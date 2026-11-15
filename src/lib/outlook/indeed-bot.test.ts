import { beforeEach, describe, expect, it, vi } from "vitest";

// La entrada del bot reusa las MISMAS funciones que el buzón de Outlook: aquí se mockean solo el alta y el mensaje
// (lo que tocaría la base de verdad). El registro (`outlook_processed`) es una base falsa en memoria con clave primaria,
// así que la idempotencia se prueba de verdad: el segundo envío del mismo externalId choca y no crea nada.

const h = vi.hoisted(() => ({
  crear: vi.fn(),
  procesar: vi.fn(),
}));

vi.mock("./crear-candidato", () => ({ crearCandidatoDesdeCorreo: h.crear }));
vi.mock("./mensaje-a-candidato", () => ({ procesarMensaje: h.procesar }));

import {
  MAX_CUERPO_INGESTA_BYTES,
  MAX_ELEMENTOS_INGESTA,
  MAX_TEXTO_MENSAJE,
  procesaElementoDeBot,
  tokenAutorizado,
  validaIngesta,
} from "./indeed-bot";
import type { SupabaseClient } from "@supabase/supabase-js";

const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(64, 0x20)]).toString("base64");

function solicitud(extra: Record<string, unknown> = {}) {
  return {
    kind: "application",
    externalId: "app-1",
    receivedAt: "2026-11-13T14:05:00Z",
    candidateName: "Maria Lopez",
    position: "Cashier",
    location: "McAllen, TX",
    phone: "(956) 555-0182",
    qualifications: ["Forklift", "Spanish", "Forklift"],
    links: { application: "https://www.indeed.com/applications/abc", resume: null },
    ...extra,
  };
}

function mensaje(extra: Record<string, unknown> = {}) {
  return {
    kind: "message",
    externalId: "msg-1",
    receivedAt: "2026-11-13T14:05:00Z",
    candidateName: "Jesse Sanchez",
    position: "Inventory Coordinator",
    location: "Harlingen, TX",
    text: "Hello yes Monday at 12pm works",
    ...extra,
  };
}

/** Base falsa de `outlook_processed`: clave primaria por message_id, como en la base real. */
function registroFalso() {
  const filas = new Map<string, Record<string, unknown>>();
  const db = {
    schema: () => ({
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          if (filas.has(row.message_id as string)) return { error: { code: "23505", message: "duplicate key" } };
          filas.set(row.message_id as string, { ...row });
          return { error: null };
        },
        update: (cambios: Record<string, unknown>) => ({
          eq: (_col: string, valor: string) => {
            const f = filas.get(valor);
            if (f) Object.assign(f, cambios);
            return { error: null };
          },
        }),
      }),
    }),
  };
  return { db: db as unknown as SupabaseClient, filas };
}

beforeEach(() => {
  h.crear.mockReset();
  h.procesar.mockReset();
  h.crear.mockResolvedValue({ resultado: "created", candidateId: "cand-1", avisoCv: null });
  h.procesar.mockResolvedValue({ resultado: "noted", candidateId: "cand-2", error: null, scheduledAt: null, detail: "Teléfono guardado" });
});

