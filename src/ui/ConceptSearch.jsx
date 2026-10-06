import { useLayoutEffect, useRef, useState } from "react";
import { usePopupDismiss } from "./usePopupDismiss";
export function ConceptSearch({ classes, onChoose }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showHits, setShowHits] = useState(false);
  const inputRef = useRef(null);
  const suggestionsRef = useRef(null);
  const searchRef = useRef(null),
    toggleRef = useRef(null);
  const q = query.trim().toLowerCase();
  const hits = q
    ? classes.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12)
    : [];
  const close = () => {
    setShowHits(false);
    setOpen(false);
  };
  useLayoutEffect(() => {
    if (open) inputRef.current.focus();
  }, [open]);
  usePopupDismiss(close, searchRef, toggleRef);
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
        ⌕
      </button>
      <div ref={searchRef} className={`search${open ? " open" : ""}`}>
        <input
          ref={inputRef}
          id="search"
          type="search"
          placeholder="Find concept…"
          aria-label="Find concept"
          autoComplete="off"
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
}
