import { useState } from "react";
import { ModelReport } from "../learning/ModelReport";
export function ReportViewer({ payload, theme = "dark", onReference, render }) {
  const [open, setOpen] = useState(false),
    [focus, setFocus] = useState(null);
  return (
    <div
      className={`atlas-panel atlas-report-host${open ? " report-open" : ""}`}
      data-theme={theme}
    >
      <div className="report-diagram" hidden={open}>
        {render({ ...payload, report: undefined }, focus)}
      </div>
      {open && (
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
      )}
      <button
        className="report-toggle"
        aria-label={open ? "Return to diagram" : "Open model report"}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Diagram" : "Report"}
      </button>
    </div>
  );
}
