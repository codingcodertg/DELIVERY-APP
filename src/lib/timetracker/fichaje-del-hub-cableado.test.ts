import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// Pruebas de CABLEADO (texto de los ficheros): no hay render en este repo. Fijan las reglas que no se pueden ver
// en una función pura: dónde se monta, qué se mira antes de llamar al servidor, que el bloqueo no se cierra con
// Escape, y que cada acción del servidor vuelve a mirar el interruptor de la persona.

const leer = (r: string) => readFileSync(r, "utf8").split("\r\n").join("\n");
const sinComentarios = (s: string) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const componente = leer("src/components/FichajeDelHub.tsx");
const componenteSinComentarios = sinComentarios(componente);
const raiz = sinComentarios(leer("src/app/layout.tsx"));
const hub = leer("src/app/timetracker/clock-in/actions/hub.ts");
const reloj = leer("src/app/timetracker/clock-in/actions/clock.ts");

describe("el componente se monta en el layout raíz, después de la burbuja general", () => {
  it("está dentro de PrefsSegunRuta (usa usePrefs) y después de BotonGeneral", () => {
    expect(raiz).toContain("<FichajeDelHub />");
    expect(raiz.indexOf("<FichajeDelHub />")).toBeGreaterThan(raiz.indexOf("<BotonGeneral />"));
    expect(raiz.indexOf("<FichajeDelHub />")).toBeGreaterThan(raiz.indexOf("<PrefsSegunRuta"));
    expect(raiz.indexOf("<FichajeDelHub />")).toBeLessThan(raiz.indexOf("</PrefsSegunRuta>"));
  });
});

describe("la app de escritorio se mira ANTES de llamar al servidor", () => {
  it("el componente exterior decide con enAppDeEscritorio antes de montar el interior (la vista previa también lo monta, con su prop)", () => {
    const i = componenteSinComentarios.indexOf("enAppDeEscritorio(window)");
    const monta = componenteSinComentarios.indexOf("return <FichajeDelHubDeEscritorio escritorio={escritorio} ancho={ancho} />");
    expect(i).toBeGreaterThan(-1);
    expect(monta).toBeGreaterThan(i);
  });

  it("la lectura del servidor solo vive dentro del componente interior (que solo monta en escritorio)", () => {
    const interior = componenteSinComentarios.indexOf("function FichajeDelHubDeEscritorio");
    expect(interior).toBeGreaterThan(-1);
    const llamadas = [...componenteSinComentarios.matchAll(/estadoDelHub\(\)/g)].map((m) => m.index ?? -1);
    expect(llamadas.length).toBeGreaterThan(0);
    for (const i of llamadas) expect(i).toBeGreaterThan(interior);
  });

  it("el exterior no llama al servidor (ni a estadoDelHub); solo lee «viendo como» con la petición compartida de la burbuja (vista previa)", () => {
    const ini = componenteSinComentarios.indexOf("export function FichajeDelHub()");
    const exterior = componenteSinComentarios.slice(ini, componenteSinComentarios.indexOf("function FichajeDelHubDeEscritorio"));
    expect(ini).toBeGreaterThan(-1);
    expect(exterior).not.toContain("estadoDelHub");
    expect(exterior).not.toContain("useSuplantacion()");
    expect(exterior).toContain("useEstadoDeSuplantacion()");
  });

  it("la lectura de 30 s y la de al volver a la ventana solo corren con el interruptor puesto", () => {
    expect(componenteSinComentarios).toContain("const CADA_LECTURA_MS = 30000;");
    expect(componenteSinComentarios).toContain("if (!activo) return;");
  });
});

