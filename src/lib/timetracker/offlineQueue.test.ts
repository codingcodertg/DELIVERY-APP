import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { Session } from "@/lib/timetracker/types";

// La cola es código de navegador. Aquí solo se necesitan dos piezas suyas —`localStorage`, que
// es donde viven los parches de sesión, y `navigator.onLine`, que es la puerta de `flush`—. Las
// capturas viven en IndexedDB y `flush` ya tolera que no exista (`catch { shots = []; }`), así
// que no hace falta fingirla.
const almacen = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => almacen.get(k) ?? null,
  setItem: (k: string, v: string) => { almacen.set(k, v); },
  removeItem: (k: string) => { almacen.delete(k); },
});
vi.stubGlobal("navigator", { onLine: true });

const { flush, queueSession, ackDiscarded, hayAlgoQueDecir } = await import("./offlineQueue");

const LS = "tt_offline_sessions";
const pendientes = () => JSON.parse(almacen.get(LS) || "{}") as Record<string, Partial<Session>>;
const descartados = () => Number(almacen.get("tt_offline_discarded") || 0);

const noHayCapturas = { uploadScreenshot: vi.fn(async () => ({}) as never) };

beforeEach(() => { almacen.clear(); });

describe("flush · un latido tardío no pisa una sesión cerrada (D-241)", () => {
  it("reenvía por la vía VIVA, no por la que actualiza cualquier fila", async () => {
    queueSession("s1", { endMs: 111, liveNote: "active" });
    const updateLiveSession = vi.fn(async () => true);
    await flush({ updateLiveSession, ...noHayCapturas });

    expect(updateLiveSession).toHaveBeenCalledWith("s1", { endMs: 111, liveNote: "active" });
    // Y el parche se da por aplicado, que es el buen caso de siempre.
    expect(pendientes()).toEqual({});
  });

  it("si ya no hay fila viva, el parche se descarta en vez de quedarse atascado", async () => {
    queueSession("s1", { endMs: 111, liveNote: "active" });
    // Esto es exactamente lo que devuelve la base cuando la fila ya la cerró el cron: el
    // UPDATE afecta a cero filas y NO es un error. Antes se aplicaba sin guarda y borraba la
    // marca `closed:cron`; ahora no encuentra fila y no se reintenta para siempre.
    await flush({ updateLiveSession: vi.fn(async () => false), ...noHayCapturas });

    expect(pendientes()).toEqual({});
  });

  it("un fallo de verdad SÍ conserva el parche y corta la vuelta", async () => {
    queueSession("s1", { endMs: 111 });
    queueSession("s2", { endMs: 222 });
    const updateLiveSession = vi.fn(async () => { throw new Error("network"); });
    await flush({ updateLiveSession, ...noHayCapturas });

    // Control: si `flush` tirara los parches pase lo que pase, esta prueba fallaría y las dos
    // de arriba seguirían pasando.
    expect(Object.keys(pendientes()).sort()).toEqual(["s1", "s2"]);
    expect(updateLiveSession).toHaveBeenCalledTimes(1);
  });

  it("no sale a la red cuando el navegador se declara sin conexión", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    queueSession("s1", { endMs: 111 });
    const updateLiveSession = vi.fn(async () => true);
    await flush({ updateLiveSession, ...noHayCapturas });
    expect(updateLiveSession).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true });
  });
});

