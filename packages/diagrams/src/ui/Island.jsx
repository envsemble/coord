import { Surface } from "@envsemble/envui";

/** A floating toolbar over the diagram canvas: an envUI pane holding compact controls. */
export function Island({ label, className = "", children, ...props }) {
  return (
    <Surface
      tone="pane"
      corners="pill"
      padding={1}
      density="compact"
      role="group"
      aria-label={label}
      className={`atlas-island${className ? ` ${className}` : ""}`}
      {...props}
    >
      {children}
    </Surface>
  );
}

export function IslandDivider() {
  return <span className="island-divider" aria-hidden="true" />;
}