describe("validación del envío", () => {
  it("acepta un envío válido y normaliza el teléfono y la fecha", () => {
    const v = validaIngesta({ items: [solicitud()] });
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.items[0].phone).toBe("9565550182");
    expect(v.items[0].receivedAt).toBe("2026-11-13T14:05:00.000Z");
    expect(v.items[0].qualifications).toEqual(["Forklift", "Spanish"]);
  });

  it("el tope de elementos es 25: 25 pasan, 26 no, y 0 tampoco", () => {
    expect(MAX_ELEMENTOS_INGESTA).toBe(25);
    expect(validaIngesta({ items: Array.from({ length: 25 }, (_, i) => solicitud({ externalId: `a-${i}` })) }).ok).toBe(true);
    expect(validaIngesta({ items: Array.from({ length: 26 }, (_, i) => solicitud({ externalId: `a-${i}` })) }).ok).toBe(false);
    expect(validaIngesta({ items: [] }).ok).toBe(false);
  });

  it("rechaza cuerpos y campos desconocidos (estricto)", () => {
    expect(validaIngesta(null).ok).toBe(false);
    expect(validaIngesta([]).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud()], otra: 1 }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ email: "x@y.com" })] }).ok).toBe(false);
  });

  it("valida tipo y forma de cada campo", () => {
    expect(validaIngesta({ items: [solicitud({ kind: "other" })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ externalId: "con espacio" })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ externalId: "x".repeat(201) })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ receivedAt: "ayer por la tarde" })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ candidateName: "" })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ candidateName: "x".repeat(121) })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ qualifications: "Forklift" })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ qualifications: Array.from({ length: 31 }, (_, i) => `q${i}`) })] }).ok).toBe(false);
  });

  it("el texto del mensaje tiene tope de 20 000 caracteres", () => {
    expect(MAX_TEXTO_MENSAJE).toBe(20_000);
    expect(validaIngesta({ items: [mensaje({ text: "a".repeat(20_000) })] }).ok).toBe(true);
    expect(validaIngesta({ items: [mensaje({ text: "a".repeat(20_001) })] }).ok).toBe(false);
  });

  it("los enlaces solo pasan si son https de indeed.com; los demás se descartan sin error", () => {
    const v = validaIngesta({
      items: [solicitud({ links: { application: "http://www.indeed.com/x", resume: "https://evil.com/cv.pdf" } })],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.items[0].links).toEqual({ application: null, resume: null });
    const ok = validaIngesta({ items: [solicitud({ links: { resume: "https://resumes.indeed.com/abc" } })] });
    if (ok.ok) expect(ok.items[0].links.resume).toBe("https://resumes.indeed.com/abc");
    expect(validaIngesta({ items: [solicitud({ links: { otra: "https://www.indeed.com" } })] }).ok).toBe(false);
  });

  it("un teléfono que no se puede leer se trata como ausente", () => {
    const v = validaIngesta({ items: [solicitud({ phone: "llámame" })] });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.items[0].phone).toBeNull();
  });

  it("el CV: base64 válido sí; base64 roto o campos extra no", () => {
    const bien = validaIngesta({ items: [solicitud({ resume: { filename: "cv.pdf", contentBase64: PDF } })] });
    expect(bien.ok).toBe(true);
    if (bien.ok) expect(bien.items[0].resume?.bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(validaIngesta({ items: [solicitud({ resume: { filename: "cv.pdf", contentBase64: "no base64!" } })] }).ok).toBe(false);
    expect(validaIngesta({ items: [solicitud({ resume: { filename: "cv.pdf", contentBase64: PDF, extra: 1 } })] }).ok).toBe(false);
  });

  it("el cuerpo tiene tope de 4 MB", () => {
    expect(MAX_CUERPO_INGESTA_BYTES).toBe(4 * 1024 * 1024);
  });
});

describe("token del bot", () => {
  it("solo el token exacto en Bearer pasa", () => {
    expect(tokenAutorizado(null, "secreto")).toBe(false);
    expect(tokenAutorizado("", "secreto")).toBe(false);
    expect(tokenAutorizado("Bearer otro", "secreto")).toBe(false);
    expect(tokenAutorizado("Bearer secreto2", "secreto")).toBe(false);
    expect(tokenAutorizado("Basic secreto", "secreto")).toBe(false);
    expect(tokenAutorizado("secreto", "secreto")).toBe(false);
    expect(tokenAutorizado("Bearer secreto", "secreto")).toBe(true);
  });

  it("sin token configurado, nadie entra", () => {
    expect(tokenAutorizado("Bearer ", "")).toBe(false);
    expect(tokenAutorizado("Bearer x", "")).toBe(false);
  });
});

