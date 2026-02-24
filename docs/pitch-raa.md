# Kabinett — Sveriges kulturarv, på ett nytt sätt

## Sammanfattning

Kabinett är en modern webbapp som gör svenska museers samlingar tillgängliga och upptäckbara. Idag visar vi **1,2 miljoner verk** från nio samlingar — Nationalmuseum, Livrustkammaren, Hallwylska museet, Historiska museet, Nordiska museet med flera — med semantisk sökning som förstår vad användaren letar efter.

All data hämtas via **K-samsök** och Nationalmuseums API. Bilderna är Public Domain, metadata CC0.

---

## Problemet

K-samsök innehåller över 10 miljoner objekt. Det är en av Europas rikaste öppna kulturarvsdatabaser. Men **Kringla** — det publika gränssnittet — är en katalog, inte en upplevelse. Textbaserad sökning, listvy, inget visuellt utforskande.

Resultatet: data finns, men publiken hittar inte dit.

## Lösningen

Kabinett visar K-samsök-data som en **visuell, mobilvänlig upplevelse**:

- **Semantisk sökning** — Skriv "ledsen man i regn" och hitta rätt verk, inte bara exakta nyckelord. Drivs av CLIP-embeddings (AI-baserad bildförståelse).
- **Tidslinjevy** — Utforska 800 år av svenskt kulturarv kronologiskt, med bilder.
- **Tematiska vandringar** — Curaterade serier som "Djur i konsten" eller "Nattscener".
- **Samlingssidor** — Varje museum/samling får en egen landningssida med statistik och utvalda verk.
- **Cross-museum** — En sökruta, nio samlingar. Användaren bryr sig inte om vilken myndighet som äger objektet.

## Siffror

| | |
|---|---|
| **Verk** | 1 158 839 |
| **Samlingar** | 9 (Nationalmuseum, Livrustkammaren, Hallwylska, Historiska, Nordiska, Skokloster, Ekonomiska/Myntkabinettet, Tumba, Förintelsemuseet) |
| **Tidsomfång** | 1200–2024 |
| **Semantiska embeddings** | 200 000+ (pågående) |
| **Datakällor** | K-samsök (RAÄ), Nationalmuseums API |

## Teknik

- **React** (server-side rendered för snabb laddning)
- **SQLite** — lätt att deploya, ingen komplex infrastruktur
- **CLIP** (Transformers.js) — semantisk sökning direkt i appen, ingen extern AI-tjänst
- **K-samsök RDF/XML** — standardiserad datahämtning, lätt att lägga till fler museer
- **Responsiv** — fungerar lika bra på mobil som desktop
- **Tillgänglighet** — WCAG 2.1 AA, skip-links, aria-labels, tangentbordsnavigation

## Vision

Kabinett kan bli det **moderna publika gränssnittet för K-samsök** — en upptäckarupplevelse som gör Sveriges kulturarv lika tillgängligt som Spotify gör musik. Inte en ersättning för Kringla (som tjänar forskare), utan ett **komplement som når en bred publik**.

Infrastrukturen för att indexera **alla museer i K-samsök** finns redan — varje nytt museum kräver bara en ny org-kod. Nästa steg:

1. Indexera alla ~7 miljoner objekt med bilder i K-samsök (Postmuseum, Östasiatiska, Sjöhistoriska, Etnografiska, Jamtli, Ájtte, m.fl.)
2. Generera semantiska embeddings i stor skala
3. Lansera publikt med riktig domän och drift
4. Bli det moderna publika gränssnittet för hela K-samsök

## Om oss

**Nathalie Wassgren** — utvecklare. Bygger Kabinett som ett eget projekt sedan februari 2026.

---

*Demo och källkod tillgänglig vid förfrågan.*
