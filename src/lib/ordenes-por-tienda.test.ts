import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { alcanceDeLaLista, leTocaPorRol, ordenesVisibles, type ContextoDeLista } from "./ordenes-visibles";
import { cuentasDeOrdenes, filasDeOrdenes } from "./filas-de-ordenes";
import { PASTILLA_TODAS } from "./pastillas-de-ordenes";
import { PESTANA_ATRASADAS } from "./atrasadas";
import { PESTANA_DOCUMENTO_PENDIENTE } from "./documento-pendiente";
import { mkDelivery } from "./__fixtures";
import { seesAllHistory, shiftDateISO, todayISO } from "./utils";
import type { OrderTypeRules } from "./required";
import type { Delivery, NamedLocation, UserRole } from "./types";

/**
 * Órdenes cortada por la tienda de quien mira (D-405).
 *
 * El dueño, 2026-09-26: *«solo pueden buscar en el search bar, solo puede buscar órdenes de ellos
 * mismos de su propia tienda»* (eligió «Solo su tienda»), y el mismo día *«y office manager, sales solo
 * pueden ver su propia tienda»*. Queda:
 *
 * - gerente y ventas: toda la lista, siempre, su tienda y su grupo; ventas además solo lo suyo;
 * - los demás (office, almacén): solo al buscar;
 * - admin y logística: todo;
 * - sin tienda, donde hay corte: ninguna, con aviso.
 *
 * Los nombres de tienda y de tipo son inventados: los de verdad son datos del dueño (Ajustes).
 */

const HOY = todayISO();
const AYER = shiftDateISO(HOY, -1);
const HACE_VEINTE = shiftDateISO(HOY, -20);

const REGLAS: OrderTypeRules = { ConFactura: { docRef: "invoice" }, Entre: { storeToStore: true } };
// «Norte» y «Oeste» trabajan juntas (mismo grupo); «Sur» va sola.
const TIENDAS: NamedLocation[] = [
  { name: "Norte", group: "G1" },
  { name: "Oeste", group: "G1" },
  { name: "Sur" },
] as NamedLocation[];

const YO = "u-yo";
const OTRO = "u-otro";
const ids = (l: readonly Delivery[]) => l.map((d) => d.id).sort();

/** De hoy, aprobada, de quien mira salvo que se diga: a ventas solo la separa la tienda. */
const orden = (id: string, store: string, over: Partial<Delivery> = {}) => mkDelivery({
  id, stage: "approved", order_type: "ConFactura", invoice_num: `INV-${id}`, delivery_date: HOY,
  store, created_by: YO, assigned_sales_rep: YO, ...over,
});

// Desordenadas a propósito: la de otra tienda va la primera.
const TRES = [orden("sur", "Sur"), orden("norte", "Norte"), orden("oeste", "Oeste")];

const ctxDe = (role: UserRole, store: string | null, over: Partial<ContextoDeLista> = {}): ContextoDeLista => ({
  me: { id: YO, role, store },
  teaching: false,
  veTodoElHistorial: seesAllHistory(role),
  busqueda: "",
  reglas: REGLAS,
  tiendas: TIENDAS,
  tiendasDeAlmacen: [],
  ...over,
});

const busca = (c: ContextoDeLista, texto: string): ContextoDeLista => ({ ...c, busqueda: texto });
const visibles = (c: ContextoDeLista, datos: readonly Delivery[] = TRES) => ids(ordenesVisibles(datos, c).visibles);
/** Lo que encuentra tecleando la factura de cada una, por separado, como en el navegador. */
const encuentra = (c: ContextoDeLista, datos: readonly Delivery[] = TRES) =>
  datos.filter((d) => ordenesVisibles(datos, busca(c, d.invoice_num ?? "")).visibles.some((v) => v.id === d.id)).map((d) => d.id).sort();

