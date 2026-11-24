import { describe, expect, it } from "vitest";
import {
  MARGEN_MS,
  DIAS_PRIMERA_VEZ,
  choferesDeLaSolicitud,
  duracionDeLlamada,
  esLlamadaPerdida,
  esperaRestante,
  extensionDeGrabacion,
  extensionesDeLaRespuesta,
  filaDeLlamadaDeChofer,
  filtrosDeLlamadas,
  hayFaltaDePermiso,
  nombreVisible,
  numeroLegible,
  rutaDeGrabacion,
  urlDeGrabacionSegura,
  ventanaDeLectura,
} from "./choferes";

const BASE = "https://platform.ringcentral.com";

describe("extensiones de RingCentral", () => {
  it("solo las de usuario, con id, número y nombre", () => {
    const salida = extensionesDeLaRespuesta([
      { id: 101, extensionNumber: "101", name: " Ana Pérez ", type: "User" },
      { id: 102, extensionNumber: "102", name: "Cola de ventas", type: "Department" },
      { id: 103, extensionNumber: "103", name: "Fax", type: "FaxUser" },
      { id: 104, name: "Sin número", type: "User" },
      null,
      "texto",
    ]);
    expect(salida).toEqual([{ id: "101", numero: "101", nombre: "Ana Pérez" }]);
  });

  it("sin nombre queda vacío y se muestra con el número", () => {
    expect(extensionesDeLaRespuesta([{ id: 7, extensionNumber: "207", type: "User" }])).toEqual([
      { id: "7", numero: "207", nombre: "" },
    ]);
    expect(nombreVisible("", "207")).toBe("Ext. 207");
    expect(nombreVisible("  Luis ", "208")).toBe("Luis");
  });
});

describe("una llamada de un chofer", () => {
  const base = {
    id: 9001,
    startTime: "2026-11-17T15:04:05.000Z",
    duration: 83.4,
    direction: "Inbound",
    result: "Accepted",
    from: { phoneNumber: "+19565550101", name: "Cliente" },
    to: { phoneNumber: "+19565550199", name: "Ana" },
    recording: { id: 55, contentUri: "https://media.ringcentral.com/restapi/v1.0/account/1/recording/55/content" },
  };

  it("entrante: se guarda con su grabación pendiente y la duración redondeada", () => {
    expect(filaDeLlamadaDeChofer(base, "101")).toEqual({
      rc_call_id: "9001",
      rc_extension_id: "101",
      direction: "in",
      started_at: "2026-11-17T15:04:05.000Z",
      duration_s: 83,
      from_number: "+19565550101",
      from_name: "Cliente",
      to_number: "+19565550199",
      to_name: "Ana",
      result: "Accepted",
      recording_uri: "https://media.ringcentral.com/restapi/v1.0/account/1/recording/55/content",
      recording_pending: true,
    });
  });

  it("saliente sin grabación", () => {
    const f = filaDeLlamadaDeChofer({ ...base, direction: "Outbound", recording: null, duration: null }, "101");
    expect(f?.direction).toBe("out");
    expect(f?.recording_uri).toBeNull();
    expect(f?.recording_pending).toBe(false);
    expect(f?.duration_s).toBeNull();
  });

  it("sin dirección conocida, sin fecha o sin id: no se guarda", () => {
    expect(filaDeLlamadaDeChofer({ ...base, direction: "Other" }, "101")).toBeNull();
    expect(filaDeLlamadaDeChofer({ ...base, startTime: "no es fecha" }, "101")).toBeNull();
    expect(filaDeLlamadaDeChofer({ ...base, id: "" }, "101")).toBeNull();
  });
});

describe("desde cuándo se lee", () => {
  const ahora = new Date("2026-11-18T12:00:00.000Z");
  it("la primera vez, 30 días atrás", () => {
    expect(ventanaDeLectura(null, ahora).getTime()).toBe(ahora.getTime() - DIAS_PRIMERA_VEZ * 24 * 3600 * 1000);
  });
  it("después, el cursor menos el solape de dos horas", () => {
    const cursor = "2026-11-18T10:00:00.000Z";
    expect(ventanaDeLectura(cursor, ahora).getTime()).toBe(Date.parse(cursor) - MARGEN_MS);
  });
  it("un cursor roto cuenta como primera vez", () => {
    expect(ventanaDeLectura("basura", ahora).getTime()).toBe(ventanaDeLectura(null, ahora).getTime());
  });
});

describe("qué URL de grabación se sigue con el token", () => {
  it("https en ringcentral.com y sus subdominios", () => {
    expect(urlDeGrabacionSegura("https://media.ringcentral.com/x/content", BASE)?.hostname).toBe("media.ringcentral.com");
    expect(urlDeGrabacionSegura("https://ringcentral.com/x", BASE)).not.toBeNull();
    expect(urlDeGrabacionSegura("/restapi/v1.0/account/~/recording/1/content", BASE)?.origin).toBe(BASE);
  });
  it("cualquier otra cosa se rechaza", () => {
    expect(urlDeGrabacionSegura("http://media.ringcentral.com/x", BASE)).toBeNull();
    expect(urlDeGrabacionSegura("https://evil.example.com/x", BASE)).toBeNull();
    expect(urlDeGrabacionSegura("https://ringcentral.com.evil.example/x", BASE)).toBeNull();
    expect(urlDeGrabacionSegura("https://user:pass@media.ringcentral.com/x", BASE)).toBeNull();
    expect(urlDeGrabacionSegura("no es una url ::", "no es base")).toBeNull();
  });
});

