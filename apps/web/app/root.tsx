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

export function headers() {
  return {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  };
}

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
        <main className="app-main" style={{ paddingBottom: "4.5rem" }}>{children}</main>
        <BottomNav />
        <ScrollRestoration />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: `
window.__toast=function(msg){
  var d=document.createElement('div');
  d.textContent=msg;
  d.style.cssText='position:fixed;bottom:5rem;left:50%;transform:translateX(-50%);background:rgba(10,9,8,0.85);color:#F5F0E8;padding:0.6rem 1.2rem;border-radius:999px;font-size:0.8rem;z-index:9999;pointer-events:none;opacity:0;transition:opacity 0.3s;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)';
  document.body.appendChild(d);
  requestAnimationFrame(function(){d.style.opacity='1'});
  setTimeout(function(){d.style.opacity='0';setTimeout(function(){d.remove()},300)},2000);
};
`}} />
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
          {/* Icons moved to bottom nav */}
        </div>
      </nav>
    </header>
  );
}

function BottomNav() {
  const location = useLocation();
  const { count } = useFavorites();
  const path = location.pathname;

  const isHome = path === "/";
  const isDark = path === "/" || path === "/timeline";

  const tabs = [
    {
      href: "/",
      label: "Hem",
      active: path === "/",
      icon: (color: string) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
          <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z" />
          <path d="M9 21V12h6v9" />
        </svg>
      ),
    },
    {
      href: "/discover",
      label: "Upptäck",
      active: path === "/discover",
      icon: (color: string) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill={color} opacity="0.15" stroke={color} />
        </svg>
      ),
    },
    {
      href: "/timeline",
      label: "Tidslinje",
      active: path === "/timeline",
      icon: (color: string) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
          <line x1="12" y1="2" x2="12" y2="22" />
          <circle cx="12" cy="6" r="2" fill={color} opacity="0.2" />
          <circle cx="12" cy="12" r="2" fill={color} opacity="0.2" />
          <circle cx="12" cy="18" r="2" fill={color} opacity="0.2" />
          <line x1="14" y1="6" x2="19" y2="6" />
          <line x1="5" y1="12" x2="10" y2="12" />
          <line x1="14" y1="18" x2="19" y2="18" />
        </svg>
      ),
    },
    {
      href: "/search",
      label: "Sök",
      active: path === "/search",
      icon: (color: string) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.35-4.35" />
        </svg>
      ),
    },
    {
      href: "/favorites",
      label: "Sparade",
      active: path === "/favorites",
      badge: count,
      icon: (color: string) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
          <path d="M20.8 5.6c-1.4-1.6-3.9-1.6-5.3 0L12 9.1 8.5 5.6c-1.4-1.6-3.9-1.6-5.3 0-1.6 1.8-1.4 4.6.2 6.2L12 21l8.6-9.2c1.6-1.6 1.8-4.4.2-6.2z" />
        </svg>
      ),
    },
  ];

  return (
    <nav
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 60,
        backgroundColor: isDark ? "rgba(10,9,8,0.85)" : "rgba(250,247,242,0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: isDark ? "1px solid rgba(255,255,255,0.08)" : "1px solid rgba(212,205,195,0.3)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          height: "3.2rem",
          maxWidth: "32rem",
          margin: "0 auto",
        }}
      >
        {tabs.map((tab) => {
          const color = tab.active
            ? (isDark ? "#F5F0E8" : "#3D3831")
            : (isDark ? "rgba(245,240,232,0.4)" : "rgba(61,56,49,0.35)");
          return (
            <a
              key={tab.href}
              href={tab.href}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "0.15rem",
                textDecoration: "none",
                position: "relative",
                padding: "0.25rem 0.5rem",
              }}
            >
              {tab.icon(color)}
              <span style={{
                fontSize: "0.6rem",
                fontWeight: tab.active ? 600 : 400,
                color,
                letterSpacing: "0.01em",
              }}>
                {tab.label}
              </span>
              {tab.badge && tab.badge > 0 ? (
                <span style={{
                  position: "absolute",
                  top: "0",
                  right: "0.15rem",
                  minWidth: "0.9rem",
                  height: "0.9rem",
                  padding: "0 0.15rem",
                  borderRadius: "999px",
                  background: "#C4553A",
                  color: "#fff",
                  fontSize: "0.55rem",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 600,
                }}>
                  {tab.badge}
                </span>
              ) : null}
            </a>
          );
        })}
      </div>
    </nav>
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
