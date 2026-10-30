import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DICT } from "@/lib/timetracker/i18n";
import {
  ACCIONES_PERSONALES, accionesEnMenu, accionesPersonales, estadoDelFichaje, textoDeAccion,
  type AccionPersonal, type EstadoDeFichar,
} from "./mis-acciones";
import { seccionesDeFichar, seccionesDeMiSemana } from "./vista-empleado";
import { debeMontarCronometro } from "./vigia";
import { OpcionesDelMenu, type OpcionDelMenu } from "@/components/MenuDeAcciones";

// D-517 · Tres pedidos del dueño del 2026-10-11 sobre Time Tracker:
//   1. «IN THE CLOCK IN THE PERSONAL ACTIONS BUTTOMS FOR THE ADMIN GOES INTO A DROPDOWN»
//   2. «TOTAL HOURS REMOVE IT AND ALSO HOURS WORKED TODAY LIKE IN THE SCREENSHOT» («Mi semana» del presencial)
//   3. «IN HERE QUITA EL TIEMPO Y SOLO DEJA CLOCK IN Y NOT ACTIVE NO QUEREMOS QUE MIREN EL TIEMPO»
// Lógica pura y, leyendo el fuente, que cada pantalla la USA.

const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8").split("\r\n").join("\n");
/** El código sin las líneas de comentario: un comentario que nombra algo no cuenta como usarlo. */
const codigo = (ruta: string) => leer(ruta).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");
const punch = leer("src/components/timetracker/PunchPanel.tsx");
const punchCodigo = codigo("src/components/timetracker/PunchPanel.tsx");
const semana = leer("src/app/timetracker/(timetracker)/week/page.tsx");
const semanaCodigo = codigo("src/app/timetracker/(timetracker)/week/page.tsx");
const fichajes = leer("src/components/timetracker/FichajesDeHoy.tsx");
const cronometro = codigo("src/components/timetracker/Cronometro.tsx");
const anfitrion = codigo("src/components/timetracker/CronometroAnfitrion.tsx");

const T0 = "2026-10-11T13:02:00Z";
const T1 = "2026-10-11T17:10:00Z";
const almuerzo = { reason: "lunch", leftAt: T1 };
const salida = { reason: "picking_up_supplies", leftAt: T1 };
const visitaPersonal = { startedAt: T1, vehicleId: null };
const visitaEmpresa = { startedAt: T1, vehicleId: "v1" };
const base: EstadoDeFichar = { dentro: true, pideMotivo: false, descanso: null, viaje: null };

/**
 * Los botones que la tarjeta de fichar pintaba ANTES de este cambio, transcritos tal cual de su JSX
 * (PunchPanel, origin/main 2026-10-11): la fila de entrada/salida y la fila de abajo. Es la referencia
 * contra la que se mide `accionesPersonales`: el menú del admin no puede tener ni una acción más ni una
 * menos que los botones.
 */
function botonesDeAntes(e: EstadoDeFichar): AccionPersonal[] {
  const b: AccionPersonal[] = [];
  // {pideMotivo ? (<caja>) : (<div className="row">{dentro ? «Clock out» : «Clock in»}</div>)}
  if (!e.pideMotivo) b.push(e.dentro ? "salir" : "entrar");
  // {dentro && (<div className="row">…)}
  if (e.dentro) {
    const fila = e.descanso ? "descanso" : e.viaje ? "visita" : "normal"; // filaDeSalida
    if (fila === "descanso" && e.descanso) b.push("terminarDescanso");
    else if (fila === "visita" && e.viaje) {
      b.push("foto");
      if (e.viaje.vehicleId == null) b.push("yaVolvi"); // seCierraDeUnToque
      b.push("almuerzo");
    } else b.push("almuerzo", "voySalir");
  }
  return b;
}

const TODAS: EstadoDeFichar[] = [];
for (const dentro of [true, false])
  for (const pideMotivo of [false, true])
    for (const descanso of [null, almuerzo, salida])
      for (const viaje of [null, visitaPersonal, visitaEmpresa]) TODAS.push({ dentro, pideMotivo, descanso, viaje });

