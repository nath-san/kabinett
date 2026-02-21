import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("explore", "routes/explore.tsx"),
  route("colors", "routes/colors.tsx"),
  route("about", "routes/about.tsx"),
] satisfies RouteConfig;
