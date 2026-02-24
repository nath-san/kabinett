import { fetchFeed } from "../lib/feed.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const cursorParam = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20"), 40);
  const filter = url.searchParams.get("filter") || "Alla";

  const cursor = cursorParam ? parseInt(cursorParam) : null;

  const result = await fetchFeed({
    cursor: Number.isNaN(cursor) ? null : cursor,
    limit,
    filter,

  });

  return Response.json(result, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
