import { Surface, Toolbar } from "@envsemble/envui";

/**
 * A floating toolbar over the diagram canvas: envUI's Toolbar on a pill
 * Surface, as envUI's ViewControls example floats one over a diagram. Its
 * controls are small (its stylesheet sets the container's control height to
 * sm), and their names show at once.
 */
export function Island({ label, className = "", children, ...props }) {
  return (
    <Surface
      background="default"
      radius="full"
      padding={1}
      render={<Toolbar.Root aria-label={label} size="sm" tooltipDelay={0} />}
      className={`coord-island${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </Surface>
  );
}

/** A separator between the toolbar's groups of controls. */
export function IslandDivider() {
  return <Toolbar.Separator />;
}
