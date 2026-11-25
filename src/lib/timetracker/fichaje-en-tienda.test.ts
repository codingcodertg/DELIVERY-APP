import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  tiendasDeLaPersonaEnElPeriodo, tiendasParaCambiar, tiendasQueOfreceElFichaje, validarTiendaDelFichaje, vistaDelCronometro,
} from "./fichaje-en-tienda";
import { debeMontarCronometro } from "./vigia";
import type { PersonaMultiTienda, TiendaElegible } from "./multitienda";

// Francis: presencial, gerente, en varias tiendas (2026-11-25: ya no tiene cronómetro, solo fichaje).
const FRANCIS: PersonaMultiTienda = { workerType: "inhouse", multiStore: true, tienda: null, puesto: "manager" };
const PRESENCIAL_UNA: PersonaMultiTienda = { workerType: "inhouse", multiStore: false, tienda: "Pharr", puesto: "sales" };
const REMOTO: PersonaMultiTienda = { workerType: "remote", multiStore: false };
const REMOTO_CON_CASILLA: PersonaMultiTienda = { workerType: "remote", multiStore: true };

const TIENDAS: TiendaElegible[] = [
  { id: "t-pharr", name: "Pharr", active: true },
  { id: "t-mcallen", name: "McAllen", active: true },
  { id: "t-cerrada", name: "Cerrada", active: false },
];

describe("quién ve el cronómetro (2026-11-25)", () => {
  it("el presencial que no es admin no tiene cronómetro, tenga o no varias tiendas", () => {
    expect(vistaDelCronometro(FRANCIS, false, false)).toBe("solo_fichaje");
    expect(vistaDelCronometro(PRESENCIAL_UNA, false, false)).toBe("solo_fichaje");
  });
  it("si quedó un cronómetro corriendo de antes, solo se puede parar", () => {
    expect(vistaDelCronometro(FRANCIS, false, true)).toBe("solo_parar");
    expect(vistaDelCronometro(PRESENCIAL_UNA, false, true)).toBe("solo_parar");
  });
  it("el remoto conserva el cronómetro como siempre, con o sin casilla", () => {
    expect(vistaDelCronometro(REMOTO, false, false)).toBe("completo");
    expect(vistaDelCronometro(REMOTO_CON_CASILLA, false, true)).toBe("completo");
  });
  it("el admin ve lo de siempre", () => {
    expect(vistaDelCronometro(FRANCIS, true, false)).toBe("completo");
    expect(vistaDelCronometro(null, true, false)).toBe("completo");
  });
  it("sin persona conocida no hay nada que esconder: se trata como el remoto de siempre", () => {
    expect(vistaDelCronometro(null, false, false)).toBe("completo");
  });
});

describe("el montaje del cronómetro para el presencial", () => {
  it("el presencial sin cronómetro vivo no se monta fuera de «Registrar tiempo»", () => {
    expect(debeMontarCronometro({ visible: false, presencial: true, esAdmin: false })).toBe(false);
    expect(debeMontarCronometro({ visible: false, presencial: true, esAdmin: false, hayCronometroVivo: false })).toBe(false);
  });
  it("con un cronómetro vivo de antes sí se monta, para poder pararlo", () => {
    expect(debeMontarCronometro({ visible: false, presencial: true, esAdmin: false, hayCronometroVivo: true })).toBe(true);
  });
  it("en «Registrar tiempo» se monta siempre (ahí pinta el fichaje o el botón de parar)", () => {
    expect(debeMontarCronometro({ visible: true, presencial: true, esAdmin: false })).toBe(true);
  });
  it("el remoto y el admin se montan igual que antes", () => {
    expect(debeMontarCronometro({ visible: false, presencial: false, esAdmin: false })).toBe(true);
    expect(debeMontarCronometro({ visible: false, presencial: true, esAdmin: true })).toBe(true);
  });
});

