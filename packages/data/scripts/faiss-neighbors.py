#!/usr/bin/env python3
"""
Batch-compute artwork neighbors using FAISS.
Replaces the slow per-artwork vec0 KNN approach.

Usage:
  pip install faiss-cpu numpy
  python3 faiss-neighbors.py [--db /data/kabinett.db] [--k 12] [--batch 50000]
"""

import argparse
import sqlite3
import time
import numpy as np
import faiss


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="/data/kabinett.db")
    p.add_argument("--k", type=int, default=12)
    p.add_argument("--batch", type=int, default=50000)
    p.add_argument("--nprobe", type=int, default=10)
    return p.parse_args()


def load_embeddings(db_path):
    print("Loading embeddings from database...")
    conn = sqlite3.connect(db_path)
    cur = conn.execute(
        "SELECT artwork_id, embedding FROM clip_embeddings ORDER BY artwork_id"
    )
    artwork_ids = []
    embeddings = []
    count = 0
    for artwork_id, emb_blob in cur:
        if len(emb_blob) != 512 * 4:
            continue
        vec = np.frombuffer(emb_blob, dtype=np.float32).copy()
        artwork_ids.append(artwork_id)
        embeddings.append(vec)
        count += 1
        if count % 100000 == 0:
            print(f"  Loaded {count} embeddings...")
    conn.close()
    artwork_ids = np.array(artwork_ids, dtype=np.int64)
    embeddings = np.vstack(embeddings).astype(np.float32)
    print(f"  Loaded {len(artwork_ids)} embeddings ({embeddings.shape})")
    return artwork_ids, embeddings


def build_index(embeddings):
    n, dim = embeddings.shape
    print(f"Building FAISS index ({n} vectors, {dim} dims)...")
    t0 = time.time()
    if n < 10000:
        index = faiss.IndexFlatIP(dim)
        faiss.normalize_L2(embeddings)
        index.add(embeddings)
    else:
        nlist = min(int(np.sqrt(n)), 4096)
        quantizer = faiss.IndexFlatIP(dim)
        index = faiss.IndexIVFFlat(quantizer, dim, nlist, faiss.METRIC_INNER_PRODUCT)
        faiss.normalize_L2(embeddings)
        print(f"  Training IVF index (nlist={nlist})...")
        index.train(embeddings)
        index.add(embeddings)
    print(f"  Index built in {time.time()-t0:.1f}s")
    return index


def batch_search(index, embeddings, k, nprobe):
    print(f"Running batch KNN search (k={k+1}, nprobe={nprobe})...")
    t0 = time.time()
    if hasattr(index, 'nprobe'):
        index.nprobe = nprobe
    distances, indices = index.search(embeddings, k + 1)
    print(f"  Search completed in {time.time()-t0:.1f}s ({len(embeddings)} queries)")
    return distances, indices


def write_neighbors(db_path, artwork_ids, distances, indices, k, batch_size):
    print("Writing neighbors to database...")
    conn = sqlite3.connect(db_path)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("DELETE FROM artwork_neighbors")
    conn.commit()
    print("  Cleared existing neighbors")

    t0 = time.time()
    total = len(artwork_ids)
    written = 0
    rows = []

    for i in range(total):
        artwork_id = int(artwork_ids[i])
        rank = 0
        for j in range(indices.shape[1]):
            neighbor_idx = int(indices[i][j])
            if neighbor_idx < 0 or neighbor_idx >= len(artwork_ids):
                continue
            neighbor_id = int(artwork_ids[neighbor_idx])
            if neighbor_id == artwork_id:
                continue
            rank += 1
            if rank > k:
                break
            rows.append((artwork_id, neighbor_id, rank, float(distances[i][j])))

        if len(rows) >= batch_size * k:
            conn.executemany(
                "INSERT INTO artwork_neighbors (artwork_id, neighbor_artwork_id, rank, distance, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
                rows
            )
            conn.commit()
            written += len(rows)
            elapsed = time.time() - t0
            print(f"  {i+1}/{total} ({(i+1)/total*100:.1f}%) - {(i+1)/elapsed:.0f} artworks/s - {written} rows written")
            rows = []

    if rows:
        conn.executemany(
            "INSERT INTO artwork_neighbors (artwork_id, neighbor_artwork_id, rank, distance, updated_at) VALUES (?, ?, ?, ?, datetime('now'))",
            rows
        )
        conn.commit()
        written += len(rows)

    conn.close()
    print(f"  Done! {written} neighbor rows written in {time.time()-t0:.1f}s")


def main():
    args = parse_args()
    t_total = time.time()
    artwork_ids, embeddings = load_embeddings(args.db)
    index = build_index(embeddings)
    distances, indices = batch_search(index, embeddings, args.k, args.nprobe)
    write_neighbors(args.db, artwork_ids, distances, indices, args.k, args.batch)
    elapsed = time.time() - t_total
    print(f"\n✅ Total time: {elapsed:.1f}s ({elapsed/60:.1f} min)")


if __name__ == "__main__":
    main()
