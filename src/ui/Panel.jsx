import { IconButton } from "./Button";
import { XIcon } from "./Icons";

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
      <div className="panel-header">
        <span className="panel-title">{label}</span>
        {onClose && (
          <IconButton
            className="panel-close"
            label="Close details"
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
