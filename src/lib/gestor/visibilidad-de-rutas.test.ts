import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Delivery, NamedLocation } from "@/lib/types";
import {
  alcanceDeChoferes, choferSeVe, choferesConOrden, intertiendaHaciaMiTienda, leeDedicados, ordenesPorChofer, veAlChofer,
} from "@/lib/gestor/choferes-por-tienda";
import { MAPA_INICIAL, alAbrirRutas, alPulsarElMapa, rutasAbiertas } from "@/lib/gestor/mapa-al-abrir-ruta";
import { puedeAbrirLaOrden } from "@/lib/abrir-la-orden";
import { ordenLegible } from "@/lib/gestor/ordenes-de-ruta-de-hoy";
import { registroDeLugar } from "@/lib/named-location";
import { PANEL_SIN_ASIGNAR } from "@/lib/vista-del-gestor";

// D-NEXT, tres pedidos del dueño del 2026-10-13. Nombres inventados: ninguna tienda ni chofer de verdad.

const TIENDAS: NamedLocation[] = [
  { name: "Tienda Norte", address: "", choferes_dedicados: ["Chofer Uno"] },
  { name: "Tienda Sur", address: "" },
  { name: "Tienda Este", address: "" },
];
const REGLAS = { Intertienda: { storeToStore: true, docRef: "any" as const } };
const orden = (o: Partial<Delivery>): Partial<Delivery> => ({ order_type: "Cliente", delivery_name: null, ...o });

