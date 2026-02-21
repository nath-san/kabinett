import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("explore", "routes/explore.tsx"),
  route("search", "routes/search.tsx"),
  route("api/autocomplete", "routes/api.autocomplete.tsx"),
  route("artwork/:id", "routes/artwork.tsx"),
  route("colors", "routes/colors.tsx"),
  route("about", "routes/about.tsx"),
] satisfies RouteConfig;
