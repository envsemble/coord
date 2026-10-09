import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePopupDismiss } from "./usePopupDismiss";
import { SearchIcon } from "./Icons";

// A compact search field for the floating toolbar. In narrow containers CSS
// collapses it to a toggle button whose field opens as an anchored popover.
export const ConceptSearch = memo(function ConceptSearch({
  classes,
  onChoose,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const searchRef = useRef(null);
  const fieldId = useId(),
    listId = useId();
  const q = query.trim().toLowerCase();
  const searchEntries = useMemo(
    () =>
      classes.map((concept) => ({ concept, text: concept.name.toLowerCase() })),
    [classes],
  );
  const hits = useMemo(() => {
    if (!q) return [];
    const matches = [];
    for (const entry of searchEntries) {
      if (entry.text.includes(q)) matches.push(entry.concept);
      if (matches.length === 12) break;
    }
    return matches;
  }, [q, searchEntries]);
  const close = () => {
    setShowHits(false);
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (open) inputRef.current.focus();
  }, [open]);
  usePopupDismiss(close, searchRef);
  useEffect(() => {
    const shortcut = (e) => {
      if (e.target.closest?.("input,textarea,select,[contenteditable='true']"))
        return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // With several embedded panels, the first visible search wins.
        if (!searchRef.current?.offsetParent) return;
        const first = [...document.querySelectorAll(".search")].find(
          (el) => el.offsetParent,
        );
        if (first && first !== searchRef.current) return;
        e.preventDefault();
        setOpen(true);
        inputRef.current.focus();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  function choose(id) {
    onChoose(id);
    setQuery("");
    close();
    inputRef.current.blur();
  }
  const listOpen = showHits && hits.length > 0;
  return (
    <div ref={searchRef} className={`search${open ? " open" : ""}`}>
      <button
        type="button"
        className="icon search-toggle"
        aria-label="Open concept search"
        aria-expanded={open}
        aria-controls={fieldId}
        title="Find concept (/)"
        onClick={() => setOpen(!open)}
      >
        <SearchIcon size={16} />
      </button>
      <div className="search-field" id={fieldId}>
        <SearchIcon size={14} className="search-icon" />
        <input
          ref={inputRef}
          id="search"
          type="search"
          placeholder="Find a concept"
          aria-label="Find concept"
          autoComplete="off"
          aria-keyshortcuts="/"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowHits(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && hits.length) {
              choose(hits[0].id);
              e.preventDefault();
            }
            if (e.key === "ArrowDown") {
              suggestionsRef.current.querySelector("button")?.focus();
              e.preventDefault();
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
              inputRef.current.blur();
            }
          }}
        />
        <kbd className="search-shortcut" aria-hidden="true">
          /
        </kbd>
        <div
          ref={suggestionsRef}
          id={listId}
          className={`suggestions${listOpen ? " open" : ""}`}
          role="listbox"
          aria-label="Concepts"
          onKeyDown={(e) => {
            const items = [
              ...suggestionsRef.current.querySelectorAll("button"),
            ];
            const index = items.indexOf(document.activeElement);
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const next = index + (e.key === "ArrowDown" ? 1 : -1);
              if (next < 0) inputRef.current.focus();
              else items[Math.min(next, items.length - 1)]?.focus();
            }
          }}
        >
          {hits.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => choose(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
});
