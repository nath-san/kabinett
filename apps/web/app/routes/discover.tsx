import type { Route } from "./+types/discover";
import { getDb } from "../lib/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Upptäck — Kabinett" },
    { name: "description", content: "Upptäck konst, ett verk i taget." },
  ];
}

export async function loader() {
  const db = getDb();
  // Preload 10 interesting paintings
  const works = db.prepare(
    `SELECT id, title_sv, title_en, iiif_url, dominant_color, artists, dating_text, category
     FROM artworks
     WHERE category LIKE '%Målningar%'
       AND color_r IS NOT NULL
       AND LENGTH(iiif_url) > 90
     ORDER BY RANDOM()
     LIMIT 10`
  ).all() as any[];

  return { works };
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; }
  catch { return "Okänd konstnär"; }
}

export default function Discover({ loaderData }: Route.ComponentProps) {
  const { works } = loaderData;

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#1A1815" }}>
      {/* Current card */}
      <div id="card-stack" style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
        {works.map((w: any, i: number) => (
          <div
            key={w.id}
            className="discover-card"
            data-index={i}
            data-id={w.id}
            style={{
              position: "absolute",
              inset: 0,
              display: i === 0 ? "flex" : "none",
              flexDirection: "column",
              justifyContent: "flex-end",
              backgroundColor: w.dominant_color || "#1A1815",
            }}
          >
            <img
              src={w.iiif_url.replace("http://", "https://") + "full/800,/0/default.jpg"}
              alt={w.title_sv || ""}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "contain",
                objectPosition: "center",
              }}
            />
            {/* Gradient overlay at bottom */}
            <div style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "50%",
              background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
              pointerEvents: "none",
            }} />
            {/* Info */}
            <div style={{
              position: "relative",
              zIndex: 10,
              padding: "0 1.25rem 6rem",
            }}>
              <h2 className="font-serif" style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: "#fff",
                lineHeight: 1.25,
                textShadow: "0 1px 8px rgba(0,0,0,0.4)",
              }}>
                {w.title_sv || w.title_en || "Utan titel"}
              </h2>
              <p style={{
                fontSize: "0.9rem",
                color: "rgba(255,255,255,0.7)",
                marginTop: "0.375rem",
              }}>
                {parseArtist(w.artists)}
              </p>
              {w.dating_text && (
                <p style={{
                  fontSize: "0.8rem",
                  color: "rgba(255,255,255,0.4)",
                  marginTop: "0.25rem",
                }}>
                  {w.dating_text}
                </p>
              )}
            </div>
          </div>
        ))}

        {/* Controls overlay */}
        <div style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 20,
          padding: "0 1.25rem 2rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <a id="btn-info" href={"/artwork/" + works[0]?.id}
            style={{
              width: "2.75rem", height: "2.75rem",
              borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
              display: "flex", alignItems: "center", justifyContent: "center",
              textDecoration: "none", color: "#fff", fontSize: "1.1rem",
            }}>
            i
          </a>
          <button id="btn-next"
            style={{
              padding: "0.75rem 2rem",
              borderRadius: "999px",
              backgroundColor: "rgba(255,255,255,0.2)",
              backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff",
              fontSize: "0.9rem",
              fontWeight: 500,
              cursor: "pointer",
            }}>
            Nästa verk →
          </button>
          <button id="btn-share"
            style={{
              width: "2.75rem", height: "2.75rem",
              borderRadius: "50%",
              backgroundColor: "rgba(255,255,255,0.15)",
              backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
              border: "none",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: "1rem", cursor: "pointer",
            }}>
            <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13" />
            </svg>
          </button>
        </div>

        {/* Progress dots */}
        <div id="dots" style={{
          position: "absolute",
          top: "3.5rem",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 20,
          display: "flex",
          gap: "0.375rem",
        }}>
          {works.map((_: any, i: number) => (
            <div key={i} className="dot" data-dot={i} style={{
              width: "0.375rem",
              height: "0.375rem",
              borderRadius: "50%",
              backgroundColor: i === 0 ? "#fff" : "rgba(255,255,255,0.3)",
              transition: "background-color 0.3s",
            }} />
          ))}
        </div>
      </div>

      {/* Inline navigation script */}
      <script dangerouslySetInnerHTML={{ __html: `
(function(){
  var cards = document.querySelectorAll('.discover-card');
  var dots = document.querySelectorAll('.dot');
  var btnNext = document.getElementById('btn-next');
  var btnInfo = document.getElementById('btn-info');
  var btnShare = document.getElementById('btn-share');
  var current = 0;
  var total = cards.length;
  var startX = 0;
  var startY = 0;
  var stack = document.getElementById('card-stack');

  var animating = false;

  function show(idx, direction) {
    if (animating) return;
    animating = true;
    var old = cards[current];
    var next = cards[idx];
    var dir = direction || 'left';
    // Setup next card off-screen
    next.style.display = 'flex';
    next.style.opacity = '0';
    next.style.transform = dir === 'left' ? 'translateX(40px)' : 'translateX(-40px)';
    next.style.transition = 'none';
    // Force reflow
    void next.offsetWidth;
    // Animate old out
    old.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    old.style.opacity = '0';
    old.style.transform = dir === 'left' ? 'translateX(-40px)' : 'translateX(40px)';
    // Animate new in
    next.style.transition = 'opacity 0.35s ease 0.1s, transform 0.35s ease 0.1s';
    next.style.opacity = '1';
    next.style.transform = 'translateX(0)';
    setTimeout(function(){
      old.style.display = 'none';
      old.style.transform = '';
      old.style.opacity = '';
      old.style.transition = '';
      animating = false;
    }, 400);
    dots.forEach(function(d,i){
      d.style.backgroundColor = i === idx ? '#fff' : 'rgba(255,255,255,0.3)';
    });
    btnInfo.href = '/artwork/' + cards[idx].dataset.id;
    current = idx;
  }

  function next() {
    if (current < total - 1) {
      show(current + 1, 'left');
    } else {
      window.location.reload();
    }
  }

  function prev() {
    if (current > 0) {
      show(current - 1, 'right');
    }
  }

  btnNext.addEventListener('click', next);

  // Swipe support
  stack.addEventListener('touchstart', function(e){
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  stack.addEventListener('touchend', function(e){
    var dx = e.changedTouches[0].clientX - startX;
    var dy = e.changedTouches[0].clientY - startY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0) next();
      else prev();
    }
  }, { passive: true });

  // Share
  btnShare.addEventListener('click', function(){
    var id = cards[current].dataset.id;
    var title = cards[current].querySelector('h2');
    var text = title ? title.textContent : 'Konstverk';
    var url = window.location.origin + '/artwork/' + id;
    if (navigator.share) {
      navigator.share({ title: text, url: url });
    } else {
      navigator.clipboard.writeText(url);
      btnShare.style.backgroundColor = 'rgba(255,255,255,0.4)';
      setTimeout(function(){ btnShare.style.backgroundColor = 'rgba(255,255,255,0.15)'; }, 500);
    }
  });

  // Keyboard
  document.addEventListener('keydown', function(e){
    if (e.key === 'ArrowRight' || e.key === ' ') next();
    if (e.key === 'ArrowLeft') prev();
  });
})();
      `}} />
    </div>
  );
}
