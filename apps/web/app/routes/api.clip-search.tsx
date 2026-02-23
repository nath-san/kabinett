import type { LoaderFunctionArgs } from "react-router";
import { clipSearch } from "../lib/clip-search.server";
import { isMuseumEnabled } from "../lib/museums.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);
  const museum = url.searchParams.get("museum")?.trim().toLowerCase() || "";

  if (!q) return Response.json([]);

  const scoped = museum && isMuseumEnabled(museum) ? museum : undefined;
  const results = await clipSearch(q, limit, offset, scoped);
  return Response.json(results);
}
