// Portable re-implementation of the M0 category-shape heuristic (proposed_l2 in
// category_assignments.csv). Name keywords win; otherwise aspect ratio from size
// drives the shape bucket. Intended to power a future in-portal categorizer; the
// authoritative M0 mapping was produced offline (see docs/adr/0005).

export type Shape =
  | "Hexagon" | "Mosaic" | "Pebble" | "Circle"
  | "Subway" | "Plank" | "Rectangle" | "Square" | "Other";

export function parseSize(sizeIn?: string | null): { w: number; h: number } | null {
  if (!sizeIn) return null;
  const m = sizeIn.replace(/["']/g, "").match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = parseFloat(m[1]);
  const b = parseFloat(m[2]);
  if (!(a > 0) || !(b > 0)) return null;
  return { w: Math.min(a, b), h: Math.max(a, b) };
}

export function classifyShape(input: { name?: string | null; sizeIn?: string | null }): Shape {
  const n = (input.name ?? "").toLowerCase();
  if (/\bhex(agon)?\b/.test(n)) return "Hexagon";
  if (/\bmosaic\b/.test(n)) return "Mosaic";
  if (/\bpebble\b|\bpenny\b/.test(n)) return "Pebble";
  if (/\bcircle\b|\bround\b/.test(n)) return "Circle";

  const sz = parseSize(input.sizeIn);
  if (!sz) return "Other";
  const ratio = sz.h / sz.w;
  if (sz.h <= 3 && sz.w <= 3) return "Mosaic"; // tiny pieces
  if (sz.h >= 24 && ratio >= 3) return "Plank"; // long wood-look
  if (sz.w <= 4 && ratio >= 1.8) return "Subway"; // small brick
  if (ratio >= 1.3) return "Rectangle";
  return "Square";
}
