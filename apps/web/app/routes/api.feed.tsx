import { fetchFeed } from "../lib/feed.server";
import type { LoaderFunctionArgs } from "react-router";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const cursorParam = url.searchParams.get("cursor");
  const rawLimit = Number.parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 40) : 20;
  const filter = url.searchParams.get("filter") || "Alla";

  const parsedCursor = cursorParam ? Number.parseInt(cursorParam, 10) : null;
  const cursor = Number.isFinite(parsedCursor) ? parsedCursor : null;

  const result = await fetchFeed({ cursor, limit, filter });

  return Response.json(result, {
    headers: { "Cache-Control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
