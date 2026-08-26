// Public URL for a product image in the `product-images` Storage bucket (public-read).
// storage_path is e.g. "products/PLG2054/0.webp". Returns null when there's no image,
// so callers can render a graceful fallback.
const BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/product-images/`;

export function productImageUrl(storagePath: string | null | undefined): string | null {
  return storagePath ? BASE + storagePath : null;
}

/** Resolve the best image URL for a catalog CARD, in the order the spec wants:
 *  products.image_url → image_urls[0] → matched Daltile silo image → null (placeholder).
 *  Only real http(s) URLs count — guards Shopify's "PENDING" sentinel and blanks. */
export function cardImageUrl(row: {
  image_url?: string | null;
  image_urls?: string[] | null;
  ext_image_url?: string | null;
}): string | null {
  const http = (s: string | null | undefined): string | null =>
    typeof s === "string" && /^https?:\/\//i.test(s) ? s : null;
  return http(row.image_url) ?? http(row.image_urls?.[0]) ?? http(row.ext_image_url) ?? null;
}
