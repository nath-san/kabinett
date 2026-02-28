const SIZE_MAP = [
  { max: 200, shm: "thumbnail" },
  { max: 400, shm: "medium" },
  { max: Infinity, shm: "full" },
];

/**
 * Build the raw external URL for a museum image at a given width.
 */
export function externalImageUrl(iiifOrDirect: string, width: number): string {
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
 * Build an image URL. Goes direct to source for now.
 * TODO: Re-enable CDN proxy via Cloudflare Worker when ready.
 */
export function buildImageUrl(iiifOrDirect: string | null | undefined, width: number): string {
  if (!iiifOrDirect?.trim()) return "";
  return externalImageUrl(iiifOrDirect, width);
}

/**
 * Direct external URL (for OG images, etc. that need absolute URLs)
 */
export function buildDirectImageUrl(iiifOrDirect: string | null | undefined, width: number): string {
  if (!iiifOrDirect?.trim()) return "";
  return externalImageUrl(iiifOrDirect, width);
}
