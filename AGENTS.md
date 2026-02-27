# AGENTS.md — Kabinett

## Stack
- React Router 7 (framework mode, SSR)
- Tailwind CSS 4
- SQLite (better-sqlite3, readonly in web app)
- pnpm monorepo: `apps/web` (frontend), `packages/data` (DB + scripts)
- CLIP embeddings for semantic search (Transformers.js / Xenova)
- Vitest for testing

## Architecture

### Monorepo layout
```
apps/web/          → React Router SSR app
  app/
    components/    → Shared UI components
    lib/           → Server utilities (*.server.ts) + shared helpers
    routes/        → Page routes + API routes
    routes.ts      → Explicit route registration (add new routes here!)
packages/data/     → SQLite DB, sync scripts, embedding generation
```

### Key patterns

**Database:** Single readonly SQLite DB (`kabinett.db`). All queries happen in loaders (server-side). The `getDb()` singleton in `db.server.ts` loads sqlite-vec and sets WAL/mmap pragmas.

**Museum filtering:** `museums.server.ts` caches enabled museums with 60s TTL. `sourceFilter()` generates SQL WHERE clauses and is cached alongside the museum list. Every query that touches artworks must include `sourceFilter()`.

**CLIP search:** `clip-search.server.ts` lazy-loads the text model (sentence-transformers/clip-ViT-B-32-multilingual-v1). The promise is nulled on error so retries work. Vector search uses `vec_artworks` + `vec_artwork_map` join pattern.

**Image URLs:** `images.ts` handles IIIF, SHM media, and Nordiska (dimu.org) URLs. `buildImageUrl()` routes through `/cdn/img` proxy for CDN-enabled hosts. Use appropriate sizes: 200 (thumbs), 400 (cards), 800 (hero).

**Feed system:** `feed.server.ts` serves the home page feed with cursor-based pagination. "Alla" filter uses `ROW_NUMBER() OVER (PARTITION BY source)` for museum interleaving. Mood/theme queries use FTS5 (`artworks_fts`).

**Stats:** `stats.server.ts` caches site stats with 5-minute TTL.

## Components (`app/components/`)

| Component | Used in | Purpose |
|---|---|---|
| `ArtworkCard` | home, search | Main artwork card with variants (large/small/search) |
| `Autocomplete` | HeroSearch, search | React-based autocomplete dropdown (no innerHTML) |
| `HeroSearch` | home | Search bar that navigates to /search |
| `ThemeCard` | home | Themed artwork collections (horizontal scroll) |
| `StatsSection` | home | Collection stats display |
| `SpotlightCard` | home | Artist spotlight section |
| `WalkPromoCard` | home | Walks feature promo |
| `Breadcrumb` | various | Navigation breadcrumb |
| `artwork-meta.ts` | ArtworkCard, routes | Shared types, focal point helper, alt text builder |

## Code Style

### Inline styles
Use Tailwind classes for all styling. `style={{}}` is OK only for truly dynamic data values (e.g., `backgroundColor: artwork.color`, focal point `objectPosition`). Never use inline styles for static values that could be Tailwind classes.

### CSS
- Global styles in `app.css`
- Use Tailwind's `@theme` for design tokens
- Prefer semantic class names via `@apply` only when a component pattern repeats 3+ times

### Components
- Shared components go in `app/components/`
- Use `React.memo` for list items in feeds/grids
- Alt text: use `buildArtworkAltText()` from `artwork-meta.ts` (includes title, artist, technique, period)

### Data
- All DB queries in loaders (server-side only)
- Files ending in `.server.ts` are server-only
- Parse JSON fields (artists, dimensions, exhibitions) defensively with try/catch

### Routes
- Explicit route registration in `routes.ts` — you must add new routes manually
- API routes prefixed with `api.`

### Copy / Language
- All user-facing text in Swedish
- Use `…` (ellipsis character), not `...`
- No emoji in UI
- Tone: clean, confident, understated. Not corporate, not cutesy.

### Accessibility
- Header nav: `aria-label="Huvudnavigering"`
- Bottom nav: `aria-label="Snabbnavigering"` (not "Primär" — avoid conflicting with header)
- Always use `buildArtworkAltText()` for artwork images
- Skip-link, `aria-current="page"`, focus rings on all interactive elements

## Testing
- Framework: Vitest (`pnpm --filter @kabinett/web test`)
- Tests live in `app/lib/__tests__/`
- Typecheck: `pnpm --filter @kabinett/web typecheck`

## Scripts (`packages/data/scripts/`)
- `generate-embeddings.ts` — CLIP image embeddings + focal points. Uses batched transactions for performance.
- `sync-ksamsok-fast.ts` — K-samsök RDF sync
- `sync-nordiska.ts` — Nordiska museet sync
- `extract-colors.ts` — Dominant color extraction

## Performance
- Home loader cached 5 min in-memory (`_homeCache`)
- Stats cached 5 min (`getCachedSiteStats`)
- Museum list cached 60s
- sourceFilter cached alongside museum list
- CLIP model loaded once, lazy, with error retry
- Feed deduplicates by `iiif_url` in JS
- Images: `contain: layout paint` on feed cards, lazy loading below fold
