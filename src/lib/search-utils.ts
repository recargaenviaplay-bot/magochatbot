export function normalizeUniversalSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .trim();
}

export function universalSearchMatches(values: unknown[], query: unknown) {
  const normalizedQuery = normalizeUniversalSearch(query);
  if (!normalizedQuery) return true;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  if (!terms.length) return true;

  const normalizedValues = values
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => normalizeUniversalSearch(value))
    .filter(Boolean);

  const haystack = normalizedValues.join(" ");
  const digitsHaystack = normalizedValues
    .map((value) => value.replace(/\D/g, ""))
    .join(" ");

  return terms.every((term) => {
    if (haystack.includes(term)) return true;

    const digits = term.replace(/\D/g, "");
    if (digits.length >= 3 && digitsHaystack.includes(digits)) return true;

    return false;
  });
}
