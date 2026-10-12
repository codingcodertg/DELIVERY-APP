import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DICT } from "@/lib/timetracker/i18n";
import { MANAGER_TABS, TABS } from "@/lib/timetracker/constants";
import {
  PESTANAS_DE_SOLICITUDES, PESTANA_DE_SOLICITUD_INICIAL, esAdminDeTt, pestanasPara, puedeVerMiDiario,
  seccionesDeFichar, seccionesDeMiSemana, verTablasDelCronometro,
} from "./vista-empleado";

// D-489. Lo que el dueño pidió el 2026-10-06 para la vista del EMPLEADO en Time Tracker, y que el
// admin siga viendo lo de antes. Lógica pura y, leyendo el fuente, que cada pantalla la USA.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
const topbar = leer("src/components/timetracker/TopBar.tsx");
const diario = leer("src/app/timetracker/(timetracker)/diary/page.tsx");
const solicitudes = leer("src/app/timetracker/(timetracker)/requests/page.tsx");
const semana = leer("src/app/timetracker/(timetracker)/week/page.tsx");
const punch = leer("src/components/timetracker/PunchPanel.tsx");
const secciones = leer("src/components/timetracker/MySections.tsx");
const fichajes = leer("src/components/timetracker/FichajesDeHoy.tsx");

const empleado = { esAdmin: false, presencial: true };
const remoto = { esAdmin: false, presencial: false };
const admin = { esAdmin: true, presencial: true };

describe("1 · «Mi diario» ya no es del empleado", () => {
  it("la barra del empleado no tiene «Mi diario»; la del admin sí", () => {
    expect(pestanasPara("employee").map((x) => x.id)).not.toContain("diary");
    expect(pestanasPara("admin").map((x) => x.id)).toContain("diary");
    expect(pestanasPara("employee")).toBe(TABS);
    expect(pestanasPara("admin")).toBe(MANAGER_TABS);
  });
  it("el resto de pestañas del empleado no cambia", () => {
    expect(TABS.map((x) => x.id)).toEqual(["track", "week", "requests"]);
  });
  it("solo el admin es admin: un gerente o un rol vacío ven la vista del empleado", () => {
    expect(esAdminDeTt("admin")).toBe(true);
    expect(esAdminDeTt("manager")).toBe(false);
    expect(esAdminDeTt(null)).toBe(false);
  });
  it("la barra pinta las pestañas de pestanasPara", () => {
    // Nota D-528: la barra ya no llama a `pestanasPara` directamente: llama a `barraDeTt` (lib/timetracker/barra.ts),
    // que parte las de `pestanasPara` en la fila y «👤 Mío ▾». Las del empleado siguen saliendo de aquí, todas en fila.
    expect(topbar).toContain("const barra = barraDeTt(me.role, pathname);");
    expect(leer("src/lib/timetracker/barra.ts")).toContain("const todas = pestanasPara(role);");
  });
  it("quien no es admin y entra a /timetracker/diary vuelve a Registrar tiempo y no ve nada", () => {
    expect(puedeVerMiDiario("employee")).toBe(false);
    expect(puedeVerMiDiario("admin")).toBe(true);
    expect(diario).toContain("const permitido = puedeVerMiDiario(me.role);");
    expect(diario).toContain('useEffect(() => { if (!permitido) router.replace("/timetracker"); }, [permitido, router]);');
    expect(diario).toContain("if (!permitido) return null;");
  });
});

describe("2 · «Mis solicitudes»: primero Tiempo libre, después Tiempo", () => {
  it("el orden y la que se abre", () => {
    expect([...PESTANAS_DE_SOLICITUDES]).toEqual(["off", "time"]);
    expect(PESTANA_DE_SOLICITUD_INICIAL).toBe("off");
  });
  it("la pantalla pinta las pestañas en ese orden y abre la primera", () => {
    expect(solicitudes).toContain("useState<PestanaDeSolicitud>(PESTANA_DE_SOLICITUD_INICIAL);");
    expect(solicitudes).toContain("{PESTANAS_DE_SOLICITUDES.map((p) => (");
    expect(solicitudes).toContain('{p === "off" ? t("emp.req.tabOff") : t("emp.req.tabTime")}');
  });
});

