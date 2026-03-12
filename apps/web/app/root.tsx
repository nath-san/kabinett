import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigation,
} from "react-router";

import type { Route } from "./+types/root";
import "./fonts.css";
import "./app.css";
import { useFavorites } from "./lib/favorites";
import { ensureRequestContext } from "./lib/request-context.server";

export function headers() {
  return {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
  };
}

export function loader({ request }: Route.LoaderArgs) {
  // Set campaign context (via AsyncLocalStorage.enterWith) so all child
  // loaders see the correct museum filter based on the request hostname.
  ensureRequestContext(request);
  return null;
}

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://nationalmuseumse.iiifhosting.com" },
  // SHM preconnect disabled until SHM is enabled
  // { rel: "preconnect", href: "https://media.samlingar.shm.se" },
  { rel: "preconnect", href: "https://ems.dimu.org" },
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
        {/* Cloudflare Web Analytics */}
        <script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon='{"token":"f5cecb07f7fc4aaa97824680349461e0"}'
        />
        <style dangerouslySetInnerHTML={{ __html: `
          @keyframes loading-bar {
            0% { width: 0%; margin-left: 0; }
            50% { width: 60%; margin-left: 20%; }
            100% { width: 0%; margin-left: 100%; }
          }
        `}} />
      </head>
      <body className="bg-cream text-ink font-sans antialiased m-0">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:bg-cream focus:text-ink focus:px-4 focus:py-2 focus:rounded-full focus:shadow-lg focus-ring"
        >
          Hoppa till innehåll
        </a>
        <Header />
        <main id="main-content" className="app-main pb-[7rem] lg:pb-0">{children}</main>
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
      </body>
    </html>
  );
}

function useIsLightPage() {
  const path = useLocation().pathname;
  return (
    path.startsWith("/artwork/") ||
    path.startsWith("/artist/") ||
    path.startsWith("/samling/") ||
    path.startsWith("/museum/") ||
    path.startsWith("/color-match")
  );
}

function NavLink({
  href,
  label,
  path,
  isDark,
}: {
  href: string;
  label: string;
  path: string;
  isDark: boolean;
}) {
  const isActive = path === href || (href !== "/" && path.startsWith(href));
  return (
    <a
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={[
        "no-underline transition-colors focus-ring relative pb-0.5",
        isDark ? "hover:text-dark-text" : "hover:text-ink",
        isActive
          ? isDark
            ? "text-dark-text font-medium"
            : "text-charcoal font-medium"
          : "",
      ].join(" ")}
    >
      {label}
      {isActive && (
        <span
          className={[
            "absolute left-0 right-0 -bottom-[0.35rem] h-[1.5px] rounded-full",
            isDark ? "bg-dark-text/50" : "bg-charcoal/40",
          ].join(" ")}
        />
      )}
    </a>
  );
}

function Header() {
  const location = useLocation();
  const path = location.pathname;
  const isLight = useIsLightPage();
  const isDark = !isLight;

  return (
    <header
      className={[
        "fixed top-0 left-0 right-0 z-[60]",
        isDark
          ? "bg-[rgba(10,9,8,0.45)] backdrop-blur-[10px] border-b border-[rgba(255,255,255,0.04)]"
          : "bg-[rgba(250,247,242,0.92)] backdrop-blur-[12px] border-b border-[rgba(212,205,195,0.25)]",
      ].join(" ")}
    >
      <nav
        aria-label="Huvudnavigering"
        className="flex items-center justify-between px-5 md:px-6 lg:px-8 h-[3.5rem] max-w-7xl mx-auto"
      >
        <a
          href="/"
          aria-current={path === "/" ? "page" : undefined}
          className={[
            "font-serif text-[1.45rem] lg:text-[1.65rem] tracking-tight no-underline focus-ring",
            isDark ? "text-dark-text" : "text-charcoal",
          ].join(" ")}
        >
          Kabinett
        </a>
        <div
          className={[
            "hidden lg:flex items-center gap-8 text-[0.82rem] tracking-[0.015em]",
            isDark ? "text-dark-text/70" : "text-warm-gray",
          ].join(" ")}
        >
          <NavLink href="/discover" label="Upptäck" path={path} isDark={isDark} />
          <NavLink href="/search" label="Sök" path={path} isDark={isDark} />
          <NavLink href="/skola" label="Skola" path={path} isDark={isDark} />
          <NavLink href="/favorites" label="Sparade" path={path} isDark={isDark} />
          <NavLink href="/om" label="Om" path={path} isDark={isDark} />
        </div>
      </nav>
    </header>
  );
}

