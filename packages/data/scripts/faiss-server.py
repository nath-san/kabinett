#!/usr/bin/env python3
"""Lightweight FAISS KNN HTTP server. Runs as sidecar in the same container."""
import json
import struct
import time
import sys
import os
from http.server import HTTPServer, BaseHTTPRequestHandler

import numpy as np
import faiss

INDEX_PATH = os.environ.get("FAISS_INDEX_PATH", "/data/faiss.index")
MAP_PATH = os.environ.get("FAISS_MAP_PATH", "/data/faiss-map.json")
PORT = int(os.environ.get("FAISS_PORT", "5555"))
DEFAULT_NPROBE = 20

print(f"[FAISS] Loading index from {INDEX_PATH}...")
t0 = time.time()
index = faiss.read_index(INDEX_PATH)
if hasattr(index, 'nprobe'):
    index.nprobe = DEFAULT_NPROBE
print(f"[FAISS] Index loaded in {time.time()-t0:.1f}s ({index.ntotal} vectors)")

print(f"[FAISS] Loading map from {MAP_PATH}...")
with open(MAP_PATH) as f:
    mapping = json.load(f)
artwork_ids = mapping["artwork_ids"]
sources = mapping["sources"]
sub_museums = mapping["sub_museums"]
broken = mapping["broken"]
print(f"[FAISS] Map loaded ({len(artwork_ids)} entries)")


class KNNHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # suppress access logs

    def do_POST(self):
        if self.path != "/knn":
            self.send_response(404)
            self.end_headers()
            return

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)
        req = json.loads(body)

        # Query vector as list of 512 floats
        query_vec = np.array(req["vector"], dtype=np.float32).reshape(1, -1)
        faiss.normalize_L2(query_vec)

        k = min(req.get("k", 120), 5000)
        allowed_sources = set(req.get("allowed_sources", []))
        filter_source = req.get("filter_source")
        filter_sub_museum = req.get("filter_sub_museum")

        # Search with extra candidates to account for filtering
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
