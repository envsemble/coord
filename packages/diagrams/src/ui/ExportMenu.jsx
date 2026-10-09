import { useRef, useState } from "react";
import { IconButton } from "./Button";
import { usePopupDismiss } from "./usePopupDismiss";
import { DownloadIcon } from "./Icons";

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
        <DownloadIcon size={16} />
      </IconButton>
      <div id="export-menu" className={`menu${open ? " open" : ""}`}>
        {children}
      </div>
    </div>
  );
}
