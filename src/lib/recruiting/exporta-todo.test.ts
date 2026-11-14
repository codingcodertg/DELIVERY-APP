import { describe, it, expect } from "vitest";
import {
  CAMPOS_TODOS, EXCLUIDOS, tablaTodosLosCampos, columnasTodosLosCampos,
  type FilaParaExportar,
} from "./exporta-todo";

/**
 * Una fila completa. Va tipada como `FilaParaExportar`: si `EmployeeFile` gana o pierde un campo, este literal
 * deja de compilar (tsc lo marca), así que la prueba de cobertura no puede quedarse con un campo viejo.
 */
const FILA: FilaParaExportar = {
  id: "f-1",
  profile_id: "p-1",
  full_name: "Ana Pérez",
  email: "ana@rtg.test",
  employee_code: "E-07",
  birthday: "1990-04-02",
  date_hired: "2026-03-05",
  date_left: null,
  phone: "9563405910",
  address: "Calle 1",
  ringcentral_ext: "204",
  department: "sales",
  store: null,
  account_store: "Tienda Norte",
  directory_group: null,
  days_off: 2,
  notes: "nota",
  job_title: "Sales Representative, AI Developer",
  personal_phone: "(956) 555-0123",
  personal_email: "ana.personal@test.dev",
  emergency_name: "Luis",
  emergency_relation: "Hermano",
  emergency_phone: "9565550199",
  left_reason: null,
  left_note: null,
  left_by: null,
  left_by_name: null,
  left_recorded_at: null,
  email_plan: "Business Standard",
  email_cost_year: 150,
  email_renewal_date: "2027-01-01",
  second_email: "ana2@test.dev",
  app_username: "ana.p",
  onepassword: "yes",
  previous_phone: null,
  device_serial: "SN-1",
  qb_initials: "AP",
  remote_pc_name: "PC-ANA",
  remote_pc_status: "ok",
  rc_user_created: "yes",
  rc_device_assigned: "yes",
  risk_score: 2,
  performance_score: 3.5,
  person_score: 4,
  score_status: "green",
  score_action: "none",
  tools_cost_year: 150,
  tools_note: "herramientas",
  docKinds: ["application"],
  licencia_vence: "2027-06-30",
};

const ctxEn = { lang: "en" as const, con159: true };
const ctxEs = { lang: "es" as const, con159: true };

function valorDe(cabecera: string, lang: "en" | "es" = "en"): unknown {
  const ctx = lang === "es" ? ctxEs : ctxEn;
  const tabla = tablaTodosLosCampos([FILA], ctx);
  const i = tabla.cabeceras.findIndex((h) => h.startsWith(cabecera + " /"));
  expect(i, `falta la columna «${cabecera}»`).toBeGreaterThanOrEqual(0);
  return tabla.filas[0][i];
}

describe("cobertura: cada campo de la fila se exporta o se excluye con razón", () => {
  const claves = Object.keys(FILA);
  const directas = CAMPOS_TODOS.flatMap((c) => (c.fuente ? [c.fuente as string] : []));

  it("cada clave de la fila está exportada o excluida, y solo una vez", () => {
    for (const k of claves) {
      const exportada = directas.includes(k);
      const excluida = k in EXCLUIDOS;
      expect(exportada || excluida, `«${k}» no se exporta ni está excluida`).toBe(true);
      expect(exportada && excluida, `«${k}» está exportada y excluida a la vez`).toBe(false);
    }
  });

  it("no hay columnas que lean un campo que la fila no trae", () => {
    for (const d of directas) expect(claves).toContain(d);
  });

  it("cada exclusión tiene una razón escrita", () => {
    for (const [k, razon] of Object.entries(EXCLUIDOS)) {
      expect(razon?.trim().length, `«${k}» sin razón`).toBeGreaterThan(20);
    }
  });

  it("las claves excluidas son las que deben: el id de la cuenta, el de quien dio la baja y la lista cruda", () => {
    expect(Object.keys(EXCLUIDOS).sort()).toEqual(["docKinds", "left_by", "profile_id"]);
  });
});

describe("encabezados", () => {
  const tabla = tablaTodosLosCampos([FILA], ctxEn);

  it("son bilingües, «Inglés / Español», y únicos", () => {
    for (const h of tabla.cabeceras) expect(h).toMatch(/ \/ /);
    expect(new Set(tabla.cabeceras).size).toBe(tabla.cabeceras.length);
  });

  it("son los mismos en las dos pantallas de idioma", () => {
    expect(tablaTodosLosCampos([FILA], ctxEs).cabeceras).toEqual(tabla.cabeceras);
  });

  it("no enseñan ningún id interno, ruta de archivo ni token", () => {
    // «1Password» es el gestor de contraseñas que usa la persona (sí/no/quizá), no una contraseña: no cuenta.
    for (const h of tabla.cabeceras) expect(h.toLowerCase()).not.toMatch(/profile|perfil|path|ruta|token|secret|contrase/);
  });

  it("el id del expediente va al final, como Record ID", () => {
    expect(tabla.cabeceras[tabla.cabeceras.length - 1]).toBe("Record ID / ID del expediente");
  });

  it("sigue el orden de las secciones de la ficha: datos, contacto, emergencia, herramientas, puntuación, baja, expediente", () => {
    const orden = (k: string) => columnasTodosLosCampos().findIndex((c) => c.clave === k);
    expect(orden("full_name")).toBeLessThan(orden("phone"));
    expect(orden("phone")).toBeLessThan(orden("emergency_name"));
    expect(orden("emergency_name")).toBeLessThan(orden("email_plan"));
    expect(orden("email_plan")).toBeLessThan(orden("risk_score"));
    expect(orden("risk_score")).toBeLessThan(orden("tot_score"));
    expect(orden("tot_score")).toBeLessThan(orden("date_left"));
    expect(orden("date_left")).toBeLessThan(orden("licencia_vence"));
  });
});

