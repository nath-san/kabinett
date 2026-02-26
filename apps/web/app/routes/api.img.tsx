import type { Route } from "./+types/api.img";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Image proxy — fetches, converts to WebP/AVIF, caches to disk.
// Concurrency-limited to avoid CPU overload.

const ALLOWED_HOSTS = new Set([
  "nationalmuseumse.iiifhosting.com",
  "media.samlingar.shm.se",
  "ems.dimu.org",
]);

// Disk cache directory
const CACHE_DIR = process.env.IMG_CACHE_DIR || "/tmp/img-cache";
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

// Concurrency control — max 2 simultaneous sharp operations
const MAX_CONCURRENT = 2;
let activeCount = 0;
const queue: Array<{ resolve: (v: void) => void }> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push({ resolve }));
}

function releaseSlot() {
  const next = queue.shift();
  if (next) {
    next.resolve();
  } else {
    activeCount--;
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const src = url.searchParams.get("url");
  const width = Math.min(Math.max(parseInt(url.searchParams.get("w") || "400", 10) || 400, 32), 1200);
  const quality = Math.min(Math.max(parseInt(url.searchParams.get("q") || "80", 10) || 80, 10), 100);

  if (!src) return new Response("Missing url param", { status: 400 });

  let srcUrl: URL;
  try { srcUrl = new URL(src); } catch { return new Response("Invalid url", { status: 400 }); }
  if (!ALLOWED_HOSTS.has(srcUrl.hostname)) return new Response("Origin not allowed", { status: 403 });

  const accept = request.headers.get("accept") || "";
  const format = accept.includes("image/avif") ? "avif" : accept.includes("image/webp") ? "webp" : "jpg";
  const contentTypes: Record<string, string> = { avif: "image/avif", webp: "image/webp", jpg: "image/jpeg" };

  // Check disk cache
  const hash = createHash("md5").update(`${src}|${width}|${quality}|${format}`).digest("hex");
  const cachePath = join(CACHE_DIR, `${hash}.${format}`);

  if (existsSync(cachePath)) {
    const cached = readFileSync(cachePath);
    return new Response(cached, {
      headers: {
        "Content-Type": contentTypes[format],
        "Cache-Control": "public, max-age=31536000, immutable",
        "CDN-Cache-Control": "public, max-age=31536000, immutable",
        "Vary": "Accept",
        "X-Cache": "HIT",
      },
    });
  }

  // Wait for a processing slot
  await acquireSlot();

  try {
    // Double-check cache (another request may have filled it while we waited)
    if (existsSync(cachePath)) {
      const cached = readFileSync(cachePath);
      return new Response(cached, {
        headers: {
          "Content-Type": contentTypes[format],
          "Cache-Control": "public, max-age=31536000, immutable",
          "CDN-Cache-Control": "public, max-age=31536000, immutable",
          "Vary": "Accept",
          "X-Cache": "HIT",
        },
      });
    }

    // Fetch original
    let res: globalThis.Response;
    try {
      res = await fetch(src, {
        headers: { "User-Agent": "Kabinett/1.0 (image-proxy)" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return new Response("Upstream fetch failed", { status: 502 });
    }
    if (!res.ok) return new Response("Upstream error", { status: res.status });

    const buffer = Buffer.from(await res.arrayBuffer());

    // Process with sharp
    let sharp: typeof import("sharp");
    try {
      sharp = (await import("sharp")).default;
    } catch {
      // sharp not available — pass through
      return new Response(buffer, {
        headers: {
          "Content-Type": res.headers.get("content-type") || "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    let pipeline = sharp(buffer).resize(width, undefined, {
      fit: "inside",
      withoutEnlargement: true,
    });

    if (format === "avif") {
      pipeline = pipeline.avif({ quality, effort: 2 }); // effort 2 = fast
    } else if (format === "webp") {
      pipeline = pipeline.webp({ quality });
    } else {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    }

    const output = await pipeline.toBuffer();

    // Save to disk cache (fire-and-forget)
    try { writeFileSync(cachePath, output); } catch { /* ignore disk errors */ }

    return new Response(output, {
      headers: {
        "Content-Type": contentTypes[format],
        "Cache-Control": "public, max-age=31536000, immutable",
        "CDN-Cache-Control": "public, max-age=31536000, immutable",
        "Vary": "Accept",
        "X-Cache": "MISS",
      },
    });
  } finally {
    releaseSlot();
  }
}
