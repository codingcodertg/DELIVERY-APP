import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmacionDelPaso, escribeComenzar, escribeListo, escrituraAlMarcarListo, palletsPropuestas, pasosDeBodega,
  type SetStage,
} from "./pasos-de-bodega";
import { escrituraAlComenzar } from "./confirmar-tarifa";
import { accionesDeLaFicha } from "./acciones-de-la-ficha";
import { columnaExtraTras } from "./orden-de-columnas";
import type { OrderTypeRule, Stage, UserRole } from "./types";

/**
 * «Siguiente paso» en la fila de Almacén (D-551). El dueño, 2026-10-14: «It would be easier if changing the stage for
 * warehouse was a dropdown as a next column instead of having to open the orders one by one».
 *
 * Se IMPORTAN las funciones que deciden y las que escriben; el fuente solo se lee al final, para ver que la página y la
 * ficha pasan por ellas. Datos inventados; las reglas de tipo son las del demo, la forma que tienen en Ajustes.
 */

const REGLAS: Record<string, OrderTypeRule> = {
  Customer: { storeToStore: false, docRef: "invoice" },
  Intertienda: { storeToStore: true, docRef: "any", homeIsDestination: true },
  Transfer: { storeToStore: true, docRef: "estimate" },
};

const yo = (role: UserRole, permissions: string[] = []) => ({ id: "u-1", role, full_name: "Persona Prueba", permissions });
const orden = (stage: Stage, order_type = "Customer") => ({
  stage, order_type, created_by: "u-otro", assigned_sales_rep: null, assigned_driver: null, store: "Tienda A",
});
const ids = (role: UserRole, stage: Stage, tipo = "Customer") => pasosDeBodega(yo(role), orden(stage, tipo), REGLAS).map((p) => p.id);

const ETAPAS: Stage[] = ["draft", "pending", "rejected", "approved", "fulfilling", "ready", "picked_up", "delivered", "canceled"];
const ROLES: UserRole[] = ["admin", "manager", "sales", "warehouse", "driver", "logistics", "accounting"];

describe("qué pasos ofrece la fila", () => {
  it("almacén: «Comenzar» en aprobada y «Marcar listo» en preparando, y nada más en ninguna etapa", () => {
    const porEtapa = Object.fromEntries(ETAPAS.map((s) => [s, ids("warehouse", s)]));
    expect(porEtapa).toEqual({
      draft: [], pending: [], rejected: [], approved: ["comenzar"], fulfilling: ["marcar_listo"],
      // En lista la ficha le da «Recoger» y en reparto «Marcar entregado»: esos se quedan en la ficha.
      ready: [], picked_up: [], delivered: [], canceled: [],
    });
  });
  it("cada paso lleva a su etapa y con el texto del botón de la ficha", () => {
    const [comenzar] = pasosDeBodega(yo("warehouse"), orden("approved"), REGLAS);
    expect(comenzar).toMatchObject({ id: "comenzar", destino: "fulfilling", texto: { en: "Start preparing", es: "Comenzar preparación" } });
    const [listo] = pasosDeBodega(yo("warehouse"), orden("fulfilling"), REGLAS);
    expect(listo).toMatchObject({ id: "marcar_listo", destino: "ready", texto: { en: "Mark ready", es: "Marcar listo" } });
  });
  it("el gerente que hace bodega (D-397) y el admin, igual que en la ficha; ventas, chofer, logística y oficina, nada", () => {
    expect([ids("manager", "approved"), ids("manager", "fulfilling")]).toEqual([["comenzar"], ["marcar_listo"]]);
    expect([ids("admin", "approved"), ids("admin", "fulfilling")]).toEqual([["comenzar"], ["marcar_listo"]]);
    for (const r of ["sales", "driver", "logistics", "accounting"] as UserRole[]) {
      expect([ids(r, "approved"), ids(r, "fulfilling")], r).toEqual([[], []]);
    }
  });
  it("quien tiene `fulfill` dado a mano lo tiene también aquí, como en la ficha", () => {
    expect(pasosDeBodega(yo("sales", ["fulfill"]), orden("approved"), REGLAS).map((p) => p.id)).toEqual(["comenzar"]);
  });
  it("es lo que la ficha ofrece, en cada rol y cada etapa: ni un paso de bodega más ni uno menos", () => {
    for (const role of ROLES) {
      for (const stage of ETAPAS) {
        const fa = accionesDeLaFicha({
          yo: yo(role), pedido: orden(stage), edicion: "nada", etapaDeEnvio: "pending", puedeRecibirla: false,
          deshaceAqui: false, borraAqui: false, ocupado: false, salidaEn: null, llegadaEn: null,
          abierto: { anular: false, rechazar: false, recoger: false, dejar: false, pod: false, motivoDeSalto: false, reentrega: false },
        });
        const deLaFicha = [...(fa.principal ? [fa.principal] : []), ...fa.menu]
          .map((a) => a.id).filter((id) => id === "comenzar" || id === "marcar_listo");
        expect(ids(role, stage), `${role} en ${stage}`).toEqual(deLaFicha);
      }
    }
  });
});

