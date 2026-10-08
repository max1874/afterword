import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ProfileNav, useProfileNav } from "./components/profile-nav";
import { getViewer } from "./lib/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  const viewer = await getViewer(request);
  return { viewer: viewer ? { handle: viewer.handle, name: viewer.name } : null };
}

export function useRoot() {
  return useRouteLoaderData<typeof loader>("root");
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Header() {
  const root = useRoot();
  const nav = useProfileNav();
  return (
    <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-4 px-4 pt-6 pb-8 sm:px-6">
      <Link to="/" className="flex items-center gap-2.5">
        {/* The app icon, same as the favicon. */}
        <img src="/favicon.svg" alt="" className="size-8" />
        <span className="text-[19px] font-semibold">后记</span>
      </Link>
      {/* On phones the kinds take their own row under the logo. */}
      {nav ? (
        <div className="order-last w-full min-w-0 md:order-none md:flex md:w-auto md:flex-1 md:justify-center">
          <ProfileNav data={nav} />
        </div>
      ) : (
        <div className="flex-1" />
      )}
      {root?.viewer ? (
        <nav className="ml-auto flex items-center gap-4 text-sm md:ml-0">
          <Link
            to="/add"
            className="rounded-full bg-ink px-4 py-1.5 font-semibold text-paper transition hover:opacity-85"
          >
            ＋ 记一笔
          </Link>
          <Link
            to="/settings"
            title="设置"
            className="grid size-8 place-items-center rounded-full bg-gradient-to-b from-[#8e8e93] to-[#636366] text-[13px] font-semibold text-white"
          >
            {root.viewer.name.slice(0, 1).toUpperCase()}
          </Link>
        </nav>
      ) : null}
    </header>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  const root = useRoot();
  return (
    <footer className="mx-auto flex max-w-6xl justify-between border-t border-line px-4 py-6 text-xs text-muted sm:px-6">
      <a href="https://github.com/max1874/afterword" className="hover:text-ink">
        后记 Afterword · 开源
      </a>
      {root?.viewer ? null : (
        <Link to="/login" className="hover:text-ink">
          登录
        </Link>
      )}
    </footer>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "出错了";
  let details = "发生了意外错误。";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "出错了";
    details = error.status === 404 ? "这一页不存在。" : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-5xl px-4 pt-16">
      <h1 className="text-3xl font-semibold">{message}</h1>
      <p className="mt-3 text-muted">{details}</p>
      <p className="mt-6">
        <Link to="/" className="text-accent underline underline-offset-4">
          回到首页
        </Link>
      </p>
      {stack && (
        <pre className="mt-6 w-full overflow-x-auto p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
