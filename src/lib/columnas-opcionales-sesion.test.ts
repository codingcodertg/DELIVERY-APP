import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { leeConOpcionales, olvidaColumnasQueFaltan, type LecturaConError } from "./columnas-opcionales";

// 348: una base sin `route_fixed` no debe costar una petición fallida en CADA lectura de la lista. La primera vez se
// aprende que falta; después, la sesión no la vuelve a pedir.
const BASE = "id, order_no, stage";

/** Una lectura falsa: la base no tiene las columnas de `sinColumnas`; cuenta las peticiones. */
function baseFalsa(sinColumnas: string[]) {
  const pedidas: string[] = [];
  const lee = async (columnas: string): Promise<LecturaConError<string>> => {
    pedidas.push(columnas);
    const falta = sinColumnas.find((c) => columnas.split(", ").includes(c));
    if (falta) return { data: "", error: { code: "42703", message: `column deliveries.${falta} does not exist` } };
    return { data: columnas, error: null };
  };
  return { lee, pedidas };
}

describe("leeConOpcionales recuerda la columna que falta (la sesión)", () => {
  // La memoria es del navegador (una sesión); las pruebas corren en Node, así que la simulamos.
  beforeEach(() => { vi.stubGlobal("window", {}); olvidaColumnasQueFaltan(); });
  afterEach(() => vi.unstubAllGlobals());

  it("la primera lectura pierde la columna que falta: una petición fallida y una buena", async () => {
    const b = baseFalsa(["route_fixed"]);
    const r = await leeConOpcionales(b.lee, BASE, ["plan_rank", "route_fixed"]);
    expect(r.error).toBeNull();
    expect(b.pedidas).toHaveLength(2);
    expect(r.data).not.toContain("route_fixed");
  });

  it("las lecturas siguientes de la misma base no la vuelven a pedir: ninguna petición fallida más", async () => {
    const b = baseFalsa(["route_fixed"]);
    await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
    b.pedidas.length = 0;
    for (let i = 0; i < 3; i++) await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
    expect(b.pedidas).toHaveLength(3);
    for (const p of b.pedidas) expect(p).not.toContain("route_fixed");
  });

  it("olvidaColumnasQueFaltan vuelve a pedirla (para las pruebas y para una base que ya la tiene)", async () => {
    const b = baseFalsa(["route_fixed"]);
    await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
    olvidaColumnasQueFaltan();
    b.pedidas.length = 0;
    await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
    expect(b.pedidas).toHaveLength(2);
  });

  it("la memoria es por base: otra lista de columnas sí la pide", async () => {
    const b = baseFalsa(["route_fixed"]);
    await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
    b.pedidas.length = 0;
    await leeConOpcionales(b.lee, "otra, base", ["route_fixed"]);
    expect(b.pedidas[0]).toContain("route_fixed");
  });

  it("una columna que sí existe nunca se olvida ni se quita", async () => {
    const b = baseFalsa([]);
    await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
    expect(b.pedidas).toHaveLength(1);
    expect(b.pedidas[0]).toContain("route_fixed");
  });
});

describe("en el servidor (sin navegador) no se recuerda nada entre peticiones", () => {
  beforeEach(() => olvidaColumnasQueFaltan());

  it("cada lectura del servidor vuelve a pedir la columna que falta (una migración aplicada se ve al momento)", async () => {
    vi.stubGlobal("window", undefined);
    try {
      const b = baseFalsa(["route_fixed"]);
      await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
      await leeConOpcionales(b.lee, BASE, ["route_fixed"]);
      expect(b.pedidas).toHaveLength(4);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