describe("A · qué choferes ve cada tienda en «Ruta de hoy»", () => {
  it("la gente de la tienda con dedicados ve SOLO a esos", () => {
    const a = alcanceDeChoferes({ role: "sales", store: "Tienda Norte" }, TIENDAS);
    expect(a.tipo).toBe("solo");
    expect(veAlChofer(a, "Chofer Uno")).toBe(true);
    expect(veAlChofer(a, " chofer  uno ")).toBe(true);
    expect(veAlChofer(a, "Chofer Dos")).toBe(false);
  });
  it("las demás tiendas ven a todos MENOS a los dedicados de otra", () => {
    const a = alcanceDeChoferes({ role: "accounting", store: "Tienda Sur" }, TIENDAS);
    expect(a.tipo).toBe("menos");
    expect(veAlChofer(a, "Chofer Uno")).toBe(false);
    expect(veAlChofer(a, "Chofer Dos")).toBe(true);
  });
  it("gerente, admin y logística ven a todos, sea cual sea su tienda", () => {
    for (const role of ["manager", "admin", "logistics"] as const) {
      expect(alcanceDeChoferes({ role, store: "Tienda Norte" }, TIENDAS).tipo, role).toBe("todos");
      expect(alcanceDeChoferes({ role, store: "Tienda Sur" }, TIENDAS).tipo, role).toBe("todos");
    }
  });
  it("almacén no es excepción: en la tienda con dedicados, solo esos", () => {
    expect(alcanceDeChoferes({ role: "warehouse", store: "Tienda Norte" }, TIENDAS).tipo).toBe("solo");
  });
  it("sin ninguna tienda con dedicados, nadie pierde nada (el caso de partida)", () => {
    const sin = TIENDAS.map((t) => ({ ...t, choferes_dedicados: undefined }));
    expect(alcanceDeChoferes({ role: "sales", store: "Tienda Norte" }, sin).tipo).toBe("todos");
    expect(alcanceDeChoferes({ role: "sales", store: "Tienda Sur" }, sin).tipo).toBe("todos");
  });
  it("sin tienda asignada no se amplía: ve a todos menos a los dedicados", () => {
    const a = alcanceDeChoferes({ role: "sales", store: null }, TIENDAS);
    expect(veAlChofer(a, "Chofer Uno")).toBe(false);
    expect(veAlChofer(a, "Chofer Dos")).toBe(true);
  });
  it("el grupo de tiendas (D-293) se presta choferes: el dedicado de mi grupo no se me esconde", () => {
    const agrupadas: NamedLocation[] = [
      { name: "Tienda Norte", address: "", group: "G1", choferes_dedicados: ["Chofer Uno"] },
      { name: "Tienda Sur", address: "", group: "G1" },
      { name: "Tienda Este", address: "" },
    ];
    expect(veAlChofer(alcanceDeChoferes({ role: "sales", store: "Tienda Sur" }, agrupadas), "Chofer Uno")).toBe(true);
    expect(veAlChofer(alcanceDeChoferes({ role: "sales", store: "Tienda Este" }, agrupadas), "Chofer Uno")).toBe(false);
  });
  it("el sandbox de enseñanza no corta", () => {
    expect(alcanceDeChoferes({ role: "sales", store: "Tienda Sur" }, TIENDAS, { teaching: true }).tipo).toBe("todos");
  });
  it("lo que no va en ningún chofer se ve siempre", () => {
    expect(veAlChofer(alcanceDeChoferes({ role: "sales", store: "Tienda Norte" }, TIENDAS), null)).toBe(true);
  });

  it("la excepción: una Intertienda que ENTRA a mi tienda se ve aunque vaya en un chofer que no veo", () => {
    const yo = { role: "sales" as const, store: "Tienda Sur" };
    const a = alcanceDeChoferes(yo, TIENDAS);
    const ordenes = [
      orden({ id: "1", assigned_driver: "Chofer Uno", order_type: "Intertienda", delivery_name: "Tienda Sur" }),
      orden({ id: "2", assigned_driver: "Chofer Uno", order_type: "Cliente", delivery_name: "Tienda Sur" }),
      orden({ id: "3", assigned_driver: "Chofer Uno", order_type: "Intertienda", delivery_name: "Tienda Este" }),
      orden({ id: "4", assigned_driver: "Chofer Dos" }),
      orden({ id: "5", assigned_driver: null }),
    ];
    const vistas = ordenesPorChofer(ordenes, a, { me: yo, tiendas: TIENDAS, reglas: REGLAS }).map((d) => d.id);
    expect(vistas).toEqual(["1", "4", "5"]);
  });
  it("la excepción vale en las dos direcciones: la tienda con dedicados ve la Intertienda que le llega en otro chofer", () => {
    const yo = { role: "warehouse" as const, store: "Tienda Norte" };
    const a = alcanceDeChoferes(yo, TIENDAS);
    const ordenes = [
      orden({ id: "1", assigned_driver: "Chofer Dos", order_type: "Intertienda", delivery_name: "tienda norte" }),
      orden({ id: "2", assigned_driver: "Chofer Dos" }),
      orden({ id: "3", assigned_driver: "Chofer Uno" }),
    ];
    expect(ordenesPorChofer(ordenes, a, { me: yo, tiendas: TIENDAS, reglas: REGLAS }).map((d) => d.id)).toEqual(["1", "3"]);
  });
  it("la excepción mira el DESTINO (y su grupo), nunca la tienda de origen; sin tienda, ninguna", () => {
    const d = orden({ order_type: "Intertienda", store: "Tienda Sur", delivery_name: "Tienda Este" });
    expect(intertiendaHaciaMiTienda(d, { store: "Tienda Sur" }, TIENDAS, REGLAS)).toBe(false);
    expect(intertiendaHaciaMiTienda(d, { store: "Tienda Este" }, TIENDAS, REGLAS)).toBe(true);
    expect(intertiendaHaciaMiTienda(d, { store: null }, TIENDAS, REGLAS)).toBe(false);
    const grupo: NamedLocation[] = [{ name: "Tienda Sur", address: "", group: "G" }, { name: "Tienda Este", address: "", group: "G" }];
    expect(intertiendaHaciaMiTienda(d, { store: "Tienda Sur" }, grupo, REGLAS)).toBe(true);
  });
  it("una parada que no se lee (sin tipo ni destino) no entra por la excepción", () => {
    expect(intertiendaHaciaMiTienda(orden({ order_type: undefined, delivery_name: undefined }), { store: "Tienda Sur" }, TIENDAS, REGLAS)).toBe(false);
  });
  it("el carril, el camión y el aviso de un chofer escondido salen solo si lleva algo que se pinta", () => {
    const a = alcanceDeChoferes({ role: "sales", store: "Tienda Sur" }, TIENDAS);
    expect(choferSeVe("Chofer Uno", a, new Set())).toBe(false);
    expect(choferSeVe("Chofer Uno", a, choferesConOrden([{ assigned_driver: "Chofer Uno " }]))).toBe(true);
    expect(choferSeVe("Chofer Dos", a, new Set())).toBe(true);
  });
  it("Datos: el texto se parte por comas, sin vacíos ni repetidos, y se guarda en la tienda", () => {
    expect(leeDedicados(" Chofer Uno ,chofer uno,, Chofer  Dos\nChofer Tres;")).toEqual(["Chofer Uno", "Chofer Dos", "Chofer Tres"]);
    const prev: NamedLocation = { name: "Tienda Norte", address: "x", choferes_dedicados: ["Viejo"] };
    expect(registroDeLugar(prev, { ...prev, choferes_dedicados: ["Chofer Uno"] }, { directoryCode: true }).choferes_dedicados).toEqual(["Chofer Uno"]);
    expect("choferes_dedicados" in registroDeLugar(prev, { ...prev, choferes_dedicados: [] }, { directoryCode: true })).toBe(false);
  });
  it("la pantalla acota en el ORIGEN, solo en «Ruta de hoy», y también carriles, camiones y avisos", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8");
    expect(src).toContain("soloLecturaDeclarada && miChofer == null ? alcanceDeChoferes(me, tiendasDeAjustes ?? [], { teaching })");
    expect(src).toContain(": ordenesPorChofer(todasLasDelDia, alcanceChoferes,");
    expect(src).toContain("todos.filter((l) => l.isBucket || seVeElChofer(l.driver))");
    expect(src.match(/todos\.filter\(\(c\) => seVeElChofer\(c\.driver\)\)/g)?.length).toBe(2);
  });
});

