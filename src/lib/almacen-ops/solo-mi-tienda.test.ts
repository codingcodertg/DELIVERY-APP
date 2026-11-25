import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 2026-11-24 (dueño): «solo admin puede ver todo»; los demás, «solo pueden ver su propia tienda». La regla vive en
// `puerta.ts` (`tiendasParaVer`); estas pruebas miran que las pantallas de VER la usen (no la lista de LLENAR).
const leer = (r: string) => readFileSync(join(process.cwd(), r), "utf8").replace(/\r\n/g, "\n");

describe("solo-mi-tienda: las pantallas de VER usan tiendasParaVer", () => {
  const OPERACIONES = leer("src/app/operaciones/Operaciones.tsx");
  const LISTA = leer("src/app/operaciones/ListaDeReportes.tsx");

  it("Operaciones.tsx da tiendasParaVer en el contexto, real y demo", () => {
    expect(OPERACIONES).toContain("tiendasParaVer");
    expect(OPERACIONES).toMatch(/tiendasParaVer: ordenarTiendas\(tiendasParaVer\(yo, todas\), yo\.store\)/);
    expect(OPERACIONES).toMatch(/tiendasParaVer: tiendasParaVer\(DEMO_YO, DEMO_TIENDAS\)/);
  });
  it("ListaDeReportes.tsx calcula su filtro de tienda desde ctx.tiendasParaVer", () => {
    expect(LISTA).toContain("const tiendasDelFiltro = useMemo(() => Array.from(new Set([...ctx.tiendasParaVer,");
    expect(LISTA).toContain("const tiendasDeConteos = useMemo(() => (tiendaElegida === \"\" ? ctx.tiendasParaVer : [tiendaElegida]), [tiendaElegida, ctx.tiendasParaVer]);");
  });
});
