import { useEffect, useRef, useState } from "react";
import { ModelReport } from "../learning/ModelReport";
import { Island, IslandDivider } from "../ui/Island";
import { ArrowLeftIcon, NoteIcon } from "../ui/Icons";

export function ReportViewer({
  payload,
  theme = "dark",
  leading,
  onReference,
  render,
}) {
  const [open, setOpen] = useState(false),
    [focus, setFocus] = useState(null);
  const host = useRef(null),
    back = useRef(null),
    returnFocus = useRef(false);
  const close = () => {
    returnFocus.current = true;
    setOpen(false);
  };
  useEffect(() => {
    if (open) {
      back.current?.focus();
      const escape = (e) => {
        if (e.key === "Escape" && host.current?.contains(e.target)) close();
      };
      document.addEventListener("keydown", escape);
      return () => document.removeEventListener("keydown", escape);
    }
    if (returnFocus.current) {
      returnFocus.current = false;
      host.current?.querySelector(".report-toggle")?.focus();
    }
  }, [open]);
  const reportControl = (
    <button
      type="button"
      className="icon with-label report-toggle"
      aria-label="Open model report"
      title="Model report"
      onClick={() => setOpen(true)}
    >
      <NoteIcon size={16} />
      <span className="collapsible-label">Report</span>
    </button>
  );
  return (
    <div
      ref={host}
      className={`atlas-panel atlas-report-host${open ? " report-open" : ""}`}
      data-theme={theme}
    >
      <div className="report-diagram" hidden={open}>
        {render({ ...payload, report: undefined }, focus, { reportControl })}
      </div>
      {open && (
        <div className="report-view">
          <div className="atlas-overlay-top report-toolbar">
            <Island label="Report navigation" className="island-start">
              <button
                ref={back}
                type="button"
                className="icon with-label"
                onClick={close}
              >
                <ArrowLeftIcon size={16} />
                <span>Back to diagram</span>
              </button>
              {leading && (
                <>
                  <IslandDivider />
                  <div className="island-leading">{leading}</div>
                </>
              )}
            </Island>
          </div>
          <ModelReport
            report={payload.report}
            model={payload.model}
            snippets={payload.snippets}
            onReference={onReference}
            onInspect={(target) => {
              setFocus({ ...target });
              setOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
