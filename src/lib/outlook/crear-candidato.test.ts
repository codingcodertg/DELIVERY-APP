/**
 * Coincidencia de una solicitud de Indeed con una ficha que ya existe. Tres casos: por teléfono y por correo directo (de
 * confianza: se llenan los campos vacíos), y solo por nombre (no se toca nada: ni campos, ni CV, ni nota).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { AVISO_SOLO_NOMBRE, comoCoincide, crearCandidatoDesdeCorreo } from "./crear-candidato";
import type { CandidatoDeIndeed } from "./indeed";

type Fila = Record<string, unknown> & { id: string };
type Escritura = { tabla: string; op: string; datos?: unknown };

/** Base falsa mínima: filtros `eq` reales; `ilike` no filtra (devuelve todas, como si la base no acotara). */
function dbFalsa(filas: Fila[]) {
  const escrituras: Escritura[] = [];
  const tabla = (nombre: string) => {
    const filtros: Array<(f: Fila) => boolean> = [];
    const resultado = () => filas.filter((f) => filtros.every((fn) => fn(f)));
    const b = {
      select: () => b,
      ilike: () => b,
      eq: (col: string, v: unknown) => {
        filtros.push((f) => f[col] === v);
        return b;
      },
      limit: () => b,
      maybeSingle: () => Promise.resolve({ data: resultado()[0] ?? null, error: null }),
      update: (datos: unknown) => {
        escrituras.push({ tabla: nombre, op: "update", datos });
        return { eq: () => Promise.resolve({ error: null }) };
      },
      insert: (datos: unknown) => {
        escrituras.push({ tabla: nombre, op: "insert", datos });
        return { select: () => ({ single: () => Promise.resolve({ data: { id: "nueva" }, error: null }) }) };
      },
      then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: resultado(), error: null }).then(ok),
    };
    return b;
  };
  const db = {
    schema: () => ({ from: (t: string) => tabla(t) }),
    storage: {
      from: () => ({
        upload: async () => {
          escrituras.push({ tabla: "storage", op: "upload" });
          return { error: null };
        },
        remove: async () => ({ error: null }),
      }),
    },
  };
  return { db: db as unknown as SupabaseClient, escrituras };
}

/** Solicitud de Indeed: el correo del relay (no identifica a nadie) salvo que el test diga otra cosa. */
const solicitud = (p: Partial<CandidatoDeIndeed>): CandidatoDeIndeed => ({
  name: "Johnathon Garza",
  email: "r7k2mx@indeedemail.com",
  correoEsRelay: true,
  phone: "9565550177",
  role: "Driver",
  location: "McAllen, TX",
  home_location: "Harlingen, TX",
  tags: [],
  enlaces: { solicitud: null, cv: null },
  notes: "",
  ...p,
});

/** Ficha existente: todos los campos del importador, vacíos salvo los que el test pone. */
const ficha = (p: Partial<Fila> & { id: string }): Fila => ({
  name: "Johnathon Garza",
  phone: null,
  email: null,
  role: null,
  location: null,
  home_location: null,
  status: "registered",
  resume_path: null,
  ...p,
});

describe("comoCoincide: de qué confía el alta", () => {
  it("caso 1, teléfono: mismos dígitos aunque el formato cambie", () => {
    expect(comoCoincide({ phone: "956-555-0177" }, { phone: "9565550177", email: null, correoEsRelay: false })).toBe("telefono");
  });

  it("caso 2, correo directo: misma dirección (no relay) aunque el nombre sea otro", () => {
    expect(comoCoincide({ phone: null, email: "johnathon.garza@example.com" }, { phone: "", email: "johnathon.garza@example.com", correoEsRelay: false })).toBe("email");
  });

  it("el relay de Indeed nunca cuenta como correo de la persona", () => {
    expect(comoCoincide({ phone: null, email: "r7k2mx@indeedemail.com" }, { phone: "", email: "r7k2mx@indeedemail.com", correoEsRelay: true })).toBe("nombre");
  });

  it("caso 3, solo nombre: sin teléfono ni correo en común", () => {
    expect(comoCoincide({ phone: "(956) 555-0100", email: "otro@example.com" }, { phone: "9565550177", email: "r7k2mx@indeedemail.com", correoEsRelay: true })).toBe("nombre");
  });
});

describe("crearCandidatoDesdeCorreo: el alta sobre una persona existente", () => {
  const cv = { nombreFichero: "cv.pdf", bytes: Buffer.from("%PDF-1.4 x") };

  it("coincidencia SOLO por nombre: no escribe nada, ni campos ni CV, y avisa", async () => {
    const { db, escrituras } = dbFalsa([ficha({ id: "c1", phone: "(956) 555-0100", email: "otro@example.com" })]);
    const r = await crearCandidatoDesdeCorreo(db, solicitud({}), cv);
    expect(r).toEqual({ resultado: "duplicate", candidateId: "c1", avisoCv: null, aviso: AVISO_SOLO_NOMBRE });
    expect(AVISO_SOLO_NOMBRE).toBe("Coincide solo por nombre; no se completó");
    expect(escrituras).toEqual([]);
  });

  it("coincidencia por TELÉFONO: llena solo los campos vacíos (puesto, ciudad, dónde vive, correo)", async () => {
    const { db, escrituras } = dbFalsa([ficha({ id: "c2", name: "Johnathon Garza", phone: "956-555-0177", location: "Harlingen, TX" })]);
    const r = await crearCandidatoDesdeCorreo(db, solicitud({}), null);
    expect(r).toEqual({ resultado: "duplicate", candidateId: "c2", avisoCv: null, aviso: null });
    expect(escrituras).toEqual([
      {
        tabla: "candidates",
        op: "update",
        datos: { role: "Driver", home_location: "Harlingen, TX", email: "r7k2mx@indeedemail.com" },
      },
    ]);
  });

  it("coincidencia por CORREO DIRECTO con nombre distinto: no toca la ficha (el nombre choca)", async () => {
    const { db, escrituras } = dbFalsa([ficha({ id: "c3", name: "J Garza", email: "johnathon.garza@example.com", location: "Harlingen, TX" })]);
    const r = await crearCandidatoDesdeCorreo(
      db,
      solicitud({ name: "Johnathon Garza", phone: "", email: "johnathon.garza@example.com", correoEsRelay: false, location: "McAllen, TX" }),
      null,
    );
    expect(r.resultado).toBe("duplicate");
    expect(r.candidateId).toBe("c3");
    expect(escrituras).toEqual([]);
  });
});

describe("comoCoincide con nombre que choca (revisión de seguridad)", () => {
  it("mismo teléfono pero otro nombre cuenta como solo nombre: no se toca la ficha", () => {
    expect(comoCoincide({ phone: "(956) 555-1234", name: "Maria Lopez" }, { phone: "9565551234", email: null, correoEsRelay: false, name: "Juan Perez" })).toBe("nombre");
  });
  it("mismo teléfono y mismo nombre (sin acentos ni mayúsculas) sí cuenta por teléfono", () => {
    expect(comoCoincide({ phone: "(956) 555-1234", name: "José Pérez" }, { phone: "9565551234", email: null, correoEsRelay: false, name: "jose perez" })).toBe("telefono");
  });
});