describe("el bloqueo del almuerzo", () => {
  it("Escape no cierra el bloqueo: el bloque del bloqueo solo impide la tecla, nunca cambia un estado", () => {
    const ini = componente.indexOf("// Escape no cierra el bloqueo");
    const fin = componente.indexOf("// Menú y pregunta");
    expect(ini).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(ini);
    const bloque = componente.slice(ini, fin);
    expect(bloque).toContain("accionDeTeclaEnBloqueo(e.key)");
    expect(bloque).toContain('if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }');
    expect(bloque).not.toMatch(/\bset[A-Z]\w*\(/);
  });

  it("la página detrás queda inerte mientras dura el bloqueo, y se libera al salir", () => {
    expect(componente).toContain('hijo.setAttribute("inert", "")');
    expect(componente).toContain('marcados.forEach((e) => e.removeAttribute("inert"))');
  });

  it("el bloqueo sale por encima de todo (z-index muy alto y por el portal al body)", () => {
    expect(componente).toContain("createPortal(");
    expect(componente).toContain("document.body,");
    const css = leer("src/app/globals.css");
    expect(css).toMatch(/\.fichaje-del-hub-bloqueo \{[^}]*z-index: 100000;/);
  });

  it("el bloqueo solo lo deciden datos del servidor: nunca un cambio de estado local sin respuesta", () => {
    expect(componente).toContain("const bloqueado = activo && estadoActual === \"en_break\";");
  });
});

describe("el servidor: cada acción vuelve a mirar el interruptor de la persona (fail closed)", () => {
  const trozos = hub.split("export async function ").slice(1);
  const nombres = trozos.map((t) => t.slice(0, t.indexOf("(")));

  it("hay exactamente estas acciones", () => {
    expect(nombres).toEqual([
      "estadoDelHub", "ficharDesdeElHub", "empezarBreakDesdeElHub", "volverDelBreakDesdeElHub", "terminarTurnoDesdeElHub",
    ]);
  });

  it("CADA acción exportada llama a ctxActivo() antes de hacer nada (la guarda de práctica puede ir primero)", () => {
    for (const [i, nombre] of nombres.entries()) {
      const cuerpo = trozos[i].slice(trozos[i].indexOf("{\n") + 1);
      const primera = cuerpo.replace(/^\s*const corte = await corteDeCapacitacion\(\);\n\s*if \(corte\) return [^\n]*\n/, "");
      expect(primera, `${nombre} debe empezar por ctxActivo()`).toMatch(/^\s*const ctx = await ctxActivo\(\);/);
    }
  });

  it("ctxActivo lee la sesión y el interruptor del servidor, y decide con puedeFicharDesdeElHub", () => {
    const i = hub.indexOf("async function ctxActivo()");
    const cuerpo = hub.slice(i, hub.indexOf("function estadoInvalido"));
    expect(cuerpo).toContain("await leeDelHub()");
    expect(cuerpo).toContain("if (!r.ok) return");
    expect(cuerpo).toContain("if (!r.lectura) return");
    expect(hub).toContain("activo: decision.ok,");
    expect(hub).toContain("const decision = puedeFicharDesdeElHub({");
  });

  it("el interruptor se lee de hub_clock, y sin la columna la decisión es no", () => {
    expect(hub).toContain('select("worker_type, multi_store, active, hub_clock")');
    expect(hub).toContain("columnaDisponible: ajustes?.interruptorDisponible ?? false,");
  });

  it("el fichaje desde el hub pasa el origen SOLO por el cuerpo interno, nunca por las acciones públicas", () => {
    expect(hub).toContain('clockInInterno({ storeId: input?.storeId ?? null, deviceId: EQUIPO }, { origen: "hub" })');
    expect(hub).toContain('clockOutInterno(l.abierto.id, { deviceId: EQUIPO }, { origen: "hub" })');
    expect(hub).not.toMatch(/from "\.\/clock"/);
    expect(hub).not.toMatch(/photoPath|lat:|lng:/);
  });

  it("el almuerzo se cierra antes de salir: la salida se niega con un almuerzo abierto", () => {
    const i = hub.indexOf("export async function terminarTurnoDesdeElHub");
    const cuerpo = hub.slice(i);
    expect(cuerpo.indexOf("endLeave(l.pausa.id)")).toBeGreaterThan(-1);
    expect(cuerpo.indexOf("endLeave(l.pausa.id)")).toBeLessThan(cuerpo.indexOf("clockOutInterno(l.abierto.id"));
  });
});

describe("la acción pública no acepta el origen del hub", () => {
  const interno = leer("src/lib/clockin/fichaje-interno.ts");

  it("clock.ts no menciona `origen` en ninguna parte: ni en los tipos de entrada ni en las acciones", () => {
    expect(reloj).not.toContain("origen");
    expect(reloj).not.toContain("OpcionesDeFichaje");
    expect(reloj).not.toMatch(/opciones\.|opciones:|, opciones\b/);
  });

  it("clockIn y clockOut públicas solo reciben la entrada y llaman al cuerpo SIN opciones", () => {
    expect(reloj).toContain("export async function clockIn(input: ClockInput): Promise<ClockInResult> {");
    expect(reloj).toContain("return clockInInterno(input);");
    expect(reloj).toContain("export async function clockOut(entryId: string, input: ClockOutInput): Promise<ClockOutResult> {");
    expect(reloj).toContain("return clockOutInterno(entryId, input);");
  });

  it("el cuerpo compartido NO es acción de servidor: no lleva \"use server\" (un cliente no lo puede llamar)", () => {
    expect(interno).not.toMatch(/^"use server";/m);
  });

  it("solo el cuerpo interno decide la geocerca según el origen, y el camino normal la lee igual", () => {
    expect(interno).toContain('const geocerca = opciones.origen === "hub"');
    expect(interno.match(/opciones\.origen === "hub"/g)?.length).toBe(2);
    expect(interno).toContain("const onSite: boolean | null = geocerca?.medido ? geocerca.onSite : null;");
    expect(interno).toContain("input.lat as number,");
    expect(interno).toContain("input.lng as number,");
  });
});

describe("la pantalla no lleva colores a pelo (reglas de la app)", () => {
  it("ni hex ni rgb en el componente: los colores vienen de las clases", () => {
    expect(componenteSinComentarios).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(componenteSinComentarios).not.toMatch(/rgba?\(/);
  });

  it("el botón lleva los atributos que la prueba y el soporte leen", () => {
    expect(componente).toContain("data-fichaje-del-hub");
    expect(componente).toContain("data-estado={estadoActual}");
  });
});

describe("quién puede llamar al cuerpo interno del fichaje", () => {
  it("solo clock.ts (sin opciones) y hub.ts (con origen hub) lo importan; ningún otro fichero", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const todos: string[] = [];
    const recorre = (d: string) => { for (const f of readdirSync(d)) { const r = `${d}/${f}`; if (statSync(r).isDirectory()) recorre(r); else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f)) todos.push(r); } };
    recorre("src");
    const importan = todos.filter((f) => leer(f).includes("@/lib/clockin/fichaje-interno")).sort();
    expect(importan).toEqual(["src/app/timetracker/clock-in/actions/clock.ts", "src/app/timetracker/clock-in/actions/hub.ts"]);
  });

  it("solo hub.ts llama al cuerpo interno CON el origen del hub (la llamada, no un comentario)", () => {
    const { readdirSync, statSync } = require("node:fs") as typeof import("node:fs");
    const todos: string[] = [];
    const recorre = (d: string) => { for (const f of readdirSync(d)) { const r = d + "/" + f; if (statSync(r).isDirectory()) recorre(r); else if (/\.(ts|tsx)$/.test(f) && !/\.test\./.test(f)) todos.push(r); } };
    recorre("src");
    const llamadas = todos.filter((f) => leer(f).includes(", { origen: \"hub\" })")).sort();
    expect(llamadas).toEqual(["src/app/timetracker/clock-in/actions/hub.ts"]);
  });
});

