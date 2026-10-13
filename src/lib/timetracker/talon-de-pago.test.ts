import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { OT_WEEKLY_MIN, summarize, type PayEntry } from "@/lib/clockin/payroll";
import { totalPagado } from "./total-de-nomina";
import type { Assignment, Project, Session } from "./types";
import {
  TARIFA_POR_DEFECTO, acumuladoDelAnio, decideTalones, escapa, htmlDeTalones, htmlDelTalon, lineasDeNomina,
  lineasDelTalon, neto, pagoPresencial, presencialDeFichajes, talonDeFila, talonRemoto, talonesPresenciales,
  type TalonDePago,
} from "./talon-de-pago";

// Talones de pago (D-NEXT). Todo con nombres y tiendas inventados.

const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").split("\r\n").join("\n");

/** Un fichaje cerrado de `horas` horas, sin comida. */
let n = 0;
function fichaje(horas: number, extra: Partial<PayEntry> = {}): PayEntry {
  const ini = Date.parse("2026-10-02T13:00:00Z") + n++ * 86400000;
  return {
    id: `e${n}`, employee_id: "ana", clock_in_at: new Date(ini).toISOString(),
    clock_out_at: new Date(ini + horas * 3600000).toISOString(), lunch_minutes: 0, ...extra,
  };
}

function talon(p: Partial<TalonDePago>): TalonDePago {
  return {
    employeeUid: "ana", employeeName: "Ana Prueba", kind: "onsite", periodStart: "2026-10-02", periodEnd: "2026-10-08",
    payDate: "2026-10-09", method: "Zelle", regularHours: 40, otHours: 0, hourlyRate: 20, otRate: 30, lines: [],
    gross: 800, adjustments: [], net: 800, payrollId: null, ...p,
  };
}

const EMPRESA = { name: "Azulejos Inventados S.A.", address: "100 Calle Falsa", phone: "555-0100", taxId: "00-0000000", currency: "$" };

describe("1 · summarize con umbral", () => {
  it("sin umbral, extras pasadas 40 h, como siempre", () => {
    const s = summarize([fichaje(10), fichaje(10), fichaje(10), fichaje(10), fichaje(5)]);
    expect(OT_WEEKLY_MIN).toBe(2400);
    expect(s.regularMin).toBe(2400);
    expect(s.otMin).toBe(300);
  });
  it("con umbral de 30 h, las extras empiezan a las 30", () => {
    const s = summarize([fichaje(10), fichaje(10), fichaje(10), fichaje(5)], 30 * 60);
    expect(s.regularMin).toBe(1800);
    expect(s.otMin).toBe(300);
  });
});

describe("2 · el pago del presencial", () => {
  it("40 h regulares y 5 extra a 1.5×", () => {
    const p = pagoPresencial({ regularMin: 2400, otMin: 300 }, { hourlyRate: 20, otMultiplier: 1.5 });
    expect(p).toMatchObject({ regularHours: 40, otHours: 5, hourlyRate: 20, otRate: 30, regularPay: 800, otPay: 150, gross: 950 });
  });
  it("sin multiplicador, el de por defecto es 1.5", () => {
    expect(TARIFA_POR_DEFECTO.otMultiplier).toBe(1.5);
    expect(pagoPresencial({ regularMin: 0, otMin: 60 }, { hourlyRate: 10 }).otRate).toBe(15);
  });
  it("multiplicador propio: 2×", () => {
    const p = pagoPresencial({ regularMin: 600, otMin: 120 }, { hourlyRate: 18.5, otMultiplier: 2 });
    expect(p.otRate).toBe(37);
    expect(p.gross).toBe(round(10 * 18.5 + 2 * 37));
  });
  it("las horas salen de minutos a dos decimales, y los importes cuadran al céntimo", () => {
    const p = pagoPresencial({ regularMin: 2399, otMin: 0 }, { hourlyRate: 17.25, otMultiplier: 1.5 });
    expect(p.regularHours).toBe(39.98);
    expect(p.regularPay).toBe(round(39.98 * 17.25));
    expect(p.gross).toBe(round(p.regularPay + p.otPay));
  });
  it("de los fichajes: umbral de la persona (30 h) y no el de 40", () => {
    const p = presencialDeFichajes([fichaje(10), fichaje(10), fichaje(10), fichaje(5)], { hourlyRate: 20, otMultiplier: 1.5, otWeeklyHours: 30 });
    expect(p.regularHours).toBe(30);
    expect(p.otHours).toBe(5);
    expect(p.gross).toBe(600 + 150);
  });
  it("de los fichajes: con 40 h por defecto, 45 h son 40 + 5", () => {
    const p = presencialDeFichajes([fichaje(10), fichaje(10), fichaje(10), fichaje(10), fichaje(5)], { hourlyRate: 20, otMultiplier: 1.5, otWeeklyHours: 40 });
    expect(p.otHours).toBe(5);
    expect(p.gross).toBe(950);
  });
});