describe("ficheros de grabación", () => {
  it("la extensión sale del tipo; lo desconocido es bin", () => {
    expect(extensionDeGrabacion("audio/x-wav")).toBe("wav");
    expect(extensionDeGrabacion("audio/mpeg; charset=x")).toBe("mp3");
    expect(extensionDeGrabacion("application/octet-stream")).toBe("bin");
  });
  it("la ruta no deja salir del bucket con los ids", () => {
    expect(rutaDeGrabacion("101", "9001", "audio/wav")).toBe("101/9001.wav");
    expect(rutaDeGrabacion("../x", "a/b", "audio/mp4")).toBe("___x/a_b.m4a");
  });
});

describe("textos de la pantalla", () => {
  it("duración m:ss y guion sin dato", () => {
    expect(duracionDeLlamada(83)).toBe("1:23");
    expect(duracionDeLlamada(5)).toBe("0:05");
    expect(duracionDeLlamada(null)).toBe("—");
  });
  it("el número de la otra parte se ve formateado", () => {
    expect(numeroLegible("+19565550101")).toBe("(956) 555-0101");
    expect(numeroLegible(null)).toBe("");
  });
});

describe("la lista de choferes que llega del navegador", () => {
  it("acepta la lista y quita repetidos", () => {
    expect(choferesDeLaSolicitud({ choferes: [{ id: "101", numero: "101", nombre: "Ana" }, { id: "101", numero: "101", nombre: "Ana" }] })).toEqual([
      { id: "101", numero: "101", nombre: "Ana" },
    ]);
  });
  it("rechaza lo que no encaja", () => {
    expect(choferesDeLaSolicitud(null)).toBeNull();
    expect(choferesDeLaSolicitud({ choferes: "x" })).toBeNull();
    expect(choferesDeLaSolicitud({ choferes: [{ id: "1 OR 1", numero: "101", nombre: "" }] })).toBeNull();
    expect(choferesDeLaSolicitud({ choferes: [{ id: "1", numero: "10a", nombre: "" }] })).toBeNull();
    expect(choferesDeLaSolicitud({ choferes: [{ id: "1", numero: "101", nombre: "x".repeat(201) }] })).toBeNull();
  });
});

describe("los filtros de la lista", () => {
  it("sin nada: página 1, tamaño por defecto, sin filtros", () => {
    expect(filtrosDeLlamadas(new URLSearchParams(""))).toEqual({
      extension: null, desde: null, hasta: null, direccion: null, conGrabacion: false, pagina: 1, tamano: 100,
    });
  });
  it("lee cada filtro y acota el tamaño", () => {
    const f = filtrosDeLlamadas(new URLSearchParams(
      "extension=101&desde=2026-11-11T06:00:00.000Z&hasta=2026-11-18T05:59:59.000Z&direccion=out&grabacion=1&pagina=3&tamano=9999",
    ));
    expect(f).toMatchObject({ extension: "101", direccion: "out", conGrabacion: true, pagina: 3, tamano: 500 });
  });
  it("un valor que no se entiende responde null", () => {
    expect(filtrosDeLlamadas(new URLSearchParams("direccion=todas"))).toBeNull();
    expect(filtrosDeLlamadas(new URLSearchParams("extension=1;drop"))).toBeNull();
    expect(filtrosDeLlamadas(new URLSearchParams("desde=ayer"))).toBeNull();
  });
});

describe("cuándo se puede volver a sincronizar y el aviso de permiso", () => {
  const ahora = new Date("2026-11-18T12:00:00.000Z");
  it("espera lo que falta de la ventana", () => {
    expect(esperaRestante("2026-11-18T11:59:30.000Z", ahora, 120)).toBe(90);
    expect(esperaRestante("2026-11-18T11:00:00.000Z", ahora, 120)).toBe(0);
    expect(esperaRestante(null, ahora, 120)).toBe(0);
  });
  it("hay falta de permiso si alguna extensión lo dice", () => {
    expect(hayFaltaDePermiso([{ last_error_code: null }, { last_error_code: "sin_permiso" }])).toBe(true);
    expect(hayFaltaDePermiso([{ last_error_code: "limite" }])).toBe(false);
    expect(hayFaltaDePermiso([])).toBe(false);
  });
});

describe("esLlamadaPerdida (D-1145, reunión del 23 nov 2026)", () => {
  it("marca en rojo solo las llamadas perdidas", () => {
    expect(esLlamadaPerdida("Missed")).toBe(true);
    expect(esLlamadaPerdida(" missed ")).toBe(true);
    expect(esLlamadaPerdida("Accepted")).toBe(false);
    expect(esLlamadaPerdida("Voicemail")).toBe(false);
    expect(esLlamadaPerdida(null)).toBe(false);
    expect(esLlamadaPerdida(undefined)).toBe(false);
  });
});
