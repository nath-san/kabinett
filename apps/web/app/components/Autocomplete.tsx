import type React from "react";
import { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export type ArtworkAutocompleteSuggestion = {
  type: "artwork";
  id: number;
  title: string;
  iiif_url: string | null;
  dominant_color: string | null;
  artist_name: string | null;
  imageUrl: string;
};

export type ArtistAutocompleteSuggestion = {
  type: "artist";
  value: string;
  count?: number;
};

export type ClipAutocompleteSuggestion = {
  type: "clip";
  value: string;
};

export type AutocompleteSuggestion =
  | ArtworkAutocompleteSuggestion
  | ArtistAutocompleteSuggestion
  | ClipAutocompleteSuggestion;

type SuggestionGroups = {
  artworks: ArtworkAutocompleteSuggestion[];
  artists: ArtistAutocompleteSuggestion[];
  clips: ClipAutocompleteSuggestion[];
};

type AutocompleteInputProps = {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  autoComplete: "off";
  role: "combobox";
  "aria-autocomplete": "list";
  "aria-expanded": boolean;
  "aria-controls": string | undefined;
};

type AutocompleteProps = {
  query: string;
  onQueryChange: (value: string) => void;
  onSelect: (suggestion: AutocompleteSuggestion) => void;
  children: (props: { inputProps: AutocompleteInputProps }) => React.ReactNode;
  dropdownClassName?: string;
  buildRequestUrl?: (query: string) => string;
  minLength?: number;
};

const EMPTY_SUGGESTIONS: SuggestionGroups = {
  artworks: [],
  artists: [],
  clips: [],
};
const CLIENT_AUTOCOMPLETE_CACHE_TTL_MS = 5 * 60_000;
const CLIENT_AUTOCOMPLETE_CACHE_MAX = 120;
const AUTOCOMPLETE_DEBOUNCE_MS = 100;
const autocompleteResponseCache = new Map<string, { suggestions: SuggestionGroups; ts: number }>();

function countSuggestions(groups: SuggestionGroups): number {
  return groups.artworks.length + groups.artists.length + groups.clips.length;
}

function cacheKeyForQuery(query: string): string {
  return query.toLowerCase();
}

function getCachedSuggestions(query: string): SuggestionGroups | null {
  const cached = autocompleteResponseCache.get(query);
  if (!cached) return null;
  if (Date.now() - cached.ts >= CLIENT_AUTOCOMPLETE_CACHE_TTL_MS) {
    autocompleteResponseCache.delete(query);
    return null;
  }
  return cached.suggestions;
}

function setCachedSuggestions(query: string, suggestions: SuggestionGroups): void {
  autocompleteResponseCache.set(query, { suggestions, ts: Date.now() });

  if (autocompleteResponseCache.size <= CLIENT_AUTOCOMPLETE_CACHE_MAX) {
    return;
  }

  const oldestKey = autocompleteResponseCache.keys().next().value;
  if (oldestKey) {
    autocompleteResponseCache.delete(oldestKey);
  }
}

function suggestionValue(suggestion: AutocompleteSuggestion): string {
  if (suggestion.type === "artwork") return suggestion.title;
  return suggestion.value;
}

function defaultRequestUrl(query: string): string {
  return `/api/autocomplete?q=${encodeURIComponent(query)}`;
}

function normalizeSuggestions(raw: unknown): SuggestionGroups {
  if (!raw || typeof raw !== "object") return EMPTY_SUGGESTIONS;

  const payload = raw as {
    artworks?: Array<{
      id?: number;
      title?: string;
      iiif_url?: string | null;
      dominant_color?: string | null;
      artist_name?: string | null;
      imageUrl?: string;
    }>;
    artists?: Array<{ value?: string; count?: number }>;
    clips?: Array<{ value?: string }>;
  };

  const artworks = Array.isArray(payload.artworks)
    ? payload.artworks
        .filter((item) => typeof item?.id === "number" && typeof item?.title === "string")
        .slice(0, 3)
        .map((item) => ({
          type: "artwork" as const,
          id: item.id as number,
          title: (item.title as string).trim() || "Utan titel",
          iiif_url: item.iiif_url ?? null,
          dominant_color: item.dominant_color ?? null,
          artist_name: item.artist_name?.trim() || null,
          imageUrl: item.imageUrl?.trim() || "",
        }))
    : [];

  const artists = Array.isArray(payload.artists)
    ? payload.artists
        .filter((item) => typeof item?.value === "string")
        .slice(0, 3)
        .map((item) => ({
          type: "artist" as const,
          value: (item.value as string).trim(),
          count: typeof item.count === "number" ? item.count : undefined,
        }))
        .filter((item) => item.value.length > 0)
    : [];

  const clips = Array.isArray(payload.clips)
    ? payload.clips
        .filter((item) => typeof item?.value === "string")
        .slice(0, 3)
        .map((item) => ({
          type: "clip" as const,
          value: (item.value as string).trim(),
        }))
        .filter((item) => item.value.length > 0)
    : [];

  return { artworks, artists, clips };
}

export default function Autocomplete({
  query,
  onQueryChange,
  onSelect,
  children,
  buildRequestUrl = defaultRequestUrl,
  dropdownClassName,
  minLength = 2,
}: AutocompleteProps) {
  const [suggestions, setSuggestions] = useState<SuggestionGroups>(EMPTY_SUGGESTIONS);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userTypingRef = useRef(false);
  const listboxId = useId();

  const flatSuggestions = useMemo(
    () => [...suggestions.artworks, ...suggestions.artists, ...suggestions.clips],
    [suggestions]
  );
  const totalSuggestions = flatSuggestions.length;

  const killPending = useCallback(() => {
    if (fetchTimer.current) {
      clearTimeout(fetchTimer.current);
      fetchTimer.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  const dismiss = useCallback(() => {
    killPending();
    setSuggestions(EMPTY_SUGGESTIONS);
    closeDropdown();
  }, [killPending, closeDropdown]);

  const applySuggestions = useCallback((nextSuggestions: SuggestionGroups) => {
    const nextCount = countSuggestions(nextSuggestions);

    startTransition(() => {
      setSuggestions(nextSuggestions);
      if (nextCount > 0) {
        setIsOpen(true);
        setActiveIndex(-1);
      } else {
        closeDropdown();
      }
    });
  }, [closeDropdown]);

  const selectSuggestion = useCallback(
    (suggestion: AutocompleteSuggestion) => {
      userTypingRef.current = false;
      dismiss();
      onQueryChange(suggestionValue(suggestion));
      onSelect(suggestion);
    },
    [dismiss, onQueryChange, onSelect]
  );

  useEffect(() => {
    killPending();

    const trimmed = query.trim();
    if (!userTypingRef.current || trimmed.length < minLength) {
      if (trimmed.length < minLength) {
        setSuggestions(EMPTY_SUGGESTIONS);
        closeDropdown();
      }
      return;
    }

    const cacheKey = cacheKeyForQuery(trimmed);
    const cachedSuggestions = getCachedSuggestions(cacheKey);
    if (cachedSuggestions) {
      applySuggestions(cachedSuggestions);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    fetchTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(buildRequestUrl(trimmed), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Autocomplete request failed");

        const raw = await response.json();
        if (controller.signal.aborted || !userTypingRef.current) return;

        const nextSuggestions = normalizeSuggestions(raw);
        setCachedSuggestions(cacheKey, nextSuggestions);
        applySuggestions(nextSuggestions);
      } catch (error: unknown) {
        if ((error as { name?: string }).name === "AbortError") return;
        setSuggestions(EMPTY_SUGGESTIONS);
        closeDropdown();
      }
    }, AUTOCOMPLETE_DEBOUNCE_MS);

    return () => {
      controller.abort();
      if (fetchTimer.current) {
        clearTimeout(fetchTimer.current);
        fetchTimer.current = null;
      }
    };
  }, [applySuggestions, buildRequestUrl, closeDropdown, killPending, minLength, query]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    };
  }, []);

  const inputProps: AutocompleteInputProps = {
    value: query,
    onChange: (event) => {
      userTypingRef.current = true;
      onQueryChange(event.target.value);
    },
    onKeyDown: (event) => {
      if (event.key === "ArrowDown" && totalSuggestions > 0) {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex((prev) => (prev < 0 ? 0 : (prev + 1) % totalSuggestions));
        return;
      }
      if (event.key === "ArrowUp" && totalSuggestions > 0) {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex((prev) => (prev < 0 ? totalSuggestions - 1 : (prev - 1 + totalSuggestions) % totalSuggestions));
        return;
      }
      if (event.key === "Enter") {
        if (isOpen && activeIndex >= 0) {
          const suggestion = flatSuggestions[activeIndex];
          if (suggestion) {
            event.preventDefault();
            selectSuggestion(suggestion);
          }
        } else {
          userTypingRef.current = false;
          dismiss();
        }
        return;
      }
      if (event.key === "Escape") {
        dismiss();
      }
    },
    onFocus: () => {
      if (totalSuggestions > 0 && userTypingRef.current) {
        setIsOpen(true);
      }
    },
    onBlur: () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      blurTimer.current = setTimeout(() => {
        closeDropdown();
      }, 120);
    },
    autoComplete: "off",
    role: "combobox",
    "aria-autocomplete": "list",
    "aria-expanded": isOpen && totalSuggestions > 0,
    "aria-controls": isOpen && totalSuggestions > 0 ? listboxId : undefined,
  };

  return (
    <div className="relative">
      {children({ inputProps })}
      {isOpen && totalSuggestions > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className={dropdownClassName || "absolute left-0 right-0 top-full mt-1 z-50 bg-dark-base rounded-card shadow-lg border border-[rgba(245,240,232,0.1)] overflow-hidden"}
        >
          {(() => {
            const { artworks, artists, clips } = suggestions;
            let globalIndex = 0;
            const hasArtworkSection = artworks.length > 0;
            const hasArtistSection = artists.length > 0;

            return (
              <>
                {hasArtworkSection && (
                  <>
                    <div className="px-4 pt-2.5 pb-1">
                      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-dark-text-muted/75">Verk</span>
                    </div>
                    <div className="pb-2">
                      {artworks.map((suggestion, index) => {
                        const idx = globalIndex++;
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={`artwork-${suggestion.id}`}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              selectSuggestion(suggestion);
                            }}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={[
                              "w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors",
                              "hover:bg-dark-hover focus-ring",
                              isActive ? "bg-dark-hover" : "",
                              index > 0 ? "border-t border-[rgba(245,240,232,0.05)]" : "",
                            ].join(" ")}
                          >
                            {suggestion.imageUrl ? (
                              <img
                                src={suggestion.imageUrl}
                                alt=""
                                className="h-8 w-8 rounded-md object-cover shrink-0 bg-dark-raised"
                                loading="lazy"
                              />
                            ) : (
                              <div
                                className="h-8 w-8 rounded-md shrink-0 bg-dark-raised"
                                style={suggestion.dominant_color ? { backgroundColor: suggestion.dominant_color } : undefined}
                              />
                            )}
                            <span className="min-w-0">
                              <span className="block text-sm text-dark-text truncate">{suggestion.title}</span>
                              <span className="block text-xs text-dark-text-muted truncate">
                                {suggestion.artist_name || "Okänd konstnär"}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {hasArtistSection && (
                  <>
                    <div className={`px-4 pt-2.5 pb-1 ${hasArtworkSection ? "border-t border-[rgba(245,240,232,0.08)]" : ""}`}>
                      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-dark-text-muted/75">Konstnärer</span>
                    </div>
                    <div className="pb-2">
                      {artists.map((suggestion, index) => {
                        const idx = globalIndex++;
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={`artist-${suggestion.value}`}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              selectSuggestion(suggestion);
                            }}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={[
                              "w-full text-left px-4 py-2.5 text-sm flex justify-between items-center cursor-pointer transition-colors",
                              "hover:bg-dark-hover focus-ring",
                              isActive ? "bg-dark-hover" : "",
                              index > 0 ? "border-t border-[rgba(245,240,232,0.05)]" : "",
                            ].join(" ")}
                          >
                            <span className="text-dark-text truncate">{suggestion.value}</span>
                            <span className="text-xs text-dark-text-muted ml-2 shrink-0">
                              {suggestion.count ? `${suggestion.count} verk` : "Konstnär"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {clips.length > 0 && (
                  <>
                    <div className={`px-4 pt-2.5 pb-1 ${(hasArtworkSection || hasArtistSection) ? "border-t border-[rgba(245,240,232,0.08)]" : ""}`}>
                      <span className="text-[0.65rem] uppercase tracking-[0.15em] text-dark-text-muted/75">Sök visuellt</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 px-4 pb-3 pt-1">
                      {clips.map((suggestion) => {
                        const idx = globalIndex++;
                        const isActive = idx === activeIndex;
                        return (
                          <button
                            key={`clip-${suggestion.value}`}
                            type="button"
                            role="option"
                            aria-selected={isActive}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              selectSuggestion(suggestion);
                            }}
                            onMouseEnter={() => setActiveIndex(idx)}
                            className={[
                              "px-3 py-1.5 rounded-full text-sm cursor-pointer transition-colors",
                              "hover:bg-dark-hover focus-ring",
                              isActive
                                ? "bg-dark-hover text-dark-text"
                                : "bg-[rgba(245,240,232,0.06)] text-dark-text-secondary",
                            ].join(" ")}
                          >
                            {suggestion.value}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