const round = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;

describe("3 · el talón del remoto", () => {
  const proj: Project = { id: "p1", name: "Proyecto Ficticio", location: "Remote", client: "", category: "", positions: [], payPeriod: "weekly", archived: false, weekStartDay: 5, createdAt: "" };
  const asig: Assignment = { id: "a1", employeeUid: "ana", projectId: "p1", hourlyRate: 20, overtimeRate: 30, overtimeThreshold: 40, weeklyLimit: null, paymentMethod: "Zelle", createdAt: "", project: proj };
  const ses = (h: number, date: string): Session => ({
    id: date, employeeUid: "ana", employeeName: "Ana Prueba", projectId: "p1", assignmentId: "a1", payrollId: "pay1", memo: "", weekOf: "2026-10-02",
    date, startMs: 0, endMs: 0, durationSeconds: h * 3600, activeSeconds: 0, idleSeconds: 0, screenSeconds: 0, keystrokes: 0, clicks: 0,
    lunchSeconds: 0, breakSeconds: 0, breakEvents: [], manual: false, source: "tracked", isLive: false, liveNote: null, createdAt: "",
  });
  const calc = lineasDeNomina([ses(20, "2026-10-02"), ses(25, "2026-10-05")], new Map([["a1", asig]]), new Map([["p1", proj]]));
  const lineas = lineasDelTalon(calc.lines, () => "Proyecto Ficticio");
  const lote = { id: "pay1", employeeUid: "ana", employeeName: "Ana Prueba", weekOf: "2026-10-02", method: "Zelle", total: Number(calc.pay.toFixed(2)), adjustments: [{ label: "Bonus", amount: 50 }, { label: "Deduction", amount: -20 }] };

  it("las líneas: 40 regulares + 5 extra a la tarifa de la asignación", () => {
    expect(lineas).toEqual([{ label: "Proyecto Ficticio", regular: 40, ot: 5, rate: 20, otRate: 30, pay: 950 }]);
  });
  it("bruto = total del lote = suma de las líneas; neto = totalPagado del lote", () => {
    const { talon: t, cuadra } = talonRemoto(lote, lineas, { periodEnd: "2026-10-08", payDate: "2026-10-09" });
    expect(cuadra).toBe(true);
    expect(t.gross).toBe(950);
    expect(t.gross).toBe(lote.total);
    expect(t.net).toBe(totalPagado(lote));
    expect(t.net).toBe(980);
    expect(t).toMatchObject({ kind: "remote", payrollId: "pay1", periodStart: "2026-10-02", regularHours: 40, otHours: 5, hourlyRate: 20, otRate: 30 });
  });
  it("si las líneas ya no suman lo pagado, manda lo pagado y `cuadra` lo dice", () => {
    const { talon: t, cuadra } = talonRemoto({ ...lote, total: 900 }, lineas, { periodEnd: "2026-10-08", payDate: "2026-10-09" });
    expect(cuadra).toBe(false);
    expect(t.gross).toBe(900);
    expect(t.net).toBe(930);
  });
  it("un lote sin total cae en la suma de las líneas", () => {
    const { talon: t } = talonRemoto({ ...lote, total: null }, lineas, { periodEnd: "2026-10-08", payDate: "2026-10-09" });
    expect(t.gross).toBe(950);
  });
  it("dos tarifas distintas: la tarifa del talón queda vacía (va por línea)", () => {
    const dos = [...lineas, { label: "Otro", regular: 2, ot: 0, rate: 25, otRate: 25, pay: 50 }];
    const { talon: t } = talonRemoto({ ...lote, total: 1000 }, dos, { periodEnd: "2026-10-08", payDate: "2026-10-09" });
    expect(t.hourlyRate).toBeNull();
    expect(t.gross).toBe(1000);
  });
});

describe("4 · neto y ajustes", () => {
  it("un bono suma y una deducción resta", () => {
    expect(neto(800, [{ label: "Bonus", amount: 100 }])).toBe(900);
    expect(neto(800, [{ label: "Deduction", amount: -75.5 }])).toBe(724.5);
    expect(neto(800, [])).toBe(800);
  });
});

