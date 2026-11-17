/**
 * Importador de Indeed: de qué campo sale cada dato, la etiqueta de importación, el descarte de los mensajes sin teléfono y
 * el «solo llenar vacíos». Los fixtures son INVENTADOS a partir de las dos formas de correo que llegan a careers@:
 *   A) «New Message from <Nombre> - <Puesto>» (cuerpo = texto libre del candidato; casi nunca trae teléfono ni ciudad).
 *   B) «[Action required] New application for <Puesto>, <Ciudad>, <ST>» (cuerpo «<Nombre> applied to the <Puesto> position…»,
 *      líneas «Name:», «Email:», «Phone:», «Location:», y el CV como adjunto cuando lo hay).
 * Cuando haya correos reales, añadir su fixture (sin datos personales) y ajustar las reglas de indeed.ts.
 */
import { describe, expect, it } from "vitest";
import { leerCandidatoDeIndeed, leerMensajeDeIndeed, clasificaCorreoIndeed, datosDelAsuntoMensaje, puestoYCiudadDelAsunto, type CandidatoDeIndeed, type CorreoDeIndeed } from "./indeed";
import { telefonoDeMensaje } from "./llamada-del-mensaje";
import {
  camposVacios,
  etiquetasDeAlta,
  ETIQUETA_IMPORTACION_INDEED,
  llegoTelefonoTarde,
  MOTIVO_SIN_TELEFONO_MENSAJE,
  payloadDeAlta,
} from "./crear-candidato";

const base = { recibido: "2026-11-13T14:05:00Z", dominioBuzon: "rtgcorp.example" };

/** A. Mensaje nuevo: asunto con nombre y puesto; el cuerpo repite el título y pone la tarjeta de Indeed. Sin teléfono. */
const correoMensajeSinTelefono: CorreoDeIndeed = {
  ...base,
  subject: "New Message from Jesse Sanchez - Inventory and Warehouse Coordinator",
  from: "Indeed <noreply@indeed.com>",
  replyTo: ["m3q8ld@indeedemail.com"],
  cuerpo:
    '<html><body><h2>New Message from Jesse Sanchez - Inventory and Warehouse Coordinator</h2>' +
    "<p>I will be open to interview tomorrow anytime from 1:30-2pm</p>" +
    '<p><a href="https://www.indeed.com/messages">View message on Indeed</a></p></body></html>',
};

/** A. Mismo formato, pero el candidato sí escribe su teléfono en el mensaje. */
const correoMensajeConTelefono: CorreoDeIndeed = {
  ...correoMensajeSinTelefono,
  subject: "New Message from Ana Ruiz - Cashier",
  cuerpo: "<html><body><p>Call me at (956) 555-0177 after 2pm</p><p>Lives in Harlingen, TX</p></body></html>",
};

/** B. Solicitud con etiquetas completas: ciudad de la vacante en el asunto, dónde vive en «Location:». */
const correoSolicitudCompleta: CorreoDeIndeed = {
  ...base,
  subject: "[Action required] New application for Inventory and Warehouse Coordinator, McAllen, TX",
  from: "Indeed <noreply@indeed.com>",
  replyTo: ["r7k2mx@indeedemail.com"],
  cuerpo: [
    "<html><body>",
    "<p>Johnathon Garza applied to the Inventory and Warehouse Coordinator position posted on Indeed.</p>",
    "<p>Resume attached (if one was provided).</p>",
    "<p>Name: Johnathon Garza</p>",
    "<p>Email: johnathon.garza@example.com</p>",
    "<p>Phone: (956) 555-0177</p>",
    "<p>Location: Harlingen, TX</p>",
    "</body></html>",
  ].join(""),
};

/** B. Solicitud sin etiquetas: el nombre sale de la frase del cuerpo y el teléfono va suelto en el texto. */
const correoSolicitudSinEtiquetas: CorreoDeIndeed = {
  ...base,
  subject: "[Action required] New application for Driver, McAllen, TX",
  from: "Indeed <noreply@indeed.com>",
  replyTo: ["p4t7wz@indeedemail.com"],
  cuerpo: "<html><body><p>Johnathon Garza applied to the Driver position posted on Indeed. Call 956-555-0188 to schedule.</p></body></html>",
};

