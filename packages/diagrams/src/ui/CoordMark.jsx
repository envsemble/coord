/** The Coord mark. Pass `label=""` when adjacent text already names Coord. */
export function CoordMark({ size = 28, label = "Coord" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="27 26.5 189 189"
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    >
      <rect x="27" y="27" width="189" height="188" rx="43" fill="#111820" />
      <g
        fill="none"
        stroke="#fff"
        strokeWidth="12"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M76 163 L120 77 L164 163" />
        <path d="M96 132 H144" />
      </g>
      <g fill="#fff">
        <circle cx="120" cy="77" r="18" />
        <circle cx="76" cy="163" r="18" />
        <circle cx="164" cy="163" r="18" />
      </g>
    </svg>
  );
}
