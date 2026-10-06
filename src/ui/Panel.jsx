import { IconButton } from "./Button";

export function Panel({ open, onClose, label = "Diagram details", children }) {
  return (
    <aside
      id="panel"
      className={`panel${open ? " open" : ""}`}
      aria-label={label}
    >
      <IconButton
        className="panel-close"
        label="Close details"
        onClick={onClose}
      >
        ×
      </IconButton>
      <div id="panel-content">{children}</div>
    </aside>
  );
}
