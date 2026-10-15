// Captures record a count they cannot establish as "?". An end without a known
// count shows none, on the canvas or in the details. The layout applies the
// same rule (lib/layout/multiplicity.cjs); a test keeps the two in step.
export const knownMultiplicity = (value) =>
  typeof value === "string" && value.trim() !== "" && value.trim() !== "?";