describe("4 · «Mi semana» del empleado: solo horas, y ahí el boletín y los fichajes de hoy", () => {
  it("el empleado no ve dinero; el admin sí", () => {
    expect(seccionesDeMiSemana(empleado).dinero).toBe(false);
    expect(seccionesDeMiSemana(remoto).dinero).toBe(false);
    expect(seccionesDeMiSemana(admin).dinero).toBe(true);
  });
  it("el boletín y los fichajes de hoy, al presencial; ni al remoto (nunca los tuvo) ni al admin (los ve donde siempre)", () => {
    expect(seccionesDeMiSemana(empleado)).toMatchObject({ boletin: true, fichajesDeHoy: true });
    expect(seccionesDeMiSemana(remoto)).toMatchObject({ boletin: false, fichajesDeHoy: false });
    expect(seccionesDeMiSemana(admin)).toMatchObject({ boletin: false, fichajesDeHoy: false });
  });
  // Nota D-517: aquí había dos pruebas de `horasDeLaSemana` (las horas fichadas del presencial en
  // «Horas totales», y «—» de una semana pasada). El dueño pidió quitar esa cifra al presencial y la
  // función se fue con ella; lo que vigila ahora que no vuelva está en mis-acciones.test.ts («2 · …»).
  it("las tablas del cronómetro: al presencial solo si tiene sesiones; al remoto y al admin siempre", () => {
    expect(verTablasDelCronometro(empleado, false)).toBe(false);
    expect(verTablasDelCronometro(empleado, true)).toBe(true);
    expect(verTablasDelCronometro(remoto, false)).toBe(true);
    expect(verTablasDelCronometro(admin, false)).toBe(true);
  });
  it("la pantalla decide con seccionesDeMiSemana y esconde TODO el dinero detrás de `dinero`", () => {
    expect(semana).toContain("const secciones = seccionesDeMiSemana(quien);");
    expect(semana).toContain("{secciones.dinero && paidTotal > 0 && <div");
    expect(semana).toContain('{secciones.dinero && <div className="stat"><div className="n">{money(totalPay)}</div><div className="l">{t("emp.week.estPay")}</div></div>}');
    expect(semana).toContain('{secciones.dinero && <div className="stat"><div className="n">{money(paidTotal)}</div><div className="l">{t("emp.week.paidSoFar")}</div></div>}');
    expect(semana).toContain('{secciones.dinero && <th className="right">{t("emp.week.colPay")}</th>}');
    expect(semana).toContain('{secciones.dinero && <td className="right nowrap">{money(r.calc.pay)}</td>}');
    // Ningún money(...) suelto fuera de esas guardas.
    const sueltos = semana.split("\n").filter((l) => l.includes("money(") && !l.includes("secciones.dinero") && !l.includes("import"));
    expect(sueltos.filter((l) => !l.includes("paidThisWeek"))).toEqual([]);
  });
  it("la cifra de horas es la del cronómetro, para quien la ve (admin y remoto); el día fichado solo se lee para los fichajes", () => {
    // Nota D-517: antes la cifra pasaba por `horasDeLaSemana` (fichajes para el presencial). Al
    // presencial ya no se le enseña; a los demás `horasDeLaSemana` les daba justo `totalSec / 3600`.
    expect(semana).toContain("<div className=\"n\">{`${(totalSec / 3600).toFixed(2)} h`}</div>");
    expect(semana).toContain("const dia = useMiDiaDeFichaje(secciones.fichajesDeHoy);");
  });
  it("las tablas del cronómetro pasan por verTablasDelCronometro", () => {
    expect(semana).toContain("const tablas = verTablasDelCronometro(quien, weekSessions.length > 0);");
    expect(semana).toContain("{!tablas ? null : rows.length === 0 ? (");
    expect(semana).toContain("{tablas && <>");
  });
  it("el boletín y los fichajes de hoy se pintan en Mi semana, sin la cifra de la semana de pago", () => {
    // Nota D-517: el parámetro `semanaDePago` pasó a llamarse `cifras` (ahora quita también «Hoy»).
    expect(semana).toContain("{secciones.boletin && <MiBoletinSec />}");
    expect(semana).toContain("{secciones.fichajesDeHoy && dia && <FichajesDeHoy d={dia} cifras={false} />}");
  });
  it("la tarjeta de fichajes solo pone «Esta semana de pago» si se le pide", () => {
    expect(fichajes).toContain("{cifras && (");
    expect(fichajes).toContain('{t("emp.punch.payWeek")}');
  });
  // Nota D-517: aquí estaba «de dónde sale la cifra del presencial, en los dos idiomas»
  // (`emp.week.fromPunches`). La línea y su clave se quitaron con la cifra.
});

describe("5 · Registrar tiempo del empleado: sin «Esta semana de pago», solo Mi horario y Notas del día", () => {
  it("el empleado: ni la tarjeta de la semana de pago, ni los fichajes, ni el boletín", () => {
    // Nota D-517: y sin el contador de la tarjeta (`contador`).
    expect(seccionesDeFichar({ esAdmin: false })).toEqual({ contador: false, semanaDePago: false, fichajesDeHoy: false, boletin: false, horarioYNotas: true });
  });
  it("el admin: todo, como antes", () => {
    expect(seccionesDeFichar({ esAdmin: true })).toEqual({ contador: true, semanaDePago: true, fichajesDeHoy: true, boletin: true, horarioYNotas: true });
  });
  it("PunchPanel decide con seccionesDeFichar y el rol de quien mira", () => {
    expect(punch).toContain("const secciones = seccionesDeFichar({ esAdmin: esAdminDeTt(me.role) });");
    expect(punch).toContain("{secciones.semanaDePago && (d.shift || d.scheduledMinutes > 0) && (");
    expect(punch).toContain("<MySections boletin={secciones.boletin} />");
    expect(punch).toContain("{secciones.fichajesDeHoy && <FichajesDeHoy d={d} cifras />}");
  });
  it("MySections pinta siempre horario y notas, y el boletín solo si se le pide", () => {
    expect(secciones).toContain("      <MiHorarioSec />\n      <MisNotasSec />\n      {boletin && <MiBoletinSec />}");
  });
  it("la tabla de fichajes ya no vive dentro de PunchPanel: una sola copia, en FichajesDeHoy", () => {
    expect(punch).not.toContain('t("emp.punch.todayPunches")');
    expect(fichajes).toContain('t("emp.punch.todayPunches")');
  });
});