describe("qué confirma cada paso antes de escribir", () => {
  it("«Comenzar» confirma la tarifa en una Customer (D-450)", () => {
    expect(pasosDeBodega(yo("warehouse"), orden("approved", "Customer"), REGLAS)[0].confirmacion).toBe("tarifa");
  });
  it("«Comenzar» en una Intertienda o un Transfer no confirma nada: se escribe al elegirlo", () => {
    expect(pasosDeBodega(yo("warehouse"), orden("approved", "Intertienda"), REGLAS)[0].confirmacion).toBeNull();
    expect(pasosDeBodega(yo("warehouse"), orden("approved", "Transfer"), REGLAS)[0].confirmacion).toBeNull();
  });
  it("«Marcar listo» confirma SIEMPRE los pallets, también en una Intertienda", () => {
    expect(confirmacionDelPaso("marcar_listo", { order_type: "Intertienda" }, REGLAS)).toBe("pallets");
    expect(confirmacionDelPaso("marcar_listo", { order_type: "Customer" }, REGLAS)).toBe("pallets");
    expect(pasosDeBodega(yo("warehouse"), orden("fulfilling", "Transfer"), REGLAS)[0].confirmacion).toBe("pallets");
  });
});

describe("los pallets de «Marcar listo»", () => {
  it("el campo abre con el real si lo hay, si no con el estimado, si no vacío", () => {
    expect(palletsPropuestas({ actual_pallets: 4, est_pallets: 6 })).toBe("4");
    expect(palletsPropuestas({ actual_pallets: null, est_pallets: 6 })).toBe("6");
    expect(palletsPropuestas({ actual_pallets: null, est_pallets: null })).toBe("");
  });
  it("marcar listo escribe solo el real, con «Pallets confirmed: N»", () => {
    const e = escrituraAlMarcarListo("5");
    expect(e).toEqual({
      pallets: 5,
      extra: { actual_pallets: 5 },
      nota: { en: "Pallets confirmed: 5", es: "Pallets confirmadas: 5" },
      aviso: { en: "Ready — 5 pallets confirmed", es: "Listo — 5 pallets confirmadas" },
    });
    expect(Object.keys(e!.extra)).toEqual(["actual_pallets"]);
  });
  it("acepta decimales, y no acepta vacío, cero, negativo ni texto", () => {
    expect(escrituraAlMarcarListo("2.5")?.pallets).toBe(2.5);
    expect(["", "0", "-2", "abc"].map(escrituraAlMarcarListo)).toEqual([null, null, null, null]);
  });
});

