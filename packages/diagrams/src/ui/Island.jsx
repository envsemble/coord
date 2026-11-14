import { Surface } from "@envsemble/envui";

/**
 * A floating toolbar over the diagram canvas: an envUI pane holding small
 * controls (its stylesheet sets the container's control height to sm).
 */
export function Island({ label, className = "", children, ...props }) {
  return (
    <Surface
      background="default"
      radius="full"
      padding={1}
      role="group"
      aria-label={label}
      className={`coord-island${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </Surface>
  );
}

export function IslandDivider() {
  return <span className="island-divider" aria-hidden="true" />;
}
