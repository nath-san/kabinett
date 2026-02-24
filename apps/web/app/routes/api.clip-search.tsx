import type { LoaderFunctionArgs } from "react-router";
import { clipSearch } from "../lib/clip-search.server";
import { isMuseumEnabled } from "../lib/museums.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 140);
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const rawOffset = Number.parseInt(url.searchParams.get("offset") || "0", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 20;
  const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;
  const museum = url.searchParams.get("museum")?.trim().toLowerCase() || "";

  if (!q) return Response.json([]);

  const scoped = museum && isMuseumEnabled(museum) ? museum : undefined;
  try {
    const results = await clipSearch(q, limit, offset, scoped);
    return Response.json(results);
  } catch {
    return Response.json([]);
  }
}