describe("asunto: puesto y ciudad de cada forma", () => {
  it("«New application for <Puesto>, <Ciudad>, <ST>» saca puesto y ciudad, quitando el marcador [Action required]", () => {
    expect(puestoYCiudadDelAsunto("[Action required] New application for Inventory and Warehouse Coordinator, McAllen, TX")).toEqual({
      puesto: "Inventory and Warehouse Coordinator",
      ubicacion: "McAllen, TX",
    });
    expect(puestoYCiudadDelAsunto("New application for Driver, Harlingen, tx")).toEqual({ puesto: "Driver", ubicacion: "Harlingen, TX" });
  });

  it("«New application for <Puesto>» sin ciudad deja la ciudad vacía", () => {
    expect(puestoYCiudadDelAsunto("New application for Cook")).toEqual({ puesto: "Cook", ubicacion: null });
  });

  it("«New Message from <Nombre> - <Puesto>» saca nombre y puesto; sin puesto, solo el nombre", () => {
    expect(datosDelAsuntoMensaje("New Message from Jesse Sanchez - Inventory and Warehouse Coordinator")).toEqual({
      nombre: "Jesse Sanchez",
      puesto: "Inventory and Warehouse Coordinator",
    });
    expect(datosDelAsuntoMensaje("New Message from Jesse Sanchez")).toEqual({ nombre: "Jesse Sanchez", puesto: null });
  });

  it("clasifica cada forma en su tipo: mensaje o solicitud", () => {
    expect(clasificaCorreoIndeed(correoMensajeSinTelefono)).toBe("message");
    expect(clasificaCorreoIndeed(correoSolicitudCompleta)).toBe("application");
    expect(clasificaCorreoIndeed(correoSolicitudSinEtiquetas)).toBe("application");
  });
});

describe("forma A («New Message»): mensaje del candidato", () => {
  it("nombre y puesto salen del asunto; el texto no lleva el título ni la tarjeta de Indeed", () => {
    expect(leerMensajeDeIndeed(correoMensajeSinTelefono)).toEqual({
      ok: true,
      mensaje: {
        candidateName: "Jesse Sanchez",
        texto: "I will be open to interview tomorrow anytime from 1:30-2pm",
        puesto: "Inventory and Warehouse Coordinator",
        empresa: null,
        ubicacion: null,
        hogar: null,
      },
    });
  });

  it("sin teléfono en el mensaje: telefonoDeMensaje da null, así que el alta nace descartada", () => {
    const r = leerMensajeDeIndeed(correoMensajeSinTelefono);
    expect(r.ok).toBe(true);
    if (r.ok) expect(telefonoDeMensaje(r.mensaje.texto)).toBeNull();
  });

  it("con teléfono y ciudad en el texto libre: saca el teléfono y dónde vive («I live in»)", () => {
    const r = leerMensajeDeIndeed(correoMensajeConTelefono);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(telefonoDeMensaje(r.mensaje.texto)).toBe("9565550177");
    expect(r.mensaje.hogar).toBe("Harlingen, TX");
    expect(r.mensaje.puesto).toBe("Cashier");
  });
});

describe("forma B («New application»): solicitud", () => {
  it("con etiquetas: puesto y ciudad de la vacante van a puesto y location; dónde vive va a home_location", () => {
    const r = leerCandidatoDeIndeed(correoSolicitudCompleta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidato).toEqual(
      expect.objectContaining({
        name: "Johnathon Garza",
        email: "johnathon.garza@example.com",
        correoEsRelay: false,
        phone: "9565550177",
        role: "Inventory and Warehouse Coordinator",
        location: "McAllen, TX",
        home_location: "Harlingen, TX",
      }),
    );
  });

  it("sin etiquetas: el nombre sale de la frase «applied to the …», el teléfono del texto y el correo es el relay", () => {
    const r = leerCandidatoDeIndeed(correoSolicitudSinEtiquetas);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidato).toEqual(
      expect.objectContaining({
        name: "Johnathon Garza",
        phone: "9565550188",
        role: "Driver",
        location: "McAllen, TX",
        home_location: null,
        email: "p4t7wz@indeedemail.com",
        correoEsRelay: true,
      }),
    );
  });
});

