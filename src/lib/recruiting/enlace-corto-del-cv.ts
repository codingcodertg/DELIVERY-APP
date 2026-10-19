import { createHmac, timingSafeEqual } from "crypto";
import { DIAS_DEL_ENLACE_DEL_CV } from "./mensaje-para-el-gerente";

// ============================================================
// El enlace corto del CV (D-593, 2026-10-19). El dueño, sobre el enlace firmado de D-590 (~300 caracteres): «no podemos
// hacer un link para el cv mas corto mucho mas corto?».
//
// `https://rtg-hub.vercel.app/api/cv/<token>`: el token lleva el id del candidato y el día en que caduca, firmados con
// HMAC. Quien lo abre no necesita sesión (el gerente no tiene cuenta): la firma es la llave. El servidor comprueba la
// firma y la caducidad, busca el CV y redirige a un enlace firmado de Storage de un minuto. Sin tabla ni migración: el
// token se calcula, no se guarda.
//
// SOLO SERVIDOR (usa `node:crypto` y el secreto). Las pruebas lo importan con un secreto de mentira.
// ============================================================

/** Cuántos días vale el enlace: los mismos 7 del enlace largo de D-590. */
export const DIAS_DEL_ENLACE_CORTO: number = DIAS_DEL_ENLACE_DEL_CV;

const b64u = (b: Buffer) => b.toString("base64url");

/** El UUID (36 caracteres) en 16 bytes → 22 caracteres. */
export function uuidABytes(uuid: string): Buffer | null {
  const hex = uuid.replace(/-/g, "");
  return /^[0-9a-f]{32}$/i.test(hex) ? Buffer.from(hex, "hex") : null;
}
export function bytesAUuid(b: Buffer): string {
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** El día (desde 1970) en que caduca: hoy + los días que vale. */
export const diaDeCaducidad = (ahora: Date, dias = DIAS_DEL_ENLACE_CORTO): number => Math.floor(ahora.getTime() / 86_400_000) + dias;

const firma = (carga: Buffer, secreto: string): string => b64u(createHmac("sha256", secreto).update(carga).digest()).slice(0, 10);

/**
 * El token: 18 bytes (16 del id + 2 del día de caducidad) en base64url (24 caracteres), un punto y 10 caracteres de
 * firma: 35 en total. `null` si el id no es un UUID.
 */
export function tokenDelCv(candidateId: string, secreto: string, ahora: Date = new Date()): string | null {
  const id = uuidABytes(candidateId);
  if (!id) return null;
  const dia = Buffer.alloc(2);
  dia.writeUInt16BE(diaDeCaducidad(ahora) & 0xffff);
  const carga = Buffer.concat([id, dia]);
  return `${b64u(carga)}.${firma(carga, secreto)}`;
}

export type TokenLeido = { ok: true; candidateId: string } | { ok: false; motivo: "malformado" | "firma" | "caducado" };

/** Lee y comprueba un token: la forma, la firma (en tiempo constante) y que el día de hoy no pase el de caducidad. */
export function leerTokenDelCv(token: string, secreto: string, ahora: Date = new Date()): TokenLeido {
  const m = /^([A-Za-z0-9_-]{24})\.([A-Za-z0-9_-]{10})$/.exec(token ?? "");
  if (!m) return { ok: false, motivo: "malformado" };
  const carga = Buffer.from(m[1], "base64url");
  if (carga.length !== 18) return { ok: false, motivo: "malformado" };
  const esperada = Buffer.from(firma(carga, secreto));
  const dada = Buffer.from(m[2]);
  if (esperada.length !== dada.length || !timingSafeEqual(esperada, dada)) return { ok: false, motivo: "firma" };
  const hoy = Math.floor(ahora.getTime() / 86_400_000) & 0xffff;
  const caduca = carga.readUInt16BE(16);
  // Los días van en 16 bits (dan la vuelta cada ~180 años): se mira cuántos días faltan, no el número. Un token válido
  // caduca entre hoy y dentro de 7 días; uno caducado da una distancia enorme (la vuelta) y cae.
  if (((caduca - hoy) & 0xffff) > DIAS_DEL_ENLACE_CORTO) return { ok: false, motivo: "caducado" };
  return { ok: true, candidateId: bytesAUuid(carga.subarray(0, 16)) };
}

/** La URL completa que se copia: el origen de la app + la ruta pública del CV. */
export const urlDelCv = (origen: string, token: string): string => `${origen.replace(/\/$/, "")}/api/cv/${token}`;

/** El secreto de la firma: una llave que solo tiene el servidor. Se deriva de la de servicio de Supabase para no
 *  añadir otra variable de entorno; nunca sale de aquí. */
export function secretoDelCv(): string {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY (server env var).");
  return `cv-link:${k}`;
}
