// Auto-optimizar al asignar (348): el proveedor real y el demo exponen las mismas piezas, y el real solo escribe
// `route_fixed` y `route_auto_state` cuando la base tiene las dos (`hayAutoOptimizar`). Prueba de texto del fuente,
// igual que las de la pantalla: el proveedor real depende de Supabase y no se puede ejecutar aqui.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const raiz = path.resolve(__dirname, "..", "..");
const real = fs.readFileSync(path.join(raiz, "src", "lib", "data-provider.tsx"), "utf8");
const demo = fs.readFileSync(path.join(raiz, "src", "lib", "local-data-provider.tsx"), "utf8");

const MIEMBROS = ["hayAutoOptimizar", "fijaParadas", "estadoAutoDeRutas", "marcaAutoDeRuta"];

/** El texto desde `inicio` hasta `fin` (o hasta el final), para mirar una sola función. */
function tramo(fuente: string, inicio: string, fin?: string): string {
  const a = fuente.indexOf(inicio);
  if (a < 0) return "";
  const b = fin ? fuente.indexOf(fin, a + inicio.length) : -1;
  return b < 0 ? fuente.slice(a) : fuente.slice(a, b);
}

describe("auto-optimizar al asignar en el proveedor", () => {
  it("la interfaz DataState declara los cuatro miembros", () => {
    const interfaz = tramo(real, "export interface DataState", "\n}\n");
    for (const m of MIEMBROS) expect(interfaz).toContain(`${m}`);
    expect(interfaz).toContain("fijaParadas: (ids: readonly string[], fija: boolean) => Promise<boolean>;");
    expect(interfaz).toContain("estadoAutoDeRutas: ReadonlyMap<string, EstadoAutoDeRuta>;");
  });

  it("el proveedor real y el demo exponen los cuatro miembros en su objeto de valor", () => {
    for (const fuente of [real, demo]) {
      const valor = tramo(fuente, "const value: DataState = useMemo(() => ({", "}), [");
      for (const m of MIEMBROS) expect(valor).toContain(m);
    }
  });

  it("el real: la bandera sale de DOS comprobaciones (la columna y la tabla), no de suponerlas", () => {
    expect(real).toContain("const hayAutoOptimizar = columnaFijadaOk && tablaAutoOk;");
    const carga = tramo(real, "const cargaEstadoAuto = useCallback", "const fijaParadas");
    expect(carga).toContain(`.from("deliveries").select("route_fixed").limit(1)`);
    expect(carga).toContain(`.from("route_auto_state").select(`);
    expect(carga).toContain("faltaLaTabla(tabla.error)");
    expect(carga).toContain(`nombraLaColumna(col.error.message ?? "", "route_fixed")`);
  });

  it("el real: cargaEstadoAuto corre con cada recarga de la página", () => {
    expect(real).toContain("void cargaEstadoAuto();");
    expect(real).toContain("}, [ensureSession, loaders, cargaEstadoAuto]);");
  });

  it("el real: `route_fixed` solo se escribe dentro de fijaParadas, y esta bajo `hayAutoOptimizar`", () => {
    const fija = tramo(real, "const fijaParadas = useCallback", "const marcaAutoDeRuta");
    expect(fija).toContain("if (!hayAutoOptimizar || teaching || ids.length === 0) return true;");
    expect(fija).toContain(`update({ route_fixed: fija })`);
    // Ningun otro sitio del proveedor escribe la columna.
    expect(real.split("route_fixed: fija").length - 1).toBe(2);   // el update y el espejo local, ambos dentro de fijaParadas
    const todo = real.split("update({ route_fixed").length - 1;
    expect(todo).toBe(1);
  });

  it("el real: `route_auto_state` solo se escribe dentro de marcaAutoDeRuta, bajo `hayAutoOptimizar`", () => {
    const marca = tramo(real, "const marcaAutoDeRuta = useCallback", "const reloadAll");
    expect(marca).toContain("if (!hayAutoOptimizar || teaching) return false;");
    expect(marca).toContain(`from("route_auto_state").upsert(`);
    expect(real.split(`from("route_auto_state").upsert(`).length - 1).toBe(1);
  });

  it("el demo: hayAutoOptimizar es true y los miembros son en memoria (sin consultas)", () => {
    expect(demo).toContain("const hayAutoOptimizar = true;");
    const fija = tramo(demo, "const fijaParadas = useCallback", "const marcaAutoDeRuta");
    expect(fija).toContain("route_fixed: fija");
    expect(fija).not.toContain("supabase");
    const marca = tramo(demo, "const marcaAutoDeRuta = useCallback", "// Renumber");
    expect(marca).toContain("setEstadoAutoDeRutas");
    expect(marca).not.toContain("supabase");
  });

  it("el tipo Delivery tiene route_fixed como opcional", () => {
    const tipos = fs.readFileSync(path.join(raiz, "src", "lib", "types.ts"), "utf8");
    expect(tipos).toContain("route_fixed?: boolean | null;");
    expect(tipos).toContain("export interface EstadoAutoDeRuta");
  });
});
