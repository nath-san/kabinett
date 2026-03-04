#!/usr/bin/env python3
"""Build a compact FAISS IVF-PQ index + artwork_id mapping."""
import argparse
import sqlite3
import time
import json
import struct
import numpy as np
import faiss

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--db", default="/data/kabinett.db")
    p.add_argument("--out-index", default="/data/faiss.index")
    p.add_argument("--out-map", default="/data/faiss-map.bin")
    p.add_argument("--pq-m", type=int, default=64, help="PQ subquantizers (must divide 512)")
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
        sources.append(source or "")
        sub_museums.append(sub_museum or "")
        broken.append(1 if is_broken else 0)
        embeddings.append(vec)
        count += 1
        if count % 200000 == 0:
            print(f"  {count}...")
    conn.close()

    embeddings = np.vstack(embeddings).astype(np.float32)
    faiss.normalize_L2(embeddings)
    print(f"  Loaded {count} embeddings in {time.time()-t0:.1f}s")

    # Build compact IVF-PQ index
    n, dim = embeddings.shape
    nlist = min(int(np.sqrt(n)), 2048)
    m = args.pq_m  # subquantizers
    print(f"Building IVF-PQ index (nlist={nlist}, m={m})...")
    t0 = time.time()
    index = faiss.index_factory(dim, f"IVF{nlist},PQ{m}x8", faiss.METRIC_INNER_PRODUCT)
    index.train(embeddings)
    index.add(embeddings)
    print(f"  Built in {time.time()-t0:.1f}s")

    faiss.write_index(index, args.out_index)
    idx_size = os.path.getsize(args.out_index) if os.path.exists(args.out_index) else 0
    print(f"  Index written to {args.out_index} ({idx_size/1e6:.1f} MB)")

    # Write compact binary mapping (not JSON — saves ~400MB RAM)
    # Format: 4 bytes count, then per entry: 8 bytes artwork_id (int64),
    #   1 byte source_len, source bytes, 1 byte sub_museum_len, sub_museum bytes, 1 byte broken
    with open(args.out_map, "wb") as f:
        f.write(struct.pack("<I", count))
        for i in range(count):
            f.write(struct.pack("<q", artwork_ids[i]))
            src = sources[i].encode("utf-8")
            f.write(struct.pack("<B", len(src)))
            f.write(src)
            sub = sub_museums[i].encode("utf-8")
            f.write(struct.pack("<B", len(sub)))
            f.write(sub)
            f.write(struct.pack("<B", broken[i]))
    print(f"  Map written to {args.out_map}")
    print("Done!")

import os
if __name__ == "__main__":
    main()
