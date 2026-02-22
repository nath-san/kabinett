import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useState } from "react";

import type { Route } from "./+types/root";
import "./app.css";

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
        <style dangerouslySetInnerHTML={{ __html: `
          #bottom-nav { display: none; }
          .top-nav-links-ssr { display: flex; }
          @media (max-width: 767px) {
            #bottom-nav { display: flex !important; }
            .top-nav-links-ssr { display: none !important; }
            .top-header-nav { justify-content: center !important; }
            main { padding-bottom: 7rem; }
          }
        `}} />
      </head>
      <body style={{ backgroundColor: "#FAF7F2", color: "#1A1815", fontFamily: '"DM Sans", system-ui, sans-serif', WebkitFontSmoothing: "antialiased", margin: 0 }}>
        <Header />
        <main className="app-main">{children}</main>
        <BottomNav />
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
  return (
    <header style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
      backgroundColor: "rgba(250,247,242,0.85)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
      borderBottom: "1px solid rgba(212,205,195,0.3)",
    }}>
      <nav className="top-header-nav" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 1rem", height: "3.5rem" }}>
        <a href="/" style={{ fontFamily: '"Instrument Serif", Georgia, serif', fontSize: "1.25rem", fontWeight: 600, color: "#3D3831", textDecoration: "none" }}>
          Kabinett
        </a>

        <div className="top-nav-links-ssr" style={{ alignItems: "center", gap: "1.25rem", fontSize: "0.875rem", color: "#8C8478" }}>
          <a href="/search" style={{ color: "inherit", textDecoration: "none" }} aria-label="Sök">
            <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
          </a>
          <a href="/explore" style={{ color: "inherit", textDecoration: "none" }}>Utforska</a>
          <a href="/walks" style={{ color: "inherit", textDecoration: "none" }}>Vandringar</a>
        </div>
      </nav>
    </header>
  );
}

function BottomNav() {
  const location = useLocation();
  const navItems = [
    { href: "/search", label: "Sök", icon: (
      <svg style={{ width: 18, height: 18 }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
      </svg>
    ) },
    { href: "/explore", label: "Utforska" },
    { href: "/discover", label: "Upptäck" },
    { href: "/walks", label: "Vandringar" },
  ];

  const isActive = (href: string) => location.pathname === href || location.pathname.startsWith(`${href}/`);

  return (
    <nav
      id="bottom-nav"
      aria-label="Primär navigation"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 24,
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: "1.25rem",
        padding: "0.85rem 1.25rem",
        borderRadius: "999px",
        backgroundColor: "rgba(250,247,242,0.85)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        border: "1px solid rgba(212,205,195,0.55)",
        boxShadow: "0 12px 30px rgba(0,0,0,0.12)",
        zIndex: 60,
      }}
    >
      {navItems.map((item) => {
        const active = isActive(item.href);
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.45rem",
              fontSize: "0.9rem",
              fontWeight: active ? 600 : 500,
              color: active ? "#3D3831" : "#8C8478",
              textDecoration: "none",
              padding: "0.25rem 0.35rem",
            }}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        );
      })}
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