describe("valores", () => {
  it("texto tal cual, sin lo que está en blanco", () => {
    expect(valorDe("Full name")).toBe("Ana Pérez");
    expect(valorDe("Store (file)")).toBeNull();
    expect(valorDe("Store (hub account)")).toBe("Tienda Norte");
  });

  it("los números quedan como números (para que Excel los sume)", () => {
    expect(valorDe("Email cost / year (USD)")).toBe(150);
    expect(valorDe("Risk")).toBe(2);
    expect(valorDe("Performance")).toBe(3.5);
    expect(typeof valorDe("Days off")).toBe("number");
  });

  it("las fechas salen formateadas como el resto de la app, no como AAAA-MM-DD crudo", () => {
    const v = String(valorDe("Date hired"));
    expect(v).toContain("2026");
    expect(v).not.toBe("2026-03-05");
    expect(valorDe("Date left")).toBeNull();
  });

  it("los teléfonos salen en la forma única del hub", () => {
    expect(valorDe("Office phone (phone book)")).toBe("(956) 340-5910");
    expect(valorDe("Personal phone (HR only)")).toBe("(956) 555-0123");
  });

  it("Tot Score es la suma de Riesgo, Desempeño y Persona", () => {
    expect(valorDe("Tot Score")).toBe(9.5);
  });

  it("Tot Score queda vacío si no hay ninguna de las tres cifras", () => {
    const tabla = tablaTodosLosCampos([{ ...FILA, risk_score: null, performance_score: null, person_score: null }], ctxEn);
    const i = tabla.cabeceras.findIndex((h) => h.startsWith("Tot Score /"));
    expect(tabla.filas[0][i]).toBeNull();
  });

  it("costo mensual: correo más otras herramientas, entre doce", () => {
    expect(valorDe("Tools cost / month (USD)")).toBe(25);
  });

  it("estado y cuenta se dicen en el idioma de la pantalla", () => {
    expect(valorDe("Status", "en")).toBe("Active");
    expect(valorDe("Status", "es")).toBe("Activo");
    expect(valorDe("Hub account", "en")).toBe("User created");
    expect(valorDe("Hub account", "es")).toBe("Con usuario");
  });

  it("un expediente sin cuenta dice «Sin usuario»", () => {
    const tabla = tablaTodosLosCampos([{ ...FILA, profile_id: null }], ctxEs);
    const i = tabla.cabeceras.findIndex((h) => h.startsWith("Hub account /"));
    expect(tabla.filas[0][i]).toBe("Sin usuario");
  });

  it("la baja sale con su motivo y su fecha cuando la hay", () => {
    const tabla = tablaTodosLosCampos([{
      ...FILA, date_left: "2026-11-01", left_reason: "resignation", left_by_name: "Roberto",
      left_recorded_at: "2026-11-01T18:00:00.000Z",
    }], ctxEs);
    const col = (en: string) => tabla.filas[0][tabla.cabeceras.findIndex((x) => x.startsWith(en + " /"))];
    expect(col("Status")).toBe("Baja");
    expect(col("Reason for leaving")).toBe("Renuncia");
    expect(col("Left recorded by")).toBe("Roberto");
    expect(String(col("Date left"))).toContain("2026");
  });

  it("el grupo del directorio se dice como lo enseña el selector; sin grupo es Normal", () => {
    expect(valorDe("Directory")).toBe("Normal");
    const tabla = tablaTodosLosCampos([{ ...FILA, directory_group: "remote" }], ctxEs);
    const i = tabla.cabeceras.findIndex((h) => h.startsWith("Directory /"));
    expect(tabla.filas[0][i]).toBe("Remoto");
  });

  it("papeles pendientes lista los que faltan, con su nombre", () => {
    const v = String(valorDe("Missing paperwork"));
    expect(v.length).toBeGreaterThan(0);
    expect(v).not.toMatch(/application/i);
  });

  it("campos por llenar usa las etiquetas de la ficha", () => {
    const tabla = tablaTodosLosCampos([{ ...FILA, job_title: null, personal_phone: null }], ctxEs);
    const i = tabla.cabeceras.findIndex((h) => h.startsWith("Fields to fill /"));
    expect(String(tabla.filas[0][i])).toContain("Puesto");
    expect(String(tabla.filas[0][i])).toContain("Teléfono personal");
  });

  it("el id del expediente va como último valor", () => {
    const tabla = tablaTodosLosCampos([FILA], ctxEn);
    expect(tabla.filas[0][tabla.filas[0].length - 1]).toBe("f-1");
  });

  it("una fila por persona, en el mismo orden que recibe", () => {
    const tabla = tablaTodosLosCampos([FILA, { ...FILA, id: "f-2" }], ctxEn);
    expect(tabla.filas).toHaveLength(2);
    expect(tabla.filas[1][tabla.filas[1].length - 1]).toBe("f-2");
    expect(tabla.filas[0]).toHaveLength(tabla.cabeceras.length);
  });
});
