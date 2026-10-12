import { describe, expect, it } from "vitest";
import { PUNTOS, SECCIONES, VERSION_DE_LA_LISTA, textoDelPunto } from "./puntos";
import {
  borradorVacio, choferesConRuta, claveDeVehiculo, contestado, debeAvisar, defectos, defectosAbiertos, defectosCriticos,
  delChoferEnElDia, esSeguroParaSalir, estadoDeLaInspeccion, etiquetaDeVehiculo, faltasParaEnviar, hechaHoy, horaDelNegocio, inspeccionParaGuardar,
  leeOdometro, opcionesDe, ordenParaLogistica, primeraSeccionConFaltas, progreso, progresoDeSeccion, resumenDelDia,
  revisaLasDelEquipo, trasContestar, yaHechaConEsteVehiculo,
  type Borrador, type Inspeccion, type Respuestas,
} from "./reglas";

/**
 * La inspección pre-viaje (D-NEXT). El dueño, 2026-10-11: «AGREGA UN NUEVO VIEW QUE SE LLAMARA PRE TRIP INSPECTION
 * CHECKLIST Y INVESTIGAME ALGO PARA HACER UN FIRST DRAFT».
 */

const CRITICOS = PUNTOS.filter((p) => p.critico).map((p) => p.id);
/** Todo contestado OK (o N/A donde se puede, para que cuente que N/A también vale). */
const todoOk = (): Respuestas => Object.fromEntries(PUNTOS.map((p) => [p.id, { estado: p.puedeNoAplicar ? "na" : "ok" }]));
const completo = (cambios: Partial<Borrador> = {}): Borrador => ({
  vehiculo: { id: "veh-1", etiqueta: "Camión 3" }, odometro: "84213", respuestas: todoOk(), notas: "", certificado: true, ...cambios,
});
const fila = (x: Partial<Inspeccion>): Inspeccion => ({
  id: "i", driver_id: "u1", driver_name: "Diego", inspection_date: "2026-10-11", vehicle_id: "veh-1", vehicle_label: "Camión 3",
  odometer: 1, answers: {}, safe: true, notes: null, certified: true, checklist_version: "v", repairs: {}, created_at: "2026-10-11T12:00:00.000Z", ...x,
});