describe("regla de descarte: un mensaje sin teléfono nace descartado", () => {
  const candidatoDeMensaje = (phone: string, descarte: CandidatoDeIndeed["descarte"]): CandidatoDeIndeed => ({
    name: "Jesse Sanchez",
    email: "m3q8ld@indeedemail.com",
    correoEsRelay: true,
    phone,
    role: "Inventory and Warehouse Coordinator",
    location: null,
    home_location: null,
    tags: [],
    enlaces: { solicitud: null, cv: null },
    notes: "",
    descarte,
  });

  it("el alta sin teléfono sale con status discarded, origen recruiter, motivo fijo y sin llamada ni seguimiento", () => {
    const p = payloadDeAlta(candidatoDeMensaje("", { motivo: MOTIVO_SIN_TELEFONO_MENSAJE }));
    expect(p).toMatchObject({
      status: "discarded",
      discard_source: "recruiter",
      discard_reason: "Sin teléfono en el mensaje de Indeed",
      phone_date: null,
      follow_up: null,
      phone: "",
    });
  });

  it("un alta normal (con teléfono, sin descarte) no lleva estado de descarte", () => {
    const p = payloadDeAlta(candidatoDeMensaje("9565550177", null));
    expect(p).not.toHaveProperty("status");
    expect(p).not.toHaveProperty("discard_source");
    expect(p.phone).toBe("(956) 555-0177");
  });

  it("si después llega el teléfono a una ficha descartada sin teléfono, se anota; si ya tenía uno, no", () => {
    expect(llegoTelefonoTarde({ status: "discarded", phone: null }, "(956) 555-0177")).toBe(true);
    expect(llegoTelefonoTarde({ status: "discarded", phone: "" }, "(956) 555-0177")).toBe(true);
    expect(llegoTelefonoTarde({ status: "discarded", phone: "(956) 555-0100" }, "(956) 555-0177")).toBe(false);
    expect(llegoTelefonoTarde({ status: "active", phone: null }, "(956) 555-0177")).toBe(false);
    expect(llegoTelefonoTarde({ status: "discarded", phone: null }, null)).toBe(false);
  });
});

describe("solo se llenan los campos vacíos al actualizar", () => {
  it("un campo con valor nunca se pisa; los vacíos se llenan con el dato del correo", () => {
    const ficha = { phone: "(956) 555-0100", email: null, role: "", location: "Harlingen, TX", home_location: null };
    const alta = { phone: "(956) 555-0177", email: "johnathon.garza@example.com", role: "Driver", location: "McAllen, TX", home_location: "McAllen, TX" };
    expect(camposVacios(ficha, alta)).toEqual({
      email: "johnathon.garza@example.com",
      role: "Driver",
      home_location: "McAllen, TX",
    });
  });

  it("un dato vacío en el correo no llena nada", () => {
    expect(camposVacios({ phone: null, email: null, role: null, location: null, home_location: null }, { phone: "", email: null, role: "  " })).toEqual({});
  });
});

describe("etiqueta de importación", () => {
  it("la tag «Indeed import» se agrega a las calificaciones de la solicitud, sin repetirse", () => {
    expect(ETIQUETA_IMPORTACION_INDEED).toBe("Indeed import");
    expect(etiquetasDeAlta(["Forklift", "Spanish"])).toEqual(["Forklift", "Spanish", "Indeed import"]);
    expect(etiquetasDeAlta(["Forklift", "Indeed import", "Forklift"])).toEqual(["Forklift", "Indeed import"]);
    expect(etiquetasDeAlta([])).toEqual(["Indeed import"]);
  });

  it("toda alta del importador lleva la etiqueta, también la de un mensaje", () => {
    const c: CandidatoDeIndeed = {
      name: "Jesse Sanchez",
      email: null,
      correoEsRelay: false,
      phone: "",
      role: null,
      location: null,
      home_location: null,
      tags: [],
      enlaces: { solicitud: null, cv: null },
      notes: "",
      descarte: { motivo: MOTIVO_SIN_TELEFONO_MENSAJE },
    };
    expect(payloadDeAlta(c).tags).toEqual(["Indeed import"]);
  });
});
