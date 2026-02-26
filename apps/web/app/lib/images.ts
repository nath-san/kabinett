const SIZE_MAP = [
  { max: 200, shm: "thumbnail" },
  { max: 400, shm: "medium" },
  { max: Infinity, shm: "full" },
];

/**
 * Build the raw external URL for a museum image at a given width.
 * Used internally and as the source URL for the image proxy.
 */
function externalImageUrl(iiifOrDirect: string, width: number): string {
  const normalized = iiifOrDirect.replace("http://", "https://");

  const shmMatch = normalized.match(/\/(thumb|thumbnail|medium|full)(\?.*)?$/);
  if (shmMatch) {
    const target = SIZE_MAP.find((s) => width <= s.max)?.shm || "full";
    return normalized.replace(/\/(thumb|thumbnail|medium|full)(\?.*)?$/, `/${target}$2`);
  }

  // Nordiska museet (ems.dimu.org) — resize via dimension param
  if (normalized.includes("ems.dimu.org")) {
    return normalized.replace(/dimension=\d+x\d+/, `dimension=${width}x${width}`);
  }

  const iiifBase = normalized.endsWith("/") ? normalized : `${normalized}/`;
  return `${iiifBase}full/${width},/0/default.jpg`;
}

/**
 * Build an image URL routed through Cloudflare CDN edge cache.
 * Falls back to direct URL for hosts not in the CDN allowlist.
 */
export function buildImageUrl(iiifOrDirect: string | null | undefined, width: number): string {
  if (!iiifOrDirect?.trim()) return "";
  const src = externalImageUrl(iiifOrDirect, width);
  try {
    const hostname = new URL(src).hostname;
    const cdnHosts = [
      "nationalmuseumse.iiifhosting.com",
      "media.samlingar.shm.se",
      "ems.dimu.org",
    ];
    if (cdnHosts.includes(hostname)) {
      return `/cdn/img?url=${encodeURIComponent(src)}`;
    }
  } catch {}
  return src;
}

/**
 * Proxied image URL — WebP/AVIF conversion via /api/img.
 * Use sparingly (e.g. hero image, single artwork view).
 */
export function proxyImageUrl(iiifOrDirect: string | null | undefined, width: number): string {
  if (!iiifOrDirect?.trim()) return "";
  const src = externalImageUrl(iiifOrDirect, width);
  return `/api/img?url=${encodeURIComponent(src)}&w=${width}`;
}

/**
 * Direct external URL (for OG images, etc. that need absolute URLs)
 */
export function buildDirectImageUrl(iiifOrDirect: string | null | undefined, width: number): string {
  if (!iiifOrDirect?.trim()) return "";
  return externalImageUrl(iiifOrDirect, width);
}
