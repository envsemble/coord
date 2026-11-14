import { Surface, Text } from "@envsemble/envui";
import { ToolButton } from "./ToolButton";
import { CloseIcon } from "./icons";

/**
 * A floating pane beside the canvas. Its header holds the title, a `toolbar`
 * (such as change navigation) after it, and the close button; the content
 * scrolls below it.
 */
export function Panel({
  open,
  onClose,
  label,
  title = label,
  toolbar = null,
  closeLabel = "Close",
  children,
  id = "panel",
  className = "",
  ...props
}) {
  return (
    <Surface
      render={<aside />}
      background="default"
      padding={0}
      id={id}
      className={`panel${open ? " open" : ""}${className ? ` ${className}` : ""}`}
      aria-label={label}
      {...props}
    >
      <div className="panel-scroll">
        <div className="panel-header">
          <Text
            render={<h2 />}
            variant="title"
            className="coord-section-heading panel-title"
          >
            {title}
          </Text>
          {toolbar}
          {onClose && (
            <ToolButton
              variant="ghost"
              className="panel-close"
              label={closeLabel}
              icon={<CloseIcon />}
              onClick={onClose}
            />
          )}
        </div>
        <div className="panel-content">{children}</div>
      </div>
    </Surface>
  );
}
