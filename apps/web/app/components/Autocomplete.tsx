import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

type Suggestion = {
  value: string;
  type: string;
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
  onSelect: (value: string) => void;
  children: (props: { inputProps: AutocompleteInputProps }) => React.ReactNode;
  dropdownClassName?: string;
  minLength?: number;
};

const TYPE_LABELS: Record<string, string> = {
  artist: "Konstnär",
  title: "Verk",
  category: "Kategori",
};

export default function Autocomplete({
  query,
  onQueryChange,
  onSelect,
  children,
  dropdownClassName,
  minLength = 2,
}: AutocompleteProps) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submittedRef = useRef(query.trim().length > 0);
  const abortRef = useRef<AbortController | null>(null);
  const listboxId = useId();

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
    setActiveIndex(-1);
  }, []);

  const selectSuggestion = useCallback((value: string) => {
    submittedRef.current = true;
    if (fetchTimer.current) { clearTimeout(fetchTimer.current); fetchTimer.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
    onQueryChange(value);
    closeDropdown();
    onSelect(value);
  }, [closeDropdown, onQueryChange, onSelect]);

  useEffect(() => {
    if (fetchTimer.current) {
      clearTimeout(fetchTimer.current);
      fetchTimer.current = null;
    }

    submittedRef.current = false;
    const trimmed = query.trim();
    if (trimmed.length < minLength) {
      setSuggestions([]);
      closeDropdown();
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    fetchTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/autocomplete?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error("Autocomplete request failed");
        }
        const data = await response.json() as Suggestion[];
        if (controller.signal.aborted) return;
        setSuggestions(data);
        if (data.length > 0 && !submittedRef.current) {
          setIsOpen(true);
          setActiveIndex(-1);
        } else {
          submittedRef.current = true;
          if (fetchTimer.current) {
            clearTimeout(fetchTimer.current);
            fetchTimer.current = null;
          }
          if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
          }
          setSuggestions([]);
          closeDropdown();
        }
      } catch (error: unknown) {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        setSuggestions([]);
        closeDropdown();
      }
    }, 200);

    return () => {
      controller.abort();
      if (fetchTimer.current) {
        clearTimeout(fetchTimer.current);
        fetchTimer.current = null;
      }
    };
  }, [closeDropdown, minLength, query]);

  useEffect(() => {
    return () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
    };
  }, []);

  const inputProps: AutocompleteInputProps = {
    value: query,
    onChange: (event) => {
      onQueryChange(event.target.value);
    },
    onKeyDown: (event) => {
      if (suggestions.length === 0) {
        if (event.key === "Escape") {
          closeDropdown();
        }
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex((prev) => {
          if (prev < 0) return 0;
          return (prev + 1) % suggestions.length;
        });
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex((prev) => {
          if (prev < 0) return suggestions.length - 1;
          return (prev - 1 + suggestions.length) % suggestions.length;
        });
        return;
      }

      if (event.key === "Enter") {
        if (isOpen && activeIndex >= 0) {
          event.preventDefault();
          selectSuggestion(suggestions[activeIndex].value);
        } else {
          submittedRef.current = true;
          if (fetchTimer.current) {
            clearTimeout(fetchTimer.current);
            fetchTimer.current = null;
          }
          if (abortRef.current) {
            abortRef.current.abort();
            abortRef.current = null;
          }
          setSuggestions([]);
          closeDropdown();
        }
        return;
      }

      if (event.key === "Escape") {
        closeDropdown();
      }
    },
    onFocus: () => {
      if (suggestions.length > 0 && !submittedRef.current) {
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
    "aria-expanded": isOpen && suggestions.length > 0,
    "aria-controls": isOpen && suggestions.length > 0 ? listboxId : undefined,
  };

  return (
    <div className="relative">
      {children({ inputProps })}
      {isOpen && suggestions.length > 0 ? (
        <div
          id={listboxId}
          role="listbox"
          className={dropdownClassName || "absolute left-0 right-0 top-full mt-1 z-50 bg-[#1C1916] rounded-xl shadow-lg border border-[rgba(245,240,232,0.1)] overflow-hidden"}
        >
          {suggestions.map((suggestion, index) => {
            const isActive = index === activeIndex;
            return (
              <button
                key={`${suggestion.type}-${suggestion.value}-${index}`}
                type="button"
                role="option"
                aria-selected={isActive}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectSuggestion(suggestion.value);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className={[
                  "w-full text-left px-4 py-3 text-sm flex justify-between cursor-pointer",
                  "hover:bg-[#2E2820] focus-ring",
                  isActive ? "bg-[#2E2820]" : "",
                  index > 0 ? "border-t border-[rgba(245,240,232,0.05)]" : "",
                ].join(" ")}
              >
                <span className="text-[#F5F0E8] truncate">{suggestion.value}</span>
                <span className="text-xs text-[rgba(245,240,232,0.4)] ml-2 shrink-0">
                  {TYPE_LABELS[suggestion.type] || ""}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

