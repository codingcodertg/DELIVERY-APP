import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  camposDeLugar, claveTiendaDelDia, errorDeInicioEnTienda, esMultiTienda, selectorDeProyecto, tiendaDelDiaDesde,
  tiendasParaElegir, validarProyectoEnSolicitud, valorTiendaDelDia, type PersonaMultiTienda, type TiendaElegible,
} from "./multitienda";
import { nombreDeSesion } from "./tienda-y-puesto";
import { DICT } from "./i18n";

// Francis: presencial, gerente, trabaja en McAllen, Pharr, Edinburg. Su caso es el que motiva esto (316).
const FRANCIS: PersonaMultiTienda = { workerType: "inhouse", multiStore: true, tienda: "Pharr", puesto: "manager" };
const PRESENCIAL_UNA_TIENDA: PersonaMultiTienda = { workerType: "inhouse", multiStore: false, tienda: "Pharr", puesto: "sales" };
const REMOTO_CON_CASILLA: PersonaMultiTienda = { workerType: "remote", multiStore: true, tienda: null, puesto: null };
const REMOTO: PersonaMultiTienda = { workerType: "remote", multiStore: false };

const TIENDAS: TiendaElegible[] = [
  { id: "t-pharr", name: "Pharr", active: true },
  { id: "t-mcallen", name: "McAllen", active: true },
  { id: "t-edinburg", name: "Edinburg", active: true },
  { id: "t-cerrada", name: "Cerrada", active: false },
];

describe("esMultiTienda y el selector", () => {
  it("solo el presencial con la casilla puesta va en varias tiendas", () => {
    expect(esMultiTienda(FRANCIS)).toBe(true);
    expect(esMultiTienda(PRESENCIAL_UNA_TIENDA)).toBe(false);
    expect(esMultiTienda(REMOTO_CON_CASILLA)).toBe(false);
    expect(esMultiTienda(null)).toBe(false);
    expect(esMultiTienda(undefined)).toBe(false);
  });

  it("sin tipo elegido cuenta el defecto de la empresa (remoto): la casilla sola no basta", () => {
    expect(esMultiTienda({ workerType: null, multiStore: true })).toBe(false);
  });

  it("el desplegable de tiendas reemplaza a los proyectos solo en el caso multitienda", () => {
    expect(selectorDeProyecto(FRANCIS)).toBe("tienda");
    expect(selectorDeProyecto(PRESENCIAL_UNA_TIENDA)).toBe("proyectos");
    expect(selectorDeProyecto(REMOTO)).toBe("proyectos");
  });
});

describe("tiendasParaElegir", () => {
  it("solo las activas, por nombre", () => {
    expect(tiendasParaElegir(TIENDAS).map((t) => t.name)).toEqual(["Edinburg", "McAllen", "Pharr"]);
  });

  it("sin lista no revienta", () => {
    expect(tiendasParaElegir(null)).toEqual([]);
    expect(tiendasParaElegir(undefined)).toEqual([]);
  });
});

describe("la tienda del día", () => {
  it("la clave es por persona", () => {
    expect(claveTiendaDelDia("abc")).toBe("tt_storeDay_abc");
  });

  it("se recuerda el mismo día", () => {
    const raw = valorTiendaDelDia("2026-11-17", "t-pharr");
    expect(tiendaDelDiaDesde(raw, "2026-11-17")).toBe("t-pharr");
  });

  it("otro día no se arrastra", () => {
    const raw = valorTiendaDelDia("2026-11-16", "t-pharr");
    expect(tiendaDelDiaDesde(raw, "2026-11-17")).toBeNull();
  });

  it("basura o vacío es no tener ninguna", () => {
    expect(tiendaDelDiaDesde(null, "2026-11-17")).toBeNull();
    expect(tiendaDelDiaDesde("", "2026-11-17")).toBeNull();
    expect(tiendaDelDiaDesde("{no es json", "2026-11-17")).toBeNull();
    expect(tiendaDelDiaDesde(JSON.stringify({ fecha: "2026-11-17" }), "2026-11-17")).toBeNull();
  });
});

describe("arrancar en tienda", () => {
  it("Francis no arranca sin tienda", () => {
    expect(errorDeInicioEnTienda(FRANCIS, "", TIENDAS)).toBe("sin_tienda");
    expect(errorDeInicioEnTienda(FRANCIS, null, TIENDAS)).toBe("sin_tienda");
  });

  it("Francis arranca con una tienda activa", () => {
    expect(errorDeInicioEnTienda(FRANCIS, "t-mcallen", TIENDAS)).toBeNull();
  });

  it("una tienda desactivada o que ya no existe cuenta como no elegida", () => {
    expect(errorDeInicioEnTienda(FRANCIS, "t-cerrada", TIENDAS)).toBe("sin_tienda");
    expect(errorDeInicioEnTienda(FRANCIS, "t-borrada", TIENDAS)).toBe("sin_tienda");
  });

  it("sin lista cargada no bloquea por la tienda elegida", () => {
    expect(errorDeInicioEnTienda(FRANCIS, "t-mcallen", [])).toBeNull();
  });

  it("el remoto y el presencial de una sola tienda arrancan como siempre", () => {
    expect(errorDeInicioEnTienda(REMOTO, "", TIENDAS)).toBeNull();
    expect(errorDeInicioEnTienda(PRESENCIAL_UNA_TIENDA, "", TIENDAS)).toBeNull();
    expect(errorDeInicioEnTienda(REMOTO_CON_CASILLA, "", TIENDAS)).toBeNull();
  });
});

