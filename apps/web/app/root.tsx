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
  { rel: "preconnect", href: "https://nationalmuseumse.iiifhosting.com" },
  { rel: "preconnect", href: "https://media.samlingar.shm.se" },
  { rel: "preconnect", href: "https://ems.dimu.org" },
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
        <meta name="theme-color" content="#FAF7F2" />
        <meta property="og:locale" content="sv_SE" />
        <meta property="og:site_name" content="Kabinett" />
        <meta name="robots" content="index,follow" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="icon" type="image/png" href="/favicon.png" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
        <script dangerouslySetInnerHTML={{ __html: `
window.addEventListener('error',function(event){
  var target=event&&event.target;
  if(target&&target.tagName==='IMG'){
    target.classList.add('is-broken');
  }
},true);
`}} />
        <Meta />
        <Links />
      </head>
      <body className="bg-cream text-ink font-sans antialiased m-0">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-cream focus:text-ink focus:px-4 focus:py-2 focus:rounded-full focus:shadow-lg focus-ring"
        >
          Hoppa till innehåll
        </a>
        <Header />
        <main id="main-content" className="app-main pb-[4.5rem] lg:pb-8">{children}</main>
        <BottomNav />
        <ScrollRestoration />
        <Scripts />
        <script dangerouslySetInnerHTML={{ __html: `
window.__toast=function(msg){
  var d=document.createElement('div');
  d.textContent=msg;
  d.className='app-toast';
  document.body.appendChild(d);
  requestAnimationFrame(function(){d.classList.add('app-toast--visible')});
  setTimeout(function(){d.classList.remove('app-toast--visible');setTimeout(function(){d.remove()},300)},2000);
};
`}} />
        <script dangerouslySetInnerHTML={{ __html: `
document.addEventListener('DOMContentLoaded',function(){
  document.querySelectorAll('img[loading="lazy"]').forEach(function(img){
    if(img.complete){img.classList.add('loaded')}
    else{img.addEventListener('load',function(){img.classList.add('loaded')})}
    img.addEventListener('error',function(){img.classList.add('is-broken')})
  });
  new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n.querySelectorAll){
          n.querySelectorAll('img[loading="lazy"]').forEach(function(img){
            if(img.complete){img.classList.add('loaded')}
            else{img.addEventListener('load',function(){img.classList.add('loaded')})}
            img.addEventListener('error',function(){img.classList.add('is-broken')})
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
  const path = location.pathname;
  const isHome = path === "/";

  return (
    <header
      className={[
        "fixed top-0 left-0 right-0 z-[60]",
        isHome
          ? "bg-[rgba(10,9,8,0.35)] backdrop-blur-[8px] border-b border-transparent"
          : "bg-[rgba(250,247,242,0.92)] backdrop-blur-[12px] border-b border-[rgba(212,205,195,0.3)]",
      ].join(" ")}
    >
      <nav
        aria-label="Huvudnavigering"
        className="flex items-center justify-between px-4 h-[3.5rem] max-w-6xl mx-auto"
      >
        <a
          href="/"
          aria-current={path === "/" ? "page" : undefined}
          className={[
            "font-serif text-[1.5rem] lg:text-[1.75rem] font-bold tracking-tight no-underline focus-ring",
            isHome ? "text-[#F5F0E8]" : "text-charcoal",
          ].join(" ")}
        >
          Kabinett
        </a>
        <div
          className={[
            "hidden lg:flex items-center gap-6 text-[0.9rem]",
            isHome ? "text-[rgba(245,240,232,0.85)]" : "text-warm-gray",
          ].join(" ")}
        >
          <a
            href="/discover"
            aria-current={path === "/discover" ? "page" : undefined}
            className={`${isHome ? "no-underline hover:text-[#F5F0E8]" : "no-underline hover:text-ink"} focus-ring`}
          >
            Upptäck
          </a>
          <a
            href="/timeline"
            aria-current={path === "/timeline" ? "page" : undefined}
            className={`${isHome ? "no-underline hover:text-[#F5F0E8]" : "no-underline hover:text-ink"} focus-ring`}
          >
            Tidslinje
          </a>
          <a
            href="/search"
            aria-current={path === "/search" ? "page" : undefined}
            className={`${isHome ? "no-underline hover:text-[#F5F0E8]" : "no-underline hover:text-ink"} focus-ring`}
          >
            Sök
          </a>
          <a
            href="/favorites"
            aria-current={path === "/favorites" ? "page" : undefined}
            className={`${isHome ? "no-underline hover:text-[#F5F0E8]" : "no-underline hover:text-ink"} focus-ring`}
          >
            Sparade
          </a>
          <a
            href="/om"
            aria-current={path === "/om" ? "page" : undefined}
            className={`${isHome ? "no-underline hover:text-[#F5F0E8]" : "no-underline hover:text-ink"} focus-ring`}
          >
            Om
          </a>
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
    {
      href: "/om",
      label: "Om",
      active: path === "/om",
      icon: (color: string) => (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 10v6" />
          <circle cx="12" cy="7" r="1" fill={color} />
        </svg>
      ),
    },
  ];

  return (
    <nav
      aria-label="Primär navigation"
      className={[
        "fixed bottom-0 left-0 right-0 z-[60] backdrop-blur-[16px] pb-[env(safe-area-inset-bottom)] border-t lg:hidden",
        isDark
          ? "bg-[rgba(10,9,8,0.85)] border-[rgba(255,255,255,0.08)]"
          : "bg-[rgba(250,247,242,0.92)] border-[rgba(212,205,195,0.3)]",
      ].join(" ")}
    >
      <div
        className="flex justify-around items-center h-[3.2rem] max-w-[32rem] mx-auto"
      >
        {tabs.map((tab) => {
          const color = tab.active
            ? (isDark ? "#F5F0E8" : "#3D3831")
            : (isDark ? "rgba(245,240,232,0.4)" : "rgba(61,56,49,0.35)");
          const labelClass = tab.active
            ? (isDark ? "text-[#F5F0E8]" : "text-charcoal")
            : (isDark ? "text-[rgba(245,240,232,0.4)]" : "text-[rgba(61,56,49,0.35)]");
          return (
            <a
              key={tab.href}
              href={tab.href}
              aria-current={tab.active ? "page" : undefined}
              aria-label={tab.label}
              className="flex flex-col items-center gap-[0.15rem] no-underline relative py-1 px-2 focus-ring"
            >
              {tab.icon(color)}
              <span
                className={[
                  "text-[0.6rem] tracking-[0.01em]",
                  tab.active ? "font-semibold" : "font-normal",
                  labelClass,
                ].join(" ")}
              >
                {tab.label}
              </span>
              {tab.badge && tab.badge > 0 ? (
                <span className="absolute top-0 right-[0.15rem] min-w-[0.9rem] h-[0.9rem] px-[0.15rem] rounded-full bg-accent text-white text-[0.55rem] inline-flex items-center justify-center font-semibold">
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
  const showStack = import.meta.env.DEV;
  return (
    <div className="py-[4rem] px-4 text-center min-h-screen flex flex-col items-center justify-center">
      <h1 className="font-serif text-[3rem] font-bold text-charcoal">{message}</h1>
      <p className="mt-4 text-warm-gray">{details}</p>
      {showStack && stack && (
        <pre className="mt-4 text-[0.65rem] text-[#999] text-left max-w-[90vw] overflow-auto whitespace-pre-wrap">
          {stack}
        </pre>
      )}
    </div>
  );
}
