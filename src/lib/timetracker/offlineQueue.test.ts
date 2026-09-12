import { describe, it, expect, beforeEach, vi } from "vitest";
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

const { flush, queueSession } = await import("./offlineQueue");

const LS = "tt_offline_sessions";
const pendientes = () => JSON.parse(almacen.get(LS) || "{}") as Record<string, Partial<Session>>;

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
