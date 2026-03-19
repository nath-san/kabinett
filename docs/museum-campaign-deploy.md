# Museum-kampanjer i en enda Fly-app

Kampanjläge styrs nu primärt av `Host`-headern per request, inte av separata Fly-appar.
Samma app + samma databas kan därför servera flera subdomäner samtidigt.

## Hostname-routing

Följande mapping används i `campaign.server.ts`:

- `europeana.norrava.com` → `europeana`
- `nm.norrava.com` → `nationalmuseum`
- `nationalmuseum.norrava.com` → `nationalmuseum`
- `nordiska.norrava.com` → `nordiska`
- `shm.norrava.com` → `shm`
- allt annat → `default`

Varje kampanj-ID definierar också vilka museer som tillåts i queries:

- `europeana` → `['europeana']`
- `nationalmuseum` → `['nationalmuseum']`
- `nordiska` → `['nordiska']`
- `shm` → `['shm']`
- `default` → `null` (alla DB-aktiverade museer)

## Fallback-beteende

Om request-kontekst saknas (t.ex. i äldre körvägar), används samma fallback som tidigare:

- `KABINETT_CAMPAIGN` styr kampanjcopy/meta
- `MUSEUMS` begränsar datakällor

Det gör migreringen bakåtkompatibel.

## Fly-konfiguration (en app)

Behåll en app, till exempel `kabinett`, med gemensam databas-volym.

`fly.toml` kan fortsatt ha:

- `KABINETT_CAMPAIGN = "default"` (fallback)
- `MUSEUMS = "nationalmuseum,nordiska,shm,europeana"` (global fallback)

Ingen extra Fly-app och ingen extra databas behövs för kampanjsubdomäner.

## DNS/Cloudflare

Peka alla kampanjsubdomäner till samma Fly-app, till exempel:

- `europeana.norrava.com` → `kabinett.fly.dev`
- `nm.norrava.com` → `kabinett.fly.dev`
- `nationalmuseum.norrava.com` → `kabinett.fly.dev`
- `nordiska.norrava.com` → `kabinett.fly.dev`
- `shm.norrava.com` → `kabinett.fly.dev`

Cloudflare kan fortsätta proxy:a trafiken (orange cloud) med SSL-läge Full/Strict.

## SEO

Kampanjlägen (`nationalmuseum`, `nordiska`, `shm`) sätter `noindex` på startsidan,
medan `default` beter sig som ordinarie indexerbar sida.
