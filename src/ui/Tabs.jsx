export function Tabs({ items, value, onChange, label = "Diagram" }) {
  return (
    <nav className="tabs" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.key}
          data-view={item.key}
          aria-selected={item.key === value}
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
