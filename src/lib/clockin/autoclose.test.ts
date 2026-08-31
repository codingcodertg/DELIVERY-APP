import { describe, it, expect } from "vitest";
import { autoCloseCutoffMs, AUTO_CLOSE_MIN } from "./schedule";

// D-141. El cierre automático de las 20:00 se SALTABA a quien fichaba después de esa hora:
// el corte de su día ya había pasado, así que un `continue` lo dejaba fuera para siempre. Así
// llegó un fichaje de 34,6 h a la nómina. Estas pruebas fijan las tres formas del cálculo,
// porque es aritmética de fechas con horario de verano y a ojo no se comprueba.
//
// CDT (verano) = UTC-5, así que shift = 5 h en milisegundos.
const CDT = 5 * 3600_000;
const CST = 6 * 3600_000;
const central = (ms: number, shift: number) => new Date(ms - shift).toISOString().slice(0, 16);

describe("autoCloseCutoffMs", () => {
  it("un turno normal se cierra a las 20:00 de SU día", () => {
    const entra = Date.parse("2026-08-27T13:00:00Z"); // 08:00 Central
    expect(central(autoCloseCutoffMs(entra, CDT), CDT)).toBe("2026-08-27T20:00");
  });

  it("uno abierto desde hace días se cierra al corte de AQUEL día, no al de hoy", () => {
    // Si usara el de esta noche, estamparía una jornada de sesenta horas en la nómina.
    const lunes = Date.parse("2026-08-24T14:00:00Z"); // 09:00 Central del lunes
    expect(central(autoCloseCutoffMs(lunes, CDT), CDT)).toBe("2026-08-24T20:00");
  });

  it("EL FALLO: quien entra pasadas las 20:00 pasa al corte del día siguiente", () => {
    const noche = Date.parse("2026-08-27T02:30:00Z"); // 21:30 Central del día 26
    const corte = autoCloseCutoffMs(noche, CDT);
    expect(central(corte, CDT)).toBe("2026-08-27T20:00");
    // Y lo que importa: tiene un cierre, no se queda abierto para siempre.
    expect(corte).toBeGreaterThan(noche);
  });

  it("justo a las 20:00 clavadas ya cuenta como 'después'", () => {
    // El límite se prueba porque es donde se equivoca uno: >= y no >, para que un fichaje
    // sellado exactamente en el corte no se cierre con duración cero.
    const justo = Date.parse("2026-08-28T01:00:00Z"); // 20:00 Central del 27
    expect(central(autoCloseCutoffMs(justo, CDT), CDT)).toBe("2026-08-28T20:00");
  });

  it("funciona igual en invierno, cuando el desfase cambia", () => {
    const enero = Date.parse("2026-01-15T14:00:00Z"); // 08:00 Central (CST)
    expect(central(autoCloseCutoffMs(enero, CST), CST)).toBe("2026-01-15T20:00");
  });

  it("el corte son las 20:00", () => {
    expect(AUTO_CLOSE_MIN).toBe(1200);
  });
});
