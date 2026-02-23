# Kabinett — Multi-museum plan

## Vision
Kabinett som discovery-plattform för Sveriges kulturarv. Pitchas till Riksantikvarieämbetet.

## Fas 1: Datamodell & refaktor (1-2 dagar)
- [ ] Lägg till `source`-kolumn i `artworks`-tabellen ("nationalmuseum", "shm", "nordiska")
- [ ] Lägg till `museum_name`, `museum_url` i ny `museums`-tabell
- [ ] Migrera befintliga 74k verk → `source = "nationalmuseum"`
- [ ] Uppdatera queries att filtrera/gruppera på source
- [ ] Uppdatera sync.ts att sätta source

## Fas 2: SHM-integration (2-3 dagar)
**Källa:** GitHub dataset (lshSWE/collection) — 91 000 objekt, CC0
- [ ] Ladda ner dataset, analysera format (CSV/JSON?)
- [ ] Skriv SHM sync-script (mappa till vår datamodell)
- [ ] Filtrera till objekt med bra bilder (IIIF eller hög-res URL)
- [ ] Importera till kabinett.db
- [ ] Generera CLIP-embeddings för SHM-verk

## Fas 3: Nordiska museet (2-3 dagar)
**Källa:** K-samsök API eller eget API
- [ ] Undersök Nordiskas API/dataformat
- [ ] Skriv sync-script
- [ ] Filtrera till verk med bilder
- [ ] Importera + CLIP-embeddings

## Fas 4: UI multi-museum (1-2 dagar)
- [ ] Museumväljare/filter på Upptäck-sidan
- [ ] Visa museum-badge på verk-kort
- [ ] Museum-sida: `/museum/nationalmuseum`, `/museum/shm`, `/museum/nordiska`
- [ ] Länk till källmuseets sida på verk-detalj
- [ ] Startsidan mixar alla museer (eller per museum)
- [ ] Sök fungerar över alla museer

## Fas 5: Pitch-material (1 dag)
- [ ] Deploy med riktig URL (kabinett.se?)
- [ ] One-pager PDF med screenshots
- [ ] Talking points: "10 miljoner objekt, Kringla visar dem som en lista, vi visar dem som en upplevelse"
- [ ] Kontakta Riksantikvarieämbetet

## Dataformat-mapping

### Nationalmuseum (befintlig)
- API: REST/JSON, api.nationalmuseum.se
- Bilder: IIIF
- Licens: CC0 metadata, Public Domain bilder

### SHM (Livrustkammaren, Hallwylska, Historiska, Skokloster)
- Källa: GitHub lshSWE/collection
- Format: TBD (CSV/JSON)
- Bilder: TBD
- Licens: CC0

### Nordiska museet
- Källa: K-samsök API eller eget
- Format: XML/RDF (K-samsök) 
- Bilder: TBD
- Licens: TBD

## Risker
- SHM-bildkvalitet kan vara låg → filtrera aggressivt
- K-samsök XML-format kräver parser
- Nordiska kanske inte har IIIF → fallback till statiska URL:er
- CLIP-embeddings för 100k+ nya verk = ~2-4 timmar compute