// ---- El descarte deja rastro (D-NEXT) ----------------------------------------------------
// Sin esto el parche se iba en silencio: correcto para la cola —no hay dónde aplicarlo— y
// mudo para la persona, que en otra pestaña o en otro dispositivo no vio el aviso del tick.
describe("flush · cuenta lo que descarta", () => {
  const noHayCapturas2 = { uploadScreenshot: vi.fn(async () => ({}) as never) };

  it("un parche descartado sube el contador", async () => {
    queueSession("s1", { endMs: 111 });
    await flush({ updateLiveSession: vi.fn(async () => false), ...noHayCapturas2 });
    expect(descartados()).toBe(1);
  });

  // El control: si el contador subiera con cualquier vuelta, esta prueba fallaría y la de
  // arriba seguiría pasando.
  it("un parche APLICADO no sube el contador", async () => {
    queueSession("s1", { endMs: 111 });
    await flush({ updateLiveSession: vi.fn(async () => true), ...noHayCapturas2 });
    expect(descartados()).toBe(0);
  });

  it("cuenta una vez por parche, no una por vuelta", async () => {
    queueSession("s1", { endMs: 111 });
    queueSession("s2", { endMs: 222 });
    queueSession("s3", { endMs: 333 });
    await flush({ updateLiveSession: vi.fn(async () => false), ...noHayCapturas2 });
    expect(descartados()).toBe(3);
  });

  it("se acumula entre tandas mientras nadie lo reconozca, y sobrevive a la recarga", async () => {
    queueSession("s1", { endMs: 111 });
    await flush({ updateLiveSession: vi.fn(async () => false), ...noHayCapturas2 });
    queueSession("s2", { endMs: 222 });
    await flush({ updateLiveSession: vi.fn(async () => false), ...noHayCapturas2 });
    // Vive en localStorage, que es lo que sobrevive a una recarga: la comprobación es que el
    // número esté en el almacén y no en una variable del módulo.
    expect(almacen.get("tt_offline_discarded")).toBe("2");
  });

  it("reconocerlo lo pone a cero, y la siguiente tanda vuelve a avisar", async () => {
    queueSession("s1", { endMs: 111 });
    await flush({ updateLiveSession: vi.fn(async () => false), ...noHayCapturas2 });
    ackDiscarded();
    expect(descartados()).toBe(0);

    queueSession("s2", { endMs: 222 });
    await flush({ updateLiveSession: vi.fn(async () => false), ...noHayCapturas2 });
    expect(descartados()).toBe(1);
  });

  it("un fallo de red no cuenta como descarte: el parche sigue pendiente", async () => {
    queueSession("s1", { endMs: 111 });
    await flush({ updateLiveSession: vi.fn(async () => { throw new Error("network"); }), ...noHayCapturas2 });
    expect(descartados()).toBe(0);
    expect(Object.keys(pendientes())).toEqual(["s1"]);
  });
});

// ---- Y el rastro se tiene que poder ver (D-NEXT) ------------------------------------------
// La pieza que un verify en verde no echa en falta. El indicador se ocultaba con
// `online && total === 0`, y un descarte llega JUSTO cuando la cola se vació y `total` es
// cero: el contador habría sido perfecto y no se habría pintado nunca.
describe("hayAlgoQueDecir", () => {
  const base = { online: true, sessions: 0, shots: 0, total: 0, discarded: 0 };

  it("con la cola vacía y sin descartes, calla", () => {
    expect(hayAlgoQueDecir(base)).toBe(false);
  });

  it("conectado, cola vacía y UN descarte: habla", () => {
    expect(hayAlgoQueDecir({ ...base, discarded: 1 })).toBe(true);
  });

  it("sigue hablando por lo de siempre: sin conexión, o con cola pendiente", () => {
    expect(hayAlgoQueDecir({ ...base, online: false })).toBe(true);
    expect(hayAlgoQueDecir({ ...base, sessions: 1, total: 1 })).toBe(true);
  });
});

// Y que el componente use ESA condición, no una copia suya. Probar la función pura demuestra
// que la regla es correcta; no demuestra que el indicador la pregunte. Sin esto, alguien puede
// dejar el `s.online && s.total === 0` de antes en el JSX y las pruebas de arriba seguirían en
// verde con el aviso invisible, que es exactamente el fallo que esta rama viene a arreglar.
describe("el indicador pregunta por la condición compartida", () => {
  const fuente = readFileSync("src/components/timetracker/OfflineIndicator.tsx", "utf8");

  it("importa y llama a hayAlgoQueDecir", () => {
    expect(fuente).toContain("hayAlgoQueDecir");
    expect(fuente).toMatch(/if \(!hayAlgoQueDecir\(s\)\) return null;/);
  });

  // Mirando el CÓDIGO, no el comentario: el comentario de la línea 15 cita la condición vieja
  // a propósito, para explicar qué se quitó, y un `toContain` a secas la contaba como si
  // siguiera viva. Es el mismo mordisco de siempre — un patrón que ve una forma y no la otra.
  it("y no conserva la condición vieja, que escondía el aviso", () => {
    const codigo = fuente.split(/\r?\n/).filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(codigo).not.toMatch(/if \(s\.online && s\.total === 0\)/);
  });

  it("enseña el número y ofrece reconocerlo", () => {
    expect(fuente).toContain("s.discarded > 0");
    expect(fuente).toContain("ackDiscarded()");
  });
});