describe("5 · acumulado del año", () => {
  const stubs = [
    talon({ periodStart: "2026-01-02", gross: 100, net: 100 }),
    talon({ periodStart: "2026-10-02", gross: 200, adjustments: [{ label: "Bonus", amount: 10 }], net: 210 }),
    talon({ periodStart: "2026-10-09", gross: 400, net: 400 }), // posterior: fuera
    talon({ periodStart: "2025-12-26", gross: 1000, net: 1000 }), // otro año: fuera
    talon({ employeeUid: "beto", periodStart: "2026-10-02", gross: 5000, net: 5000 }), // otra persona: fuera
    talon({ kind: "remote", periodStart: "2026-09-25", gross: 50, adjustments: [{ label: "Deduction", amount: -5 }], net: 45 }),
  ];
  it("solo esa persona, ese año y hasta el periodo incluido; los dos tipos", () => {
    expect(acumuladoDelAnio(stubs, "ana", 2026, "2026-10-02")).toEqual({ gross: 350, adjustments: 5, net: 355 });
  });
  it("el periodo de antes no incluye el de después", () => {
    expect(acumuladoDelAnio(stubs, "ana", 2026, "2026-09-25").gross).toBe(150);
  });
});

describe("6 · la foto no se recalcula", () => {
  it("si ya hay talón de esa persona, ese tipo y ese periodo, se reutiliza tal cual", () => {
    const viejo = talon({ id: "s1", gross: 800, net: 800 });
    const nuevo = talon({ gross: 999, net: 999 });
    const r = decideTalones([viejo], [nuevo]);
    expect(r.aGuardar).toEqual([]);
    expect(r.aImprimir).toEqual([viejo]);
  });
  it("otro periodo u otro tipo no es el mismo talón", () => {
    const viejo = talon({ id: "s1" });
    const r = decideTalones([viejo], [talon({ periodStart: "2026-10-09" }), talon({ kind: "remote" })]);
    expect(r.aGuardar).toHaveLength(2);
  });
  it("talonesPresenciales: guardado se reutiliza aunque ya no tenga tarifa; sin tarifa y con fichaje abierto se quedan fuera", () => {
    const guardado = talon({ id: "s1", employeeUid: "ana", gross: 123, net: 123 });
    const r = talonesPresenciales({
      personas: [
        { id: "ana", name: "Ana Prueba", method: "Zelle", entries: [fichaje(8)] },
        { id: "beto", name: "Beto Prueba", method: null, entries: [fichaje(8)] },
        { id: "caro", name: "Caro Prueba", method: null, entries: [fichaje(8)] },
        { id: "dani", name: "Dani Prueba", method: "Cash", entries: [fichaje(8), fichaje(1, { clock_out_at: null })] },
      ],
      tarifas: new Map([
        ["beto", { hourlyRate: 15, otMultiplier: 1.5, otWeeklyHours: 40 }],
        ["dani", { hourlyRate: 15, otMultiplier: 1.5, otWeeklyHours: 40 }],
      ]),
      existentes: [guardado],
      periodStart: "2026-10-02", periodEnd: "2026-10-08", payDate: "2026-10-09",
    });
    expect(r.aImprimir.map((s) => s.employeeUid)).toEqual(["ana", "beto"]);
    expect(r.aImprimir[0]).toBe(guardado);
    expect(r.aGuardar.map((s) => s.employeeUid)).toEqual(["beto"]);
    expect(r.aGuardar[0]).toMatchObject({ kind: "onsite", regularHours: 8, otHours: 0, hourlyRate: 15, otRate: 22.5, gross: 120, net: 120, method: null });
    expect(r.sinTarifa).toEqual(["Caro Prueba"]);
    expect(r.conAbiertos).toEqual(["Dani Prueba"]);
  });
  it("talonDeFila: los numeric que llegan como texto se vuelven números", () => {
    const t = talonDeFila({ id: "x", employeeUid: "ana", kind: "onsite", periodStart: "2026-10-02", gross: "950.00", net: "980", hourlyRate: null, lines: [{ label: "P", regular: "1", ot: 0, rate: "2", otRate: 3, pay: "2" }] });
    expect(t.gross).toBe(950);
    expect(t.net).toBe(980);
    expect(t.hourlyRate).toBeNull();
    expect(t.lines[0].pay).toBe(2);
  });
});

