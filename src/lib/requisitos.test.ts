import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mkDelivery } from "./__fixtures";
import {
  alternaRequisito, anadeAlCatalogo, catalogoDeRequisitos, conRequisitosSiCabe, delCatalogo, faltan, faltanAlChofer, fraseDeFaltan,
  habilidadesPorNombre, laBaseTieneRequisitos, laBaseTieneRequisitosEnOrdenes, MAX_REQUISITOS, requisitosDeLaOrden,
} from "./requisitos";
import { separaPorRequisitos } from "./mejor-lugar";
import type { Delivery } from "./types";

/**
 * Requisitos del camión (D-418, 151; OptimoRoute `skills` / `vehicleFeatures`). El dueño, 2026-09-27: *«solos haz 1 3
 * y 4»*. Aquí: la librería, «Mejor lugar», y que las pantallas usan todo esto. Auto-asignar NO: el orquestador lo sacó del alcance (otra rama lo reescribe sobre el motor). El motor de «Planificar el
 * día» tiene su propia prueba (`route-engine/requisitos-en-el-motor.test.ts`).
 */

const leer = (p: string) => readFileSync(join(process.cwd(), p), "utf8").split("\r\n").join("\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const CAT = ["Liftgate", "Montacargas", "Dos personas"];

describe("la librería", () => {
  it("el catálogo: limpio, sin repetidos ni vacíos, con la primera grafía; sin la columna, vacío", () => {
    expect(catalogoDeRequisitos({ delivery_requirements: [" Liftgate ", "liftgate", "", "Dos   personas", 3 as unknown as string] })).toEqual(["Liftgate", "Dos personas"]);
    expect(catalogoDeRequisitos({})).toEqual([]);
    expect(catalogoDeRequisitos(null)).toEqual([]);
    expect(laBaseTieneRequisitos({ delivery_requirements: [] })).toBe(true);
    expect(laBaseTieneRequisitos({})).toBe(false);
  });

  it("solo cuenta lo del catálogo, con su grafía y en su orden", () => {
    expect(delCatalogo(["dos personas", "LIFTGATE", "Grúa"], CAT)).toEqual(["Liftgate", "Dos personas"]);
    expect(requisitosDeLaOrden({ requirements: ["montacargas"] }, CAT)).toEqual(["Montacargas"]);
    expect(requisitosDeLaOrden({}, CAT)).toEqual([]);
  });

  it("faltan: lo que pide y no tiene, sin mayúsculas", () => {
    expect(faltan(["Liftgate", "Montacargas"], ["liftgate"])).toEqual(["Montacargas"]);
    expect(faltan([], [])).toEqual([]);
    expect(faltan(["Liftgate"], null)).toEqual(["Liftgate"]);
  });

  it("la frase, en los dos idiomas", () => {
    expect(fraseDeFaltan(["Liftgate"], "es")).toBe("falta Liftgate");
    expect(fraseDeFaltan(["Liftgate", "Montacargas", "Dos personas"], "es")).toBe("faltan Liftgate, Montacargas y Dos personas");
    expect(fraseDeFaltan(["Liftgate", "Forklift"], "en")).toBe("missing Liftgate and Forklift");
    expect(fraseDeFaltan([], "es")).toBe("");
  });

  it("qué tiene cada chofer, por NOMBRE; quien no tiene fila, nada; las rutas temporales no se filtran", () => {
    const hab = habilidadesPorNombre([{ profile_id: "u1", features: ["liftgate"] }, { profile_id: "u2", features: [] }], [{ id: "u1", full_name: "Ana Ruiz" }, { id: "u2", full_name: "Beto" }], CAT);
    const pide = { requirements: ["Liftgate"] };
    expect(faltanAlChofer(pide, "ana ruiz ", CAT, hab)).toEqual([]);
    expect(faltanAlChofer(pide, "Beto", CAT, hab)).toEqual(["Liftgate"]);
    expect(faltanAlChofer(pide, "Carla", CAT, hab)).toEqual(["Liftgate"]);
    expect(faltanAlChofer(pide, "Route 1", CAT, hab, ["Route 1"])).toEqual([]);
    expect(faltanAlChofer({ requirements: [] }, "Beto", CAT, hab)).toEqual([]);
    // Quitado del catálogo, deja de contar: la orden vuelve a ir con cualquiera.
    expect(faltanAlChofer(pide, "Beto", ["Montacargas"], hab)).toEqual([]);
  });

  it("guardar la orden: la clave solo viaja si la base tiene la columna", () => {
    expect(conRequisitosSiCabe({ a: 1, requirements: ["Liftgate"] }, [{ id: "x" }])).toEqual({ a: 1 });
    expect(conRequisitosSiCabe({ a: 1, requirements: ["Liftgate"] }, [{ id: "x", requirements: [] }])).toEqual({ a: 1, requirements: ["Liftgate"] });
    expect(laBaseTieneRequisitosEnOrdenes([])).toBe(false);
  });

  it("marcar y desmarcar, en el orden del catálogo; y añadir al catálogo con sus límites", () => {
    expect(alternaRequisito(["Dos personas"], "Liftgate", CAT)).toEqual(["Liftgate", "Dos personas"]);
    expect(alternaRequisito(["liftgate", "Viejo"], "Liftgate", CAT)).toEqual([]);
    expect(anadeAlCatalogo(CAT, "  Camión   grande ")).toEqual({ ok: true, catalogo: [...CAT, "Camión grande"] });
    expect(anadeAlCatalogo(CAT, "LIFTGATE")).toEqual({ ok: false, motivo: "repetido" });
    expect(anadeAlCatalogo(CAT, "   ")).toEqual({ ok: false, motivo: "vacio" });
    expect(anadeAlCatalogo(CAT, "x".repeat(41))).toEqual({ ok: false, motivo: "largo" });
    expect(anadeAlCatalogo(Array.from({ length: MAX_REQUISITOS }, (_, k) => `r${k}`), "otro")).toEqual({ ok: false, motivo: "lleno" });
  });
});

// ---- «Mejor lugar» ---------------------------------------------------------------------------------------------------

const o = (id: string, over: Partial<Delivery> = {}) => mkDelivery({ id, order_no: Number(id.replace(/\D/g, "")) || 1, delivery_lat: 26.2, delivery_lng: -98.2, est_pallets: 1, delivery_windows: null, ...over });
const tiene: Record<string, string[]> = { Ana: ["Liftgate"], Beto: [] };
const faltanA = (d: Delivery, chofer: string) => faltan(requisitosDeLaOrden(d, CAT), tiene[chofer] ?? []);

describe("«Mejor lugar»: el filtro de chofer válido", () => {
  it("separa lo que el camión de la ruta puede llevar de lo que no, con lo que falta", () => {
    const a = o("o1"), b = o("o2", { requirements: ["Liftgate"] }), c = o("o3", { requirements: ["Montacargas"] });
    const r = separaPorRequisitos([a, b, c], (d) => faltanA(d, "Ana"));
    expect(r.pueden.map((d) => d.id)).toEqual(["o1", "o2"]);
    expect(r.no.map((x) => [x.orden.id, x.faltan])).toEqual([["o3", ["Montacargas"]]]);
  });
});

describe("las pantallas usan todo esto", () => {
  it("el Gestor: «Mejor lugar» filtra ANTES de colocar o asignar al final", () => {
    const p = plano(leer("src/app/(app)/routes/page.tsx"));
    expect(p).toContain("const { faltanA } = useRequisitosDelCamion();");
    // Auto-asignar (que respetaba los requisitos por el motor, D-419) se quitó en D-437; repartir es «Armar rutas», que es el motor.
    expect(p).toContain("const { pueden: marcadas, no: sinCamion } = separaPorRequisitos(filasDelChip.filter((d) => selectedOrders.has(d.id)), (d) => faltanA(d, laneKey));");
    // El bucle que coloca (y el que asigna al final) recorre `marcadas`, que ya es SOLO lo que puede ir.
    const cuerpo = p.slice(p.indexOf("const colocaEnElMejorLugar"), p.indexOf("const move = async"));
    expect(cuerpo.indexOf("separaPorRequisitos(")).toBeGreaterThan(-1);
    expect(cuerpo.indexOf("separaPorRequisitos(")).toBeLessThan(cuerpo.indexOf("for (const d of marcadas)"));
    expect(cuerpo).not.toContain("const marcadas = filasDelChip");
  });

  it("el gancho pregunta a `driver_settings` solo con catálogo, y responde con `faltanAlChofer`", () => {
    const h = plano(leer("src/lib/usa-requisitos.ts"));
    expect(h).toContain('if (!hayCatalogo || LOCAL_MODE) return;');
    expect(h).toContain('createClient().from("driver_settings").select("profile_id, features")');
    expect(h).toContain("faltanAlChofer(orden, chofer, catalogo, habilidades, carriles ?? [])");
  });

  it("la ficha: marca con `alternaRequisito` y guarda con `conRequisitosSiCabe`", () => {
    const f = plano(leer("src/components/OrderModal.tsx"));
    expect(f).toContain("const payload = conRequisitosSiCabe(conAvisosSiCabe(conPrioridadSiCabe({");
    expect(f).toContain("}, deliveries), deliveries), deliveries);");
    expect(f).toContain('{laBaseTieneRequisitosEnOrdenes(deliveries) && catalogoDeRequisitos(settings).length > 0 && (');
    expect(f).toContain('onChange={() => set("requirements", alternaRequisito(d.requirements, r, catalogoDeRequisitos(settings)))}');
  });

  it("Ajustes: el catálogo con `anadeAlCatalogo`, y los camiones leídos con `features` solo si la base la tiene", () => {
    const s = plano(leer("src/components/RouteEngineSettings.tsx"));
    expect(s).toContain("const r = anadeAlCatalogo(catalogo, nuevoRequisito);");
    expect(s).toContain("saveSettings({ delivery_requirements: siguiente } as Partial<Settings>);");
    expect(s).toContain('leeConOpcionales((columnas) => { pedidas = columnas; return supabase.from("driver_settings").select(columnas); }, COLUMNAS_DE_CHOFER, COLUMNAS_OPCIONALES_DE_CHOFER);');
    expect(s).toContain('setHayFeatures(pedidas.split(", ").includes("features"));');
    expect(s).toContain("onChange={() => edita(u.id, { features: alternaRequisito(f.features, r, catalogo) })}");
  });
});
