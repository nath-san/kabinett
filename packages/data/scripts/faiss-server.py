#!/usr/bin/env python3
"""Lightweight FAISS KNN HTTP server with compact binary map."""
import json
import struct
import time
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

import numpy as np
import faiss

INDEX_PATH = os.environ.get("FAISS_INDEX_PATH", "/data/faiss.index")
MAP_PATH = os.environ.get("FAISS_MAP_PATH", "/data/faiss-map.bin")
PORT = int(os.environ.get("FAISS_PORT", "5555"))
DEFAULT_NPROBE = 20

print(f"[FAISS] Loading index from {INDEX_PATH}...")
t0 = time.time()
index = faiss.read_index(INDEX_PATH)
if hasattr(index, 'nprobe'):
    index.nprobe = DEFAULT_NPROBE
print(f"[FAISS] Index loaded in {time.time()-t0:.1f}s ({index.ntotal} vectors)")

print(f"[FAISS] Loading map from {MAP_PATH}...")
t0 = time.time()
with open(MAP_PATH, "rb") as f:
    count = struct.unpack("<I", f.read(4))[0]
    artwork_ids = []
    sources = []
    sub_museums = []
    broken = []
    for _ in range(count):
        aid = struct.unpack("<q", f.read(8))[0]
        src_len = struct.unpack("<B", f.read(1))[0]
        src = f.read(src_len).decode("utf-8")
        sub_len = struct.unpack("<B", f.read(1))[0]
        sub = f.read(sub_len).decode("utf-8")
        brk = struct.unpack("<B", f.read(1))[0]
        artwork_ids.append(aid)
        sources.append(src)
        sub_museums.append(sub)
        broken.append(bool(brk))
print(f"[FAISS] Map loaded in {time.time()-t0:.1f}s ({len(artwork_ids)} entries)")


class KNNHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_POST(self):
        if self.path != "/knn":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        req = json.loads(body)

        query_vec = np.array(req["vector"], dtype=np.float32).reshape(1, -1)
        faiss.normalize_L2(query_vec)

        k = min(req.get("k", 120), 5000)
        allowed_sources = set(req.get("allowed_sources", []))
        filter_source = req.get("filter_source")
        filter_sub_museum = req.get("filter_sub_museum")

        search_k = min(k * 4, index.ntotal)
        distances, indices = index.search(query_vec, search_k)

        results = []
        for i in range(indices.shape[1]):
            idx = int(indices[0][i])
            if idx < 0 or idx >= len(artwork_ids):
                continue
            if broken[idx]:
                continue
            src = sources[idx]
            if allowed_sources and src not in allowed_sources:
                continue
            if filter_sub_museum:
                if src != "shm" or sub_museums[idx] != filter_sub_museum:
                    continue
            elif filter_source:
                if src != filter_source:
                    continue
            results.append({
                "artwork_id": artwork_ids[idx],
                "distance": float(distances[0][i]),
            })
            if len(results) >= k:
                break

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"results": results}).encode())

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "vectors": index.ntotal}).encode())
            return
        self.send_response(404)
        self.end_headers()


print(f"[FAISS] Server starting on port {PORT}...")
server = HTTPServer(("127.0.0.1", PORT), KNNHandler)
print(f"[FAISS] Ready!")
server.serve_forever()
