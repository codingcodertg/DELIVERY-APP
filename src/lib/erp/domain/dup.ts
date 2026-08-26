// Duplicate-detection normalization used by the new-item request dup-check.
// Collapse case/punctuation/whitespace so trivially-different names compare equal.

export function dupKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function isLikelyDup(a: string, b: string): boolean {
  return dupKey(a) === dupKey(b);
}