describe("campos de lugar de la sesión o la solicitud", () => {
  it("Francis va con su tienda y sin proyecto, aunque quedara un proyecto seleccionado", () => {
    expect(camposDeLugar(FRANCIS, "t-mcallen", { id: "a1", projectId: "p1" })).toEqual({
      storeId: "t-mcallen", projectId: null, assignmentId: null,
    });
  });

  it("Francis sin tienda elegida va con storeId null (la solicitud lo deja opcional)", () => {
    expect(camposDeLugar(FRANCIS, "", null)).toEqual({ storeId: null, projectId: null, assignmentId: null });
  });

  it("el remoto va con su proyecto y sin tienda, como siempre", () => {
    expect(camposDeLugar(REMOTO, "t-mcallen", { id: "a1", projectId: "p1" })).toEqual({
      storeId: null, projectId: "p1", assignmentId: "a1",
    });
    expect(camposDeLugar(REMOTO, "", null)).toEqual({ storeId: null, projectId: null, assignmentId: null });
  });

  it("el presencial de una sola tienda conserva su proyecto si lo tuviera", () => {
    expect(camposDeLugar(PRESENCIAL_UNA_TIENDA, "", { id: "a2", projectId: "p2" })).toEqual({
      storeId: null, projectId: "p2", assignmentId: "a2",
    });
  });
});

describe("validar proyecto en una solicitud", () => {
  it("Francis puede pedir sin proyecto ni tienda: no se le bloquea", () => {
    expect(validarProyectoEnSolicitud(FRANCIS, null)).toBeNull();
    expect(validarProyectoEnSolicitud(FRANCIS, "")).toBeNull();
  });

  it("el presencial de una sola tienda tampoco se bloquea", () => {
    expect(validarProyectoEnSolicitud(PRESENCIAL_UNA_TIENDA, null)).toBeNull();
  });

  it("el remoto sin proyecto sí se bloquea, como antes", () => {
    expect(validarProyectoEnSolicitud(REMOTO, null)).toBe("elige_proyecto");
    expect(validarProyectoEnSolicitud(REMOTO, "a1")).toBeNull();
  });
});

describe("nombre de la sesión con tienda (316)", () => {
  const etiquetas = { sinProyecto: "Sin proyecto", eliminado: "(eliminado)" };

  it("una sesión de tienda sin proyecto sale como «<Tienda> · <puesto>»", () => {
    expect(nombreDeSesion(null, null, FRANCIS, "es", etiquetas, "McAllen")).toBe("McAllen · Gerente");
    expect(nombreDeSesion(null, null, FRANCIS, "en", etiquetas, "McAllen")).toBe("McAllen · Manager");
  });

  it("la tienda de la sesión gana a la de la persona, que puede haber cambiado", () => {
    expect(nombreDeSesion(null, null, { tienda: "Pharr", puesto: "sales" }, "es", etiquetas, "Edinburg")).toBe("Edinburg · Ventas");
  });

  it("sin tienda en la sesión, lo de antes", () => {
    expect(nombreDeSesion(null, null, PRESENCIAL_UNA_TIENDA, "es", etiquetas, null)).toBe("Pharr · Ventas");
    expect(nombreDeSesion(null, null, REMOTO, "es", etiquetas, null)).toBe("Sin proyecto");
  });

  it("con proyecto, el proyecto manda aunque la sesión lleve tienda", () => {
    expect(nombreDeSesion("p1", "Proyecto X", FRANCIS, "es", etiquetas, "McAllen")).toBe("Proyecto X");
  });
});

describe("textos nuevos en los dos idiomas", () => {
  const claves = [
    "track.storeLabel", "track.pickStore", "track.storeHint", "track.pickStoreFirst",
    "emp.req.storeLabel", "emp.req.anyStore", "mgr.ppl.colMulti", "mgr.ppl.multiNo", "mgr.ppl.multiYes",
  ];
  it.each(claves)("%s existe en en y es", (clave) => {
    expect(DICT.en[clave], "en " + clave).toBeTruthy();
    expect(DICT.es[clave], "es " + clave).toBeTruthy();
  });
});

describe("cableado en las pantallas", () => {
  const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

  it("el cronómetro usa el desplegable de tiendas y graba la tienda al arrancar", () => {
    const c = leer("src/components/timetracker/Cronometro.tsx");
    expect(c).toContain("selectorDeProyecto(me) === \"tienda\"");
    expect(c).toContain("errorDeInicioEnTienda(me, tiendaId, tiendas)");
    expect(c).toContain("...camposDeLugar(me, tiendaId");
  });

  it("el presencial en varias tiendas ve las dos vistas, como el admin", () => {
    const c = leer("src/components/timetracker/Cronometro.tsx");
    expect(c).toContain("const dosVistas = esAdmin || multitienda;");
    expect(c).toContain("if (presencial && !dosVistas)");
  });

  it("la solicitud no bloquea al presencial por proyecto", () => {
    const r = leer("src/app/timetracker/(timetracker)/requests/page.tsx");
    expect(r).toContain("validarProyectoEnSolicitud(me, f.assignmentId || null)");
    expect(r).toContain("camposDeLugar(me, f.storeId");
  });

  it("aprobar una solicitud de tienda la lleva a la sesión", () => {
    const r = leer("src/app/timetracker/(timetracker)/team-requests/page.tsx");
    expect(r).toContain("storeId: (p.storeId as string | undefined) ?? null");
  });
});
