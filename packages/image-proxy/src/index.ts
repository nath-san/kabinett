interface Env {
  IMAGES: R2Bucket;
  ALLOWED_ORIGINS: string;
}

const ALLOWED_HOSTS = new Set([
  "nationalmuseum.dfrn.se",
  "nationalmuseumse.iiifhosting.com",
  "nationalmuseum.iiifhosting.com",
  "media.samlingar.shm.se",
  "ems.dimu.org",
]);

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const matched = origin && allowed.includes(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": matched || allowed[0],
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Max-Age": "86400",
  };
}

function cacheKey(targetUrl: string): string {
  try {
    const t = new URL(targetUrl);
    return `${t.host}${t.pathname}${t.search}`.replace(/[^a-zA-Z0-9._\-\/]/g, "_");
  } catch {
    return "";
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: cors });
    }

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { ...cors, "Content-Type": "text/plain" } });
    }

    const targetUrl = url.searchParams.get("url");
    if (!targetUrl) {
      return new Response("Missing ?url= parameter", { status: 400, headers: cors });
    }

    let target: URL;
    try {
      target = new URL(targetUrl);
    } catch {
      return new Response("Invalid URL", { status: 400, headers: cors });
    }

    if (!ALLOWED_HOSTS.has(target.host)) {
      return new Response("Host not allowed", { status: 403, headers: cors });
    }

    const key = cacheKey(targetUrl);
    if (!key) {
      return new Response("Invalid URL", { status: 400, headers: cors });
    }

    // Check R2 cache
    const cached = await env.IMAGES.get(key);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          ...cors,
          "Content-Type": cached.httpMetadata?.contentType || "image/jpeg",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Cache": "HIT",
        },
      });
    }

    // Fetch from museum
    let response: Response;
    try {
      response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Kabinett/1.0 (image proxy; kontakt@norrava.com)",
          "Accept": "image/*",
        },
      });
    } catch {
      return new Response("Upstream fetch failed", { status: 502, headers: cors });
    }

    if (!response.ok) {
      return new Response("Upstream error", { status: response.status, headers: cors });
    }

    const contentType = response.headers.get("Content-Type") || "image/jpeg";
    const body = await response.arrayBuffer();

    // Store in R2 (don't block response)
    try {
      await env.IMAGES.put(key, body, {
        httpMetadata: { contentType },
      });
    } catch {
      // R2 write failed, still serve the image
    }

    return new Response(body, {
      headers: {
        ...cors,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Cache": "MISS",
      },
    });
  },
} satisfies ExportedHandler<Env>;
