import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePopupDismiss } from "./usePopupDismiss";
import { SearchIcon } from "./Icons";
export const ConceptSearch = memo(function ConceptSearch({
  classes,
  onChoose,
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const searchRef = useRef(null),
    toggleRef = useRef(null);
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
  usePopupDismiss(close, searchRef, toggleRef);
  useEffect(() => {
    const shortcut = (e) => {
      if (e.target.closest("input,textarea,select,[contenteditable='true']"))
        return;
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setOpen(true);
        inputRef.current.focus();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  function choose(name) {
    onChoose(name);
    setQuery("");
    close();
    inputRef.current.blur();
  }
  return (
    <>
      <button
        ref={toggleRef}
        id="search-toggle"
        className="icon"
        aria-label="Open concept search"
        title="Find concept"
        onClick={() => setOpen(!open)}
      >
        <SearchIcon size={16} />
      </button>
      <div ref={searchRef} className={`search${open ? " open" : ""}`}>
        <SearchIcon size={16} className="search-icon" />
        <input
          ref={inputRef}
          id="search"
          type="search"
          placeholder="Find a concept"
          aria-label="Find concept"
          autoComplete="off"
          aria-keyshortcuts="/"
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
          id="suggestions"
          className={`suggestions${showHits && hits.length ? " open" : ""}`}
          role="listbox"
          aria-label="Concepts"
        >
          {hits.map((c) => (
            <button key={c.id} role="option" onClick={() => choose(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
      </div>
    </>
  );
});
