# Kabinett
**En modern ingång till Sveriges digitala kulturarv**

---

## Vad är Kabinett?

Kabinett är en webbapp som samlar och tillgängliggör konst och kulturföremål från svenska museer i ett gemensamt, sökbart gränssnitt. Användaren kan utforska över **1,1 miljoner verk** från **9 samlingar** — med en AI-driven sökning som förstår naturligt språk.

Sök på *"stormigt hav"*, *"barn som leker"* eller *"guldsmide"* — och hitta relevanta verk oavsett hur de katalogiserats.

**→ [kabinett.norrava.com](https://kabinett.norrava.com)**

---

## Problemet

Sveriges museer har digitaliserat enorma mängder — men för den vanliga användaren är materialet svårt att hitta. Datan ligger utspridd i separata system (K-samsök, DigitaltMuseum, institutionernas egna API:er) och söks bäst av specialister. Det finns ingen gemensam, publik upplevelse.

K-samsök är ryggraden i den svenska kulturarvsinfrastrukturen, men saknar idag ett modernt publikt gränssnitt sedan Kringla. Museisamlingar.se fokuserar på registrering, inte på upptäckt.

---

## Lösningen

Kabinett aggregerar metadata och bilder från flera källor och presenterar dem i ett enhetligt, visuellt gränssnitt byggt för utforskande — inte bara sökning.

### Tekniken

- **Semantisk sökning (CLIP)** — AI-modell som matchar fritext mot bildinnehåll. Fungerar på svenska och engelska.
- **1,1M+ verk indexerade** med vektorembeddings för visuell likhet och textmatchning.
- **Tre datakällor:** K-samsök (SHM), Nationalmuseums API, DigitaltMuseum (Nordiska museet).
- **9 samlingar:** Nationalmuseum, Livrustkammaren, Hallwylska, Historiska museet, Skokloster, Myntkabinettet, Nordiska museet, Tumba bruksmuseum, Förintelsemuseet.
- Alla bilder länkas från respektive institutions servrar — inga bilder lagras.
- Öppen data: all metadata används under CC0/CC BY i enlighet med respektive institutions licenser.
- **Byggd för att växa:** Tre källor och nio samlingar är en medveten avgränsning för att validera konceptet. Arkitekturen är modulär — att lägga till en ny källa (K-samsök-institution, IIIF-museum eller DigitaltMuseum-samling) kräver ett synkskript och en rad i konfigurationen. Inga förändringar i frontend eller sökmotor.

### Upplevelsen

- **Hem:** Kurerat flöde med temasamlingar, konstnärsspotlights och statistik.
- **Sök:** Fritext med AI — skriv vad du vill hitta.
- **Upptäck:** Bläddra per samling, kategori eller tidsperiod.
- **Konstverk:** Detaljsida med beskrivning, teknik, mått, utställningshistorik och liknande verk.
- **Sparade:** Personlig favoritmapp (lokal, ingen inloggning).
- Responsiv design optimerad för mobil.

---

## Varför Riksantikvarieämbetet?

Kabinett bygger direkt på den infrastruktur RAÄ förvaltar. K-samsök är den största enskilda datakällan (800 000+ verk via SHM). Projektet visar vad som är möjligt när öppna kulturarvsdata möter modern sökteknik.

Vi ser Kabinett som ett komplement till RAÄ:s eget arbete med det nya K-samsök — en publik frontend som gör kulturarvsdatan tillgänglig och sökbar för alla.

### Möjliga samarbetsformer

- **Pilot:** Kabinett som referensimplementation för hur nya K-samsöks data kan presenteras publikt.
- **Utökning:** Fler museer och samlingar — K-samsök har hundratals anslutna institutioner, och Kabinetts arkitektur gör det enkelt att lägga till nya källor.
- **Licensiering/drift:** RAÄ eller anslutna museer licensierar Kabinett som publik söktjänst.
- **Gemensam utveckling:** Samarbete kring semantisk sökning och AI-indexering av kulturarvsdata.

---

## Om mig

**Nathalie Wassgren** — webbutvecklare baserad i Stockholm. Kabinett är ett privat projekt drivet av ett intresse för konst, öppen data och att göra kulturarv tillgängligt.

---

*Kabinett är i aktiv utveckling. Demo och kod visas gärna vid möte.*
