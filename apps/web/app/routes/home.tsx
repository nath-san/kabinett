import type { Route } from "./+types/home";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Kabinett — Discover Swedish Art" },
    {
      name: "description",
      content:
        "Utforska Nationalmuseums samling på ett nytt sätt. 89 000 konstverk. Sök efter färg, stämning eller nyfikenhet.",
    },
  ];
}

export default function Home() {
  return (
    <div className="min-h-screen pt-14">
      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-(--spacing-page) py-24 md:py-32 text-center">
        <h1 className="font-serif text-5xl md:text-7xl font-bold text-charcoal leading-tight">
          Upptäck svensk konst
        </h1>
        <p className="mt-6 text-lg md:text-xl text-warm-gray max-w-xl">
          89 000 verk från Nationalmuseums samling.
          <br />
          Utforska efter färg, tid eller nyfikenhet.
        </p>
        <div className="mt-10 flex gap-4">
          <a
            href="/explore"
            className="px-6 py-3 bg-charcoal text-cream rounded-full text-sm font-medium hover:bg-ink transition-colors"
          >
            Börja utforska
          </a>
          <a
            href="/colors"
            className="px-6 py-3 border border-stone text-charcoal rounded-full text-sm font-medium hover:bg-linen transition-colors"
          >
            Utforska färger
          </a>
        </div>
      </section>

      {/* Featured grid placeholder */}
      <section className="px-(--spacing-page) pb-24">
        <h2 className="font-serif text-2xl font-semibold text-charcoal mb-8">
          Ur samlingen
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {PLACEHOLDER_WORKS.map((work) => (
            <ArtworkCard key={work.id} {...work} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ArtworkCard({
  id,
  title,
  artist,
  iiif,
  color,
}: {
  id: number;
  title: string;
  artist: string;
  iiif: string;
  color: string;
}) {
  return (
    <a
      href={`/artwork/${id}`}
      className="group block rounded-lg overflow-hidden bg-linen"
    >
      <div
        className="aspect-[3/4] overflow-hidden"
        style={{ backgroundColor: color }}
      >
        <img
          src={`${iiif}full/400,/0/default.jpg`}
          alt={title}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
        />
      </div>
      <div className="p-3">
        <p className="text-sm font-medium text-charcoal truncate">{title}</p>
        <p className="text-xs text-warm-gray mt-0.5">{artist}</p>
      </div>
    </a>
  );
}

// Placeholder data — will be replaced with real data from SQLite
const PLACEHOLDER_WORKS = [
  {
    id: 24342,
    title: "Midvinterblot",
    artist: "Carl Larsson",
    iiif: "http://nationalmuseumse.iiifhosting.com/iiif/f45a26268de52e95fb39de2fdf4375b60d79fa11b661f22ef63f3f89e1a30b47/",
    color: "#8B6F4E",
  },
  {
    id: 18194,
    title: "Grindslanten",
    artist: "August Malmström",
    iiif: "http://nationalmuseumse.iiifhosting.com/iiif/a4f8fbd9b30d87f97b4a3b8c4d6e5f2a1c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f/",
    color: "#5C7A4E",
  },
  {
    id: 4000,
    title: "Skulptur, vädurshuvud",
    artist: "Okänd",
    iiif: "http://nationalmuseumse.iiifhosting.com/iiif/b0f55a34aa32d4de2a37974c1318ff5aa53ab4495633e6e91c73b525ebf70633/",
    color: "#7A7568",
  },
  {
    id: 15724,
    title: "Karl XI:s likbår",
    artist: "Okänd",
    iiif: "http://nationalmuseumse.iiifhosting.com/iiif/c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4/",
    color: "#4A3F35",
  },
];
