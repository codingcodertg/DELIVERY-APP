import { describe, expect, it } from "vitest";
import { toCSV } from "./utils";

describe("toCSV no deja pasar fórmulas", () => {
  it("antepone comilla al texto que Excel leería como fórmula", () => {
    const csv = toCSV(["a"], [["=HYPERLINK(\"x\")"], ["+1"], ["-2+3"], ["@SUM(A1)"], [-5], ["normal"]]);
    const filas = csv.split("\n").slice(1);
    expect(filas[0]).toBe('"\'=HYPERLINK(""x"")"');
    expect(filas[1]).toBe("'+1");
    expect(filas[2]).toBe("'-2+3");
    expect(filas[3]).toBe("'@SUM(A1)");
    expect(filas[4]).toBe("-5");
    expect(filas[5]).toBe("normal");
  });
});
