import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("add", "routes/add.tsx"),
  route("import", "routes/import.tsx"),
  route("api/import", "routes/api.import.ts"),
  route("api/v1/*", "routes/api.v1.ts"),
  route(".well-known/apple-app-site-association", "routes/apple-app-site-association.ts"),
  route("login", "routes/login.tsx"),
  route("login/recovery", "routes/login.recovery.tsx"),
  route("setup", "routes/setup.tsx"),
  route("join/:code", "routes/join.tsx"),
  route("settings", "routes/settings.tsx"),
  route("auth/passkey", "routes/auth.passkey.ts"),
  route("logout", "routes/logout.tsx"),
  route("covers/:key", "routes/cover.ts"),
  route("cover-proxy", "routes/cover-proxy.ts"),
  route("items/:id", "routes/item-legacy.ts"),
  // `/@handle` pages; static paths above take precedence.
  route(":profile", "routes/profile.tsx"),
  route(":profile/library", "routes/library.tsx"),
  route(":profile/items/:id", "routes/item.tsx"),
  route(":profile/items/:id/artwork", "routes/item-artwork.tsx"),
] satisfies RouteConfig;
