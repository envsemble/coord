import { IconButton, Tooltip } from "@envsemble/envui";

/**
 * An icon-only toolbar action: envUI's IconButton, with its name repeated as a
 * tooltip. `pressed` makes it a toggle: plain while off, and the neutral
 * secondary fill while on (selection is never the accent, which is for actions).
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
        variant={variant ?? (pressed === false ? "ghost" : "secondary")}
      />
    </Tooltip>
  );
}
