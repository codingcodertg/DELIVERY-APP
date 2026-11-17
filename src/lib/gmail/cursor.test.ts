import { describe, expect, it } from "vitest";
import { cursorInicial, nuevoUidCursor, uidsPendientes } from "./cursor";
import { claveDelCorreo } from "./clave";
import { reclamaRegistro } from "@/lib/outlook/registro";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("uidsPendientes", () => {
  it("devuelve solo los UID mayores que el cursor, ordenados y con tope", () => {
    expect(uidsPendientes([9, 3, 15, 7, 12], 7, 2)).toEqual([9, 12]);
  });

  it("sin pendientes devuelve lista vacía", () => {
    expect(uidsPendientes([1, 2, 3], 3, 50)).toEqual([]);
  });

  it("ignora valores que no son enteros", () => {
    expect(uidsPendientes([4.5, 6, Number.NaN], 0, 50)).toEqual([6]);
  });
});

describe("nuevoUidCursor", () => {
  it("avanza al máximo procesado", () => {
    expect(nuevoUidCursor(10, [11, 12, 14])).toBe(14);
  });

  it("nunca retrocede aunque lo procesado sea menor", () => {
    expect(nuevoUidCursor(20, [5, 6])).toBe(20);
    expect(nuevoUidCursor(20, [])).toBe(20);
  });
});

describe("cursorInicial (UIDVALIDITY)", () => {
  it("si el UIDVALIDITY coincide, sigue con el UID guardado", () => {
    expect(cursorInicial({ uidvalidity: 77, ultimoUid: 540 }, 77)).toEqual({ uidvalidity: 77, ultimoUid: 540, reinicio: false });
  });

  it("si cambió, empieza de cero y avisa del reinicio", () => {
    expect(cursorInicial({ uidvalidity: 77, ultimoUid: 540 }, 91)).toEqual({ uidvalidity: 91, ultimoUid: 0, reinicio: true });
  });

  it("sin UIDVALIDITY guardado empieza de cero sin marcarlo como reinicio", () => {
    expect(cursorInicial({ uidvalidity: null, ultimoUid: 0 }, 91)).toEqual({ uidvalidity: 91, ultimoUid: 0, reinicio: false });
  });
});

describe("claveDelCorreo (dedupe)", () => {
  it("el mismo Message-ID da la misma clave, con o sin ángulos y en cualquier caja", () => {
    const a = claveDelCorreo({ messageId: "<ABC123@indeed.com>", uidvalidity: 1, uid: 5 });
    const b = claveDelCorreo({ messageId: "abc123@indeed.com", uidvalidity: 9, uid: 77 });
    expect(a).toBe("gmail:abc123@indeed.com");
    expect(a).toBe(b);
  });

  it("sin Message-ID usa UIDVALIDITY y UID, y dentro de un lote el número de adjunto", () => {
    expect(claveDelCorreo({ messageId: null, uidvalidity: 77, uid: 540 })).toBe("gmail:uid:77:540");
    expect(claveDelCorreo({ messageId: "", uidvalidity: 77, uid: 540, parte: 2 })).toBe("gmail:uid:77:540:2");
  });
});

describe("dedupe en el registro compartido (outlook_processed)", () => {
  /** Un registro de mentira: el primer insert entra y el segundo choca con la clave primaria (23505), como Postgres. */
  function registroFalso() {
    const claves = new Set<string>();
    const db = {
      schema: () => ({
        from: () => ({
          insert: async (fila: { message_id: string }) => {
            if (claves.has(fila.message_id)) return { error: { code: "23505", message: "duplicate key" } };
            claves.add(fila.message_id);
            return { error: null };
          },
        }),
      }),
    } as unknown as SupabaseClient;
    return db;
  }

  it("el mismo correo llegado por redirección y luego reenviado en lote se reclama una sola vez", async () => {
    const db = registroFalso();
    const porRedireccion = claveDelCorreo({ messageId: "<m1@indeed.com>", uidvalidity: 1, uid: 10 });
    const porLote = claveDelCorreo({ messageId: "<M1@indeed.com>", uidvalidity: 1, uid: 99, parte: 0 });
    const datos = { receivedAt: null, subject: "x", fromAddress: "noreply@indeed.com" };
    expect(await reclamaRegistro(db, { messageId: porRedireccion, ...datos })).toBe("reclamado");
    expect(await reclamaRegistro(db, { messageId: porLote, ...datos })).toBe("ya-reclamado");
  });
});
