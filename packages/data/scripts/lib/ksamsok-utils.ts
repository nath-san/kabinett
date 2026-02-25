export const KSAMSOK_XML_PARSER_CONFIG = {
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true,
  textNodeName: "#text",
};

export function getText(node: any): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return getText(node[0]);
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

export function findAll(obj: any, key: string, acc: any[] = []): any[] {
  if (!obj || typeof obj !== "object") return acc;
  if (key in obj) {
    const value = obj[key];
    if (Array.isArray(value)) acc.push(...value);
    else acc.push(value);
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) findAll(item, key, acc);
    } else if (typeof value === "object") {
      findAll(value, key, acc);
    }
  }
  return acc;
}

export function findFirst(obj: any, key: string): any {
  if (!obj || typeof obj !== "object") return null;
  if (key in obj) return Array.isArray(obj[key]) ? obj[key][0] : obj[key];
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = findFirst(item, key);
        if (found != null) return found;
      }
    } else if (typeof value === "object") {
      const found = findFirst(value, key);
      if (found != null) return found;
    }
  }
  return null;
}

export function extractYears(
  text: string,
  options: { minYear?: number; maxYear?: number } = {},
): { start: number | null; end: number | null } {
  const minYear = options.minYear ?? 500;
  const maxYear = options.maxYear ?? 2100;

  const years = (text.match(/\d{4}/g) || [])
    .map((year) => parseInt(year, 10))
    .filter((year) => year >= minYear && year <= maxYear);

  if (years.length === 0) return { start: null, end: null };
  return { start: Math.min(...years), end: Math.max(...years) };
}
