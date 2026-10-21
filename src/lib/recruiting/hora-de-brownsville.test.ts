import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ZONA_DE_RRHH, cuadriculaDelMes, desfaseDeBrownsvilleMin, diaEnBrownsville, formatoDeDia, formatoEnBrownsville,
  hoyEnBrownsville, instanteDePared, mesEnBrownsville, paredDeInstante, sumarDias,
} from "./hora-de-brownsville";
import { fmtDate, fmtDateTime, isToday, todayISO } from "./utils";
import { validarFechaPresencial, fechaYHora } from "./agendar-presencial";
import { grupoDelCandidato } from "./vista-del-gerente";
import { BUSINESS_TZ } from "@/lib/utils";
import type { Stage } from "./types";

/* El dueño (2026-10-21): «él lo ve a las 4:30, yo lo puse para las 3:30 … el horario que yo ponga ahí, que ese se quede».
 * Estas pruebas ponen el PROCESO en otra zona (la del aparato del reclutador) y comprueban que lo escrito y lo pintado
 * es la hora de Brownsville igual. Windows no entiende `TZ=America/Denver` (lo ignora en silencio y se queda con la
 * del sistema), así que se prueba el nombre IANA y, si no prende, el POSIX equivalente; y antes de medir se AFIRMA que
 * la zona del proceso cambió de verdad, para que la prueba no pase por estar midiendo la zona de siempre. */

type Zona = { nombre: string; posix: string; julio: number; diciembre: number };
const DENVER: Zona = { nombre: "America/Denver", posix: "MST7MDT", julio: 360, diciembre: 420 };
const LOS_ANGELES: Zona = { nombre: "America/Los_Angeles", posix: "PST8PDT", julio: 420, diciembre: 480 };
const NUEVA_YORK: Zona = { nombre: "America/New_York", posix: "EST5EDT", julio: 240, diciembre: 300 };

const desfasesDelProceso = () => [new Date(Date.UTC(2026, 6, 1, 12)).getTimezoneOffset(), new Date(Date.UTC(2026, 11, 1, 12)).getTimezoneOffset()];

