import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Route } from "./+types/quiz";
import { getDb } from "../lib/db.server";
import { buildImageUrl } from "../lib/images";
import { sourceFilter } from "../lib/museums.server";

function buildIiif(url: string, size: number) {
  return buildImageUrl(url, size);
}

function parseArtist(json: string | null): string {
  if (!json) return "Okänd konstnär";
  try { return JSON.parse(json)[0]?.name || "Okänd konstnär"; } catch { return "Okänd konstnär"; }
}

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Ditt konstverk — Kabinett" },
    { name: "description", content: "Fem snabba frågor som hittar ditt konstverk." },
  ];
}

export async function loader({}: Route.LoaderArgs) {
  const db = getDb();

  const moodSamples = {
    dark: db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE (color_r + color_g + color_b) / 3 < 90
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
           AND id NOT IN (SELECT artwork_id FROM broken_images)
           AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
    light: db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE (color_r + color_g + color_b) / 3 > 170
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
    dramatic: db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE (max(color_r, color_g, color_b) - min(color_r, color_g, color_b)) > 80
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
    calm: db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE (max(color_r, color_g, color_b) - min(color_r, color_g, color_b)) < 55
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
  };

  const epochSamples = {
    "1500s": db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE year_start BETWEEN 1500 AND 1599
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
    "1600s": db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE year_start BETWEEN 1600 AND 1699
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
    "1700s": db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE year_start BETWEEN 1700 AND 1799
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
    "1800s": db
      .prepare(
        `SELECT id, iiif_url, title_sv, title_en, artists FROM artworks
         WHERE year_start BETWEEN 1800 AND 1899
           AND iiif_url IS NOT NULL
           AND LENGTH(iiif_url) > 40
         AND id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter()}
         ORDER BY RANDOM()
         LIMIT 1`
      )
      .get() as any,
  };

  function subjectSample(ftsQuery: string) {
    return db.prepare(
      `SELECT a.id, a.iiif_url, a.title_sv, a.title_en, a.artists FROM artworks_fts
       JOIN artworks a ON a.id = artworks_fts.rowid
       WHERE artworks_fts MATCH ?
         AND a.iiif_url IS NOT NULL
         AND LENGTH(a.iiif_url) > 40
         AND a.id NOT IN (SELECT artwork_id FROM broken_images)
         AND ${sourceFilter("a")}
       ORDER BY RANDOM()
       LIMIT 1`
    ).get(ftsQuery) as any;
  }

  const subjectSamples = {
    landskap: subjectSample("landskap OR skog OR sjö OR berg"),
    portratt: subjectSample("porträtt OR portrait OR man OR kvinna"),
    stilleben: subjectSample("stilleben OR blommor OR frukt"),
    abstrakt: subjectSample("abstrakt OR komposition"),
  };

  function mapSample(row: any) {
    if (!row?.iiif_url) return null;
    return {
      url: buildIiif(row.iiif_url, 400),
      title: row.title_sv || row.title_en || "Utan titel",
      artist: parseArtist(row.artists || null),
    };
  }

  return {
    samples: {
      mood: {
        dark: mapSample(moodSamples.dark),
        light: mapSample(moodSamples.light),
        dramatic: mapSample(moodSamples.dramatic),
        calm: mapSample(moodSamples.calm),
      },
      epoch: {
        "1500s": mapSample(epochSamples["1500s"]),
        "1600s": mapSample(epochSamples["1600s"]),
        "1700s": mapSample(epochSamples["1700s"]),
        "1800s": mapSample(epochSamples["1800s"]),
      },
      subject: {
        landskap: mapSample(subjectSamples.landskap),
        portratt: mapSample(subjectSamples.portratt),
        stilleben: mapSample(subjectSamples.stilleben),
        abstrakt: mapSample(subjectSamples.abstrakt),
      },
    },
  };
}

type QuizResult = {
  id: number;
  title: string;
  artist: string;
  imageUrl: string;
  color: string;
  year: string;
  technique: string;
  dimensions: string;
};

