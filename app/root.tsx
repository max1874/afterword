import { env } from "cloudflare:workers";
import {
  Form,
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
import { isOwner } from "./lib/session.server";

export async function loader({ request }: Route.LoaderArgs) {
  return { owner: await isOwner(request), ownerName: env.OWNER_NAME || "我" };
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
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-8 pb-6 sm:px-6">
      <Link to="/" className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-[3px] bg-seal text-lg font-semibold text-seal-ink">
          记
        </span>
        <span className="text-2xl font-semibold tracking-[0.08em]">后记</span>
      </Link>
      {root?.owner ? (
        <nav className="flex items-center gap-4 text-sm">
          <Link
            to="/add"
            className="rounded-full bg-ink px-4 py-1.5 text-paper transition hover:opacity-85"
          >
            ＋ 记一笔
          </Link>
          <Form method="post" action="/logout">
            <button className="text-muted hover:text-ink">退出</button>
          </Form>
        </nav>
      ) : null}
    </header>
  );
}

export default function App() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

function Footer() {
  const root = useRoot();
  return (
    <footer className="mx-auto flex max-w-5xl justify-between border-t border-line px-4 py-6 text-xs text-muted sm:px-6">
      <a href="https://github.com/max1874/afterword" className="hover:text-ink">
        后记 Afterword · 开源
      </a>
      {root?.owner ? null : (
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
        <Link to="/" className="text-seal underline underline-offset-4">
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
