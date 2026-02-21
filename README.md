# Kabinett

**Discover Swedish art.**

Kabinett is a modern, discovery-focused exploration of Sweden's national art collection. Built on top of [Nationalmuseum's open API](https://api.nationalmuseum.se), it reimagines how we browse and discover art — less catalog, more curiosity.

Think Spotify for art: explore by color, mood, era, or serendipity.

## Stack

- **Frontend:** React Router 7, Tailwind CSS
- **Data:** SQLite, synced from Nationalmuseum's API (~89,000 works with images)
- **Images:** IIIF (International Image Interoperability Framework)

## Getting Started

```bash
pnpm install
pnpm sync        # Sync data from Nationalmuseum API
pnpm dev         # Start dev server
```

## Data Source

All artwork metadata is CC0. Images are Public Domain, served via IIIF.
No API key required.

---

*A project by [nath-san](https://github.com/nath-san)*
