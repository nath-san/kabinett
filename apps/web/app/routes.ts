import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("explore", "routes/explore.tsx"),
] satisfies RouteConfig;
