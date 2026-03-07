const SIZE_MAP = [
  { max: 200, shm: "thumbnail" },
  { max: 400, shm: "medium" },
  { max: Infinity, shm: "medium" },
];

const DEFAULT_IMAGE_PROXY_URL = "https://img.norrava.com";

function getEnv(name: string): string {
  const viteValue = (import.meta.env as Record<string, string | undefined> | undefined)?.[name];
  if (typeof viteValue === "string" && viteValue.trim()) return viteValue.trim();
  const processValue = typeof process !== "undefined" ? process.env[name] : undefined;
  if (typeof processValue === "string" && processValue.trim()) return processValue.trim();
  return "";
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

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

const IMAGE_PROXY_URL = normalizeBaseUrl(
  getEnv("VITE_IMAGE_PROXY_URL") || getEnv("KABINETT_IMAGE_PROXY_URL") || DEFAULT_IMAGE_PROXY_URL
);

/**
 * Build an image URL via Cloudflare R2 proxy for fast cached delivery.
 */
export function buildImageUrl(iiifOrDirect: string | null | undefined, width: number): string {
  if (!iiifOrDirect?.trim()) return "";
  const direct = externalImageUrl(iiifOrDirect, width);
  return `${IMAGE_PROXY_URL}/?url=${encodeURIComponent(direct)}`;
}

/**
 * Direct external URL (for OG images, etc. that need absolute URLs)
 */
export function buildDirectImageUrl(iiifOrDirect: string | null | undefined, width: number): string {
  if (!iiifOrDirect?.trim()) return "";
  return externalImageUrl(iiifOrDirect, width);
}