describe("1 · a quién le salen las acciones en un desplegable", () => {
  it("solo al admin; el empleado y el gerente siguen con sus botones", () => {
    expect(accionesEnMenu("admin")).toBe(true);
    expect(accionesEnMenu("employee")).toBe(false);
    expect(accionesEnMenu("manager")).toBe(false);
    expect(accionesEnMenu(null)).toBe(false);
    expect(accionesEnMenu(undefined)).toBe(false);
  });
});

describe("1 · qué acciones hay: exactamente los botones de la tarjeta", () => {
  it(`en las ${TODAS.length} combinaciones (dentro, motivo, salida, viaje) el menú tiene las mismas acciones que los botones`, () => {
    for (const e of TODAS) {
      expect([...accionesPersonales(e)].sort(), JSON.stringify(e)).toEqual([...botonesDeAntes(e)].sort());
    }
  });
  it("sin fichar: solo «Registrar entrada»", () => {
    expect(accionesPersonales({ ...base, dentro: false })).toEqual(["entrar"]);
  });
  it("con la caja del motivo abierta no hay entrada en el menú: la caja trae su propio botón", () => {
    expect(accionesPersonales({ ...base, dentro: false, pideMotivo: true })).toEqual([]);
  });
  it("trabajando: almuerzo y voy a salir, y registrar la salida al FINAL", () => {
    expect(accionesPersonales(base)).toEqual(["almuerzo", "voySalir", "salir"]);
  });
  it("con una salida abierta: solo terminarla (y la salida del día)", () => {
    expect(accionesPersonales({ ...base, descanso: almuerzo })).toEqual(["terminarDescanso", "salir"]);
    // La salida manda sobre la visita, como en filaDeSalida: con el viaje en pausa la foto solo fallaría.
    expect(accionesPersonales({ ...base, descanso: almuerzo, viaje: visitaPersonal })).toEqual(["terminarDescanso", "salir"]);
  });
  it("de visita en su vehículo: foto, «ya volví» de un toque y almuerzo", () => {
    expect(accionesPersonales({ ...base, viaje: visitaPersonal })).toEqual(["foto", "yaVolvi", "almuerzo", "salir"]);
  });
  it("de visita en vehículo de la empresa: sin «ya volví» (pide el cuentakilómetros abajo)", () => {
    expect(accionesPersonales({ ...base, viaje: visitaEmpresa })).toEqual(["foto", "almuerzo", "salir"]);
  });
});

