import { Surface, Text } from "@envsemble/envui";
import { ToolButton } from "./Button";
import { CloseIcon } from "./Icons";

/** A floating pane beside the canvas, such as the inspector. */
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
    <Surface
      as="aside"
      tone="pane"
      padding={0}
      id={id}
      className={`panel${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      {...props}
    >
      <div className={`panel-header${title ? "" : " compact"}`}>
        {title && (
          <Text as="h2" variant="section-heading" className="panel-title">
            {title}
          </Text>
        )}
        {onClose && (
          <ToolButton
            className="panel-close"
            label={closeLabel}
            icon={<CloseIcon />}
            onClick={onClose}
          />
        )}
      </div>
      <div className="panel-content">{children}</div>
    </Surface>
  );
}