describe("7 · el documento", () => {
  const presencial = talon({ regularHours: 40, otHours: 5, hourlyRate: 20, otRate: 30, gross: 950, adjustments: [{ label: "Bonus", amount: 50 }, { label: "Deduction", amount: -20 }], net: 980 });
  const acum = { gross: 3800, adjustments: 30, net: 3830 };

  it("escapa: <script> sale como texto", () => {
    expect(escapa("<script>alert('x')</script> & \"y\"")).toBe("&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;y&quot;");
  });
  it("un nombre o un rótulo con <script> no llega al HTML como etiqueta", () => {
    const html = htmlDelTalon(talon({ employeeName: "<script>x()</script>", adjustments: [{ label: "<img src=x onerror=y>", amount: 1 }], method: "<b>m</b>" }), EMPRESA, acum, "en");
    expect(html).not.toContain("<script>x()");
    expect(html).toContain("&lt;script&gt;x()&lt;/script&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>m</b>");
  });
  it("lleva las cifras clave del presencial", () => {
    const html = htmlDelTalon(presencial, EMPRESA, acum, "en");
    for (const s of ["Azulejos Inventados S.A.", "100 Calle Falsa", "555-0100", "Tax ID 00-0000000", "Ana Prueba", "On-site", "Zelle",
      "Regular hours", "40.00", "$ 20.00", "$ 800.00", "Overtime hours", "5.00", "$ 30.00", "$ 150.00",
      "Gross pay", "$ 950.00", "Bonus", "+$ 50.00", "Deduction", "-$ 20.00", "Net pay", "$ 980.00",
      "Year to date", "$ 3,800.00", "+$ 30.00", "$ 3,830.00", "No taxes withheld"]) {
      expect(html, s).toContain(s);
    }
  });
  it("en español, los rótulos en español y sin retenciones", () => {
    const html = htmlDelTalon(presencial, EMPRESA, acum, "es");
    for (const s of ["TALÓN DE PAGO", "Presencial", "Horas regulares", "Horas extra", "Pago bruto", "Pago neto", "Acumulado del año", "Sin retenciones de impuestos"]) {
      expect(html, s).toContain(s);
    }
  });
  it("ninguna línea de impuestos", () => {
    const html = htmlDelTalon(presencial, EMPRESA, acum, "en").replace("No taxes withheld", "");
    expect(html).not.toMatch(/\btax(es)?\b(?! ID)/i);
    expect(html).not.toMatch(/withholding|federal|FICA|medicare|social security/i);
  });
  it("el remoto: una fila por proyecto, con sus extras", () => {
    const remoto = talon({ kind: "remote", lines: [{ label: "Proyecto Ficticio", regular: 40, ot: 5, rate: 20, otRate: 30, pay: 950 }, { label: "Otro & Cía", regular: 2, ot: 0, rate: 25, otRate: 25, pay: 50 }], gross: 1000, net: 1000 });
    const html = htmlDelTalon(remoto, EMPRESA, acum, "en");
    expect(html).toContain("Remote");
    expect(html).toContain("<td>Proyecto Ficticio</td><td class=\"n\">40.00 + 5.00 OT</td><td class=\"n\">$ 20.00 / $ 30.00</td><td class=\"n\">$ 950.00</td>");
    expect(html).toContain("<td>Otro &amp; Cía</td><td class=\"n\">2.00</td><td class=\"n\">$ 25.00</td><td class=\"n\">$ 50.00</td>");
    expect(html).not.toContain("Regular hours");
  });
  it("varios talones: una página por talón", () => {
    const html = htmlDeTalones([{ talon: presencial, acumulado: acum }, { talon: talon({ employeeName: "Beto Prueba" }), acumulado: acum }], EMPRESA, "en");
    expect(html.split('<section class="talon">').length - 1).toBe(2);
    expect(html).toContain("page-break-after:always");
    expect(html).toContain("Beto Prueba");
    // Papel blanco con texto oscuro, aunque la app esté en oscuro.
    expect(html).toContain("background:#ffffff;color:#152238;");
  });
});

describe("8 · las pantallas llaman a esto", () => {
  const rep = leer("src/components/timetracker/ManagerReports.tsx");
  const ts = leer("src/components/timetracker/PayrollTimesheets.tsx");
  it("Remoto: las líneas salen de lineasDeNomina; al pagar se guarda la foto; al reabrir se borra; se imprime por iframe", () => {
    expect(rep).toContain("return lineasDeNomina(sess, aMap, pMap);");
    expect(rep).toContain("try { await insertPaystubs([talonDelLote(uid, row, sess).talon]); }");
    expect(rep).toContain("await removePaystubOfPayroll(b.id);");
    expect(rep).toContain("imprimeDocumento(htmlDelTalon(stub, empresa, acumulado, lang)");
    expect(rep).not.toContain("computePay(");
  });
  it("Presencial: solo con el periodo cerrado, y se imprime lo guardado", () => {
    expect(ts).toContain("disabled={busy || !d.signedOff || ids.length === 0}");
    expect(ts).toContain("const aImprimir = r.aImprimir.map((s) => guardados.get(s.employeeUid) ?? s);");
    expect(ts).toContain("imprimeDocumento(htmlDeTalones(items, empresa, lang)");
  });
});
