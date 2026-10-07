import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("items/:id", "routes/item.tsx"),
  route("add", "routes/add.tsx"),
  route("import", "routes/import.tsx"),
  route("api/import", "routes/api.import.ts"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  route("covers/:key", "routes/cover.ts"),
  route("cover-proxy", "routes/cover-proxy.ts"),
] satisfies RouteConfig;
