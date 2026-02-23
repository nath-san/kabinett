import type { LoaderFunctionArgs } from "react-router";
import { clipSearch } from "../lib/clip-search.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0"), 0);

  if (!q) return Response.json([]);

  const results = await clipSearch(q, limit, offset);
  return Response.json(results);
}
