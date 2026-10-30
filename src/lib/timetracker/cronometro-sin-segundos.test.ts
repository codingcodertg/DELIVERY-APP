import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fmtClock, fmtClockSinSegundos } from "./helpers";

/** El contador de «Clock in / out» sin segundos (D-NEXT, 2026-10-29). */

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

describe("fmtClockSinSegundos", () => {
  it("horas:minutos, con los minutos a dos cifras; los segundos se tiran, no se redondean", () => {
    expect(fmtClockSinSegundos(0)).toBe("0:00");
    expect(fmtClockSinSegundos(100)).toBe("0:01");
    expect(fmtClockSinSegundos(119)).toBe("0:01");
    expect(fmtClockSinSegundos(3600 * 8 + 7 * 60 + 59)).toBe("8:07");
    expect(fmtClockSinSegundos(-5)).toBe("0:00");
    // Control: la de siempre sigue con segundos para quien la usa (semana, nómina, en vivo).
    expect(fmtClock(100)).toBe("0:01:40");
  });
});

describe("el panel de fichar", () => {
  const panel = leer("src/components/timetracker/PunchPanel.tsx").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("pinta el contador sin segundos y lo mueve cada 15 s, no cada segundo", () => {
    expect(panel).toContain('{dentro ? fmtClockSinSegundos(llevo) : "0:00"}');
    expect(panel).not.toContain("fmtClock(llevo)");
    expect(panel).toContain("setInterval(() => setAhora(Date.now()), 15000)");
    expect(panel).not.toContain("setInterval(() => setAhora(Date.now()), 1000)");
  });
});
