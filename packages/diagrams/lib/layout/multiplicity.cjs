// Captures record a count they cannot establish as "?". An end without a known
// count gets no label. The viewer applies the same rule
// (src/model/multiplicity.js); a test keeps the two in step.
const knownMultiplicity = (value) =>
  typeof value === "string" && value.trim() !== "" && value.trim() !== "?";
module.exports = { knownMultiplicity };
