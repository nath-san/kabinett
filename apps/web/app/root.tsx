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
      <body style={{ backgroundColor: "#FAF7F2", color: "#1A1815", fontFamily: '"Inter", system-ui, sans-serif', WebkitFontSmoothing: "antialiased", margin: 0 }}>
        <Header />
        <main>{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
      backgroundColor: "rgba(250,247,242,0.85)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      borderBottom: "1px solid rgba(212,205,195,0.3)",
    }}>
      <nav style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 1rem", height: "3.5rem" }}>
        <a href="/" style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: "1.25rem", fontWeight: 600, color: "#3D3831", textDecoration: "none" }}>
          Kabinett
        </a>

        {/* Nav links — always visible, compact on mobile */}
        <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", fontSize: "0.875rem", color: "#8C8478" }}>
          <a href="/search" style={{ color: "inherit", textDecoration: "none" }} aria-label="Sök">
            <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </a>
          <a href="/explore" style={{ color: "inherit", textDecoration: "none" }}>Utforska</a>
          <a href="/timeline" style={{ color: "inherit", textDecoration: "none" }}>Tidslinje</a>
          <a href="/colors" style={{ color: "inherit", textDecoration: "none" }}>Färger</a>
          <a href="/about" style={{ color: "inherit", textDecoration: "none" }}>Om</a>
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
  let stack = "";
  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Fel";
    details = error.status === 404 ? "Den här sidan finns inte." : error.statusText || details;
  } else if (error instanceof Error) {
    details = error.message;
    stack = error.stack || "";
  }
  return (
    <div style={{ padding: "4rem 1rem", textAlign: "center", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
      <h1 style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: "3rem", fontWeight: "bold", color: "#3D3831" }}>{message}</h1>
      <p style={{ marginTop: "1rem", color: "#8C8478" }}>{details}</p>
      {stack && <pre style={{ marginTop: "1rem", fontSize: "0.65rem", color: "#999", textAlign: "left", maxWidth: "90vw", overflow: "auto", whiteSpace: "pre-wrap" }}>{stack}</pre>}
    </div>
  );
}