describe("gerente y ventas: toda la lista, su tienda y su grupo", () => {
  for (const role of ["manager", "sales"] as const) {
    it(`${role} de Norte, sin buscar: Norte y Oeste (su grupo), nunca Sur`, () => {
      expect(visibles(ctxDe(role, "Norte"))).toEqual(["norte", "oeste"]);
    });

    it(`${role} de Norte, buscando por factura: encuentra Norte y Oeste, no Sur`, () => {
      expect(encuentra(ctxDe(role, "Norte"))).toEqual(["norte", "oeste"]);
    });

    it(`${role} de Sur (va sola): solo Sur`, () => {
      expect(visibles(ctxDe(role, "Sur"))).toEqual(["sur"]);
    });

    it(`${role}: las pastillas cuentan lo mismo que enseñan («Todas», la etapa, «Outdated», «Factura pendiente»)`, () => {
      const datos = [
        ...TRES,
        orden("sur-ayer", "Sur", { delivery_date: AYER }),
        orden("norte-ayer", "Norte", { delivery_date: AYER }),
        // De AYER desde D-NEXT (antes, de hace 20 días): «Factura pendiente» ya solo lleva de ayer en adelante.
        orden("sur-pend", "Sur", { stage: "delivered", invoice_num: null, delivery_date: AYER }),
        orden("norte-pend", "Norte", { stage: "delivered", invoice_num: null, delivery_date: AYER }),
        // Y una de hace 20 días, para que lo de arriba no pase por no tener nada viejo delante.
        orden("norte-pend-vieja", "Norte", { stage: "delivered", invoice_num: null, delivery_date: HACE_VEINTE }),
      ];
      const listas = ordenesVisibles(datos, ctxDe(role, "Norte"));
      const cuentas = cuentasDeOrdenes(listas, PASTILLA_TODAS, () => true, REGLAS);
      const filas = (p: string) => ids(filasDeOrdenes(listas, p, () => true, REGLAS));
      // Hasta D-NEXT «Todas» era ["norte", "oeste"]: la atrasada de ayer solo estaba en «Outdated»
      // (D-404). El dueño, 2026-09-26 por la tarde: *«outdated que también salga en all»*.
      expect(filas(PASTILLA_TODAS)).toEqual(["norte", "norte-ayer", "norte-pend", "oeste"]);
      expect(cuentas[PASTILLA_TODAS]).toBe(4);
      expect(cuentas.approved).toBe(3);
      expect(filas("approved")).toEqual(["norte", "norte-ayer", "oeste"]);
      expect(filas(PESTANA_ATRASADAS)).toEqual(["norte-ayer"]);
      expect(cuentas[PESTANA_ATRASADAS]).toBe(1);
      expect(filas(PESTANA_DOCUMENTO_PENDIENTE)).toEqual(["norte-pend"]);
      expect(cuentas[PESTANA_DOCUMENTO_PENDIENTE]).toBe(1);
    });
  }

  it("ventas: la suya de otra tienda ya no sale, ni sin buscar ni buscando (revierte la parte de D-374)", () => {
    const c = ctxDe("sales", "Norte");
    // Control: por rol le toca, porque es suya. Lo único que la quita es la tienda.
    expect(leTocaPorRol(TRES[0], c)).toBe(true);
    expect(visibles(c)).not.toContain("sur");
    expect(encuentra(c)).not.toContain("sur");
  });

  it("ventas: dentro de su tienda, solo las suyas (D-374 sigue)", () => {
    const deOtro = orden("norte-otro", "Norte", { created_by: OTRO, assigned_sales_rep: OTRO });
    const asignada = orden("norte-asignada", "Norte", { created_by: OTRO, assigned_sales_rep: YO });
    const datos = [...TRES, deOtro, asignada];
    expect(visibles(ctxDe("sales", "Norte"), datos)).toEqual(["norte", "norte-asignada", "oeste"]);
    expect(encuentra(ctxDe("sales", "Norte"), datos)).toEqual(["norte", "norte-asignada", "oeste"]);
  });

  it("ventas: el borrador de otro lo sigue viendo (D-286), pero solo el de su tienda", () => {
    const borradorNorte = orden("borr-norte", "Norte", { stage: "draft", created_by: OTRO, assigned_sales_rep: OTRO });
    const borradorSur = orden("borr-sur", "Sur", { stage: "draft", created_by: OTRO, assigned_sales_rep: OTRO });
    expect(visibles(ctxDe("sales", "Norte"), [borradorNorte, borradorSur])).toEqual(["borr-norte"]);
  });

  it("gerente: la de otro vendedor de su tienda sí (el corte «solo lo suyo» es de ventas)", () => {
    const deOtro = orden("norte-otro", "Norte", { created_by: OTRO, assigned_sales_rep: OTRO });
    expect(visibles(ctxDe("manager", "Norte"), [...TRES, deOtro])).toEqual(["norte", "norte-otro", "oeste"]);
  });
});

describe("una Intertienda es de las dos tiendas (D-309)", () => {
  const entre = orden("entre", "Sur", { order_type: "Entre", pickup_name: "Sur", delivery_name: "Norte" });

  it("gerente de Norte (destino) y gerente de Sur (origen) la ven los dos", () => {
    expect(visibles(ctxDe("manager", "Norte"), [entre])).toEqual(["entre"]);
    expect(visibles(ctxDe("manager", "Sur"), [entre])).toEqual(["entre"]);
  });

  it("…y también la de su grupo: gerente de Oeste", () => {
    expect(visibles(ctxDe("manager", "Oeste"), [entre])).toEqual(["entre"]);
  });

  it("control: una orden de cliente de Sur NO la ve el gerente de Norte (solo cuenta `store`)", () => {
    const cliente = orden("cli-sur", "Sur", { delivery_name: "Norte" });
    expect(visibles(ctxDe("manager", "Norte"), [cliente])).toEqual([]);
  });
});

