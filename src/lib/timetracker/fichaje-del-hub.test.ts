import { describe, it, expect } from "vitest";
import {
  ANCHO_MINIMO_DEL_HUB, accionDeTeclaEnBloqueo, accionesValidas, demoDelHub, fechaDeTexas, formatoCronometro,
  formatoTranscurrido, horaCorta, horaDeTexas, reconciliaLectura, saludoDe, seVeElBoton, siguienteEstado,
  tiendaPorDefecto, puedeFicharDesdeElHub, type DatosDelHub,
} from "./fichaje-del-hub";

const DATOS: DatosDelHub = {
  sesion: true, activo: true, estado: "fuera", desde: null, nombre: "Carla Cajera", uid: "u-carla",
  multiTienda: false, tiendas: [], tiendaDeHoy: null,
};

describe("máquina de estados del hub", () => {
  it("fuera → entrar → en turno; en turno → almuerzo → volver", () => {
    expect(siguienteEstado("fuera", "entrar")).toBe("en_turno");
    expect(siguienteEstado("en_turno", "empezar_break")).toBe("en_break");
    expect(siguienteEstado("en_break", "volver_del_break")).toBe("en_turno");
  });

  it("terminar el turno sale de cualquier estado con turno (también del almuerzo)", () => {
    expect(siguienteEstado("en_turno", "terminar_turno")).toBe("fuera");
    expect(siguienteEstado("en_break", "terminar_turno")).toBe("fuera");
  });

  it("las acciones que no valen en un estado dan null (no se fichan dos veces ni se sale sin entrar)", () => {
    expect(siguienteEstado("fuera", "terminar_turno")).toBeNull();
    expect(siguienteEstado("fuera", "empezar_break")).toBeNull();
    expect(siguienteEstado("fuera", "volver_del_break")).toBeNull();
    expect(siguienteEstado("en_turno", "entrar")).toBeNull();
    expect(siguienteEstado("en_turno", "volver_del_break")).toBeNull();
    expect(siguienteEstado("en_break", "empezar_break")).toBeNull();
    expect(siguienteEstado("en_break", "entrar")).toBeNull();
  });

  it("los botones válidos por estado, en el orden de la pantalla", () => {
    expect(accionesValidas("fuera")).toEqual(["entrar"]);
    expect(accionesValidas("en_turno")).toEqual(["empezar_break", "terminar_turno"]);
    expect(accionesValidas("en_break")).toEqual(["volver_del_break", "terminar_turno"]);
  });
});

describe("quién ve el botón", () => {
  const todo = { escritorio: true, activo: true, viendoComo: false, ancho: 1280 };

  it("se ve en la app de escritorio, con el interruptor puesto, en una pantalla ancha", () => {
    expect(seVeElBoton(todo)).toBe(true);
  });

  it("nunca en un navegador ni en un teléfono", () => {
    expect(seVeElBoton({ ...todo, escritorio: false })).toBe(false);
    expect(seVeElBoton({ ...todo, ancho: 390 })).toBe(false);
  });

  it("no se ve sin el interruptor de la persona, ni mientras un admin ve como otra persona", () => {
    expect(seVeElBoton({ ...todo, activo: false })).toBe(false);
    expect(seVeElBoton({ ...todo, viendoComo: true })).toBe(false);
  });

  it("el umbral es 700 px, en el límite incluido", () => {
    expect(ANCHO_MINIMO_DEL_HUB).toBe(700);
    expect(seVeElBoton({ ...todo, ancho: 700 })).toBe(true);
    expect(seVeElBoton({ ...todo, ancho: 699 })).toBe(false);
  });
});

describe("la demo solo existe con modo local y la variable", () => {
  it("las dos cosas juntas", () => {
    expect(demoDelHub(true, true)).toBe(true);
    expect(demoDelHub(true, false)).toBe(false);
    expect(demoDelHub(false, true)).toBe(false);
    expect(demoDelHub(false, false)).toBe(false);
  });
});

describe("una lectura fallida nunca bloquea ni desbloquea", () => {
  it("una lectura buena reemplaza lo último que se supo", () => {
    const nuevo = { ...DATOS, estado: "en_break" as const };
    expect(reconciliaLectura(DATOS, { ok: true, datos: nuevo })).toEqual(nuevo);
  });

  it("una lectura fallida conserva lo último que se supo (un almuerzo sigue bloqueado)", () => {
    const enBreak = { ...DATOS, estado: "en_break" as const, desde: "2026-11-25T18:31:00.000Z" };
    expect(reconciliaLectura(enBreak, { ok: false })).toEqual(enBreak);
  });

  it("si nunca se supo nada, sigue sin saberse: nada se muestra", () => {
    expect(reconciliaLectura(null, { ok: false })).toBeNull();
  });
});

describe("las teclas del bloqueo", () => {
  it("Escape no cierra el bloqueo", () => {
    expect(accionDeTeclaEnBloqueo("Escape")).toBe("ignorar");
  });

  it("Tab se queda dentro del bloqueo", () => {
    expect(accionDeTeclaEnBloqueo("Tab")).toBe("atrapar_foco");
  });

  it("cualquier otra tecla no hace nada especial", () => {
    expect(accionDeTeclaEnBloqueo("Enter")).toBe("ignorar");
    expect(accionDeTeclaEnBloqueo("a")).toBe("ignorar");
  });
});

