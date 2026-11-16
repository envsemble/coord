import { Surface, Toolbar } from "@envsemble/envui";

/**
 * A floating toolbar over the diagram canvas: envUI's Toolbar on a pill
 * Surface, as envUI's ViewControls example floats one over a diagram. Its
 * controls are small (its stylesheet sets the container's control height to
 * sm).
 */
export function Island({ label, className = "", children, ...props }) {
  return (
    <Surface
      background="default"
      radius="full"
      padding={1}
      render={<Toolbar.Root aria-label={label} size="sm" />}
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
