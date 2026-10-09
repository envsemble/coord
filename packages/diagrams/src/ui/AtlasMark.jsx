/** The Atlas mark. Pass `label=""` when adjacent text already names Atlas. */
export function AtlasMark({ size = 28, label = "Atlas" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinejoin="round"
        d="M16 47V32h16V17m0 15h16v15"
      />
      <path fill="var(--warning, #e3b341)" d="m32 9-8 12h16z" />
      <rect
        x="9"
        y="42"
        width="14"
        height="14"
        rx="4"
        fill="var(--accent, #539bf5)"
      />
      <rect
        x="41"
        y="42"
        width="14"
        height="14"
        rx="4"
        fill="var(--success, #57ab5a)"
      />
    </svg>
  );
}
