import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { useFavorites } from "./lib/favorites";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=DM+Sans:wght@400;500;600&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#3D3831" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <Meta />
        <Links />
      </head>
      <body style={{ backgroundColor: "#FAF7F2", color: "#1A1815", fontFamily: '"DM Sans", system-ui, sans-serif', WebkitFontSmoothing: "antialiased", margin: 0 }}>
        <Header />
        <main className="app-main">{children}</main>
        <ScrollRestoration />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: `
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('img[loading="lazy"]').forEach(function(img){
    if(img.complete){img.classList.add('loaded')}
    else{img.addEventListener('load',function(){img.classList.add('loaded')})}
  });
  new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.querySelectorAll){
          n.querySelectorAll('img[loading="lazy"]').forEach(function(img){
            if(img.complete){img.classList.add('loaded')}
            else{img.addEventListener('load',function(){img.classList.add('loaded')})}
          });
        }
      });
    });
  }).observe(document.body,{childList:true,subtree:true});
});
        `}} />
      </body>
    </html>
  );
}

function Header() {
  const location = useLocation();
  const isHome = location.pathname === "/";
  const { count } = useFavorites();

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        backgroundColor: isHome ? "rgba(10,9,8,0.35)" : "rgba(250,247,242,0.92)",
        backdropFilter: isHome ? "blur(8px)" : "blur(12px)",
        WebkitBackdropFilter: isHome ? "blur(8px)" : "blur(12px)",
        borderBottom: isHome ? "none" : "1px solid rgba(212,205,195,0.3)",
      }}
    >
      <nav
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 1rem",
          height: "3.5rem",
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: '"Instrument Serif", Georgia, serif',
            fontSize: "1.25rem",
            fontWeight: 600,
            color: isHome ? "#F5F0E8" : "#3D3831",
            textDecoration: "none",
          }}
        >
          Kabinett
        </a>
        <div style={{ display: "flex", alignItems: "center", gap: "0.85rem" }}>
          <a
            href="/favorites"
            style={{
              color: isHome ? "#F5F0E8" : "#3D3831",
              textDecoration: "none",
              display: "flex",
              position: "relative",
            }}
            aria-label="Favoriter"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.8 5.6c-1.4-1.6-3.9-1.6-5.3 0L12 9.1 8.5 5.6c-1.4-1.6-3.9-1.6-5.3 0-1.6 1.8-1.4 4.6.2 6.2L12 21l8.6-9.2c1.6-1.6 1.8-4.4.2-6.2z" />
            </svg>
            {count > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: "-0.3rem",
                  right: "-0.45rem",
                  minWidth: "1rem",
                  height: "1rem",
                  padding: "0 0.2rem",
                  borderRadius: "999px",
                  background: "#C4553A",
                  color: "#fff",
                  fontSize: "0.6rem",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                }}
              >
                {count}
              </span>
            )}
          </a>
          <a
            href="/search"
            style={{
              color: isHome ? "#F5F0E8" : "#3D3831",
              textDecoration: "none",
              display: "flex",
            }}
            aria-label="Sök"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
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
      <h1 style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: "3rem", fontWeight: "bold", color: "#3D3831" }}>{message}</h1>
      <p style={{ marginTop: "1rem", color: "#8C8478" }}>{details}</p>
      {stack && <pre style={{ marginTop: "1rem", fontSize: "0.65rem", color: "#999", textAlign: "left", maxWidth: "90vw", overflow: "auto", whiteSpace: "pre-wrap" }}>{stack}</pre>}
    </div>
  );
}