describe("B · abrir las rutas de un chofer esconde el mapa", () => {
  it("qué cuenta como abierta: la desplegada en Cuadrícula; en Ancho, las tarjetas abiertas (no «Sin asignar»)", () => {
    expect(rutasAbiertas({ ancho: false, desplegada: "Ana", alternadas: new Set(["Beto"]) })).toEqual(["Ana"]);
    expect(rutasAbiertas({ ancho: false, desplegada: null, alternadas: new Set(["Beto"]) })).toEqual([]);
    expect(rutasAbiertas({ ancho: true, desplegada: "Ana", alternadas: new Set(["Beto", PANEL_SIN_ASIGNAR]) })).toEqual(["Beto"]);
  });
  it("abrir una ruta esconde el mapa", () => {
    const e = alAbrirRutas(MAPA_INICIAL, [], ["Ana"]);
    expect(e.visible).toBe(false);
    expect(e.autoOculto).toBe(true);
  });
  it("el botón de arriba lo vuelve a enseñar, y abrir OTRA ruta en esa vista no se lo pelea", () => {
    const oculto = alAbrirRutas(MAPA_INICIAL, [], ["Ana"]);
    const mostrado = alPulsarElMapa(oculto, true);
    expect(mostrado.visible).toBe(true);
    expect(alAbrirRutas(mostrado, ["Ana"], ["Beto"]).visible).toBe(true);
  });
  it("cerrar todas devuelve el mapa que escondió la regla, y la próxima vez se vuelve a esconder", () => {
    const oculto = alAbrirRutas(MAPA_INICIAL, [], ["Ana"]);
    const cerrado = alAbrirRutas(oculto, ["Ana"], []);
    expect(cerrado.visible).toBe(true);
    const mostradoAMano = alPulsarElMapa(oculto, true);
    const trasCerrar = alAbrirRutas(mostradoAMano, ["Ana"], []);
    expect(alAbrirRutas(trasCerrar, [], ["Ana"]).visible).toBe(false);
  });
  it("si la persona lo escondió ella, cerrar las rutas no se lo enseña", () => {
    const aMano = alPulsarElMapa(MAPA_INICIAL, false);
    const abierta = alAbrirRutas(aMano, [], ["Ana"]);
    expect(alAbrirRutas(abierta, ["Ana"], []).visible).toBe(false);
  });
  it("re-pintar con la misma ruta abierta no cambia nada", () => {
    const mostrado = { visible: true, autoOculto: false, respetar: false };
    expect(alAbrirRutas(mostrado, ["Ana"], ["Ana"])).toBe(mostrado);
  });
  it("la pantalla usa las tres piezas, y el botón de arriba pasa por `alPulsarElMapa`", () => {
    const src = readFileSync(join(process.cwd(), "src/app/(app)/routes/page.tsx"), "utf8");
    expect(src).toContain("const abiertas = miChofer != null ? [] : rutasAbiertas({ ancho: wideRoutes, desplegada, alternadas });");
    expect(src).toContain("setEstadoDelMapa((e) => alAbrirRutas(e, antes, abiertas));");
    expect(src).toContain("onClick={() => setEstadoDelMapa((e) => alPulsarElMapa(e, abiertas.length > 0))}");
    expect(src).not.toContain("setShowTop");
  });
});

