import { describe, expect, it } from "vitest";
import { fmtCaptura } from "./fecha-de-captura";

describe("Input Date corta (11/09/26 1:15pm)", () => {
  it("fecha y hora", () => {
    expect(fmtCaptura("2026-11-09", "1315")).toBe("11/09/26 1:15pm");
    expect(fmtCaptura("2026-11-03", "1608")).toBe("11/03/26 4:08pm");
    expect(fmtCaptura("2026-11-06", "0900")).toBe("11/06/26 9:00am");
    expect(fmtCaptura("2026-11-06", "0005")).toBe("11/06/26 12:05am");
    expect(fmtCaptura("2026-11-06", "1200")).toBe("11/06/26 12:00pm");
  });
  it("sin hora o sin fecha", () => {
    expect(fmtCaptura("2026-11-09", null)).toBe("11/09/26");
    expect(fmtCaptura(null, "1315")).toBe("—");
  });
});
