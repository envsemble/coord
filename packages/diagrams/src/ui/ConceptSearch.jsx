import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Kbd, SearchField, Surface } from "@envsemble/envui";
import { usePopupDismiss } from "./usePopupDismiss";
import { ToolButton } from "./Button";
import { SearchIcon } from "./Icons";

// envUI's compact search field with a list of matching concepts. In a crowded
// toolbar CSS collapses it to a button whose field opens below it.
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
      <ToolButton
        className="search-toggle"
        label="Open concept search"
        tooltip={
          <>
            Find concept <Kbd>/</Kbd>
          </>
        }
        aria-expanded={open}
        aria-controls={fieldId}
        icon={<SearchIcon />}
        onClick={() => setOpen(!open)}
      />
      <div className="search-field" id={fieldId}>
        <SearchField
          ref={inputRef}
          label="Find concept"
          placeholder="Find a concept (/)"
          autoComplete="off"
          aria-keyshortcuts="/"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          value={query}
          onValueChange={(next) => {
            setQuery(next);
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
              // The panel's own Escape (clear selection) does not apply here.
              e.stopPropagation();
              if (listOpen) {
                // Close the list first and keep the query.
                e.preventDefault();
                setShowHits(false);
              } else if (!query) {
                close();
                inputRef.current.blur();
              }
            }
          }}
        />
        <Surface
          ref={suggestionsRef}
          id={listId}
          tone="pane"
          padding={1}
          corners="standard"
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
            if (e.key === "Escape") {
              e.stopPropagation();
              setShowHits(false);
              inputRef.current.focus();
            }
          }}
        >
          {hits.map((c) => (
            <button
              key={c.id}
              type="button"
              role="option"
              aria-selected="false"
              className="suggestion"
              onClick={() => choose(c.id)}
            >
              <span className="suggestion-name">{c.name}</span>
              {c.stereotype && (
                <span className="suggestion-detail">«{c.stereotype}»</span>
              )}
            </button>
          ))}
        </Surface>
      </div>
    </div>
  );
});
