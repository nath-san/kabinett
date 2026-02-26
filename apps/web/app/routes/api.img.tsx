import type { Route } from "./+types/api.img";

// Image proxy — fetches external museum images, converts to WebP,
// resizes with sharp, and serves with immutable cache headers.
// URL: /api/img?url=<encoded_url>&w=<width>&q=<quality>

// Allowlisted origins — only proxy images from known museum servers
const ALLOWED_HOSTS = new Set([
  "nationalmuseumse.iiifhosting.com",
  "media.samlingar.shm.se",
  "ems.dimu.org",
]);

// In-flight dedup — avoid fetching the same image twice simultaneously
const inFlight = new Map<string, Promise<Response>>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const src = url.searchParams.get("url");
  const width = Math.min(Math.max(parseInt(url.searchParams.get("w") || "400", 10) || 400, 32), 1200);
  const quality = Math.min(Math.max(parseInt(url.searchParams.get("q") || "80", 10) || 80, 10), 100);

  if (!src) {
    return new Response("Missing url param", { status: 400 });
  }

  // Validate origin
  let srcUrl: URL;
  try {
    srcUrl = new URL(src);
  } catch {
    return new Response("Invalid url", { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(srcUrl.hostname)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  // Check Accept header for format support
  const accept = request.headers.get("accept") || "";
  const supportsAvif = accept.includes("image/avif");
  const supportsWebp = accept.includes("image/webp");

  const cacheKey = `${src}|${width}|${quality}|${supportsAvif ? "avif" : supportsWebp ? "webp" : "jpg"}`;

  // Dedup in-flight requests
  const existing = inFlight.get(cacheKey);
  if (existing) {
    return existing.then((r) => r.clone());
  }

  const promise = processImage(src, width, quality, supportsAvif, supportsWebp);
  inFlight.set(cacheKey, promise);

  try {
    const response = await promise;
    return response;
  } finally {
    // Clean up after a short delay (allow clones to resolve)
    setTimeout(() => inFlight.delete(cacheKey), 1000);
  }
}

async function processImage(
  src: string,
  width: number,
  quality: number,
  supportsAvif: boolean,
  supportsWebp: boolean,
): Promise<Response> {
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

  if (!res.ok) {
    return new Response("Upstream error", { status: res.status });
  }

  const buffer = Buffer.from(await res.arrayBuffer());

  // Process with sharp
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default;
  } catch {
    // sharp not available — pass through original with cache headers
    return new Response(buffer, {
      headers: {
        "Content-Type": res.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "public, max-age=31536000, immutable",
        "CDN-Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  let pipeline = sharp(buffer).resize(width, undefined, {
    fit: "inside",
    withoutEnlargement: true,
  });

  let contentType: string;

  if (supportsAvif) {
    pipeline = pipeline.avif({ quality, effort: 4 });
    contentType = "image/avif";
  } else if (supportsWebp) {
    pipeline = pipeline.webp({ quality });
    contentType = "image/webp";
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
    contentType = "image/jpeg";
  }

  const output = await pipeline.toBuffer();

  return new Response(output, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
      "CDN-Cache-Control": "public, max-age=31536000, immutable",
      "Vary": "Accept",
    },
  });
}
