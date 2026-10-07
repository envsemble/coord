import { IconButton } from "./Button";
import { XIcon } from "./Icons";

export function Panel({
  open,
  onClose,
  label = "Diagram details",
  title = label,
  closeLabel = "Close details",
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
      <div className={`panel-header${title ? "" : " compact"}`}>
        {title && <span className="panel-title">{title}</span>}
        {onClose && (
          <IconButton
            className="panel-close"
            label={closeLabel}
            onClick={onClose}
          >
            <XIcon size={16} />
          </IconButton>
        )}
      </div>
      <div className="panel-content">{children}</div>
    </aside>
  );
}