describe("la lista: un solo sitio, en inglés y español", () => {
  it("34 puntos en 6 zonas, con ids únicos y texto en los dos idiomas", () => {
    expect(SECCIONES.map((s) => s.id)).toEqual(["cabina", "motor", "luces", "llantas", "carga", "seguridad"]);
    expect(PUNTOS).toHaveLength(34);
    expect(new Set(PUNTOS.map((p) => p.id)).size).toBe(PUNTOS.length);
    for (const p of PUNTOS) expect([p.id, p.en.trim().length > 3, p.es.trim().length > 3]).toEqual([p.id, true, true]);
    expect(VERSION_DE_LA_LISTA).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("son críticos frenos, freno de estacionamiento, dirección, llantas, ruedas, luces de freno y direccionales", () => {
    expect(CRITICOS).toEqual(["frenos", "freno_estacionamiento", "direccion", "direccionales", "luces_freno", "inflado", "dibujo", "cortes", "tuercas", "rines"]);
  });

  it("un punto crítico nunca admite «No aplica»", () => {
    expect(PUNTOS.filter((p) => p.critico && p.puedeNoAplicar)).toEqual([]);
  });

  it("el texto de un id que ya no está en la lista es el id", () => {
    expect(textoDelPunto("frenos", true)).toBe("Frenos: pedal firme, frena derecho");
    expect(textoDelPunto("frenos", false)).toBe("Service brakes: firm pedal, stops straight");
    expect(textoDelPunto("punto_viejo", true)).toBe("punto_viejo");
  });
});

describe("opciones y progreso («12 de 34»)", () => {
  const frenos = PUNTOS.find((p) => p.id === "frenos")!;
  const plataforma = PUNTOS.find((p) => p.id === "plataforma")!;
  const bocina = PUNTOS.find((p) => p.id === "bocina")!;

  it("crítico: OK y Defecto; con equipo opcional: también No aplica; el resto: OK y Defecto", () => {
    expect(opcionesDe(frenos)).toEqual(["ok", "defecto"]);
    expect(opcionesDe(plataforma)).toEqual(["ok", "defecto", "na"]);
    expect(opcionesDe(bocina)).toEqual(["ok", "defecto"]);
  });

  it("«No aplica» en un punto que no lo admite no cuenta como contestado", () => {
    expect(contestado(frenos, { estado: "na" })).toBe(false);
    expect(contestado(plataforma, { estado: "na" })).toBe(true);
    expect(contestado(bocina, undefined)).toBe(false);
  });

  it("cuenta los contestados de la lista entera y de cada sección", () => {
    expect(progreso({})).toEqual({ hechos: 0, total: 34 });
    const r: Respuestas = { frenos: { estado: "ok" }, bocina: { estado: "defecto" }, direccion: { estado: "na" }, plataforma: { estado: "na" }, punto_viejo: { estado: "ok" } };
    expect(progreso(r)).toEqual({ hechos: 3, total: 34 });
    expect(progresoDeSeccion(SECCIONES[0], r)).toEqual({ hechos: 2, total: 10 });
    expect(progreso(todoOk())).toEqual({ hechos: 34, total: 34 });
  });
});

describe("«seguro para salir»", () => {
  it("todo OK es seguro", () => {
    expect(esSeguroParaSalir(todoOk())).toBe(true);
  });

  it("cada punto crítico con «Defecto» lo hace NO seguro", () => {
    for (const id of CRITICOS) expect([id, esSeguroParaSalir({ ...todoOk(), [id]: { estado: "defecto" } })]).toEqual([id, false]);
  });

  it("un crítico sin contestar no es seguro (pide la afirmación, no la falta de queja)", () => {
    const r = todoOk();
    delete r.frenos;
    expect(esSeguroParaSalir(r)).toBe(false);
    expect(esSeguroParaSalir({})).toBe(false);
  });

  it("un defecto en algo no crítico (bocina, plataforma) no lo impide", () => {
    expect(esSeguroParaSalir({ ...todoOk(), bocina: { estado: "defecto" }, plataforma: { estado: "defecto" } })).toBe(true);
  });

  it("defectos y críticos, en el orden de la lista; un id viejo con defecto también sale", () => {
    const r: Respuestas = { ...todoOk(), rines: { estado: "defecto" }, bocina: { estado: "defecto" }, frenos: { estado: "defecto" }, punto_viejo: { estado: "defecto" } };
    expect(defectos(r)).toEqual(["bocina", "frenos", "rines", "punto_viejo"]);
    expect(defectosCriticos(r)).toEqual(["frenos", "rines"]);
    expect(defectos(null)).toEqual([]);
  });
});

describe("lo que falta para enviar", () => {
  it("completo: nada", () => {
    expect(faltasParaEnviar(completo())).toEqual([]);
  });

  it("sin vehículo, o con el nombre en blanco", () => {
    expect(faltasParaEnviar(completo({ vehiculo: null }))).toEqual([{ tipo: "vehiculo" }]);
    expect(faltasParaEnviar(completo({ vehiculo: { id: null, etiqueta: "   " } }))).toEqual([{ tipo: "vehiculo" }]);
  });

  it("sin odómetro, o con letras: nunca un vacío convertido en 0", () => {
    expect(faltasParaEnviar(completo({ odometro: "" }))).toEqual([{ tipo: "odometro" }]);
    expect(faltasParaEnviar(completo({ odometro: "abc" }))).toEqual([{ tipo: "odometro" }]);
  });

  it("los puntos sin contestar, por id", () => {
    const r = todoOk();
    delete r.bocina;
    delete r.chaleco;
    expect(faltasParaEnviar(completo({ respuestas: r }))).toEqual([{ tipo: "sin_contestar", ids: ["bocina", "chaleco"] }]);
  });

  it("un defecto pide nota Y foto", () => {
    const r: Respuestas = { ...todoOk(), bocina: { estado: "defecto", nota: "  ", fotos: [] }, frenos: { estado: "defecto", nota: "chillan", fotos: ["data:x"] } };
    expect(faltasParaEnviar(completo({ respuestas: r }))).toEqual([
      { tipo: "defecto_sin_nota", ids: ["bocina"] },
      { tipo: "defecto_sin_foto", ids: ["bocina"] },
    ]);
  });

  it("sin la casilla de certificar", () => {
    expect(faltasParaEnviar(completo({ certificado: false }))).toEqual([{ tipo: "certificar" }]);
  });

  it("un borrador vacío lo pide todo, en orden", () => {
    expect(faltasParaEnviar(borradorVacio()).map((f) => f.tipo)).toEqual(["vehiculo", "odometro", "sin_contestar", "certificar"]);
  });

  it("al pulsar Enviar con faltas, se abre la primera sección que tiene alguna", () => {
    const r = todoOk();
    delete r.extintor;
    delete r.aceite;
    expect(primeraSeccionConFaltas(faltasParaEnviar(completo({ respuestas: r })))).toBe("motor");
    expect(primeraSeccionConFaltas([{ tipo: "certificar" }])).toBeNull();
  });
});

describe("el odómetro escrito a mano", () => {
  it("acepta comas, espacios y un decimal", () => {
    expect(leeOdometro("84213")).toBe(84213);
    expect(leeOdometro("84,213")).toBe(84213);
    expect(leeOdometro(" 84 213.7 ")).toBe(84213.7);
  });
  it("rechaza vacío, letras, negativos y más de 7 cifras", () => {
    for (const x of ["", "  ", "abc", "-5", "12a", "12345678", "1.2.3"]) expect([x, leeOdometro(x)]).toEqual([x, null]);
  });
  it("rechaza lo que Number() sí leería: exponente y hexadecimal", () => {
    for (const x of ["1e3", "0x10", "84213e1"]) expect([x, leeOdometro(x)]).toEqual([x, null]);
  });
});

describe("lo que se guarda", () => {
  it("limpia las respuestas, calcula «seguro» y lleva la versión de la lista", () => {
    const r: Respuestas = {
      ...todoOk(),
      bocina: { estado: "ok", nota: "sobraba", fotos: ["data:viejo"] },
      frenos: { estado: "defecto", nota: "  chillan  ", fotos: ["a", "b", "c"] },
      direccion: { estado: "na" },
      punto_viejo: { estado: "ok" },
    };
    const g = inspeccionParaGuardar(completo({ respuestas: r, odometro: "84,213", notas: "  ", vehiculo: { id: null, etiqueta: "  Pickup roja " } }), { id: "u1", nombre: "Diego" }, "2026-10-11");
    expect(g.answers.bocina).toEqual({ estado: "ok" });
    expect(g.answers.frenos).toEqual({ estado: "defecto", nota: "chillan", fotos: ["a", "b"] });
    expect(g.answers.direccion).toBeUndefined();
    expect(g.answers.punto_viejo).toBeUndefined();
    expect(g.safe).toBe(false);
    expect(g.odometer).toBe(84213);
    expect(g.notes).toBeNull();
    expect(g.vehicle_id).toBeNull();
    expect(g.vehicle_label).toBe("Pickup roja");
    expect(g.checklist_version).toBe(VERSION_DE_LA_LISTA);
    expect([g.driver_id, g.driver_name, g.inspection_date, g.certified]).toEqual(["u1", "Diego", "2026-10-11", true]);
  });

  it("todo OK se guarda como seguro", () => {
    expect(inspeccionParaGuardar(completo(), { id: "u1", nombre: "D" }, "2026-10-11").safe).toBe(true);
  });
});

describe("una por chofer, por día y por vehículo", () => {
  const filas = [
    fila({ id: "a", created_at: "2026-10-11T12:00:00.000Z" }),
    fila({ id: "b", vehicle_id: null, vehicle_label: "  Pickup   Roja ", created_at: "2026-10-11T15:00:00.000Z" }),
    fila({ id: "ayer", inspection_date: "2026-10-10" }),
    fila({ id: "otro", driver_id: "u2" }),
  ];

  it("la del día es la última del chofer ese día; otro día u otro chofer no cuentan", () => {
    expect(hechaHoy(filas, "u1", "2026-10-11")?.id).toBe("b");
    expect(delChoferEnElDia(filas, "u1", "2026-10-11").map((f) => f.id)).toEqual(["a", "b"]);
    expect(hechaHoy(filas, "u1", "2026-10-12")).toBeNull();
    expect(hechaHoy(filas, "u3", "2026-10-11")).toBeNull();
  });

  it("el mismo vehículo: por id, o por el texto sin mayúsculas ni espacios de más", () => {
    expect(yaHechaConEsteVehiculo(filas, "u1", "2026-10-11", { id: "veh-1", etiqueta: "otro nombre" })).toBe(true);
    expect(yaHechaConEsteVehiculo(filas, "u1", "2026-10-11", { id: null, etiqueta: "pickup roja" })).toBe(true);
    expect(yaHechaConEsteVehiculo(filas, "u1", "2026-10-11", { id: "veh-2", etiqueta: "Camión 5" })).toBe(false);
    expect(yaHechaConEsteVehiculo(filas, "u2", "2026-10-11", { id: null, etiqueta: "pickup roja" })).toBe(false);
    expect(yaHechaConEsteVehiculo(filas, "u1", "2026-10-11", null)).toBe(false);
    expect(claveDeVehiculo({ vehicle_id: null, vehicle_label: "  Pickup   Roja " })).toBe("texto:pickup roja");
  });
});

describe("el aviso de «Mi ruta»", () => {
  const hecha = [fila({ driver_id: "u1", inspection_date: "2026-10-11" })];
  it("sale mientras hoy no haya ninguna", () => {
    expect(debeAvisar("listo", [], "u1", "2026-10-11")).toBe(true);
    expect(debeAvisar("listo", hecha, "u1", "2026-10-12")).toBe(true);
  });
  it("hecha hoy, no sale", () => {
    expect(debeAvisar("listo", hecha, "u1", "2026-10-11")).toBe(false);
  });
  it("sin la migración, cargando, con error o sin chofer, no sale", () => {
    for (const e of ["sin_tabla", "cargando", "error"] as const) expect([e, debeAvisar(e, [], "u1", "2026-10-11")]).toEqual([e, false]);
    expect(debeAvisar("listo", [], null, "2026-10-11")).toBe(false);
  });
});

describe("logística", () => {
  it("un defecto marcado corregido deja de estar abierto", () => {
    const f = fila({ answers: { bocina: { estado: "defecto" }, frenos: { estado: "defecto" }, rines: { estado: "ok" } }, repairs: { bocina: { at: "x", by: null, by_name: null, note: null } } });
    expect(defectosAbiertos(f)).toEqual(["frenos"]);
  });

  it("cómo está hoy: no segura mientras le quede un crítico abierto; corregida cuando ya no; con defectos; limpia", () => {
    const rep = { at: "x", by: null, by_name: null, note: null };
    const critico = { inflado: { estado: "defecto" as const } };
    expect(estadoDeLaInspeccion(fila({ safe: false, answers: critico }))).toBe("no_segura");
    expect(estadoDeLaInspeccion(fila({ safe: false, answers: critico, repairs: { inflado: rep } }))).toBe("corregida");
    // Con el crítico corregido, una bocina abierta no la deja «no segura».
    expect(estadoDeLaInspeccion(fila({ safe: false, answers: { ...critico, bocina: { estado: "defecto" } }, repairs: { inflado: rep } }))).toBe("corregida");
    expect(estadoDeLaInspeccion(fila({ safe: true, answers: { bocina: { estado: "defecto" } } }))).toBe("con_defectos");
    expect(estadoDeLaInspeccion(fila({ safe: true, answers: { bocina: { estado: "defecto" } }, repairs: { bocina: rep } }))).toBe("limpia");
    expect(estadoDeLaInspeccion(fila({ safe: true }))).toBe("limpia");
  });

  it("un defecto de un punto que ya no está en la lista cuenta como crítico: ante la duda, no se da por segura", () => {
    expect(estadoDeLaInspeccion(fila({ safe: false, answers: { punto_viejo: { estado: "defecto" } } }))).toBe("no_segura");
  });

  it("arriba lo que pide acción: no segura con abiertos, luego con abiertos; dentro, por hora", () => {
    const def = { inflado: { estado: "defecto" as const } };
    const corregido = { inflado: { at: "x", by: null, by_name: null, note: null } };
    const filas = [
      fila({ id: "limpia-temprano", created_at: "2026-10-11T11:00:00.000Z" }),
      fila({ id: "abierta", answers: { bocina: { estado: "defecto" } }, created_at: "2026-10-11T13:00:00.000Z" }),
      fila({ id: "no-segura-tarde", safe: false, answers: def, created_at: "2026-10-11T14:00:00.000Z" }),
      fila({ id: "no-segura-corregida", safe: false, answers: def, repairs: corregido, created_at: "2026-10-11T10:00:00.000Z" }),
      fila({ id: "no-segura-temprano", safe: false, answers: def, created_at: "2026-10-11T12:00:00.000Z" }),
    ];
    expect(ordenParaLogistica(filas).map((f) => f.id)).toEqual(["no-segura-temprano", "no-segura-tarde", "abierta", "no-segura-corregida", "limpia-temprano"]);
  });

  it("los choferes con ruta ese día: sin borradores, rechazadas ni anuladas, sin repetir y sin los de otro día", () => {
    const ordenes = [
      { assigned_driver: "Diego", delivery_date: "2026-10-11", stage: "approved" },
      { assigned_driver: " diego ", delivery_date: "2026-10-11", stage: "delivered" },
      { assigned_driver: "Carlos R.", delivery_date: "2026-10-11", stage: "picked_up" },
      { assigned_driver: "Miguel A.", delivery_date: "2026-10-11", stage: "canceled" },
      { assigned_driver: "Luis", delivery_date: "2026-10-11", stage: "draft" },
      { assigned_driver: "Ana", delivery_date: "2026-10-11", stage: "rejected" },
      { assigned_driver: "Pedro", delivery_date: "2026-10-12", stage: "approved" },
      { assigned_driver: null, delivery_date: "2026-10-11", stage: "approved" },
    ];
    expect(choferesConRuta(ordenes, "2026-10-11")).toEqual(["Carlos R.", "Diego"]);
  });

  it("el resumen: hechas, no seguras, defectos abiertos y quién con ruta no inspeccionó", () => {
    const filas = [
      fila({ driver_name: "Diego", safe: false, answers: { frenos: { estado: "defecto" }, bocina: { estado: "defecto" } } }),
      fila({ driver_name: "carlos r.", answers: { bocina: { estado: "defecto" } }, repairs: { bocina: { at: "x", by: null, by_name: null, note: null } } }),
    ];
    expect(resumenDelDia(filas, ["Carlos R.", "Diego", "Miguel A."])).toEqual({ hechas: 2, noSeguras: 1, defectosAbiertos: 2, sinInspeccion: ["Miguel A."] });
    // La no segura con su crítico ya corregido deja de contar como «no segura».
    const corregida = fila({ driver_name: "Miguel A.", safe: false, answers: { frenos: { estado: "defecto" } }, repairs: { frenos: { at: "x", by: null, by_name: null, note: null } } });
    expect(resumenDelDia([...filas, corregida], ["Miguel A."])).toEqual({ hechas: 3, noSeguras: 1, defectosAbiertos: 2, sinInspeccion: [] });
  });

  it("revisan las del equipo logística y el admin; nadie más", () => {
    expect(["admin", "logistics", "driver", "manager", "sales", "warehouse", "accounting", null].map(revisaLasDelEquipo))
      .toEqual([true, true, false, false, false, false, false, false]);
  });
});

describe("plegar y abrir secciones al contestar", () => {
  const cabinaOk = (): Respuestas => Object.fromEntries(SECCIONES[0].puntos.map((p) => [p.id, { estado: "ok" }]));

  it("sección completa sin defectos: se pliega y se abre la siguiente que falte", () => {
    expect(trasContestar("cabina", cabinaOk())).toEqual({ cerrar: true, abrir: "motor" });
    const conMotor = { ...cabinaOk(), ...Object.fromEntries(SECCIONES[1].puntos.map((p) => [p.id, { estado: "ok" as const }])) };
    expect(trasContestar("cabina", conMotor)).toEqual({ cerrar: true, abrir: "luces" });
  });

  it("con un defecto se queda abierta (toca la nota y la foto)", () => {
    expect(trasContestar("cabina", { ...cabinaOk(), bocina: { estado: "defecto" } })).toEqual({ cerrar: false, abrir: null });
  });

  it("incompleta, no se mueve", () => {
    const r = cabinaOk();
    delete r.bocina;
    expect(trasContestar("cabina", r)).toEqual({ cerrar: false, abrir: null });
  });

  it("la última vuelve a la primera que falte; todo completo, solo se pliega", () => {
    const seguridad = Object.fromEntries(SECCIONES[5].puntos.map((p) => [p.id, { estado: "ok" as const }]));
    expect(trasContestar("seguridad", seguridad)).toEqual({ cerrar: true, abrir: "cabina" });
    expect(trasContestar("seguridad", todoOk())).toEqual({ cerrar: true, abrir: null });
  });
});

describe("formatos", () => {
  it("la hora es la del negocio (Texas), no la del navegador", () => {
    expect(horaDelNegocio("2026-10-11T12:41:00.000Z", false)).toBe("7:41 AM");
    expect(horaDelNegocio("no es fecha", true)).toBe("");
  });
  it("«Camión 3 · TX 4KD-221», y sin placa solo el nombre", () => {
    expect(etiquetaDeVehiculo({ name: " Camión 3 ", plate: "TX 4KD-221" })).toBe("Camión 3 · TX 4KD-221");
    expect(etiquetaDeVehiculo({ name: "Isuzu", plate: null })).toBe("Isuzu");
  });
});
