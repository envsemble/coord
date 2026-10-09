export function Tabs({
  items,
  value,
  onChange,
  label = "Diagram",
  compact = false,
}) {
  if (compact)
    return (
      <select
        className="view-select"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {items.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </select>
    );
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