describe("office: solo al buscar", () => {
  it("office de Norte, sin buscar: la lista no cambia, también Sur", () => {
    expect(visibles(ctxDe("accounting", "Norte"))).toEqual(["norte", "oeste", "sur"]);
  });

  it("office de Norte, buscando por factura: Norte y Oeste, no Sur", () => {
    expect(encuentra(ctxDe("accounting", "Norte"))).toEqual(["norte", "oeste"]);
  });

  it("buscando, la atrasada que D-404 deja salir en la normal pasa también por el corte", () => {
    const surAyer = orden("sur-ayer", "Sur", { delivery_date: AYER });
    const norteAyer = orden("norte-ayer", "Norte", { delivery_date: AYER });
    expect(encuentra(ctxDe("accounting", "Norte"), [surAyer, norteAyer])).toEqual(["norte-ayer"]);
    // Control: sin buscar, office la ve en «Outdated» (la lista no se corta sin buscar).
    expect(ids(ordenesVisibles([surAyer, norteAyer], ctxDe("accounting", "Norte")).atrasadas)).toEqual(["norte-ayer", "sur-ayer"]);
  });

  it("una búsqueda solo de espacios no es buscar", () => {
    expect(visibles(busca(ctxDe("accounting", "Norte"), "   "))).toEqual(["norte", "oeste", "sur"]);
  });
});

describe("almacén: no cambia nada si tiene tienda", () => {
  it("almacén de Norte encuentra buscando lo mismo que ya veía sin buscar", () => {
    const c = ctxDe("warehouse", "Norte", { tiendasDeAlmacen: ["norte", "oeste"] });
    expect(visibles(c)).toEqual(["norte", "oeste"]);
    expect(encuentra(c)).toEqual(["norte", "oeste"]);
  });
});

describe("admin y logística: todo, busquen o no", () => {
  for (const role of ["admin", "logistics"] as const) {
    it(`${role}, con tienda o sin ella: las tres, y las encuentra por factura`, () => {
      for (const store of [null, "Norte"]) {
        expect(visibles(ctxDe(role, store))).toEqual(["norte", "oeste", "sur"]);
        expect(encuentra(ctxDe(role, store))).toEqual(["norte", "oeste", "sur"]);
      }
    });
  }

  it("el sandbox de enseñanza no tiene cortes, tampoco este", () => {
    const c = ctxDe("manager", null, { teaching: true });
    expect(visibles(c)).toEqual(["norte", "oeste", "sur"]);
    expect(alcanceDeLaLista(busca(c, "INV"))).toEqual({ tipo: "todas" });
  });
});

describe("sin tienda: ninguna, y la pantalla lo sabe por el mismo valor", () => {
  for (const role of ["manager", "sales"] as const) {
    it(`${role} sin tienda: ninguna orden, sin buscar y buscando, y alcance «sin-tienda»`, () => {
      const c = ctxDe(role, null);
      const l = ordenesVisibles(TRES, c);
      expect([l.visibles, l.atrasadas, l.conPendientes].flat()).toEqual([]);
      expect(encuentra(c)).toEqual([]);
      expect(l.alcanceLista).toEqual({ tipo: "sin-tienda" });
    });
  }

  it("office sin tienda: sin buscar lo ve todo; buscando, nada, y el alcance lo dice", () => {
    const c = ctxDe("accounting", null);
    expect(visibles(c)).toEqual(["norte", "oeste", "sur"]);
    expect(ordenesVisibles(TRES, c).alcanceLista).toEqual({ tipo: "todas" });
    expect(encuentra(c)).toEqual([]);
    expect(ordenesVisibles(TRES, busca(c, "INV")).alcanceLista).toEqual({ tipo: "sin-tienda" });
  });

  it("`alcanceDeLaLista` es el que devuelve `ordenesVisibles`", () => {
    const c = ctxDe("manager", "Norte");
    expect(ordenesVisibles([], c).alcanceLista).toEqual(alcanceDeLaLista(c));
    expect(alcanceDeLaLista(c)).toMatchObject({ tipo: "tiendas", normalizadas: ["norte", "oeste"] });
  });

  it("la pantalla pinta el aviso con `alcanceLista`, el que cortó la lista", () => {
    const plana = readFileSync("src/app/(app)/page.tsx", "utf8").replace(/\s+/g, " ");
    expect(plana).toContain("const { visibles: visible, conPendientes, atrasadas, alcancePendientes, alcanceLista } = useMemo(");
    expect(plana).toContain('{alcanceLista.tipo === "sin-tienda" && ( <div className="card" data-ordenes-sin-tienda');
    // Buscando dice «la búsqueda»; sin buscar (gerente y ventas), «Órdenes». En ese orden.
    expect(plana).toContain('🏬 {q.trim() ? t("No store assigned: the search finds only your store\'s orders.');
    expect(plana).toContain("Sin tienda asignada: la búsqueda encuentra solo órdenes de su tienda.");
    expect(plana).toContain("Sin tienda asignada: Órdenes enseña solo las órdenes de su tienda.");
  });
});
