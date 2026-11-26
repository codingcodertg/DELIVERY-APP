import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 348: la auto-optimización al asignar, cableada en el Gestor de rutas. Son pruebas de CABLEADO (el texto de la pantalla):
// que cada gesto la llama, que el botón pregunta antes de pisar, que la auto comprueba la huella dentro de la cola y que
// nada se escribe con reglas rotas. El comportamiento de cada pieza está probado en sus propios archivos.
const raiz = path.resolve(__dirname, "..", "..");
const pagina = fs.readFileSync(path.join(raiz, "src", "app", "(app)", "routes", "page.tsx"), "utf8").replace(/\r\n/g, "\n");

/** El texto de una función de la pantalla: desde su cabecera hasta la siguiente declaración de su mismo nivel. */
function cuerpoDe(cabecera: string, hasta: string[] = []): string {
  const i = pagina.indexOf(cabecera);
  expect(i, `no está: ${cabecera}`).toBeGreaterThan(-1);
  let fin = pagina.length;
  // Cada función del Gestor vive al mismo nivel (2 espacios): su fin es la siguiente declaración de ese nivel.
  for (const h of ["\n  const ", "\n  // ", "\n  /**", "\n  type ", "\n  useEffect(", ...hasta]) {
    const j = pagina.indexOf(h, i + cabecera.length);
    if (j > -1 && j < fin) fin = j;
  }
  return pagina.slice(i, fin);
}

const DESPUES_DE_OPTIMIZA = ["  // Friendly display name for a lane key.", "  const bloqueada = (laneKey: string)"];

describe("la auto-optimización al asignar (348) en el Gestor", () => {
  it("cada gesto de asignación llama a trasAsignar (o fija la parada a mano)", () => {
    const gestos: [string, string[]][] = [
      ["  const manualAssign = (id: string, driver: string) => {", ["  const apruebaSolicitud"]],
      ["  const unassign = (id: string) => {", ["  const assignToLane"]],
      ["  const boardMove = (orderId: string, columnKey: string) => {", ["  const toggleOrder"]],
      ["  const bulkAssign = async (driver: string) => {", ["  // «🧭 Optimizar»", "  // Assign every checked order", "  const numeraElArranque"]],
      ["  const pasaAYa = async (origen: string, ids: readonly string[], destino: string) => {", ["  // ---- ARRASTRAR (D-456)"]],
      ["  const mergeSelectedLanes = async () => {", ["  // Create a temp driver"]],
      ["  const assignRouteToDriver = async (bucket: string, driver: string) => {", ["  // Delete a whole route/load"]],
      ["  const clearLane = async (laneKey: string) => {", ["  // Friendly", "  const sueltaParadaYa"]],
      ["  const colocaEnElMejorLugar = async (laneKey: string) => {", ["  // ---- «Asignar a…» varios choferes (D-474)"]],
      ["  const reparte = async () => {", ["  const sueltaEnLaLinea"]],
      ["  const mueveParadaYa = async (laneKey: string, indice: number, dir: -1 | 1) => {", ["  /** «Pasar a…» (D-443"]],
      ["  const sueltaParadaYa = async (rutaDeOrigen: string, claveOrigen: string, destino: string, claveDestino: string | null) => {", ["  /** Las flechas, cuando les toca en la fila"]],
      ["  const aParadaYa = async (laneKey: string, clave: string, numero: number, entera: boolean) => {", ["  const traeEntregaYa"]],
      ["  const traeEntregaYa = async (laneKey: string, clave: string) => {", ["  // Lo último de cada gesto"]],
      ["  const sueltaEnLaLinea = async (movida: string, destino: Destino) => {", []],
    ];
    for (const [cabecera, hasta] of gestos) {
      const cuerpo = cuerpoDe(cabecera, hasta);
      expect(/trasAsignar\(|fijaLasMovidas\(|fijaParadas\(/.test(cuerpo), `el gesto no llama a trasAsignar ni fija: ${cabecera}`).toBe(true);
    }
  });

  it("trasAsignar sale al momento sin hayAutoOptimizar (la base sin la 348 no hace nada)", () => {
    const cuerpo = cuerpoDe("  const trasAsignar = (cambios: readonly CambioDeAsignacion[]");
    expect(cuerpo).toContain("if (!hayAutoOptimizar) return;");
    expect(cuerpo.indexOf("if (!hayAutoOptimizar) return;")).toBeLessThan(cuerpo.indexOf("rutasAOptimizar(cambios)"));
  });

  it("el botón «Optimizar» pregunta antes de pisar paradas fijadas a mano (con la confirmación de la pantalla)", () => {
    const cuerpo = cuerpoDe("  const optimizaLaRuta = async (laneKey: string) => {", DESPUES_DE_OPTIMIZA);
    const pregunta = cuerpo.indexOf("avisoDePisar(stops)");
    expect(pregunta).toBeGreaterThan(-1);
    expect(cuerpo.slice(pregunta, pregunta + 260)).toContain("confirmAction(");
    expect(cuerpo.indexOf("confirmAction(")).toBeLessThan(cuerpo.indexOf("setOptimizando(laneKey)"));
    expect(pagina).not.toMatch(/window\.confirm\(/);
  });

  it("el motor del botón conserva UNA sola firma y la auto no la llama con un modo", () => {
    expect(pagina.split("const optimizaLaRuta = async (laneKey: string) => {").length - 1).toBe(1);
    expect(pagina).not.toMatch(/optimizaLaRuta\(laneKey, "auto"\)/);
  });

  it("D-1201: al asignar nunca se reacomoda la ruta entera (no queda la auto de toda la ruta)", () => {
    expect(pagina).not.toContain("const autoOptimizaToda");
    expect(pagina).not.toContain("optimizar_todo");
  });

  it("la colocación comprueba la huella DENTRO de la cola antes de escribir", () => {
    const insertar = cuerpoDe("  const insertaEnLaRuta = async (");
    expect(insertar).toMatch(/await enFila\(async \(\) => \{\s*if \(huellaVivaRef\.current\(laneKey\) !== huellaInicial\)/);
  });

  it("no se escribe lo que añade una regla dura, y se guarda UNA sola vez al final (D-1201)", () => {
    const insertar = cuerpoDe("  const escribeLasNuevas = async (", ["  /** La colocación automática de las órdenes nuevas"]);
    expect(insertar).toContain("violacionesNuevas(");
    expect(insertar.split("guardaLaLista(").length - 1).toBe(1);
    expect(insertar.indexOf("if (nuevas.length)")).toBeLessThan(insertar.indexOf("guardaLaLista(laneKey, iniciales, lista"));
  });

  it("el motor de «Optimizar» y el de la auto usan el mismo constructor de reglas", () => {
    expect(pagina).toContain("reglasDeLaEntrada(");
    expect(pagina).not.toMatch(/validaLaLista\(/);
  });

  it("el lote de una ráfaga de asignaciones es UNA pasada por chofer (un temporizador por ruta)", () => {
    const cuerpo = cuerpoDe("  const encolaAuto = (laneKey: string");
    expect(cuerpo).toContain("if (lote.timer) clearTimeout(lote.timer);");
    expect(cuerpo).toContain("}, 700);");
  });
});