function enElAparato(z: Zona, prueba: () => void) {
  const antes = process.env.TZ;
  try {
    for (const tz of [z.nombre, z.posix]) {
      process.env.TZ = tz;
      const [j, d] = desfasesDelProceso();
      if (j === z.julio && d === z.diciembre) break;
    }
    expect(desfasesDelProceso(), `el proceso no se pudo poner en ${z.nombre}`).toEqual([z.julio, z.diciembre]);
    prueba();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
}

const APARATOS = [DENVER, LOS_ANGELES, NUEVA_YORK];

describe("hora de Brownsville: lo escrito es lo que queda, en cualquier aparato (D-632)", () => {
  it("la zona es America/Chicago, la misma que el resto del negocio", () => {
    expect(ZONA_DE_RRHH).toBe("America/Chicago");
    expect(ZONA_DE_RRHH).toBe(BUSINESS_TZ);
  });

  it("el caso del dueño: en un aparato de Denver, escribir 3:30 guarda las 3:30 de Brownsville y todos ven 3:30", () => {
    enElAparato(DENVER, () => {
      // Lo que hacía el código viejo con ese mismo texto (`new Date(valor)`): la hora del aparato, una hora más tarde en Texas.
      expect(new Date("2026-10-21T15:30").toISOString()).toBe("2026-10-21T21:30:00.000Z");
      // Lo de ahora:
      expect(instanteDePared("2026-10-21T15:30")?.toISOString()).toBe("2026-10-21T20:30:00.000Z");
      expect(validarFechaPresencial("2026-10-21T15:30", new Date("2026-10-21T12:00:00Z"))).toEqual({ ok: true, iso: "2026-10-21T20:30:00.000Z" });
      expect(fmtDateTime("2026-10-21T20:30:00.000Z")).toBe("Oct 21 03:30 PM");
      expect(paredDeInstante("2026-10-21T20:30:00+00:00")).toBe("2026-10-21T15:30");
      // Y lo que hay hoy en producción (guardado a las 21:30Z desde ese aparato) se ve como lo ve el jefe: 4:30.
      expect(fmtDateTime("2026-10-21T21:30:00.000Z")).toBe("Oct 21 04:30 PM");
    });
  });

  it("15:30 escrito en Denver, Los Ángeles o Nueva York es el mismo instante, a ambos lados de cada cambio de horario", () => {
    const casos: [string, string][] = [
      ["2026-03-07T15:30", "2026-03-07T21:30:00.000Z"], // sábado antes del salto: CST, UTC−6
      ["2026-03-08T15:30", "2026-03-08T20:30:00.000Z"], // domingo del salto (8 de marzo): ya CDT, UTC−5
      ["2026-10-31T15:30", "2026-10-31T20:30:00.000Z"], // sábado antes de atrasar: CDT
      ["2026-11-01T15:30", "2026-11-01T21:30:00.000Z"], // domingo 1 de noviembre: ya CST
    ];
    for (const z of APARATOS) {
      enElAparato(z, () => {
        for (const [pared, iso] of casos) {
          expect(instanteDePared(pared)?.toISOString(), `${z.nombre} ${pared}`).toBe(iso);
          expect(paredDeInstante(iso), `${z.nombre} ${iso}`).toBe(pared);
          expect(fmtDateTime(iso).endsWith("03:30 PM"), `${z.nombre} ${iso}`).toBe(true);
        }
      });
    }
  });

  it("ida y vuelta cada 15 minutos de los dos días de cambio de horario, desde un aparato de Los Ángeles", () => {
    enElAparato(LOS_ANGELES, () => {
      for (const dia of ["2026-03-08", "2026-11-01"]) {
        for (let m = 0; m < 24 * 60; m += 15) {
          const pared = `${dia}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const t = instanteDePared(pared);
          expect(t, pared).not.toBeNull();
          // La hora que no existe (2:00–2:59 del 8 de marzo) es la única que no vuelve igual: se corre una hora.
          const noExiste = dia === "2026-03-08" && pared.slice(11, 13) === "02";
          const vuelta = paredDeInstante(t!);
          if (noExiste) expect(vuelta, pared).toBe(`${dia}T03:${pared.slice(14)}`);
          else expect(vuelta, pared).toBe(pared);
        }
      }
    });
  });

  it("la hora repetida (1:30 del 1 de noviembre) es la PRIMERA; la que no existe (2:30 del 8 de marzo) pasa a las 3:30", () => {
    expect(instanteDePared("2026-11-01T01:30")?.toISOString()).toBe("2026-11-01T06:30:00.000Z"); // CDT
    expect(instanteDePared("2026-11-01T02:30")?.toISOString()).toBe("2026-11-01T08:30:00.000Z"); // CST
    expect(instanteDePared("2026-03-08T02:30")?.toISOString()).toBe("2026-03-08T08:30:00.000Z"); // = 3:30 CDT
    expect(paredDeInstante("2026-03-08T08:30:00Z")).toBe("2026-03-08T03:30");
    expect(instanteDePared("2026-03-08T01:59")?.toISOString()).toBe("2026-03-08T07:59:00.000Z"); // CST, justo antes
    expect(instanteDePared("2026-03-08T03:00")?.toISOString()).toBe("2026-03-08T08:00:00.000Z"); // CDT, justo después
    expect(desfaseDeBrownsvilleMin("2026-07-01T12:00:00Z")).toBe(-300);
    expect(desfaseDeBrownsvilleMin("2026-12-01T12:00:00Z")).toBe(-360);
  });

  it("lo que no es una fecha y hora no se convierte en ninguna", () => {
    for (const malo of ["", "ayer", "2026-10-21", "2026-02-30T10:00", "2026-13-01T10:00", "2026-10-21T24:00", "2026-10-21T10:60"]) {
      expect(instanteDePared(malo), malo).toBeNull();
    }
    expect(instanteDePared(" 2026-10-21T15:30 ")?.toISOString()).toBe("2026-10-21T20:30:00.000Z");
    expect(instanteDePared("2026-10-21T15:30:45")?.toISOString()).toBe("2026-10-21T20:30:45.000Z");
    expect(paredDeInstante(null)).toBe("");
    expect(paredDeInstante("basura")).toBe("");
  });

  it("«hoy» y el día de una cita son los de Brownsville, no los del aparato ni los de UTC", () => {
    // 23:30 del 31 de octubre en Brownsville = 04:30Z del 1 de noviembre; en Nueva York ya es 1 de noviembre.
    const tarde = new Date("2026-11-01T04:30:00Z");
    enElAparato(NUEVA_YORK, () => {
      expect(hoyEnBrownsville(tarde)).toBe("2026-10-31");
      expect(todayISO(tarde)).toBe("2026-10-31");
      expect(isToday("2026-10-31T15:00:00Z", tarde)).toBe(true);
      expect(isToday("2026-11-01T15:00:00Z", tarde)).toBe(false);
      expect(mesEnBrownsville(tarde)).toEqual({ y: 2026, m: 9 });
    });
    enElAparato(LOS_ANGELES, () => {
      // 22:30 del 21 en Los Ángeles = 00:30 del 22 en Brownsville: para Texas ya es mañana.
      const noche = new Date("2026-10-22T05:30:00Z");
      expect(diaEnBrownsville(noche)).toBe("2026-10-22");
      const etapas: Stage[] = [{ id: "i", key: "inperson", label: "", color: "", type: "active", sort: 0, max_days: null }];
      expect(grupoDelCandidato({ status: "inperson", inperson_date: "2026-10-22T15:00:00Z" }, etapas, noche)).toBe("hoy");
    });
  });

  it("el texto de la cita dice la hora y el «mañana» de Brownsville aunque se arme en otro aparato", () => {
    enElAparato(DENVER, () => {
      const r = fechaYHora("2026-10-22T20:30:00.000Z", "es", new Date("2026-10-21T17:00:00Z"));
      expect(r).toMatchObject({ time: "3:30 p.m.", day: "mañana", when: "mañana a las 3:30 p.m." });
    });
  });

  it("un día de calendario sale tal cual en cualquier aparato; un instante, con su día de Brownsville", () => {
    for (const z of APARATOS) {
      enElAparato(z, () => {
        expect(fmtDate("2026-10-21")).toBe("Oct 21, 2026");
        // 03:00Z del 22 = 22:00 del 21 en Brownsville.
        expect(fmtDate("2026-10-22T03:00:00Z")).toBe("Oct 21, 2026");
        expect(formatoDeDia("2026-10-01", "en-US", { month: "long", year: "numeric" })).toBe("October 2026");
      });
    }
    expect(fmtDate(null)).toBe("—");
    expect(fmtDateTime(null)).toBe("—");
    expect(formatoEnBrownsville("basura", "en-US", { hour: "2-digit" })).toBe("");
  });

  it("aritmética de calendario sin zona: sumar días cruza meses y años, y la cuadrícula del mes es la de siempre", () => {
    expect(sumarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(cuadriculaDelMes(2026, 9)).toEqual({ dias: 31, empieza: 4 }); // octubre de 2026 empieza en jueves
    expect(cuadriculaDelMes(2028, 1)).toEqual({ dias: 29, empieza: 2 }); // febrero bisiesto, martes
  });
});

/* ---- La puerta: nadie vuelve a pintar ni a leer horas con la zona del aparato en RR. HH. ----
 * Se barre el CONTENIDO (no línea a línea: una llamada partida en dos líneas también cuenta). La única excepción es
 * `hora-de-brownsville.ts`, que es la puerta. Si de verdad hace falta otra, se añade a PERMITIDOS con su porqué. */

const RAIZ = join(__dirname, "..", "..", "..");
const CARPETAS = ["src/app/recruiting", "src/components/recruiting", "src/lib/recruiting", "src/app/api/recruiting"];
const SUELTOS = ["src/lib/recruiting-data-provider.tsx"];
const PERMITIDOS = new Set(["src/lib/recruiting/hora-de-brownsville.ts"]);

const PROHIBIDOS: { nombre: string; re: RegExp }[] = [
  { nombre: "toLocaleString/DateString/TimeString (zona del aparato)", re: /\.\s*toLocale(?:Date|Time)?String\s*\(/ },
  { nombre: "Intl.DateTimeFormat fuera de la puerta", re: /\bIntl\s*\.\s*DateTimeFormat\b/ },
  { nombre: "get/set de horas locales del aparato", re: /\.\s*(?:getHours|getMinutes|getDate|getDay|getMonth|getFullYear|setHours|setMinutes|setDate|setMonth|setFullYear|getTimezoneOffset)\s*\(/ },
  { nombre: "día o minuto UTC cortado de toISOString", re: /\.\s*toISOString\s*\(\s*\)\s*\.\s*slice\s*\(\s*0\s*,\s*(?:10|16)\s*\)/ },
  { nombre: "un ISO cortado a 16 para un datetime-local (hora UTC en el input)", re: /\.\s*slice\s*\(\s*0\s*,\s*16\s*\)/ },
];

/** Qué reglas incumple un texto de código. Se prueba el propio detector abajo. */
function incumplimientos(codigo: string): string[] {
  return PROHIBIDOS.filter((p) => p.re.test(codigo)).map((p) => p.nombre);
}

function ficheros(dir: string): string[] {
  const abs = join(RAIZ, dir);
  return readdirSync(abs).flatMap((n) => {
    const rel = `${dir}/${n}`;
    if (statSync(join(abs, n)).isDirectory()) return ficheros(rel);
    return /\.(ts|tsx)$/.test(n) && !/\.test\.ts$/.test(n) ? [rel] : [];
  });
}

describe("puerta: RR. HH. no formatea ni lee horas con la zona del aparato (D-632)", () => {
  const todos = [...CARPETAS.flatMap(ficheros), ...SUELTOS];

  it("el detector caza cada forma, también partida en varias líneas, y deja pasar lo que no es hora local", () => {
    expect(incumplimientos("d\n    .toLocaleTimeString('en-US')")).toHaveLength(1);
    expect(incumplimientos("x.toLocaleDateString(loc)")).toHaveLength(1);
    expect(incumplimientos("new Intl\n.DateTimeFormat('en')")).toHaveLength(1);
    expect(incumplimientos("d.setHours(9, 0, 0, 0)")).toHaveLength(1);
    expect(incumplimientos("new Date().toISOString().slice(0, 10)")).toHaveLength(1);
    expect(incumplimientos("existing.slice(0, 16)")).toHaveLength(1);
    expect(incumplimientos("w.toLocaleUpperCase('es') + d.getUTCDate() + d.getTime() + d.toISOString()")).toEqual([]);
  });

  it("barre todos los ficheros de RR. HH. (no está barriendo una carpeta vacía)", () => {
    expect(todos.length).toBeGreaterThan(40);
    expect(todos).toContain("src/components/recruiting/ModalHost.tsx");
    expect(todos).toContain("src/app/recruiting/(recruiting)/calendar/page.tsx");
  });

  it("ningún fichero de RR. HH. fuera de la puerta usa la zona del aparato", () => {
    const malos = todos
      .filter((f) => !PERMITIDOS.has(f))
      .flatMap((f) => incumplimientos(readFileSync(join(RAIZ, f), "utf8")).map((n) => `${f}: ${n}`));
    expect(malos).toEqual([]);
  });

  it("todo <input type=\"datetime-local\"> de RR. HH. lee y escribe por la puerta (instanteDePared / paredDeInstante)", () => {
    const conInput = todos.filter((f) => f.endsWith(".tsx") && /<input[^>]*type="datetime-local"/.test(readFileSync(join(RAIZ, f), "utf8")));
    expect(conInput.length).toBeGreaterThanOrEqual(2);
    for (const f of conInput) {
      const src = readFileSync(join(RAIZ, f), "utf8");
      expect(src, f).toMatch(/paredDeInstante\(/);
      // Ninguna fecha del input se lee con `new Date(<valor del input>)`: se lee con instanteDePared o validarFechaPresencial.
      expect(src, f).not.toMatch(/new Date\(\s*(?:dt|phoneDt|local)\s*\)/);
      expect(src, f).toMatch(/instanteDePared\(|validarFechaPresencial\(/);
    }
  });
});
