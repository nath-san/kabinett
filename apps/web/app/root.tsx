import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  {
    rel: "preconnect",
    href: "https://fonts.googleapis.com",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;600;700&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Header />
        <main>{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream/80 backdrop-blur-md border-b border-stone/30">
      <nav className="flex items-center justify-between px-(--spacing-page) h-14">
        <a href="/" className="font-serif text-xl font-semibold tracking-tight text-charcoal">
          Kabinett
        </a>
        <div className="flex items-center gap-5 text-sm text-warm-gray">
          <a href="/search" className="hover:text-charcoal transition-colors" aria-label="Sök">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </a>
          <a href="/explore" className="hover:text-charcoal transition-colors">
            Utforska
          </a>
          <a href="/colors" className="hover:text-charcoal transition-colors">
            Färger
          </a>
          <a href="/about" className="hover:text-charcoal transition-colors">
            Om
          </a>
        </div>
      </nav>
    </header>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "Något gick fel.";

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Fel";
    details =
      error.status === 404
        ? "Den här sidan finns inte."
        : error.statusText || details;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-(--spacing-page)">
      <h1 className="font-serif text-6xl font-bold text-charcoal">{message}</h1>
      <p className="mt-4 text-warm-gray">{details}</p>
    </div>
  );
}