describe("C · un vendedor solo abre sus órdenes", () => {
  const ajena = { stage: "approved", created_by: "otro", assigned_sales_rep: "otro" } as Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep">;
  it("ventas: la ajena no se abre", () => {
    expect(puedeAbrirLaOrden({ id: "yo", role: "sales" }, ajena)).toBe(false);
  });
  it("ventas: la suya por vendedor asignado, o la que creó", () => {
    expect(puedeAbrirLaOrden({ id: "yo", role: "sales" }, { ...ajena, assigned_sales_rep: "yo" })).toBe(true);
    expect(puedeAbrirLaOrden({ id: "yo", role: "sales" }, { ...ajena, created_by: "yo" })).toBe(true);
  });
  it("ventas: un borrador ajeno sí se abre (D-286, «que cualquiera pueda volver y editarlo»)", () => {
    expect(puedeAbrirLaOrden({ id: "yo", role: "sales" }, { ...ajena, stage: "draft" })).toBe(true);
  });
  it("los demás roles abren lo que ven; sin `me`, nada; en el sandbox, todo", () => {
    for (const role of ["manager", "accounting", "warehouse", "admin", "logistics"] as const) {
      expect(puedeAbrirLaOrden({ id: "yo", role }, ajena), role).toBe(true);
    }
    expect(puedeAbrirLaOrden(null, ajena)).toBe(false);
    expect(puedeAbrirLaOrden({ id: "yo", role: "sales" }, ajena, { teaching: true })).toBe(true);
  });
  it("«Ruta de hoy» usa la misma regla para pintar el enlace", () => {
    const leidas = [{ id: "x", ...ajena } as Delivery, { id: "y", ...ajena, created_by: "yo" } as Delivery];
    expect(ordenLegible("x", leidas, { id: "yo", role: "sales" })).toBeNull();
    expect(ordenLegible("y", leidas, { id: "yo", role: "sales" })).toBe(leidas[1]);
  });
  it("la puerta está en la ficha que montan TODAS las pantallas", () => {
    const lazy = readFileSync(join(process.cwd(), "src/components/OrderModalLazy.tsx"), "utf8");
    expect(lazy).toContain("props.existing != null && !puedeAbrirLaOrden(props.me, props.existing, { teaching })");
    expect(lazy).toContain("if (cerrada) return null;");
    expect(lazy).toContain("notify(t(AVISO_SOLO_TUS_ORDENES.en, AVISO_SOLO_TUS_ORDENES.es));");
  });
});