type StoredResult = QuizResult & { timestamp: number };

const MOOD_OPTIONS = [
  { id: "dark", label: "Mörk" },
  { id: "light", label: "Ljus" },
  { id: "dramatic", label: "Dramatisk" },
  { id: "calm", label: "Lugn" },
];

const COLOR_OPTIONS = [
  { id: "#2E2A26", label: "Mörk umbra" },
  { id: "#E0B04A", label: "Guld" },
  { id: "#8FA9C5", label: "Klarblå" },
  { id: "#C56D6A", label: "Korall" },
  { id: "#AFC3A3", label: "Salvia" },
  { id: "#F2E9D8", label: "Linne" },
];

const EPOCH_OPTIONS = [
  { id: "1500s", label: "1500-tal" },
  { id: "1600s", label: "1600-tal" },
  { id: "1700s", label: "1700-tal" },
  { id: "1800s", label: "1800-tal" },
];

const SUBJECT_OPTIONS = [
  { id: "landskap", label: "Landskap" },
  { id: "porträtt", label: "Porträtt" },
  { id: "stilleben", label: "Stilleben" },
  { id: "abstrakt", label: "Abstrakt" },
];

const SIZE_OPTIONS = [
  { id: "small", label: "Liten" },
  { id: "large", label: "Stor" },
];

