#!/usr/bin/env python3
"""Build a FAISS IVF index file + artwork_id mapping for the KNN sidecar."""
import argparse
import sqlite3
import time
import json
import numpy as np
import faiss

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="/data/kabinett.db")
    p.add_argument("--out-index", default="/data/faiss.index")
    p.add_argument("--out-map", default="/data/faiss-map.json")
    args = p.parse_args()

    print("Loading embeddings...")
    t0 = time.time()
    conn = sqlite3.connect(args.db)
    cur = conn.execute(
        "SELECT c.artwork_id, c.embedding, a.source, a.sub_museum, "
        "CASE WHEN b.artwork_id IS NULL THEN 0 ELSE 1 END as is_broken "
        "FROM clip_embeddings c "
        "JOIN artworks a ON a.id = c.artwork_id "
        "LEFT JOIN broken_images b ON b.artwork_id = c.artwork_id "
        "ORDER BY c.artwork_id"
    )
    artwork_ids = []
    sources = []
    sub_museums = []
    broken = []
    embeddings = []
    count = 0
    for artwork_id, emb_blob, source, sub_museum, is_broken in cur:
        if len(emb_blob) != 512 * 4:
            continue
        vec = np.frombuffer(emb_blob, dtype=np.float32).copy()
        artwork_ids.append(artwork_id)
        sources.append(source)
        sub_museums.append(sub_museum)
        broken.append(bool(is_broken))
        embeddings.append(vec)
        count += 1
        if count % 200000 == 0:
            print(f"  {count}...")
    conn.close()

    embeddings = np.vstack(embeddings).astype(np.float32)
    faiss.normalize_L2(embeddings)
    print(f"  Loaded {count} embeddings in {time.time()-t0:.1f}s")

    # Build IVF index
    n, dim = embeddings.shape
    nlist = min(int(np.sqrt(n)), 4096)
    print(f"Building IVF index (nlist={nlist})...")
    t0 = time.time()
    quantizer = faiss.IndexFlatIP(dim)
    index = faiss.IndexIVFFlat(quantizer, dim, nlist, faiss.METRIC_INNER_PRODUCT)
    index.train(embeddings)
    index.add(embeddings)
    print(f"  Built in {time.time()-t0:.1f}s")

    faiss.write_index(index, args.out_index)
    print(f"  Index written to {args.out_index}")

    # Write mapping
    mapping = {
        "artwork_ids": artwork_ids,
        "sources": sources,
        "sub_museums": sub_museums,
        "broken": broken,
    }
    with open(args.out_map, "w") as f:
        json.dump(mapping, f)
    print(f"  Map written to {args.out_map} ({count} entries)")
    print(f"Done!")

if __name__ == "__main__":
    main()