describe("procesamiento de un elemento", () => {
  it("una solicitud va a crearCandidatoDesdeCorreo con los campos del bot y source Indeed", async () => {
    const { db } = registroFalso();
    const it = validaIngesta({ items: [solicitud()] });
    if (!it.ok) throw new Error(it.error);
    const r = await procesaElementoDeBot(db, it.items[0], new Date("2026-11-13T15:00:00Z"));
    expect(r).toMatchObject({ externalId: "app-1", result: "created", candidateId: "cand-1" });
    expect(h.procesar).not.toHaveBeenCalled();
    const [, cand, cv] = h.crear.mock.calls[0];
    expect(cand).toMatchObject({
      name: "Maria Lopez",
      phone: "9565550182",
      email: null,
      role: "Cashier",
      home_location: "McAllen, TX",
      tags: ["Forklift", "Spanish"],
    });
    expect(cand.notes).toContain("Llegó desde Indeed (bot) para Cashier");
    expect(cv).toBeNull();
  });

  it("una solicitud con CV válido pasa el CV; con CV inválido se crea igual con aviso", async () => {
    const { db } = registroFalso();
    const bueno = validaIngesta({ items: [solicitud({ externalId: "a1", resume: { filename: "Maria.pdf", contentBase64: PDF } })] });
    const malo = validaIngesta({ items: [solicitud({ externalId: "a2", resume: { filename: "cv.txt", contentBase64: PDF } })] });
    if (!bueno.ok || !malo.ok) throw new Error("fixture");
    await procesaElementoDeBot(db, bueno.items[0], new Date());
    expect(h.crear.mock.calls[0][2].nombreFichero).toBe("Maria.pdf");
    const r = await procesaElementoDeBot(db, malo.items[0], new Date());
    expect(h.crear.mock.calls[1][2]).toBeNull();
    expect(r.result).toBe("created");
    expect(r.error).toBe("CV no guardado: el adjunto no es PDF, DOC ni DOCX");
  });

  it("una solicitud sin teléfono ni correo se omite sin crear nada", async () => {
    const { db, filas } = registroFalso();
    const it = validaIngesta({ items: [solicitud({ phone: undefined })] });
    if (!it.ok) throw new Error(it.error);
    const r = await procesaElementoDeBot(db, it.items[0], new Date());
    expect(r).toMatchObject({ result: "skipped", error: "sin teléfono ni correo del candidato" });
    expect(h.crear).not.toHaveBeenCalled();
    expect(filas.get("bot:app-1")?.result).toBe("skipped");
  });

  it("un mensaje va a procesarMensaje con el teléfono del bot como respaldo", async () => {
    const { db } = registroFalso();
    const it = validaIngesta({ items: [mensaje({ phone: "956-555-0199" })] });
    if (!it.ok) throw new Error(it.error);
    const ahora = new Date("2026-11-13T15:00:00Z");
    const r = await procesaElementoDeBot(db, it.items[0], ahora);
    expect(h.crear).not.toHaveBeenCalled();
    expect(h.procesar).toHaveBeenCalledTimes(1);
    const [, args] = h.procesar.mock.calls[0];
    expect(args).toMatchObject({
      recibido: "2026-11-13T14:05:00.000Z",
      ahora: ahora.toISOString(),
      replyToRelay: null,
      telefonoExtra: "9565550199",
    });
    expect(args.mensaje).toEqual({
      candidateName: "Jesse Sanchez",
      texto: "Hello yes Monday at 12pm works",
      puesto: "Inventory Coordinator",
      empresa: null,
      ubicacion: "Harlingen, TX",
    });
    expect(r).toMatchObject({ result: "noted", candidateId: "cand-2", detail: "Teléfono guardado" });
  });

  it("un mensaje sin texto se omite", async () => {
    const { db } = registroFalso();
    const it = validaIngesta({ items: [mensaje({ text: "" })] });
    if (!it.ok) throw new Error(it.error);
    const r = await procesaElementoDeBot(db, it.items[0], new Date());
    expect(r).toMatchObject({ result: "skipped", error: "message sin texto" });
    expect(h.procesar).not.toHaveBeenCalled();
  });

  it("un error de la base o del alta se anota como failed y no tumba el envío", async () => {
    const { db, filas } = registroFalso();
    h.crear.mockRejectedValueOnce(new Error("No se pudo guardar el candidato: boom"));
    const it = validaIngesta({ items: [solicitud()] });
    if (!it.ok) throw new Error(it.error);
    const r = await procesaElementoDeBot(db, it.items[0], new Date());
    expect(r).toMatchObject({ result: "failed", error: "No se pudo guardar el candidato: boom" });
    expect(filas.get("bot:app-1")).toMatchObject({ result: "failed", error: "No se pudo guardar el candidato: boom" });
  });
});

describe("idempotencia", () => {
  it("el mismo externalId dos veces: la segunda vez no crea ni llama a nada", async () => {
    const { db, filas } = registroFalso();
    const it = validaIngesta({ items: [solicitud({ externalId: "dup-1" })] });
    if (!it.ok) throw new Error(it.error);
    const primera = await procesaElementoDeBot(db, it.items[0], new Date());
    const segunda = await procesaElementoDeBot(db, it.items[0], new Date());
    expect(primera.result).toBe("created");
    expect(segunda).toMatchObject({ externalId: "dup-1", result: "skipped", candidateId: null });
    expect(segunda.error).toContain("ya recibido antes");
    expect(h.crear).toHaveBeenCalledTimes(1);
    expect(filas.has("bot:dup-1")).toBe(true);
  });

  it("el mismo mensaje dos veces tampoco vuelve a agendar ni a anotar", async () => {
    const { db } = registroFalso();
    const it = validaIngesta({ items: [mensaje({ externalId: "msg-dup" })] });
    if (!it.ok) throw new Error(it.error);
    await procesaElementoDeBot(db, it.items[0], new Date());
    const otra = await procesaElementoDeBot(db, it.items[0], new Date());
    expect(otra.result).toBe("skipped");
    expect(h.procesar).toHaveBeenCalledTimes(1);
  });
});