export default function Quiz({ loaderData }: Route.ComponentProps) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({
    mood: "",
    color: "",
    epoch: "",
    subject: "",
    size: "",
  });
  const [result, setResult] = useState<QuizResult | null>(null);
  const [reveal, setReveal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<StoredResult | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem("kabinett-quiz-result");
    if (stored) {
      try {
        setLastResult(JSON.parse(stored));
      } catch {}
    }
  }, []);

  const canSubmit = useMemo(
    () =>
      Boolean(
        answers.mood &&
          answers.color &&
          answers.epoch &&
          answers.subject &&
          answers.size
      ),
    [answers]
  );

  const answersRef = useRef(answers);
  answersRef.current = answers;

  async function submitQuiz() {
    const a = answersRef.current;
    if (!a.mood || !a.color || !a.epoch || !a.subject || !a.size) return;
    setLoading(true);
    const params = new URLSearchParams({
      mood: a.mood,
      color: a.color,
      epoch: a.epoch,
      subject: a.subject,
      size: a.size,
    });

    try {
      const res = await fetch(`/api/quiz-match?${params.toString()}`);
      const data = await res.json();
      if (data?.result) {
        setResult(data.result);
        setReveal(true);
        const stored = { ...data.result, timestamp: Date.now() } as StoredResult;
        localStorage.setItem("kabinett-quiz-result", JSON.stringify(stored));
        setLastResult(stored);
      }
    } finally {
      setLoading(false);
    }
  }

  function resetQuiz() {
    setAnswers({ mood: "", color: "", epoch: "", subject: "", size: "" });
    setStep(0);
    setResult(null);
    setReveal(false);
  }

  async function shareResult() {
    if (!result) return;
    const shareData = {
      title: "Ditt konstverk — Kabinett",
      text: `Mitt konstverk är ${result.title} av ${result.artist}.`,
      url: `/artwork/${result.id}`,
    };

    if (navigator.share) {
      await navigator.share(shareData);
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(window.location.origin + shareData.url);
      (window as any).__toast?.("Länk kopierad");
    }
  }

  const samples = loaderData.samples;

  return (
    <div className="min-h-screen pt-14 bg-cream">
      <div className="px-(--spacing-page) pt-8 pb-6">
        <p className="text-xs uppercase tracking-[0.2em] text-stone">Ditt konstverk</p>
        <h1 className="font-serif text-4xl md:text-5xl text-charcoal mt-3">Fem frågor, ett verk</h1>
        <p className="text-warm-gray mt-2 max-w-xl">
          Välj det som känns rätt. Vi matchar din smak med ett verk ur samlingen.
        </p>
      </div>

      {lastResult && !result && (
        <div className="px-(--spacing-page) pb-6">
          <div className="bg-linen rounded-3xl p-4 flex flex-col md:flex-row gap-4 items-center">
            <div className="w-full md:w-32 aspect-[3/4] rounded-2xl overflow-hidden" style={{ backgroundColor: lastResult.color }}>
              <img src={lastResult.imageUrl} alt={`${lastResult.title} — ${lastResult.artist}`} className="w-full h-full object-cover" loading="lazy" width={400} height={533} />
            </div>
            <div className="flex-1">
              <p className="text-xs uppercase tracking-[0.2em] text-stone">Ditt senaste</p>
              <h2 className="font-serif text-2xl text-charcoal mt-2">{lastResult.title}</h2>
              <p className="text-sm text-warm-gray mt-1">{lastResult.artist}</p>
              <a href={`/artwork/${lastResult.id}`} className="text-sm text-accent mt-3 inline-block focus-ring">
                Se verket
              </a>
            </div>
          </div>
        </div>
      )}

      <div className="px-(--spacing-page) pb-24">
        {!result && (
          <div className="bg-linen rounded-[32px] p-5 md:p-8">
            <QuizProgress step={step} />

            {step === 0 && (
              <Question
                title="Vilken stämning?"
                subtitle="Välj en känsla"
                options={MOOD_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  image: samples.mood[option.id as keyof typeof samples.mood],
                }))}
                selected={answers.mood}
                onSelect={(value) => {
                  setAnswers((prev) => ({ ...prev, mood: value }));
                  setStep(1);
                }}
              />
            )}

            {step === 1 && (
              <Question
                title="Vilken färg?"
                subtitle="Välj en ton"
                options={COLOR_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  color: option.id,
                }))}
                selected={answers.color}
                onSelect={(value) => {
                  setAnswers((prev) => ({ ...prev, color: value }));
                  setStep(2);
                }}
              />
            )}

            {step === 2 && (
              <Question
                title="Vilken epok?"
                subtitle="Välj ett sekel"
                options={EPOCH_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  image: samples.epoch[option.id as keyof typeof samples.epoch],
                }))}
                selected={answers.epoch}
                onSelect={(value) => {
                  setAnswers((prev) => ({ ...prev, epoch: value }));
                  setStep(3);
                }}
              />
            )}

            {step === 3 && (
              <Question
                title="Vilket motiv?"
                subtitle="Välj ett ämne"
                options={SUBJECT_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  image: samples.subject[
                    option.id === "porträtt" ? "portratt" : (option.id as keyof typeof samples.subject)
                  ],
                }))}
                selected={answers.subject}
                onSelect={(value) => {
                  setAnswers((prev) => ({ ...prev, subject: value }));
                  setStep(4);
                }}
              />
            )}

            {step === 4 && (
              <Question
                title="Stor eller liten?"
                subtitle="Välj format"
                options={SIZE_OPTIONS.map((option) => ({
                  id: option.id,
                  label: option.label,
                  size: option.id,
                }))}
                selected={answers.size}
                onSelect={(value) => {
                  setAnswers((prev) => ({ ...prev, size: value }));
                }}
                footer={
                  <div className="flex flex-col md:flex-row gap-3 mt-6">
                    <button
                      id="quiz-submit"
                      type="button"
                      onClick={submitQuiz}
                      disabled={loading}
                      className="px-6 py-4 rounded-full bg-charcoal text-cream text-sm font-medium disabled:opacity-50 focus-ring"
                    >
                      {loading ? "Söker ditt verk…" : "Hitta mitt konstverk"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setStep(3)}
                      className="px-6 py-4 rounded-full bg-cream text-charcoal text-sm font-medium focus-ring"
                    >
                      Tillbaka
                    </button>
                  </div>
                }
              />
            )}
          </div>
        )}
      </div>

      {result && (
        <div className={`fixed inset-0 z-50 ${reveal ? "" : "pointer-events-none"}`}>
          <div className="absolute inset-0 bg-charcoal/90 backdrop-blur-sm" />
          <div className="relative z-10 flex flex-col items-center justify-center min-h-screen px-6 text-center">
            {/* removed confetti */}
            <p className="text-xs uppercase tracking-[0.2em] text-stone">Ditt konstverk</p>
            <h2 className="font-serif text-4xl md:text-5xl text-cream mt-3">{result.title}</h2>
            <p className="text-sm text-stone mt-2">{result.artist}</p>
            <div className="mt-6 w-full max-w-sm rounded-3xl overflow-hidden" style={{ backgroundColor: result.color }}>
              <img src={result.imageUrl} alt={`${result.title} — ${result.artist}`} className="w-full h-[60vh] object-cover" />
            </div>
            <div className="mt-6 flex flex-col md:flex-row gap-3">
              <button
                type="button"
                onClick={shareResult}
                className="px-6 py-3 rounded-full bg-cream text-charcoal text-sm font-medium focus-ring"
              >
                Dela ditt resultat
              </button>
              <button
                type="button"
                onClick={resetQuiz}
                className="px-6 py-3 rounded-full bg-transparent border border-cream/50 text-cream text-sm font-medium focus-ring"
              >
                Prova igen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

type QuestionOption = {
  id: string;
  label: string;
  image?: { url: string; title: string; artist: string } | null;
  color?: string;
  size?: string;
};

type QuestionProps = {
  title: string;
  subtitle: string;
  options: QuestionOption[];
  selected: string;
  onSelect: (value: string) => void;
  footer?: ReactNode;
};

function Question({ title, subtitle, options, selected, onSelect, footer }: QuestionProps) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.2em] text-stone">{subtitle}</p>
      <h2 className="font-serif text-3xl text-charcoal mt-2">{title}</h2>
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        {options.map((option) => {
          const isActive = selected === option.id;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => onSelect(option.id)}
              className={`relative rounded-3xl overflow-hidden aspect-[3/4] border transition-all focus-ring ${
                isActive ? "border-charcoal shadow-xl" : "border-transparent"
              }`}
            >
              {option.image ? (
                <img
                  src={option.image.url}
                  alt={`${option.image.title} — ${option.image.artist}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  width={400}
                  height={533}
                />
              ) : option.color ? (
                <div className="w-full h-full" style={{ backgroundColor: option.color }} />
              ) : option.size ? (
                <div className="w-full h-full bg-cream flex items-center justify-center">
                  <div
                    className="rounded-2xl bg-charcoal/80"
                    style={{
                      width: option.size === "large" ? "70%" : "35%",
                      height: option.size === "large" ? "70%" : "35%",
                    }}
                  />
                </div>
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
              <span className="absolute bottom-3 left-3 text-sm text-cream font-medium">
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
      {footer}
    </div>
  );
}

function QuizProgress({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {Array.from({ length: 5 }).map((_, index) => (
        <span
          key={index}
          className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-charcoal" : "bg-cream"}`}
        />
      ))}
    </div>
  );
}

function Confetti() {
  return (
    <div className="confetti">
      {Array.from({ length: 18 }).map((_, i) => (
        <span key={i} style={{ left: `${(i / 18) * 100}%`, animationDelay: `${i * 0.15}s` }} />
      ))}
      <style>{`
        .confetti span {
          position: absolute;
          top: -10%;
          width: 10px;
          height: 18px;
          background: linear-gradient(180deg, #E8987F, #C4553A);
          opacity: 0.8;
          border-radius: 6px;
          animation: confettiFall 3.5s linear infinite;
        }
        .confetti span:nth-child(2n) {
          background: linear-gradient(180deg, #F2E9D8, #D4CDC3);
        }
        .confetti span:nth-child(3n) {
          background: linear-gradient(180deg, #8FA9C5, #5A6E86);
        }
        @keyframes confettiFall {
          0% { transform: translateY(0) rotate(0deg); }
          100% { transform: translateY(120vh) rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
