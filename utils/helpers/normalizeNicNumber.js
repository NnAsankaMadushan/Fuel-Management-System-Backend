const normalizeNicNumber = (value = "") =>
  String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");

export { normalizeNicNumber };