function BottomNav() {
  const { count } = useFavorites();
  const path = useLocation().pathname;

  const isLight = useIsLightPage();
  const isDark = !isLight;

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
      href: "/search?focus=1",
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
      aria-label="Snabbnavigering"
      className={[
        "fixed bottom-0 left-0 right-0 z-[60] backdrop-blur-[16px] pb-[env(safe-area-inset-bottom)] border-t lg:hidden",
        isDark
          ? "bg-[rgba(10,9,8,0.85)] border-[rgba(255,255,255,0.08)]"
          : "bg-[rgba(250,247,242,0.92)] border-[rgba(212,205,195,0.3)]",
      ].join(" ")}
    >
      <div
        className="flex justify-around items-center h-[3.5rem] max-w-[32rem] mx-auto"
      >
        {tabs.map((tab) => {
          const color = tab.active
            ? (isDark ? "var(--color-dark-text)" : "#3D3831")
            : (isDark ? "rgba(245,240,232,0.4)" : "rgba(61,56,49,0.35)");
          const labelClass = tab.active
            ? (isDark ? "text-dark-text" : "text-charcoal")
            : (isDark ? "text-dark-text-muted" : "text-[rgba(61,56,49,0.35)]");
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
  const navigation = useNavigation();
  const isNavigating = navigation.state === "loading";

  return (
    <>
      {isNavigating && (
        <div className="fixed top-0 left-0 right-0 z-[100] h-[2px]">
          <div className="h-full bg-[rgba(201,176,142,0.7)] animate-[loading-bar_1.5s_ease-in-out_infinite]" />
        </div>
      )}
      <Outlet />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Något gick fel";
  let details = "Ett oväntat fel uppstod. Ladda om sidan och försök igen.";
  let stack = "";

  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      message = "Sidan hittades inte";
      details = "Sidan du söker finns inte eller har flyttats.";
    } else {
      message = "Sidan kunde inte visas";
      details = import.meta.env.DEV ? (error.statusText || details) : "Vi kunde inte visa sidan just nu.";
    }
  } else if (error instanceof Error) {
    if (import.meta.env.DEV) {
      details = error.message;
    }
    stack = error.stack || "";
  }

  const showStack = import.meta.env.DEV;

  return (
    <div className="py-[4rem] px-5 min-h-screen flex items-center justify-center">
      <div className="max-w-md text-center">
        <h1 className="font-serif text-[2rem] md:text-[2.4rem] text-charcoal">{message}</h1>
        <p className="mt-4 text-warm-gray leading-relaxed text-[0.92rem]">{details}</p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 rounded-full bg-charcoal text-cream text-[0.82rem] font-medium border-none cursor-pointer hover:bg-ink active:scale-[0.97] transition-[background-color,transform] focus-ring"
          >
            Försök igen
          </button>
          <a
            href="/"
            className="px-5 py-2.5 rounded-full border border-stone/25 text-charcoal text-[0.82rem] font-medium no-underline hover:bg-linen active:scale-[0.97] transition-[background-color,transform] focus-ring"
          >
            Till startsidan
          </a>
        </div>
      </div>
      {showStack && stack && (
        <pre className="mt-4 text-[0.65rem] text-[#999] text-left max-w-[90vw] overflow-auto whitespace-pre-wrap">
          {stack}
        </pre>
      )}
    </div>
  );
}
