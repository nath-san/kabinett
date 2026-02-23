# AGENTS.md — Kabinett

## Stack
- React Router 7 (framework mode, SSR)
- Tailwind CSS 4
- SQLite (better-sqlite3, readonly)
- pnpm monorepo: `apps/web` (frontend), `packages/data` (DB + scripts)
- CLIP embeddings for semantic search (Transformers.js / Xenova)

## Code Style

### No inline styles
Use **Tailwind classes** for all styling. Never use `style={{...}}` in JSX.

Exception: truly dynamic values that can't be expressed as classes (e.g., `backgroundColor: artwork.color` where the color comes from data). In those cases, use `style` only for the dynamic property and Tailwind for everything else.

### CSS
- Global styles in `app.css`
- Use Tailwind's `@theme` for design tokens
- Prefer semantic class names via `@apply` only when a component pattern repeats 3+ times

### Components
- Colocate components in route files unless shared across 3+ routes
- Shared components go in `app/components/`
- Use `React.memo` for list items in feeds/grids

### Data
- All DB queries in loaders (server-side only)
- Files ending in `.server.ts` are server-only
- Parse JSON fields (artists, dimensions, exhibitions) defensively with try/catch

### Routes
- Explicit route registration in `routes.ts`
- API routes prefixed with `api.`

### Copy / Language
- All user-facing text in Swedish
- Use `…` (ellipsis character), not `...`
- No emoji in UI
- Tone: clean, confident, understated. Not corporate, not cutesy.

### Performance
- Images: use IIIF with appropriate sizes (200 for thumbs, 400 for cards, 800 for hero)
- Lazy load images below the fold
- Use `contain: layout paint` for feed cards
