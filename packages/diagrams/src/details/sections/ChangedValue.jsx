/** A value before and after a change: the arrow reads as "changed to". */
export function ChangedValue({ before, after }) {
  return (
    <>
      <del className="change-before">{before}</del>
      <span className="change-arrow" aria-hidden="true">
        →
      </span>
      <span className="visually-hidden"> changed to </span>
      <ins className="change-after">{after}</ins>
    </>
  );
}

/** A changed property on one line: its name, then before → after. */
export function ChangedProperty({ name, before, after }) {
  return (
    <span>
      <span className="change-key">{name}</span>{" "}
      <ChangedValue before={before} after={after} />
    </span>
  );
}
