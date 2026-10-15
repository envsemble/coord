// Fingerprints of values: SHA-256 over JSON with sorted keys, so equal values
// fingerprint alike whatever the order of their keys.
const { createHash } = require("node:crypto");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}
const fingerprint = (value) =>
  createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));

module.exports = { fingerprint, clone };
