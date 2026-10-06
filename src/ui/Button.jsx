export function IconButton({
  label,
  title = label,
  className = "",
  children,
  ...props
}) {
  return (
    <button
      className={`icon ${className}`}
      aria-label={label}
      title={title}
      {...props}
    >
      {children}
    </button>
  );
}

export function ToggleButton({ pressed, className = "", children, ...props }) {
  return (
    <button className={className} aria-pressed={pressed} {...props}>
      {children}
    </button>
  );
}
