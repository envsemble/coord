import { Surface, Text } from "@envsemble/envui";
import { ToolButton } from "./ToolButton";
import { CloseIcon } from "./icons";

/**
 * A floating pane beside the canvas, such as the inspector. Its header holds
 * the title or a `toolbar` (such as change navigation) and the close button;
 * `resizer` (a separator on its inner edge) stays put while the content
 * scrolls. `ref` reaches the scrolling content.
 */
export function Panel({
  ref,
  open,
  onClose,
  label = "Diagram details",
  title = label,
  toolbar = null,
  closeLabel = "Close details",
  resizer = null,
  children,
  id = "panel",
  className = "",
  ...props
}) {
  const compact = !title && !toolbar;
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
      {resizer}
      <div className="panel-scroll" ref={ref}>
        <div className={`panel-header${compact ? " compact" : ""}`}>
          {toolbar}
          {!toolbar && title && (
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
      </div>
    </Surface>
  );
}
