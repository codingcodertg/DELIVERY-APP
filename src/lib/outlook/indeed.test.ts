/**
 * ATENCIÓN: los cuerpos de estos fixtures son INVENTADOS a partir de los patrones que se conocen de Indeed
 * («New application: <Puesto> - <Nombre>», «<Nombre> applied to <Puesto>», líneas «Name:/Email:/Phone:», relay
 * xxx@indeedemail.com en Reply-To). No son correos reales. Cuando haya un correo real de Indeed, añadir su fixture
 * (quitando datos personales) y ajustar las reglas de indeed.ts si hace falta.
 */
import { describe, expect, it } from "vitest";
import {
  aTextoPlano,
  datosDelAsunto,
  direccionDe,
  esCorreoDeIndeed,
  esDireccionIndeed,
  extraerEmails,
  clasificaCorreoIndeed,
  leerCandidatoDeIndeed,
  leerMensajeDeIndeed,
  telefonoDe,
  type CorreoDeIndeed,
} from "./indeed";

/**
 * REAL: capturas de pantalla que envió el dueño (texto transcrito, no el HTML original). El remitente y el asunto no se
 * vieron: el asunto es el encabezado y el From de Indeed es SUPUESTO. El Reply-To del relay tampoco se vio.
 */
const fixtureMensajeReal: CorreoDeIndeed = {
  recibido: "2026-11-13T14:05:00Z",
  dominioBuzon: "rtgcorp.example",
  subject: "You've received a new message from Jesse Sanchez",
  from: "Indeed <noreply@indeed.com>",
  replyTo: [],
  cuerpo:
    '<html><body><img alt="Indeed For Employers"/>' +
    "<h2>You've received a new message from Jesse Sanchez</h2>" +
    "<div>Hello yes would Monday at 12pm work?</div><hr/>" +
    '<a href="https://www.indeed.com/job"><b><u>Inventory and Warehouse Coordinator</u></b></a><br/>' +
    "RODRIGUEZ TILE GROUP<br/>McAllen, TX 78501</body></html>",
};

const fixtureSolicitudReal: CorreoDeIndeed = {
  recibido: "2026-11-13T14:05:00Z",
  dominioBuzon: "rtgcorp.example",
  subject: "Johnathon Garza applied",
  from: "Indeed <noreply@indeed.com>",
  replyTo: ["r7k2mx@indeedemail.com"],
  cuerpo:
    '<html><body><img alt="Indeed For Employers"/>' +
    '<h2><a href="https://www.indeed.com/applications/johnathon">Johnathon Garza</a> applied</h2>' +
    "<p>Inventory and Warehouse Coordinator &bull; McAllen, TX</p>" +
    "<p>Qualifications</p>" +
    "<p>Forklift &middot; US work authorization &middot; Spanish &middot; Driver's License &middot; Computer operation &middot; English</p>" +
    '<a href="https://www.indeed.com/applications/full/johnathon">See full application</a> ' +
    '<a href="https://www.indeed.com/resume/johnathon">View resume</a>' +
    "<p>Manage application update settings</p></body></html>",
};

const base = { recibido: "2026-11-13T14:05:00Z", dominioBuzon: "rtgcorp.example" };

/** 1. Inglés, texto plano con etiquetas y correo directo. Asunto «New application: Puesto - Nombre». */
const fixtureTextoEtiquetas: CorreoDeIndeed = {
  ...base,
  subject: "New application: Cashier - Maria Lopez",
  from: "Indeed <noreply@indeed.com>",
  replyTo: ["k8s3j2@indeedemail.com"],
  cuerpo: [
    "Maria Lopez applied to your job Cashier.",
    "",
    "Name: Maria Lopez",
    "Email: maria.lopez@gmail.com",
    "Phone: (956) 555-0182",
    "Location: Brownsville, TX",
    "Job: Cashier",
  ].join("\n"),
};

/** 2. Inglés, HTML con relay de Indeed como único correo y el teléfono suelto en el texto. Asunto «X applied to Y». */
const fixtureHtmlRelay: CorreoDeIndeed = {
  ...base,
  subject: "Juan Perez applied to Warehouse Associate",
  from: "Indeed <indeed@indeedmail.com>",
  replyTo: ["x9f2qa@indeedemail.com"],
  cuerpo:
    '<html><body><p>Juan Perez has applied to <b>Warehouse Associate</b>.</p>' +
    '<table><tr><td>Contact the applicant:</td><td><a href="mailto:x9f2qa@indeedemail.com">x9f2qa@indeedemail.com</a></td></tr>' +
    "<tr><td>Phone</td><td>+1 956 555 0199</td></tr></table>" +
    '<p><a href="https://www.indeed.com/view-resume">View resume</a></p></body></html>',
};