describe("qué tiendas se ofrecen al fichar", () => {
  it("solo a quien va en varias tiendas, y solo las activas por nombre", () => {
    expect(tiendasQueOfreceElFichaje(FRANCIS, TIENDAS).map((t) => t.name)).toEqual(["McAllen", "Pharr"]);
  });
  it("a los demás no se les ofrece ninguna", () => {
    expect(tiendasQueOfreceElFichaje(PRESENCIAL_UNA, TIENDAS)).toEqual([]);
    expect(tiendasQueOfreceElFichaje(REMOTO_CON_CASILLA, TIENDAS)).toEqual([]);
    expect(tiendasQueOfreceElFichaje(null, TIENDAS)).toEqual([]);
  });
  it("al cambiar de tienda se ofrecen las demás, sin la actual", () => {
    expect(tiendasParaCambiar(FRANCIS, TIENDAS, "t-pharr").map((t) => t.id)).toEqual(["t-mcallen"]);
    expect(tiendasParaCambiar(FRANCIS, TIENDAS, null).map((t) => t.id)).toEqual(["t-mcallen", "t-pharr"]);
  });
});

describe("validarTiendaDelFichaje (lo que manda el servidor)", () => {
  const activas = [{ id: "t-pharr" }, { id: "t-mcallen" }];
  it("quien va en varias tiendas debe mandar una tienda activa de su empresa", () => {
    expect(validarTiendaDelFichaje({ multiStore: true, storeId: "t-pharr", tiendasActivas: activas }))
      .toEqual({ ok: true, storeId: "t-pharr" });
  });
  it("sin tienda, o con una que no es activa de la empresa, se rechaza con su código", () => {
    expect(validarTiendaDelFichaje({ multiStore: true, storeId: null, tiendasActivas: activas }))
      .toEqual({ ok: false, code: "tienda_requerida" });
    expect(validarTiendaDelFichaje({ multiStore: true, storeId: "", tiendasActivas: activas }))
      .toEqual({ ok: false, code: "tienda_requerida" });
    expect(validarTiendaDelFichaje({ multiStore: true, storeId: "t-ajena", tiendasActivas: activas }))
      .toEqual({ ok: false, code: "tienda_no_permitida" });
  });
  it("quien no va en varias tiendas: la tienda que llegue se ignora (null)", () => {
    expect(validarTiendaDelFichaje({ multiStore: false, storeId: "t-pharr", tiendasActivas: activas }))
      .toEqual({ ok: true, storeId: null });
    expect(validarTiendaDelFichaje({ multiStore: false, storeId: undefined, tiendasActivas: activas }))
      .toEqual({ ok: true, storeId: null });
  });
});

describe("tiendas de una persona en el periodo (Nómina)", () => {
  const fichajes = [
    { employee_id: "f", work_store_id: "t-pharr" },
    { employee_id: "f", work_store_id: "t-mcallen" },
    { employee_id: "f", work_store_id: "t-pharr" },
    { employee_id: "f", work_store_id: null },
    { employee_id: "otra", work_store_id: "t-edinburg" },
  ];
  it("las tiendas distintas en las que fichó, sin repetir ni vacías, solo de esa persona", () => {
    expect(tiendasDeLaPersonaEnElPeriodo(fichajes, "f")).toEqual(["t-pharr", "t-mcallen"]);
    expect(tiendasDeLaPersonaEnElPeriodo(fichajes, "otra")).toEqual(["t-edinburg"]);
    expect(tiendasDeLaPersonaEnElPeriodo(fichajes, "nadie")).toEqual([]);
  });
});

describe("cableado: el servidor y el fichaje", () => {
  const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

  it("el cronómetro usa el nuevo criterio y el anfitrión solo monta el vivo", () => {
    const c = leer("src/components/timetracker/Cronometro.tsx");
    expect(c).toContain("vistaDelCronometro(me, esAdmin, running)");
    const a = leer("src/components/timetracker/CronometroAnfitrion.tsx");
    expect(a).toContain("listLiveSessions()");
    expect(a).toContain("hayCronometroVivo: vivoAlEntrar");
  });
});
