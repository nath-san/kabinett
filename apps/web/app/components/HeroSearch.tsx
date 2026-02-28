import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import Autocomplete from "./Autocomplete";

export default function HeroSearch({
  totalWorks,
}: {
  totalWorks: number;
  showMuseumBadge?: boolean;
  onSearchActive?: (active: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();

  const goToSearch = useCallback(
    (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      navigate(`/search?q=${encodeURIComponent(trimmed)}`);
    },
    [navigate]
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      goToSearch(query);
    },
    [query, goToSearch]
  );

  return (
    <div className="pt-[4.8rem] pb-4 px-5 md:px-2 lg:px-0 lg:pt-[5rem] lg:pb-4">
      <h1 className="font-serif text-[1.55rem] md:text-[1.8rem] lg:text-[2.2rem] text-[#F5F0E8] text-center leading-[1.15] tracking-[-0.01em]">
        {totalWorks.toLocaleString("sv-SE")} konstverk.{" "}
        <span className="text-[rgba(245,240,232,0.45)]">Sök på vad som helst.</span>
      </h1>

      <Autocomplete
        query={query}
        onQueryChange={setQuery}
        onSelect={(value) => goToSearch(value)}
        dropdownClassName="absolute left-0 right-0 top-full mt-1 z-50 max-w-lg mx-auto bg-[#1C1916] rounded-xl shadow-lg border border-[rgba(245,240,232,0.1)] overflow-hidden"
      >
        {({ inputProps }) => (
          <form onSubmit={handleSubmit} className="mt-4 md:mt-5 max-w-lg mx-auto">
            <label htmlFor="hero-search" className="sr-only">
              Sök bland konstverk
            </label>
            <div className="flex items-center gap-3 rounded-2xl bg-[rgba(245,240,232,0.1)] backdrop-blur-[12px] border border-[rgba(245,240,232,0.18)] px-5 py-3.5 transition-all duration-200 focus-within:border-[rgba(201,176,142,0.45)] focus-within:bg-[rgba(245,240,232,0.14)] focus-within:shadow-[0_0_30px_rgba(201,176,142,0.08)]">
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="text-[rgba(201,176,142,0.6)] shrink-0"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
              <input
                {...inputProps}
                id="hero-search"
                type="search"
                placeholder="porträtt, blå himmel, stilleben…"
                className="flex-1 bg-transparent text-[#F5F0E8] placeholder:text-[rgba(245,240,232,0.35)] text-[1rem] md:text-[1.05rem] px-0 py-0 border-none outline-none [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          </form>
        )}
      </Autocomplete>
    </div>
  );
}
