import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("discover", "routes/discover.tsx"),
  route("explore", "routes/explore-redirect.tsx"),
  route("search", "routes/search.tsx"),
  route("api/autocomplete", "routes/api.autocomplete.tsx"),
  route("api/color-search", "routes/api.color-search.tsx"),
  route("timeline", "routes/timeline.tsx"),
  route("artwork/:id", "routes/artwork.tsx"),
  route("artist/:name", "routes/artist.tsx"),
  route("museum/:id", "routes/museum.tsx"),
  route("om", "routes/om.tsx"),
  route("walks", "routes/walks.tsx"),
  route("api/feed", "routes/api.feed.tsx"),
  route("api/clip-search", "routes/api.clip-search.tsx"),
  route("favorites", "routes/favorites.tsx"),
  route("color-match", "routes/color-match.tsx"),
  route("api/artworks", "routes/api.artworks.tsx"),
  route("quiz", "routes/quiz.tsx"),
  route("api/quiz-match", "routes/api.quiz-match.tsx"),
] satisfies RouteConfig;
