import { IconButton } from "./Button";

export function Panel({
  open,
  onClose,
  label = "Diagram details",
  children,
  id = "panel",
  className = "",
  ...props
}) {
  return (
    <aside
      id={id}
      className={`panel${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      {...props}
    >
      {onClose && (
        <IconButton
          className="panel-close"
          label="Close details"
          onClick={onClose}
        >
          ×
        </IconButton>
      )}
      <div className="panel-content">{children}</div>
    </aside>
  );
}
