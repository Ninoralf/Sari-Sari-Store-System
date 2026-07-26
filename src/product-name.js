export function formatProductName(value) {
  const source = String(value ?? "");
  const match = source.match(/\(([^()]*)\)\s*$/);
  if (!match) return { name: source, variant: "" };

  const name = source.slice(0, match.index).trimEnd();
  const variant = match[1].trim();
  if (!name || !variant) return { name: source, variant: "" };

  return { name, variant };
}