/** 3. Español, asunto «Nueva solicitud: Puesto - Nombre», etiquetas en español, teléfono con +1. */
const fixtureEspanol: CorreoDeIndeed = {
  ...base,
  subject: "Nueva solicitud: Auxiliar de almacén - Ana Gómez",
  from: "Indeed <no-responder@indeed.com>",
  replyTo: [],
  cuerpo: [
    "Ana Gómez aplicó a tu vacante Auxiliar de almacén.",
    "Nombre: Ana Gómez",
    "Teléfono: +1 956 555 0144",
    "Correo electrónico: ana.gomez@correo.com",
    "Ubicación: Harlingen, TX",
  ].join("\n"),
};

/** 4. Solo Reply-To (relay) y el teléfono sin etiqueta. Sin correo directo en el cuerpo. */
const fixtureSoloReplyTo: CorreoDeIndeed = {
  ...base,
  subject: "Carlos Ruiz applied to Driver",
  from: "Indeed <indeed@indeedemail.com>",
  replyTo: ["p4t7wz@indeedemail.com"],
  cuerpo: "Carlos Ruiz has applied to Driver. Call him at 956-555-0166 for more details.",
};

/** 5. No es un aviso de candidato (resumen de Indeed). Debe salir como «omitido», no como candidato. */
const fixtureNoEsCandidato: CorreoDeIndeed = {
  ...base,
  subject: "Your weekly job alerts from Indeed",
  from: "Indeed <alerts@indeed.com>",
  replyTo: [],
  cuerpo: "Here are 10 new jobs near you. Apply now at https://www.indeed.com/jobs",
};

/** 6. Hay nombre pero ni teléfono ni correo: no se puede contactar, se omite con motivo. */
const fixtureSinContacto: CorreoDeIndeed = {
  ...base,
  subject: "New application: Cook - Pedro Diaz",
  from: "Indeed <noreply@indeed.com>",
  replyTo: [],
  cuerpo: "Pedro Diaz applied to Cook. Open Indeed to see the full application.",
};

describe("leerCandidatoDeIndeed (fixtures inventados, ver la nota arriba)", () => {
  it("1. inglés con etiquetas y correo directo", () => {
    const r = leerCandidatoDeIndeed(fixtureTextoEtiquetas);
    expect(r).toEqual({
      ok: true,
      candidato: expect.objectContaining({
        name: "Maria Lopez",
        email: "maria.lopez@gmail.com",
        correoEsRelay: false,
        phone: "9565550182",
        role: "Cashier",
        home_location: "Brownsville, TX",
      }),
    });
  });

  it("2. HTML: el relay es el único correo y se marca como relay", () => {
    const r = leerCandidatoDeIndeed(fixtureHtmlRelay);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidato.name).toBe("Juan Perez");
    expect(r.candidato.email).toBe("x9f2qa@indeedemail.com");
    expect(r.candidato.correoEsRelay).toBe(true);
    expect(r.candidato.phone).toBe("9565550199");
    expect(r.candidato.role).toBe("Warehouse Associate");
  });

  it("3. español: asunto y etiquetas en español, teléfono con +1", () => {
    const r = leerCandidatoDeIndeed(fixtureEspanol);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidato.name).toBe("Ana Gómez");
    expect(r.candidato.email).toBe("ana.gomez@correo.com");
    expect(r.candidato.phone).toBe("9565550144");
    expect(r.candidato.role).toBe("Auxiliar de almacén");
    expect(r.candidato.home_location).toBe("Harlingen, TX");
  });

  it("4. solo Reply-To: usa el relay y no inventa correo directo", () => {
    const r = leerCandidatoDeIndeed(fixtureSoloReplyTo);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.candidato.email).toBe("p4t7wz@indeedemail.com");
    expect(r.candidato.correoEsRelay).toBe(true);
    expect(r.candidato.phone).toBe("9565550166");
  });

  it("5. un aviso que no es de candidato se omite con motivo", () => {
    const r = leerCandidatoDeIndeed(fixtureNoEsCandidato);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/nombre/);
  });

  it("6. sin teléfono ni correo se omite con motivo", () => {
    const r = leerCandidatoDeIndeed(fixtureSinContacto);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/sin teléfono ni correo/);
  });

  it("rechaza un correo que no viene de Indeed aunque tenga el formato", () => {
    const r = leerCandidatoDeIndeed({ ...fixtureTextoEtiquetas, from: "Amigo <amigo@gmail.com>" });
    expect(r).toEqual({ ok: false, motivo: "no es de Indeed" });
  });

  it("nunca toma la dirección del propio buzón como la del candidato", () => {
    const r = leerCandidatoDeIndeed({
      ...fixtureSinContacto,
      cuerpo: "Pedro Diaz applied to Cook. Questions? write to hr@rtgcorp.example or call 956-555-0100",
      replyTo: [],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.candidato.email).toBeNull();
  });
});

