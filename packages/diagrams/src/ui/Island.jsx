/** A floating toolbar surface over the diagram canvas. */
export function Island({ label, className = "", children, ...props }) {
  return (
    <div
      className={`atlas-island${className ? ` ${className}` : ""}`}
      role="group"
      aria-label={label}
      {...props}
    >
      {children}
    </div>
  );
}

export function IslandDivider() {
  return <span className="island-divider" aria-hidden="true" />;
}

/** Primer-style segmented control for mutually exclusive modes. */
export function SegmentedControl({ items, value, onChange, label }) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          data-mode={item.key}
          aria-current={item.key === value ? "true" : undefined}
          title={item.title}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
