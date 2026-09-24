import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ETAPAS_QUE_EL_BLOQUE_NO_TOCA, MUESTRA_DEL_BLOQUE, porEtapa, preguntaDelBloque, reparteParaElBloque } from "./cambio-en-bloque";
import { stageLabel } from "./constants";
import { LARGO_DE_LA_NOTA, LARGO_DE_VALOR_EN_NOTA, changedFieldsNote } from "./utils";
import type { Stage } from "./types";

/**
 * El incidente del 2026-09-23: 162 de 245 órdenes cambiaron de fecha de golpe, 110 ya entregadas, y el historial no guardaba
 * la fecha anterior, así que 52 no se pudieron devolver. Aquí se fija lo que impide que se repita (D-372).
 */

const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
const plano = (s: string) => s.replace(/\s+/g, " ");
const o = (id: string, stage: Stage) => ({ id, stage });

describe("qué entra en un cambio en bloque", () => {
  it("una entregada y una anulada se quedan fuera; todo lo demás entra", () => {
    const todas: Stage[] = ["draft", "pending", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"];
    const { entran, saltadas } = reparteParaElBloque(todas.map((s, i) => o(`o${i}`, s)));
    expect(saltadas.map((x) => x.stage)).toEqual(["delivered", "canceled"]);
    expect(entran.map((x) => x.stage)).toEqual(["draft", "pending", "rejected", "approved", "fulfilling", "ready", "picked_up"]);
    expect(entran.length + saltadas.length).toBe(todas.length);        // no se pierde ninguna por el camino
  });
  it("la lista conserva el orden de la selección, para que la muestra se lea igual que la pantalla", () => {
    const { entran } = reparteParaElBloque([o("c", "ready"), o("a", "pending"), o("b", "approved")]);
    expect(entran.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
  it("una selección entera de entregadas no deja nada que cambiar", () => {
    const { entran, saltadas } = reparteParaElBloque([o("a", "delivered"), o("b", "canceled")]);
    expect([entran.length, saltadas.length]).toEqual([0, 2]);
  });
  it("son esas dos etapas y no otras: si mañana alguien añade una, esta prueba lo dice", () => {
    expect([...ETAPAS_QUE_EL_BLOQUE_NO_TOCA]).toEqual(["delivered", "canceled"]);
  });
  it("cuenta por etapa para poder decirlo sin redondear", () => {
    expect(porEtapa([o("a", "delivered"), o("b", "delivered"), o("c", "canceled")])).toEqual({ delivered: 2, canceled: 1 });
    expect(porEtapa([])).toEqual({});
  });
});

describe("la pregunta que se hace ANTES de tocar nada", () => {
  const accion = { en: "Set the delivery date to 2026-12-25?", es: "¿Fijar la fecha de entrega en 2026-12-25?" };
  const arma = (nEntran: number, saltadas: Stage[] = []) => preguntaDelBloque({
    accion,
    entran: Array.from({ length: nEntran }, (_, i) => ({ id: `id${i}`, order_no: 1000 + i })),
    saltadas: saltadas.map((s, i) => o(`s${i}`, s)),
    etiqueta: (d) => String(d.order_no),
    etiquetaDeEtapa: stageLabel,
  });
  it("dice CUÁNTAS se cambian, en los dos idiomas", () => {
    const q = arma(84);
    expect(q.en).toContain("This changes 84 order(s):");
    expect(q.es).toContain("Se cambian 84 orden(es):");
    expect(q.en).toContain(accion.en);
  });
  it("enseña una muestra, y la corta con puntos cuando hay más", () => {
    expect(arma(3).en).toContain("#1000, #1001, #1002");
    expect(arma(3).en).not.toContain("…");
    const larga = arma(20).en;
    expect(larga).toContain("…");
    expect((larga.match(/#10\d\d/g) ?? []).length).toBe(MUESTRA_DEL_BLOQUE);
  });
  it("dice lo que se salta y por qué, con su cuenta por etapa", () => {
    const q = arma(52, ["delivered", "delivered", "canceled"]);
    expect(q.en).toContain("3 order(s) are skipped: 2 delivered and 1 canceled.");
    expect(q.es).toContain("Se saltan 3 orden(es): 2 entregado y 1 cancelado.");
    expect(q.en).toContain("Open one to change it.");
  });
  it("sin nada que saltar, no se inventa la frase", () => {
    expect(arma(5).en).not.toContain("skipped");
    expect(arma(5).es).not.toContain("saltan");
  });
  it("el número de la pregunta es el de las que ENTRAN, no el de la selección", () => {
    // Es el corazón del incidente: «se cambian 162» cuando 110 no debían cambiar es una pregunta que miente.
    const q = arma(52, Array.from({ length: 110 }, () => "delivered" as Stage));
    expect(q.es).toContain("Se cambian 52 orden(es)");
    expect(q.es).toContain("Se saltan 110 orden(es)");
    expect(q.es).not.toContain("162");
  });
});

describe("el historial guarda de qué valor venía", () => {
  it("una fecha se apunta con el antes y el después", () => {
    expect(changedFieldsNote({ delivery_date: "2026-09-24" }, { delivery_date: "2026-12-25" }))
      .toBe("Changed: Delivery Date: 2026-09-24 → 2026-12-25");
  });
  it("lo vacío se escribe «—», que si no la nota parece rota", () => {
    expect(changedFieldsNote({ assigned_driver: null }, { assigned_driver: "Carlos R." })).toBe("Changed: Assigned Driver: — → Carlos R.");
    expect(changedFieldsNote({ assigned_driver: "Carlos R." }, { assigned_driver: "" })).toBe("Changed: Assigned Driver: Carlos R. → —");
  });
  it("varios campos en una sola nota, separados para que se lean", () => {
    const n = changedFieldsNote({ delivery_date: "2026-09-24", est_pallets: 3 }, { delivery_date: "2026-12-25", est_pallets: 7 });
    expect(n).toBe("Changed: Delivery Date: 2026-09-24 → 2026-12-25 · Est. Pallets: 3 → 7");
  });
  it("el texto libre largo NO trae su valor: solo que cambió", () => {
    const n = changedFieldsNote({ delivery_notes: "lo de siempre" }, { delivery_notes: "otra cosa" });
    expect(n).toBe("Changed: Notes");
    expect(n).not.toContain("otra cosa");
  });
  it("y un valor largo en un campo corto tampoco: se apunta el nombre", () => {
    const largo = "x".repeat(LARGO_DE_VALOR_EN_NOTA + 1);
    expect(changedFieldsNote({ delivery_address: "calle 1" }, { delivery_address: largo })).toBe("Changed: Delivery Address");
    const justo = "y".repeat(LARGO_DE_VALOR_EN_NOTA);
    expect(changedFieldsNote({ delivery_address: "" }, { delivery_address: justo })).toBe(`Changed: Delivery Address: — → ${justo}`);
  });
  it("la nota entera tiene tope, porque no se sabe el tipo de la columna", () => {
    const parche: Record<string, unknown> = {}, antes: Record<string, unknown> = {};
    for (const k of ["store", "account", "contact", "delivery_phone", "po2", "so_num", "invoice_num", "estimate_num", "delivery_name", "assigned_sales_rep"]) {
      antes[k] = "a".repeat(30); parche[k] = "b".repeat(30);
    }
    const n = changedFieldsNote(antes, parche);
    expect(n.length).toBeLessThanOrEqual(LARGO_DE_LA_NOTA);
    expect(n.endsWith("…")).toBe(true);
  });
  it("lo que no cambió o es ruido no ensucia la nota", () => {
    expect(changedFieldsNote({ delivery_date: "2026-09-24" }, { delivery_date: "2026-09-24" })).toBe("");
    expect(changedFieldsNote({ updated_at: "x" }, { updated_at: "y" })).toBe("");
    expect(changedFieldsNote({ delivery_date: "2026-09-24", updated_at: "x" }, { delivery_date: "2026-12-25", updated_at: "y" }))
      .toBe("Changed: Delivery Date: 2026-09-24 → 2026-12-25");
  });
});

describe("la pantalla: elegir y aplicar son dos pasos", () => {
  const pagina = leer("src/app/(app)/page.tsx");
  it("ni la fecha ni el chofer se aplican al elegirlos", () => {
    expect(pagina).toContain('<input type="date" value={fechaEnBloque} disabled={bulkBusy} onChange={(e) => setFechaEnBloque(e.target.value)}');
    expect(pagina).toContain("<select value={choferEnBloque} disabled={bulkBusy} onChange={(e) => setChoferEnBloque(e.target.value)}");
    // Lo que había antes, y que causó el incidente: aplicar dentro del propio onChange.
    expect(pagina).not.toMatch(/onChange=\{\(e\) => \{ if \(e\.target\.value\) bulkSetDate/);
    expect(pagina).not.toMatch(/onChange=\{\(e\) => \{ bulkAssignDriver/);
  });
  it("aplicar es un botón aparte, y solo sale cuando hay algo elegido", () => {
    expect(plano(pagina)).toContain("{(me.role === \"manager\" || me.role === \"admin\" || me.role === \"logistics\") && fechaEnBloque && (");
    expect(plano(pagina)).toContain("{me.role === \"admin\" && choferEnBloque && (");
    expect(plano(pagina)).toContain("onClick={async () => { await bulkSetDate(fechaEnBloque); setFechaEnBloque(\"\"); }}");
    expect(plano(pagina)).toContain("onClick={async () => { await bulkAssignDriver(choferEnBloque); setChoferEnBloque(\"\"); }}");
  });
  it("los dos pasan por la misma puerta, que pregunta y reparte", () => {
    expect(plano(pagina)).toContain("const bulkAssignDriver = (driver: string) => cambioEnBloque(");
    expect(plano(pagina)).toContain("const bulkSetDate = (date: string) => cambioEnBloque(");
    const puerta = pagina.slice(pagina.indexOf("const cambioEnBloque ="), pagina.indexOf("const bulkAssignDriver ="));
    expect(puerta).toContain("const { entran, saltadas } = reparteParaElBloque(chosen);");
    // La pregunta se hace sobre LO QUE ENTRA, no sobre la selección: preguntar por 162 cuando cambian 52 es el incidente.
    expect(plano(puerta)).toContain("preguntaDelBloque({ accion, entran, saltadas,");
    expect(puerta).not.toMatch(/preguntaDelBloque\(\{[^}]*entran: chosen/);
    expect(puerta).toContain("if (!(await confirmAction(");
    expect(puerta).toContain("for (const d of entran) await updateDelivery(d.id, parche);");
    expect(puerta).not.toContain("for (const d of chosen)");           // nunca sobre la selección entera
  });
  it("las otras acciones en bloque no se tocan: tienen su propia regla de etapas", () => {
    for (const otra of ["bulkStage", "bulkMarkDelivered", "bulkOverride"]) {
      expect(pagina, otra).toContain(`const ${otra}`);
      const cuerpo = pagina.slice(pagina.indexOf(`const ${otra}`), pagina.indexOf(`const ${otra}`) + 700);
      expect(cuerpo, otra).not.toContain("reparteParaElBloque");
    }
  });
  it("el demo escribe la MISMA nota que la app, o el historial no se podría mirar ahí", () => {
    const local = leer("src/lib/local-data-provider.tsx");
    expect(local).toContain('events: addEvent(s, id, "edited", antes ? changedFieldsNote(antes, patch as Record<string, unknown>) || undefined : undefined),');
    expect(local).toContain('import { changedFieldsNote, orderOwner, todayISO } from "@/lib/utils";');
  });
});
