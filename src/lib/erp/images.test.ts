import { describe, it, expect } from "vitest";
import { cardImageUrl } from "./images";

describe("cardImageUrl — card image precedence", () => {
  it("prefers a real image_url", () => {
    expect(cardImageUrl({ image_url: "https://cdn.shopify.com/a.jpg" })).toBe("https://cdn.shopify.com/a.jpg");
  });
  it('treats the "PENDING" sentinel (and blanks) as no image', () => {
    expect(cardImageUrl({ image_url: "PENDING" })).toBeNull();
    expect(cardImageUrl({ image_url: "" })).toBeNull();
  });
  it("falls back to image_urls[0] when image_url is not a real URL", () => {
    expect(cardImageUrl({ image_url: "PENDING", image_urls: ["https://x/y.png"] })).toBe("https://x/y.png");
  });
  it("falls back to the matched Daltile silo image", () => {
    expect(cardImageUrl({ image_url: null, image_urls: [], ext_image_url: "https://daltile/silo.jpg" }))
      .toBe("https://daltile/silo.jpg");
  });
  it("returns null (→ placeholder) when nothing is a real URL", () => {
    expect(cardImageUrl({ image_url: "PENDING", image_urls: null, ext_image_url: null })).toBeNull();
    expect(cardImageUrl({})).toBeNull();
  });
});