describe("hora de Texas, saludo y tiempos", () => {
  // Noviembre: Texas está en CST (UTC-6). 14:30 UTC = 08:30 en Brownsville.
  it("la hora se lee en la zona de Texas, no en UTC", () => {
    expect(horaDeTexas(new Date("2026-11-25T14:30:00Z"))).toBe(8);
    expect(horaDeTexas(new Date("2026-11-25T23:30:00Z"))).toBe(17);
  });

  it("el saludo: mañana antes de las 12, tarde antes de las 18, noche después", () => {
    expect(saludoDe(0)).toBe("manana");
    expect(saludoDe(11)).toBe("manana");
    expect(saludoDe(12)).toBe("tarde");
    expect(saludoDe(17)).toBe("tarde");
    expect(saludoDe(18)).toBe("noche");
    expect(saludoDe(23)).toBe("noche");
  });

  it("la fecha de hoy en Texas, como YYYY-MM-DD (la de la tienda del día)", () => {
    // 03:00 UTC del 26 es todavía el 25 en Texas.
    expect(fechaDeTexas(new Date("2026-11-26T03:00:00Z"))).toBe("2026-11-25");
  });

  it("la hora corta de un fichaje, en hora de Texas", () => {
    expect(horaCorta("2026-11-25T14:02:00Z", "en")).toBe("8:02 AM");
  });

  it("«3 h 12 min», «12 min», y cero si el tiempo es negativo", () => {
    expect(formatoTranscurrido((3 * 60 + 12) * 60000)).toBe("3 h 12 min");
    expect(formatoTranscurrido(12 * 60000)).toBe("12 min");
    expect(formatoTranscurrido(0)).toBe("0 min");
    expect(formatoTranscurrido(-5000)).toBe("0 min");
  });

  it("el cronómetro, «00:14:27», y las horas pasan de 99 sin romper el formato", () => {
    expect(formatoCronometro((14 * 60 + 27) * 1000)).toBe("00:14:27");
    expect(formatoCronometro(0)).toBe("00:00:00");
    expect(formatoCronometro((100 * 3600 + 5) * 1000)).toBe("100:00:05");
  });
});

describe("la tienda por defecto", () => {
  const tiendas = [{ id: "s-mcallen" }, { id: "s-pharr" }];

  it("la de la entrada abierta manda", () => {
    expect(tiendaPorDefecto({ tiendaDeHoy: "s-pharr", recordada: "s-mcallen", tiendas })).toBe("s-pharr");
  });

  it("si no hay entrada, la que recordó hoy", () => {
    expect(tiendaPorDefecto({ tiendaDeHoy: null, recordada: "s-pharr", tiendas })).toBe("s-pharr");
  });

  it("si no hay ninguna de esas (o ya no existe), la primera", () => {
    expect(tiendaPorDefecto({ tiendaDeHoy: null, recordada: "borrada", tiendas })).toBe("s-mcallen");
    expect(tiendaPorDefecto({ tiendaDeHoy: null, recordada: null, tiendas: [] })).toBeNull();
  });
});

describe("el servidor decide si puede fichar desde el hub (cierra por defecto)", () => {
  const BUENO = { tipo: "inhouse", activa: true, hubClock: true };

  it("todo a favor: pasa", () => {
    expect(puedeFicharDesdeElHub({ error: false, ajustes: BUENO, columnaDisponible: true })).toEqual({ ok: true });
  });

  it("interruptor apagado: se niega", () => {
    expect(puedeFicharDesdeElHub({ error: false, ajustes: { ...BUENO, hubClock: false }, columnaDisponible: true }))
      .toEqual({ ok: false, causa: "interruptor_apagado" });
  });

  it("persona inactiva: se niega", () => {
    expect(puedeFicharDesdeElHub({ error: false, ajustes: { ...BUENO, activa: false }, columnaDisponible: true }))
      .toEqual({ ok: false, causa: "inactiva" });
  });

  it("remota (no presencial): se niega aunque tenga el interruptor", () => {
    expect(puedeFicharDesdeElHub({ error: false, ajustes: { ...BUENO, tipo: "remote" }, columnaDisponible: true }))
      .toEqual({ ok: false, causa: "no_presencial" });
  });

  it("la base no tiene la columna (351 sin aplicar): se niega", () => {
    expect(puedeFicharDesdeElHub({ error: false, ajustes: BUENO, columnaDisponible: false }))
      .toEqual({ ok: false, causa: "sin_columna" });
  });

  it("error de lectura: se niega (nunca se decide con datos que no se leyeron)", () => {
    expect(puedeFicharDesdeElHub({ error: true, ajustes: BUENO, columnaDisponible: true }))
      .toEqual({ ok: false, causa: "error_de_lectura" });
  });

  it("sin fila de ajustes: se niega", () => {
    expect(puedeFicharDesdeElHub({ error: false, ajustes: null, columnaDisponible: true }))
      .toEqual({ ok: false, causa: "sin_ajustes" });
  });

  it("un error gana sobre todo lo demás (aunque la fila diga que sí)", () => {
    expect(puedeFicharDesdeElHub({ error: true, ajustes: null, columnaDisponible: false }).ok).toBe(false);
  });
});
