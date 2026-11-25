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
  it("el componente exterior decide con enAppDeEscritorio antes de montar el interior", () => {
    const i = componenteSinComentarios.indexOf("enAppDeEscritorio(window)");
    const monta = componenteSinComentarios.indexOf("return <FichajeDelHubDeEscritorio />");
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

  it("el exterior no llama al servidor ni usa el hook de suplantación (ese también pide estado)", () => {
    const ini = componenteSinComentarios.indexOf("export function FichajeDelHub()");
    const exterior = componenteSinComentarios.slice(ini, componenteSinComentarios.indexOf("function FichajeDelHubDeEscritorio"));
    expect(ini).toBeGreaterThan(-1);
    expect(exterior).not.toContain("estadoDelHub");
    expect(exterior).not.toContain("useSuplantacion");
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

describe("el servidor: cada acción vuelve a mirar el interruptor de la persona", () => {
  const trozos = hub.split("export async function ").slice(1);
  const nombres = trozos.map((t) => t.slice(0, t.indexOf("(")));

  it("hay exactamente estas acciones", () => {
    expect(nombres).toEqual([
      "estadoDelHub", "ficharDesdeElHub", "empezarBreakDesdeElHub", "volverDelBreakDesdeElHub", "terminarTurnoDesdeElHub",
    ]);
  });

  it("todas menos la lectura pasan por ctxActivo (sesión + interruptor); la lectura solo informa", () => {
    for (const [i, nombre] of nombres.entries()) {
      if (nombre === "estadoDelHub") continue;
      expect(trozos[i], `${nombre} debe llamar a ctxActivo()`).toContain("await ctxActivo()");
    }
    expect(trozos[0]).not.toContain("ctxActivo()");
  });

  it("el interruptor se lee de hub_clock y, sin la columna, nadie queda activo", () => {
    expect(hub).toContain('select("worker_type, multi_store, active, hub_clock")');
    expect(hub).toContain("interruptorDisponible");
    expect(hub).toContain("ajustes.interruptorDisponible");
  });

  it("el fichaje desde el hub no manda lugar ni foto y marca el origen", () => {
    expect(hub).toContain('clockIn({ origen: "hub", storeId: input?.storeId ?? null, deviceId: EQUIPO })');
    expect(hub).toContain('clockOut(l.abierto.id, { origen: "hub", deviceId: EQUIPO })');
    expect(hub).not.toMatch(/photoPath|lat:|lng:/);
  });

  it("el almuerzo se cierra antes de salir: la salida de clock.ts se niega con un almuerzo abierto", () => {
    const i = hub.indexOf("export async function terminarTurnoDesdeElHub");
    const cuerpo = hub.slice(i);
    expect(cuerpo.indexOf("endLeave(l.pausa.id)")).toBeGreaterThan(-1);
    expect(cuerpo.indexOf("endLeave(l.pausa.id)")).toBeLessThan(cuerpo.indexOf("clockOut(l.abierto.id"));
  });
});

describe("clock.ts: el camino del hub no lee la geocerca y no escribe excepciones", () => {
  it("clockIn y clockOut no llaman a sitioDelFichaje cuando origen es hub", () => {
    expect(reloj).toContain('const geocerca = input.origen === "hub"\n    ? null');
    expect(reloj.match(/input\.origen === "hub"/g)?.length).toBe(2);
    expect(reloj).toContain("const onSite: boolean | null = geocerca?.medido ? geocerca.onSite : null;");
  });

  it("el camino normal sigue igual: la geocerca sí se lee cuando no es hub", () => {
    expect(reloj).toContain("input.lat as number,");
    expect(reloj).toContain("input.lng as number,");
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
