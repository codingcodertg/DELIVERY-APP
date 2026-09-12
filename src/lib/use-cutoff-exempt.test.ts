import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { consultarExencion, olvidarExencion, vigilarExencion } from "./use-cutoff-exempt";

// La consulta compartida decide si el cronómetro se para a las 18:30, así que lo que se prueba
// aquí es qué se guarda y qué no. El hook en sí (el `useState`) no se puede montar: vitest corre
// en node, sin jsdom.
const responder = (cuerpo: unknown) =>
  vi.fn(async () => ({ json: async () => cuerpo })) as unknown as typeof fetch;

beforeEach(() => { olvidarExencion(); });

describe("consultarExencion", () => {
  it("devuelve el sí y el no tal cual", async () => {
    vi.stubGlobal("fetch", responder({ exento: true }));
    expect(await consultarExencion()).toBe(true);
    olvidarExencion();
    vi.stubGlobal("fetch", responder({ exento: false }));
    expect(await consultarExencion()).toBe(false);
  });

  it("un `exento: null` del servidor NO se aplana a false: es «no se sabe»", async () => {
    // La ruta responde `null` cuando su consulta a la base falla, y ese null tiene que llegar
    // entero: el aviso lo resuelve callando y el cronómetro parando, y cada uno necesita
    // distinguirlo de un «no» de verdad.
    vi.stubGlobal("fetch", responder({ exento: null }));
    expect(await consultarExencion()).toBeNull();
  });

  it("una respuesta rara tampoco inventa un sí", async () => {
    for (const cuerpo of [{}, { exento: "sí" }, { otra: 1 }]) {
      olvidarExencion();
      vi.stubGlobal("fetch", responder(cuerpo));
      expect(await consultarExencion()).toBeNull();
    }
  });

  it("el sí se comparte: dos preguntas, una sola petición", async () => {
    const f = responder({ exento: true });
    vi.stubGlobal("fetch", f);
    await Promise.all([consultarExencion(), consultarExencion()]);
    await consultarExencion();
    expect(f).toHaveBeenCalledTimes(1);
  });

  // El punto que importa: un parpadeo de red a las 18:20 no puede dejar al `owner` con el reloj
  // parándose todos los días hasta que recargue la pestaña. El cronómetro es justo la pestaña
  // que se queda abierta.
  it("el «no se sabe» NO se cachea: la siguiente vez se vuelve a preguntar", async () => {
    const falla = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", falla);
    expect(await consultarExencion()).toBeNull();

    const bien = responder({ exento: true });
    vi.stubGlobal("fetch", bien);
    expect(await consultarExencion()).toBe(true);
    expect(bien).toHaveBeenCalledTimes(1);
  });

  it("y un `null` del servidor tampoco se queda pegado", async () => {
    vi.stubGlobal("fetch", responder({ exento: null }));
    expect(await consultarExencion()).toBeNull();
    const bien = responder({ exento: false });
    vi.stubGlobal("fetch", bien);
    expect(await consultarExencion()).toBe(false);
    expect(bien).toHaveBeenCalledTimes(1);
  });
});

describe("la ruta no resuelve la duda por sus consumidores", () => {
  const src = readFileSync("src/app/auth/cutoff/route.ts", "utf8");

  it("cuando la puerta falla responde `null`, no `true`", () => {
    expect(src).toMatch(/if \(error \|\| !data\) return NextResponse\.json\(\{ exento: null/);
    expect(src).not.toContain("exento: true");
  });

  it("y sin sesión responde que no está exento, que sí es una respuesta", () => {
    expect(src).toContain("exento: false, sesion: false");
  });
});

// ---- Y hay que VOLVER a preguntar, que es la mitad que faltaba -----------------------------
// Vaciar la caché tras un fallo deja el sitio libre y nadie vuelve a ocuparlo: en el hook,
// `setExento(null)` sobre un estado que ya es `null` no re-renderiza, y el `activo` del
// cronómetro pasa de false a true una sola vez. Sin reintento, el arreglo estaba puesto y el
// daño era el mismo. La propiedad que se fija aquí: mientras no se sabe se pregunta otra vez;
// en cuanto se sabe, se deja de preguntar.
describe("vigilarExencion", () => {
  it("dos fallos seguidos son dos peticiones, y el sí que llega después corta", async () => {
    vi.useFakeTimers();
    const llamadas: number[] = [];
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      n += 1; llamadas.push(n);
      if (n <= 2) throw new Error("network");
      return { json: async () => ({ exento: true }) };
    }) as unknown as typeof fetch);

    const visto: boolean[] = [];
    const parar = vigilarExencion((v) => visto.push(v), 1000);

    await vi.advanceTimersByTimeAsync(0);      // intento 1: falla
    await vi.advanceTimersByTimeAsync(1000);   // intento 2: falla
    expect(llamadas.length).toBe(2);
    expect(visto).toEqual([]);

    await vi.advanceTimersByTimeAsync(1000);   // intento 3: responde
    expect(visto).toEqual([true]);

    // Y a partir de aquí no se pregunta más: la respuesta es estable.
    await vi.advanceTimersByTimeAsync(5000);
    expect(llamadas.length).toBe(3);

    parar();
    vi.useRealTimers();
  });

  it("un «no» también corta: lo que para el reintento es saber, no que la respuesta guste", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => ({ json: async () => ({ exento: false }) })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);
    const visto: boolean[] = [];
    const parar = vigilarExencion((v) => visto.push(v), 1000);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(visto).toEqual([false]);
    expect(f).toHaveBeenCalledTimes(1);
    parar();
    vi.useRealTimers();
  });

  it("y al soltarlo deja de preguntar aunque nunca haya sabido nada", async () => {
    vi.useFakeTimers();
    const f = vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", f);
    const parar = vigilarExencion(() => {}, 1000);
    await vi.advanceTimersByTimeAsync(0);
    parar();
    await vi.advanceTimersByTimeAsync(5000);
    expect(f).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

// Y que el cierre de sesión la olvide, que es su motivo de producción: la caché es de módulo,
// o sea de la carga de página, y el «Cerrar sesión» de la pantalla sin acceso navega sin
// recargar. En una tienda donde sale un owner y entra un vendedor en el mismo equipo, sin esto
// el vendedor hereda el `true` del anterior y a las 18:30 su reloj no se para.
describe("los cierres de sesión de cliente olvidan la respuesta", () => {
  const caminos = [
    "src/app/no-access/SignOut.tsx",
    "src/lib/timetracker-data-provider.tsx",
  ];

  it("los dos la llaman", () => {
    expect(caminos.length).toBe(2); // control: si la lista se vacía, falla
    for (const f of caminos) {
      expect(readFileSync(f, "utf8"), f).toContain("olvidarExencion()");
    }
  });

  it("y el de la pantalla sin acceso la llama ANTES de navegar", () => {
    const src = readFileSync("src/app/no-access/SignOut.tsx", "utf8");
    expect(src.indexOf("olvidarExencion()")).toBeLessThan(src.indexOf('router.replace("/login")'));
  });
});
