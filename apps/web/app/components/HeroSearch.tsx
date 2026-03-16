import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router";
import Autocomplete from "./Autocomplete";
import type { AutocompleteSuggestion } from "./Autocomplete";
import type { CampaignId } from "../lib/campaign.server";

const HERO_SUGGESTION_CHIPS: Record<CampaignId, readonly string[]> = {
  default: ["äpple", "röd klänning", "solnedgång", "guld", "barn som leker", "hav"],
  nationalmuseum: ["stilleben", "porträtt", "landskap", "guld", "blommor", "storm"],
  nordiska: ["samisk trumma", "samiska föremål", "folkdräkt", "Stockholm", "leksaker", "Skansen"],
  shm: ["vikingasvärd", "krona", "runsten", "rustning", "silver", "medeltid"],
};

export default function HeroSearch({
  totalWorks,
  headline,
  subline,
  introText,
  isCampaign,
  campaignId = "default",
}: {
  totalWorks: number;
  headline?: string;
  subline?: string;
  introText?: string | null;
  isCampaign?: boolean;
  campaignId?: CampaignId;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const resolvedHeadline = headline || `${totalWorks.toLocaleString("sv-SE")} konstverk.`;
  const resolvedSubline = subline || "Sök på vad som helst.";
  const suggestionChips = HERO_SUGGESTION_CHIPS[campaignId] || HERO_SUGGESTION_CHIPS.default;

  const handleFocus = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    window.scrollTo(0, 0);
    if (typeof el.setSelectionRange === "function") {
      requestAnimationFrame(() => {
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    }
  }, []);

  const goToSearch = useCallback(
    (q: string, type: "all" | "visual" = "all") => {
      const trimmed = q.trim();
      if (!trimmed) return;
      inputRef.current?.blur();
      const params = new URLSearchParams({ q: trimmed });
      if (type !== "all") params.set("type", type);
      navigate(`/search?${params.toString()}`);
    },
    [navigate]
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      if (suggestion.type === "artwork") {
        inputRef.current?.blur();
        navigate(`/artwork/${suggestion.id}`);
        return;
      }
      if (suggestion.type === "artist") {
        inputRef.current?.blur();
        navigate(`/artist/${encodeURIComponent(suggestion.value)}`);
        return;
      }
      goToSearch(suggestion.value, "visual");
    },
    [goToSearch, navigate]
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const inputValue = inputRef.current?.value || query;
      goToSearch(inputValue);
    },
    [query, goToSearch]
  );

  return (
    <div className="pt-[5.5rem] pb-8 px-5 md:px-2 md:pb-10 lg:px-0 lg:pt-[8rem] lg:pb-16">
      {isCampaign ? (
        /* ── Campaign hero: clear hierarchy ── */
        <div className="text-center">
          <p className="text-[0.8rem] md:text-[0.85rem] uppercase tracking-[0.2em] text-gradient-warm mb-3" style={{ opacity: 0.6 }}>
            Kabinett ×
          </p>
          <h1 className="font-serif text-[2.6rem] md:text-[3.2rem] lg:text-[3.8rem] text-dark-text leading-[1.05] tracking-[-0.02em]">
            <span className="text-gradient-warm">{resolvedHeadline}</span>
          </h1>
          <p className="mt-3 text-[1rem] md:text-[1.1rem] text-dark-text-muted tracking-[-0.01em]">
            {resolvedSubline}
          </p>
          {introText && (
            <p className="mt-3 mx-auto max-w-[32rem] text-[0.85rem] text-dark-text-muted/50 leading-relaxed">
              {introText}
            </p>
          )}
        </div>
      ) : (
        /* ── Default hero: original layout ── */
        <>
          <h1 className="font-serif text-[2.2rem] md:text-[2.8rem] lg:text-[3.4rem] text-dark-text text-center leading-[1.08] tracking-[-0.02em]">
            <span className="text-gradient-warm">{resolvedHeadline}</span>{" "}
            <span className="text-dark-text-muted">{resolvedSubline}</span>
          </h1>
          {introText && (
            <p className="mt-4 mx-auto max-w-[36rem] text-center text-dark-text-muted text-[0.9rem] leading-relaxed">
              {introText}
            </p>
          )}
        </>
      )}

      <Autocomplete
        query={query}
        onQueryChange={setQuery}
        onSelect={handleSelectSuggestion}
        dropdownClassName="absolute left-0 right-0 top-full mt-1.5 z-50 max-w-lg mx-auto bg-dark-base rounded-card shadow-lg border border-[rgba(245,240,232,0.08)] overflow-hidden"
      >
        {({ inputProps }) => (
          <form action="/search" method="get" onSubmit={handleSubmit} className="mt-7 md:mt-9 max-w-[34rem] mx-auto">
            <label htmlFor="hero-search" className="sr-only">
              Sök bland konstverk
            </label>
            <div className="flex items-center gap-3.5 rounded-full bg-[rgba(245,240,232,0.08)] border border-[rgba(245,240,232,0.10)] px-6 py-[0.95rem] transition-all duration-300 focus-within:border-[rgba(212,168,83,0.35)] focus-within:bg-[rgba(245,240,232,0.10)] focus-within:shadow-[0_0_48px_rgba(212,168,83,0.08)]" style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}>
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                className="text-[rgba(212,168,83,0.45)] shrink-0"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                {...inputProps}
                ref={inputRef}
                onFocus={(e) => { inputProps.onFocus(); handleFocus(); }}
                id="hero-search"
                name="q"
                type="text" enterKeyHint="search" autoCorrect="off"
                placeholder="porträtt, blå himmel, stilleben…"
                className="flex-1 bg-transparent text-dark-text placeholder:text-[rgba(201,176,142,0.35)] text-[0.95rem] md:text-[1rem] px-0 py-0 border-none outline-none [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          </form>
        )}
      </Autocomplete>

      <div className="mt-4 max-w-[34rem] mx-auto flex flex-wrap items-center justify-center gap-2">
        {suggestionChips.map((chip) => (
          <button
            key={`${campaignId}-${chip}`}
            type="button"
            onClick={() => goToSearch(chip, "visual")}
            className="cursor-pointer rounded-full border border-[rgba(245,240,232,0.10)] bg-[rgba(245,240,232,0.04)] px-4 py-2 text-[0.8rem] leading-none text-[rgba(201,176,142,0.50)] transition-[color,border-color,background,transform] duration-200 hover:border-[rgba(212,168,83,0.25)] hover:text-[rgba(212,168,83,0.75)] hover:bg-[rgba(212,168,83,0.06)] hover:scale-[1.03] active:scale-[0.97] focus-ring"
            style={{ transitionTimingFunction: "cubic-bezier(0.175, 0.885, 0.32, 1.275)" }}
          >
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}