describe("piezas del parser", () => {
  it("dominios de Indeed: exactos y subdominios, nunca imitaciones", () => {
    expect(esDireccionIndeed("a@indeed.com")).toBe(true);
    expect(esDireccionIndeed("a@x.indeedemail.com")).toBe(true);
    expect(esDireccionIndeed("a@indeedmail.com")).toBe(true);
    expect(esDireccionIndeed("a@indeed.com.evil.net")).toBe(false);
    expect(esDireccionIndeed("a@notindeed.com")).toBe(false);
    expect(esDireccionIndeed("a@gmail.com")).toBe(false);
  });

  it("lee la dirección de un From con nombre", () => {
    expect(direccionDe("Indeed <Noreply@Indeed.com>")).toBe("noreply@indeed.com");
    expect(esCorreoDeIndeed("Indeed <noreply@indeed.com>")).toBe(true);
    expect(esCorreoDeIndeed("Juan <juan@gmail.com>")).toBe(false);
  });

  it("asunto: los dos formatos y el de solo nombre", () => {
    expect(datosDelAsunto("New application: Cashier - Maria Lopez")).toEqual({ puesto: "Cashier", nombre: "Maria Lopez" });
    expect(datosDelAsunto("Juan Perez applied to Warehouse Associate")).toEqual({ nombre: "Juan Perez", puesto: "Warehouse Associate" });
    expect(datosDelAsunto("New applicant: Lee Park")).toEqual({ nombre: "Lee Park", puesto: null });
    expect(datosDelAsunto("Hola")).toEqual({ nombre: null, puesto: null });
  });

  it("teléfono: 10 dígitos en varios formatos, sin tomar otros números", () => {
    expect(telefonoDe("Tel (956) 555-0182")).toBe("9565550182");
    expect(telefonoDe("+1 956.555.0182")).toBe("9565550182");
    expect(telefonoDe("9565550182")).toBe("9565550182");
    expect(telefonoDe("Pedido 12345 de 2026")).toBeNull();
  });

  it("correos: sin repetir, en minúsculas, sin imágenes", () => {
    expect(extraerEmails("A@X.com a@x.com logo@2x.png")).toEqual(["a@x.com"]);
  });

  it("HTML a texto: los bloques se conservan como saltos de línea", () => {
    expect(aTextoPlano("<p>Name: Ana</p><p>Phone: 9565550144</p>")).toBe("Name: Ana\nPhone: 9565550144");
    expect(aTextoPlano("Tom&amp;Jerry&nbsp;x")).toBe("Tom&Jerry x");
  });
});

describe("solicitud REAL (captura del dueño): «<Nombre> applied»", () => {
  it("se clasifica como application", () => {
    expect(clasificaCorreoIndeed(fixtureSolicitudReal)).toBe("application");
  });

  it("saca nombre, puesto, ubicación, calificaciones y enlaces; sin teléfono; correo = relay", () => {
    const r = leerCandidatoDeIndeed(fixtureSolicitudReal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = r.candidato;
    expect(c.name).toBe("Johnathon Garza");
    expect(c.role).toBe("Inventory and Warehouse Coordinator");
    expect(c.home_location).toBe("McAllen, TX");
    expect(c.tags).toEqual(["Forklift", "US work authorization", "Spanish", "Driver's License", "Computer operation", "English"]);
    expect(c.enlaces).toEqual({
      solicitud: "https://www.indeed.com/applications/full/johnathon",
      cv: "https://www.indeed.com/resume/johnathon",
    });
    expect(c.notes).toContain("https://www.indeed.com/applications/full/johnathon");
    expect(c.notes).toContain("https://www.indeed.com/resume/johnathon");
    expect(c.phone).toBe("");
    expect(c.email).toBe("r7k2mx@indeedemail.com");
    expect(c.correoEsRelay).toBe(true);
  });
});

describe("mensaje REAL del candidato (captura del dueño)", () => {
  it("se clasifica como message, no como application", () => {
    expect(clasificaCorreoIndeed(fixtureMensajeReal)).toBe("message");
    expect(clasificaCorreoIndeed({ ...fixtureMensajeReal, from: "Amigo <amigo@gmail.com>" })).toBe("other");
  });

  it("saca el nombre, el texto y el bloque de la vacante", () => {
    expect(leerMensajeDeIndeed(fixtureMensajeReal)).toEqual({
      ok: true,
      mensaje: {
        candidateName: "Jesse Sanchez",
        texto: "Hello yes would Monday at 12pm work?",
        puesto: "Inventory and Warehouse Coordinator",
        empresa: "RODRIGUEZ TILE GROUP",
        ubicacion: "McAllen, TX 78501",
      },
    });
  });

  it("un mensaje sin texto se rechaza con motivo", () => {
    const r = leerMensajeDeIndeed({ ...fixtureMensajeReal, cuerpo: "<h2>You've received a new message from Ana Ruiz</h2>" });
    expect(r.ok).toBe(false);
  });
});
