import { useRef, useState } from "react";
import { IconButton } from "./Button";
import { usePopupDismiss } from "./usePopupDismiss";

export function ExportMenu({ children }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  usePopupDismiss(() => setOpen(false), root);
  return (
    <div className="menu-wrap" ref={root}>
      <IconButton
        id="export"
        label="Export"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ↓
      </IconButton>
      <div id="export-menu" className={`menu${open ? " open" : ""}`}>
        {children}
      </div>
    </div>
  );
}
