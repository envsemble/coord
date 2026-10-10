export const printable = (value) =>
  typeof value === "string" ? value : JSON.stringify(value ?? "");
