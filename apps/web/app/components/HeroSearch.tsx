import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import Autocomplete from "./Autocomplete";
import type { AutocompleteSuggestion } from "./Autocomplete";

export default function HeroSearch({
  totalWorks,
}: {
  totalWorks: number;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep cursor at end on iOS when focusing an empty-looking input
  const handleFocus = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    // Scroll to top first so iOS keyboard scroll positions input correctly
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
      // Blur input to close autocomplete dropdown before navigating
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
      // Read directly from input to avoid stale state
      const inputValue = inputRef.current?.value || query;
      goToSearch(inputValue);
    },
    [query, goToSearch]
  );

  return (
    <div className="pt-[5rem] pb-6 px-5 md:px-2 md:pb-8 lg:px-0 lg:pt-[7.5rem] lg:pb-14">
      <h1 className="font-serif text-[2rem] md:text-[2.6rem] lg:text-[3.2rem] text-dark-text text-center leading-[1.08] tracking-[-0.02em]">
        {totalWorks.toLocaleString("sv-SE")} konstverk.{" "}
        <span className="text-dark-text-muted">Sök på vad som helst.</span>
      </h1>

      <Autocomplete
        query={query}
        onQueryChange={setQuery}
        onSelect={handleSelectSuggestion}
        dropdownClassName="absolute left-0 right-0 top-full mt-1.5 z-50 max-w-lg mx-auto bg-dark-base rounded-card shadow-lg border border-[rgba(245,240,232,0.08)] overflow-hidden"
      >
        {({ inputProps }) => (
          <form action="/search" method="get" onSubmit={handleSubmit} className="mt-6 md:mt-8 max-w-[32rem] mx-auto">
            <label htmlFor="hero-search" className="sr-only">
              Sök bland konstverk
            </label>
            <div className="flex items-center gap-3.5 rounded-full bg-[rgba(245,240,232,0.07)] border border-[rgba(245,240,232,0.12)] px-6 py-[0.9rem] transition-all duration-300 focus-within:border-[rgba(201,176,142,0.35)] focus-within:bg-[rgba(245,240,232,0.10)] focus-within:shadow-[0_0_40px_rgba(201,176,142,0.06)]">
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                className="text-[rgba(201,176,142,0.45)] shrink-0"
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
                className="flex-1 bg-transparent text-dark-text placeholder:text-[rgba(201,176,142,0.4)] text-[0.95rem] md:text-[1rem] px-0 py-0 border-none outline-none [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          </form>
        )}
      </Autocomplete>
    </div>
  );
}
