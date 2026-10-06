import reference from "./reference.json";
export const documentationURL = (key) =>
  `https://ontouml.readthedocs.io/en/latest/${reference[key]?.path || ""}`;
export function lessonFor(key) {
  return (
    reference[key] || {
      title: key || "Unspecified stereotype",
      summary:
        "This stereotype is not covered by the bundled lessons. Consult the metamodel and record the classification rationale.",
      question: "What are its identity, rigidity, and dependence commitments?",
    }
  );
}
export function countMeaning(value) {
  if (value === "*") return "zero or more";
  const [a, b] = value.split("..");
  if (b === "*") return `${a} or more`;
  return b ? `${a} to ${b}` : `exactly ${a}`;
}
export function readMultiplicity(relation) {
  return [
    `For each ${relation.source.name}: ${countMeaning(relation.targetMultiplicity)} ${relation.targetMultiplicity === "1" ? "instance" : "instances"} of ${relation.target.name}.`,
    `For each ${relation.target.name}: ${countMeaning(relation.sourceMultiplicity)} ${relation.sourceMultiplicity === "1" ? "instance" : "instances"} of ${relation.source.name}.`,
  ];
}
export function identityProviders(model, id) {
  const found = new Set(),
    pending = [id];
  const classes = new Map(model.classes.map((c) => [c.id, c]));
  while (pending.length) {
    const next = pending.pop();
    if (found.has(next)) continue;
    found.add(next);
    pending.push(
      ...model.generalizations
        .filter((g) => g.specificId === next)
        .map((g) => g.generalId),
    );
  }
  return [...found]
    .map((key) => classes.get(key))
    .filter(
      (c) =>
        c &&
        [
          "kind",
          "collective",
          "quantity",
          "relator",
          "mode",
          "quality",
        ].includes(c.stereotype),
    );
}
export { reference };
