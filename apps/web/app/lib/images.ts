const SIZE_MAP = [
  { max: 200, shm: "thumbnail" },
  { max: 400, shm: "medium" },
  { max: Infinity, shm: "full" },
];

export function buildImageUrl(iiifOrDirect: string, width: number): string {
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

  return normalized + `full/${width},/0/default.jpg`;
}
