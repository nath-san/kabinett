import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { useState } from "react";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
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
        <meta name="theme-color" content="#FAF7F2" />
        <Meta />
        <Links />
      </head>
      <body>
        <Header />
        <main className="animate-fadeIn">{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-cream/80 backdrop-blur-md border-b border-stone/20">
      <nav className="flex items-center justify-between px-(--spacing-page) h-14">
        <a href="/" className="font-serif text-xl font-semibold tracking-tight text-charcoal">
          Kabinett
        </a>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-6 text-sm text-warm-gray">
          <a href="/search" className="hover:text-charcoal transition-colors" aria-label="Sök">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </a>
          <a href="/explore" className="hover:text-charcoal transition-colors">Utforska</a>
          <a href="/colors" className="hover:text-charcoal transition-colors">Färger</a>
          <a href="/about" className="hover:text-charcoal transition-colors">Om</a>
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2 -mr-2 text-charcoal"
          aria-label="Meny"
        >
          {menuOpen ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div className="md:hidden bg-cream/95 backdrop-blur-lg border-b border-stone/20 animate-slideDown">
          <div className="flex flex-col px-(--spacing-page) py-4 gap-4">
            <a href="/search" className="flex items-center gap-3 text-charcoal text-base font-medium" onClick={() => setMenuOpen(false)}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              Sök
            </a>
            <a href="/explore" className="text-charcoal text-base font-medium" onClick={() => setMenuOpen(false)}>Utforska</a>
            <a href="/colors" className="text-charcoal text-base font-medium" onClick={() => setMenuOpen(false)}>Färger</a>
            <a href="/about" className="text-charcoal text-base font-medium" onClick={() => setMenuOpen(false)}>Om</a>
          </div>
        </div>
      )}
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
    details = error.status === 404 ? "Den här sidan finns inte." : error.statusText || details;
  }
  return (
    <div className="flex flex-col items-center justify-center min-h-screen px-(--spacing-page)">
      <h1 className="font-serif text-6xl font-bold text-charcoal">{message}</h1>
      <p className="mt-4 text-warm-gray">{details}</p>
    </div>
  );
}