describe("lo que escriben: la ficha y la fila llaman a esto", () => {
  const graba = () => {
    const llamadas: unknown[][] = [];
    const setStage: SetStage = async (...a) => { llamadas.push(a); return true; };
    return { llamadas, setStage };
  };
  const en = (e: string) => e;

  it("«Comenzar» sin confirmación mueve la etapa sin nota ni tarifa (lo que hacía `move(\"fulfilling\")`)", async () => {
    const { llamadas, setStage } = graba();
    expect(await escribeComenzar(setStage, "o-1", null, en)).toBe(true);
    expect(llamadas).toEqual([["o-1", "fulfilling"]]);
  });
  it("«Comenzar» confirmando el monto: la nota «Fee confirmed», sin tocar la tarifa", async () => {
    const { llamadas, setStage } = graba();
    await escribeComenzar(setStage, "o-1", escrituraAlComenzar(100, 100), en);
    expect(llamadas).toEqual([["o-1", "fulfilling", "Fee confirmed $100.00", undefined]]);
  });
  it("«Comenzar» corrigiendo: la tarifa nueva en la MISMA escritura, con el rastro de D-372", async () => {
    const { llamadas, setStage } = graba();
    await escribeComenzar(setStage, "o-1", escrituraAlComenzar(126, 80), en);
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0][1]).toBe("fulfilling");
    expect(llamadas[0][2]).toContain("Fee corrected");
    expect(llamadas[0][2]).toContain("126 → 80");
    expect(llamadas[0][3]).toEqual({ delivery_fee: 80 });
  });
  it("«Comenzar» sin tarifa: no escribe tarifa, y lo anota", async () => {
    const { llamadas, setStage } = graba();
    await escribeComenzar(setStage, "o-1", escrituraAlComenzar(null, null, true), en);
    expect(llamadas).toEqual([["o-1", "fulfilling", "No fee — started without a delivery fee charged", undefined]]);
  });
  it("«Marcar listo»: la etapa y `actual_pallets` en una escritura, con la nota en el idioma de quien la da", async () => {
    const { llamadas, setStage } = graba();
    await escribeListo(setStage, "o-2", escrituraAlMarcarListo("5")!, (_en, es) => es);
    expect(llamadas).toEqual([["o-2", "ready", "Pallets confirmadas: 5", { actual_pallets: 5 }]]);
  });
});

describe("la columna va al lado de la etapa", () => {
  it("tras «stage» si se ve; si no, al final; sin columna, en ninguna parte", () => {
    expect(columnaExtraTras(["__id", "po", "stage", "date"], "stage")).toBe(2);
    expect(columnaExtraTras(["__id", "po", "date"], "stage")).toBe(2);
    expect(columnaExtraTras(["__id", "po", "date"], undefined)).toBe(-1);
  });
});

describe("la página y la ficha pasan por aquí", () => {
  const leer = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8").replace(/\s+/g, " ");
  const pagina = leer("src/app/(app)/warehouse/page.tsx");
  const fila = leer("src/components/SiguientePasoDeBodega.tsx");
  const ficha = leer("src/components/OrderModal.tsx");
  const tabla = leer("src/components/OrdersTable.tsx");

  it("Almacén pone la columna, tras «Etapa», en la Cola y en Recepción, y pinta el diálogo", () => {
    expect(pagina).toContain("const pasoEnLaFila = usePasoEnLaFila();");
    expect(pagina).toContain('despuesDe: "stage"');
    expect(pagina.split("columnaExtra={columnaSiguientePaso}").length - 1).toBe(2);
    expect(pagina).toContain("{pasoEnLaFila.dialogo}");
  });
  it("la celda pregunta a `pasosDeBodega`, y si el paso confirma abre el diálogo en vez de escribir", () => {
    expect(fila).toContain("const pasos = pasosDeBodega(me, d, settings.order_type_rules);");
    expect(fila).toContain("if (paso.confirmacion) { setAbierto({ pedido, paso }); return; }");
    expect(fila).toContain("escribeComenzar(setStage, pedido.id, null, t)");
  });
  it("los diálogos de la fila son los de la ficha, y escriben con las mismas funciones", () => {
    expect(fila).toContain('paso.confirmacion === "tarifa" ? ( <ConfirmarTarifaAlComenzar');
    expect(fila).toContain("escribeComenzar(setStage, pedido.id, escritura, t)");
    expect(fila).toContain("<ConfirmarPallets");
    // El campo de pallets abre con el número de `palletsPropuestas`, como abría en la ficha.
    expect(leer("src/components/ConfirmarPallets.tsx")).toContain("useState(() => palletsPropuestas(pedido))");
    expect(fila).toContain("escribeListo(setStage, pedido.id, escritura, t)");
    expect(ficha).toContain("<ConfirmarTarifaAlComenzar pedido={existing}");
    expect(ficha).toContain("<ConfirmarPallets pedido={existing}");
    expect(ficha).toContain("escribeComenzar(setStage, existing.id, escritura, t)");
    expect(ficha).toContain("escribeListo(setStage, existing.id, escritura, t)");
  });
  it("tocar la celda no abre la orden", () => {
    expect(tabla).toContain("<td key={columnaExtra.key} data-label={lang === \"es\" ? columnaExtra.es : columnaExtra.en} onClick={(e) => e.stopPropagation()}>");
  });
});