describe("1 · el texto de cada opción es el del botón", () => {
  it("las mismas claves que los botones, con su icono", () => {
    expect(textoDeAccion("entrar", base)).toEqual({ clave: "emp.punch.clockIn", icono: null, hora: null, peligro: false });
    expect(textoDeAccion("almuerzo", base)).toMatchObject({ clave: "emp.punch.startLunch", icono: "🍽" });
    expect(textoDeAccion("voySalir", base)).toMatchObject({ clave: "emp.punch.goingOut", icono: "🚚" });
    expect(textoDeAccion("foto", base)).toMatchObject({ clave: "emp.visit.takePhoto", icono: "📷" });
  });
  it("terminar una salida: «Terminar almuerzo» si es el almuerzo, «Ya volví» si no, con la hora a la que salió", () => {
    expect(textoDeAccion("terminarDescanso", { ...base, descanso: almuerzo })).toMatchObject({ clave: "emp.punch.endLunch", hora: T1 });
    expect(textoDeAccion("terminarDescanso", { ...base, descanso: salida })).toMatchObject({ clave: "emp.punch.imBack", hora: T1 });
  });
  it("«Ya volví» de la visita lleva la hora a la que empezó el viaje", () => {
    expect(textoDeAccion("yaVolvi", { ...base, viaje: visitaPersonal })).toMatchObject({ clave: "emp.punch.imBack", hora: T1 });
  });
  it("registrar la salida es la única en rojo (era el botón rojo)", () => {
    for (const a of ACCIONES_PERSONALES) expect(textoDeAccion(a, base).peligro, a).toBe(a === "salir");
  });
  it("cada clave existe en inglés y en español", () => {
    for (const e of TODAS) for (const a of accionesPersonales(e)) {
      const { clave } = textoDeAccion(a, e);
      expect(DICT.en[clave], clave).toBeTruthy();
      expect(DICT.es[clave], clave).toBeTruthy();
    }
    expect(DICT.en["emp.menu.mine"]).toBe("My actions");
    expect(DICT.es["emp.menu.mine"]).toBe("Mis acciones");
    expect(DICT.en["emp.menu.busy"]).toBeTruthy();
    expect(DICT.es["emp.menu.busy"]).toBeTruthy();
  });
  it("pintado con el menú de verdad: las opciones, y la salida tras una raya y en rojo", () => {
    const e = { ...base, viaje: visitaPersonal };
    const opciones: OpcionDelMenu[] = accionesPersonales(e).map((a) => {
      const x = textoDeAccion(a, e);
      return { id: a, texto: DICT.en[x.clave], peligro: x.peligro, alPulsar: () => {} };
    });
    const html = renderToStaticMarkup(createElement(OpcionesDelMenu, { opciones, onElegir: () => {} }));
    expect(html.split('role="menuitem"').length - 1).toBe(4);
    expect(html.indexOf('role="separator"')).toBeGreaterThan(html.indexOf("Start lunch"));
    expect(html.indexOf('role="separator"')).toBeLessThan(html.indexOf("Clock out"));
    expect(html).toMatch(/menu-accion-peligro"[^>]*>Clock out</);
  });
});

describe("1 · el estado que se ve sin abrir el menú", () => {
  it("sin fichar: «sin fichar», sin hora", () => {
    expect(estadoDelFichaje({ entrada: null, descanso: null, viaje: null })).toEqual({ clave: "emp.punch.notClockedIn", icono: null, desde: null, tono: "wait" });
  });
  it("trabajando: desde la hora de entrada", () => {
    expect(estadoDelFichaje({ entrada: T0, descanso: null, viaje: null })).toEqual({ clave: "emp.state.working", icono: "🟢", desde: T0, tono: "on" });
  });
  it("almorzando o fuera: desde que salió (era lo que decía el botón «Terminar almuerzo · 12:10»)", () => {
    expect(estadoDelFichaje({ entrada: T0, descanso: almuerzo, viaje: null })).toEqual({ clave: "emp.state.onLunch", icono: "🍽", desde: T1, tono: "wait" });
    expect(estadoDelFichaje({ entrada: T0, descanso: salida, viaje: null })).toEqual({ clave: "emp.state.out", icono: "🚚", desde: T1, tono: "wait" });
  });
  it("de viaje: desde que empezó; y una salida abierta manda sobre el viaje", () => {
    expect(estadoDelFichaje({ entrada: T0, descanso: null, viaje: visitaEmpresa })).toEqual({ clave: "emp.state.onTrip", icono: "🚗", desde: T1, tono: "on" });
    expect(estadoDelFichaje({ entrada: T0, descanso: almuerzo, viaje: visitaPersonal }).clave).toBe("emp.state.onLunch");
  });
  it("los cuatro estados nuevos existen en los dos idiomas, con la hora", () => {
    for (const k of ["emp.state.working", "emp.state.onLunch", "emp.state.out", "emp.state.onTrip"]) {
      expect(DICT.en[k], k).toContain("{time}");
      expect(DICT.es[k], k).toContain("{time}");
    }
  });
});

describe("1 · PunchPanel usa todo esto", () => {
  it("decide con accionesEnMenu y el rol de quien mira", () => {
    expect(punch).toContain("const enMenu = accionesEnMenu(me.role);");
  });
  it("el admin: un solo «Mis acciones ▾», el MenuDeAcciones de la ficha, con las acciones de accionesPersonales", () => {
    expect(punch).toContain("const jornada = { dentro, pideMotivo: !!pideMotivo, descanso: d.leave, viaje: viaje?.trip ?? null };");
    expect(punch).toContain("const misAcciones: OpcionDelMenu[] = accionesPersonales(jornada).map((a) => {");
    expect(punch).toContain("const x = textoDeAccion(a, jornada);");
    expect(punch).toContain("{enMenu && misAcciones.length > 0 && (");
    expect(punch).toContain('<MenuDeAcciones rotulo={t("emp.menu.mine")} opciones={misAcciones} className="btn" />');
  });
  it("cada opción llama a la MISMA función que su botón, y mientras se guarda no se pulsa", () => {
    expect(punch).toContain("      alPulsar: hacer[a],");
    expect(punch).toContain('      deshabilitada: ocupado ? t("emp.menu.busy") : null,');
    expect(punch).toContain("      peligro: x.peligro,");
  });
  it("lo que hace cada acción está escrito una vez, y es lo que hacía cada botón", () => {
    const h = punch.slice(punch.indexOf("const hacer: Record<AccionPersonal, () => void> = {"), punch.indexOf("  };", punch.indexOf("const hacer:")));
    expect(h).toContain('entrar: () => pide("in"),');
    expect(h).toContain('salir: () => pide("out"),');
    expect(h).toContain("terminarDescanso: () => void corre(async () => endLeave(d.leave!.id, await ubicacionOpcional())),");
    expect(h).toContain("foto: () => fotoVisitaRef.current?.click(),");
    expect(h).toContain("yaVolvi: () => void corre(async () => endTrip({ ...(await ubicacionOpcional()) })),");
    expect(h).toContain('almuerzo: () => void corre(async () => startLeave({ reason: "lunch", geo: await ubicacionOpcional() })),');
    expect(h).toContain('voySalir: () => setSalida("pregunta"),');
  });
  it("los botones del empleado llaman a esas mismas funciones, y no salen al admin", () => {
    expect(punch).toContain(") : !enMenu && (");
    expect(punch).toContain("{!enMenu && dentro && (");
    for (const a of ["salir", "entrar", "terminarDescanso", "foto", "yaVolvi", "almuerzo", "voySalir"]) {
      expect(punch, a).toContain(`onClick={hacer.${a}}`);
    }
    // Ninguno de esos botones hace nada por su cuenta: todo pasa por `hacer`.
    const filas = punchCodigo.slice(punchCodigo.indexOf(") : !enMenu && ("), punchCodigo.indexOf("{dentro && fila === \"visita\" && viaje?.trip && ("));
    expect(filas).not.toContain("onClick={() =>");
  });
  it("la pastilla del admin dice su estado (estadoDelFichaje); la del empleado, la de siempre", () => {
    expect(punch).toContain("const estado = estadoDelFichaje({ entrada: d.open?.clockInAt ?? null, descanso: d.leave, viaje: viaje?.trip ?? null });");
    expect(punch).toContain('{enMenu\n            ? <span className={"pill " + estado.tono}>');
    expect(punch).toContain('{t("emp.punch.since")} {hhmm(d.open!.clockInAt)}</span>');
  });
});

describe("3 · el empleado no ve el contador de su tarjeta de fichar", () => {
  it("el contador es solo del admin", () => {
    expect(seccionesDeFichar({ esAdmin: false }).contador).toBe(false);
    expect(seccionesDeFichar({ esAdmin: true }).contador).toBe(true);
  });
  it("PunchPanel lo pinta solo con secciones.contador, y no hay otro", () => {
    // D-NEXT: sin segundos.
    expect(punch).toContain("{secciones.contador && (\n          <div style={{ fontSize: 40, fontWeight: 800, letterSpacing: 1, margin: \"8px 0\" }}>\n            {dentro ? fmtClockSinSegundos(llevo) : \"0:00\"}");
    expect(punchCodigo.split("fmtClockSinSegundos(").length - 1).toBe(1);
    expect(punchCodigo).not.toContain("fmtClock(");
  });
  it("sin contador no se repinta cada segundo", () => {
    expect(punch).toContain("const conContador = secciones.contador;");
    expect(punch).toContain("    if (!conContador) return;");
    // D-755: y con contador, cada 15 s (sin segundos en pantalla no hace falta más).
    expect(punch).toContain("const i = setInterval(() => setAhora(Date.now()), 15000);");
  });
});

describe("3 · quitar el número NO para el cronómetro de D-470", () => {
  it("al presencial se le sigue montando el cronómetro en «Registrar tiempo», y a los demás también fuera", () => {
    expect(debeMontarCronometro({ visible: true, presencial: true, esAdmin: false })).toBe(true);
    expect(debeMontarCronometro({ visible: false, presencial: false, esAdmin: false })).toBe(true);
    expect(debeMontarCronometro({ visible: false, presencial: true, esAdmin: true })).toBe(true);
  });
  it("el anfitrión del layout lo monta igual que antes", () => {
    expect(anfitrion).toContain("if (!montar) return null;");
    expect(anfitrion).toContain("return <Cronometro visible={visible} />;");
  });
  it("el tick, el latido y el vigía se arman ANTES de que el presencial vea su tarjeta: montarlo los sigue arrancando", () => {
    const tarjeta = cronometro.indexOf("if (presencial && !esAdmin) return visible ? <PunchPanel /> : null;");
    expect(tarjeta).toBeGreaterThan(0);
    for (const pieza of ["tickRef.current = setInterval(async () => {", "setInterval(vigilar, VIGIA_CADA_MS)", 'navigator.sendBeacon("/timetracker/api/heartbeat"']) {
      const i = cronometro.indexOf(pieza);
      expect(i, pieza).toBeGreaterThan(0);
      expect(i, pieza).toBeLessThan(tarjeta);
    }
  });
  it("el número del cronómetro (remoto, admin) sigue en su sitio, y la tarjeta de fichar no toca el cronómetro", () => {
    expect(cronometro).toContain('<div className="timer-big">{fmtClock(worked)}</div>');
    expect(punchCodigo).not.toMatch(/Cronometro|heartbeat|timer-big/);
  });
});

describe("2 · «Mi semana» del presencial: sin «Horas totales» y sin «Hoy · 0h 00m»", () => {
  it("«Horas totales»: fuera para el presencial; el remoto y el admin la conservan", () => {
    expect(seccionesDeMiSemana({ esAdmin: false, presencial: true }).totalDeHoras).toBe(false);
    expect(seccionesDeMiSemana({ esAdmin: false, presencial: false }).totalDeHoras).toBe(true);
    expect(seccionesDeMiSemana({ esAdmin: true, presencial: true }).totalDeHoras).toBe(true);
    expect(seccionesDeMiSemana({ esAdmin: true, presencial: false }).totalDeHoras).toBe(true);
  });
  it("la pantalla pinta la cifra solo con secciones.totalDeHoras, y en ningún otro sitio", () => {
    const i = semanaCodigo.indexOf("{secciones.totalDeHoras && (");
    expect(i).toBeGreaterThan(0);
    const j = semanaCodigo.indexOf('t("emp.week.totalHours")');
    expect(j).toBeGreaterThan(i);
    expect(semanaCodigo.split('t("emp.week.totalHours")').length - 1).toBe(1);
    expect(semanaCodigo.slice(i, j)).toContain("<div className=\"n\">{`${(totalSec / 3600).toFixed(2)} h`}</div>");
    // La cifra fichada del presencial ya no existe.
    expect(semana).not.toContain("horasDeLaSemana(");
    expect(semana).not.toContain("emp.week.fromPunches");
  });
  it("«Fichajes de hoy» en Mi semana va sin las cifras de horas; debajo del reloj del admin, con ellas", () => {
    expect(semana).toContain("{secciones.fichajesDeHoy && dia && <FichajesDeHoy d={dia} cifras={false} />}");
    expect(punch).toContain("{secciones.fichajesDeHoy && <FichajesDeHoy d={d} cifras />}");
  });
  it("la tarjeta de fichajes pinta «Hoy» y «Esta semana de pago» solo con `cifras`; la tabla, siempre", () => {
    const i = fichajes.indexOf("      {cifras && (");
    const hoy = fichajes.indexOf('{t("emp.punch.today")}');
    const semanaDePago = fichajes.indexOf('{t("emp.punch.payWeek")}');
    const tabla = fichajes.indexOf('<h2>{t("emp.punch.todayPunches")}</h2>');
    expect(i).toBeGreaterThan(0);
    expect(hoy).toBeGreaterThan(i);
    expect(semanaDePago).toBeGreaterThan(hoy);
    expect(tabla).toBeGreaterThan(semanaDePago);
    // El bloque de cifras se cierra antes de la tabla: «Fichajes de hoy» sale con o sin cifras.
    expect(fichajes.slice(semanaDePago, tabla)).toContain("      )}");
    expect(fichajes.split("horasYMinutos(d.todayMinutes)").length - 1).toBe(1);
  });
});
