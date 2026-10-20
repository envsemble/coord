import { IconButton, Tooltip } from "@envsemble/envui";

/**
 * An icon-only toolbar action: envUI's IconButton, with its name repeated as a
 * tooltip. `pressed` makes it a toggle, shown with the primary fill while on.
 * Other props (including a menu's trigger props and ref) reach the button.
 */
export function ToolButton({
  label,
  tooltip = label,
  icon,
  pressed,
  variant,
  side = "bottom",
  ...props
}) {
  return (
    <Tooltip content={tooltip} side={side}>
      <IconButton
        {...props}
        aria-label={label}
        aria-pressed={pressed}
        icon={icon}
        variant={variant ?? (pressed ? "primary" : "secondary")}
      />
    </Tooltip>
  );
}
