import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Button, Theme, Tooltip, useTheme } from "@envsemble/envui";
import { ModelReport } from "../learning/ModelReport";
import { Island, IslandDivider } from "../ui/Island";
import { BackIcon, ReportIcon } from "../ui/Icons";

export function ReportViewer({ payload, theme, leading, onReference, render }) {
  // The standalone viewer passes no theme and follows its envUI theme.
  const ambientTheme = useTheme();
  const [open, setOpen] = useState(false),
    [focus, setFocus] = useState(null);
  // Paper is light: the report prints in the light theme whatever the screen uses.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
  }, []);
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
    <Tooltip content="Model report" side="bottom">
      <Button
        variant="secondary"
        className="report-toggle"
        aria-label="Open model report"
        startIcon={<ReportIcon />}
        onClick={() => setOpen(true)}
      >
        <span className="collapsible-label">Report</span>
      </Button>
    </Tooltip>
  );
  return (
    <Theme
      ref={host}
      theme={printing ? "light" : theme || ambientTheme}
      className={`atlas-panel atlas-report-host${open ? " report-open" : ""}`}
      data-theme={theme || ambientTheme}
    >
      <div className="report-diagram" hidden={open}>
        {render({ ...payload, report: undefined }, focus, { reportControl })}
      </div>
      {open && (
        <div className="report-view">
          <div className="atlas-overlay-top report-toolbar">
            <Island label="Report navigation" className="island-start">
              <Button
                ref={back}
                variant="secondary"
                startIcon={<BackIcon />}
                onClick={close}
              >
                Back to diagram
              </Button>
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
    </Theme>
  );
}