describe("viendo como: la vista previa (solo ver, nada se registra)", () => {
  const cuerpoDe = (nombre: string) => {
    const i = hub.indexOf(`export async function ${nombre}(`);
    const fin = hub.indexOf("\nexport async function ", i + 1);
    return hub.slice(i, fin === -1 ? undefined : fin);
  };
  const escriben = ["ficharDesdeElHub", "empezarBreakDesdeElHub", "volverDelBreakDesdeElHub", "terminarTurnoDesdeElHub"];

  it("las cuatro acciones que escriben refusan mientras hay suplantación, justo después de ctxActivo y antes de cualquier escritura", () => {
    for (const nombre of escriben) {
      const c = cuerpoDe(nombre);
      const ctx = c.indexOf("const ctx = await ctxActivo();");
      const refusa = c.indexOf("if (ctx.suplantando) return SUPLANTANDO_RES;");
      const escritura = Math.min(
        ...["ctx.demo", "demoAccion(", "startLeave(", "endLeave(", "clockInInterno(", "clockOutInterno("]
          .map((s) => c.indexOf(s)).filter((i) => i > -1),
      );
      expect(ctx, nombre).toBeGreaterThan(-1);
      expect(refusa, nombre).toBeGreaterThan(ctx);
      expect(refusa, nombre).toBeLessThan(escritura);
    }
  });

  it("estadoDelHub NO refusa: contesta lo de la persona en la que se entró, marcado con `suplantado`", () => {
    const lectura = cuerpoDe("estadoDelHub");
    expect(lectura).not.toContain("SUPLANTANDO_RES");
    expect(lectura).toContain("suplantado: ctx.suplantando");
  });

  it("ctxActivo decide la suplantación ANTES que nada, con la cookie de retorno y el token de «Entrar como»; el helper cierra por defecto", () => {
    const ctx = hub.slice(hub.indexOf("async function ctxActivo()"), hub.indexOf("function estadoInvalido"));
    expect(ctx.indexOf("await suplantandoDelServidor()")).toBeLessThan(ctx.indexOf("corteDeCapacitacion()"));
    const helper = hub.slice(hub.indexOf("async function suplantandoDelServidor"), hub.indexOf("async function ctxActivo"));
    expect(helper).toContain("COOKIE_RETORNO");
    expect(helper).toContain("sesionDeEntrarComo(");
    expect(helper).toMatch(/catch \{/);
    expect(helper).toContain("errorDeLectura: true");
  });

  it("los textos de la vista previa existen en los dos idiomas", () => {
    expect(componente).toContain("— preview only. Nothing is recorded.");
    expect(componente).toContain("— solo vista. No se registra nada.");
    expect(componente).toContain("Viewing as someone else: nothing is recorded.");
    expect(componente).toContain("Viendo como otra persona: no se registra nada.");
  });

  it("la tarjeta del almuerzo en vista previa no lleva overlay, inert ni diálogo modal", () => {
    const ini = componente.indexOf("{verBreakPrevio && (");
    const fin = componente.indexOf("{aviso && !bloqueado");
    expect(ini).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(ini);
    expect(componente.slice(ini, fin)).not.toMatch(/createPortal|inert|aria-modal|fichaje-del-hub-bloqueo/);
  });

  it("el bloqueo real solo sale sin «viendo como»: `activo` lo excluye", () => {
    expect(componente).toContain("const activo = !!datos?.activo && !viendoComo;");
    expect(componente).toContain("const bloqueado = activo && estadoActual === \"en_break\";");
  });

  it("todo lo que se pulsa se apaga en la vista previa: el guardián y los botones usan `bloqueoDeAccion`", () => {
    expect(componente).toContain("if (ocupado || viendoComo) return;");
    expect(componente).toContain("const bloqueoDeAccion = ocupado || viendoComo;");
    expect((componente.match(/disabled=\{bloqueoDeAccion/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("la pregunta de fichar no se abre sola en la vista previa (solo al pulsar el botón)", () => {
    expect(componente).toContain("if (viendoComo) {\n      if (datos.estado === \"en_break\") setMenu(true);\n      return;\n    }");
  });

  it("la vista previa sale por seVeElBoton con esVistaPrevia, y el exterior monta la pantalla también fuera del escritorio", () => {
    expect(componente).toContain("seVeElBoton({ escritorio, activo: datos.activo, viendoComo, esVistaPrevia: viendoComo, ancho })");
    expect(componente).toContain("if (!escritorio && estadoSup === null) return null;");
  });
});
