/**
 * Candidatos duplicados (reunión del 11 nov: «duplicate entries… from Indeed»). El alta y la importación ya buscaban
 * duplicados, pero SOLO en la lista que el navegador tenía cargada: con una pestaña abierta desde antes, o con otro
 * reclutador dando de alta a la misma persona, la lista estaba vieja y se creaba otro registro (Itiel de Leon dos veces
 * el 11 nov, con 5 h de diferencia; Vidal Contreras dos veces en julio). Ahora, justo antes de insertar, se pregunta a
 * la BASE por el mismo teléfono (solo dígitos, últimos 10) o el mismo nombre normalizado, y si existe se usa ese.
 */
import { normalizeName } from "./utils";

type ConDatos = { id: string; name: string | null; phone: string | null };

/** Solo dígitos y los últimos 10 (quita el «1» de larga distancia): «+1 (956) 317-9574» = «9563179574». */
export function digitosTel(p: string | null | undefined): string {
  const d = (p ?? "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

/**
 * Patrón `ilike` que encuentra el número guardado en cualquier formato: «%9%5%6%3%1%7%9%5%7%4%». Puede traer de más
 * (eso se filtra después con `buscaDuplicado`), nunca de menos. Null si hay menos de 7 dígitos (no es un teléfono).
 */
export function patronTel(p: string | null | undefined): string | null {
  const d = digitosTel(p);
  return d.length >= 7 ? `%${d.split("").join("%")}%` : null;
}

/** El nombre como patrón `ilike` exacto (sin comodines del usuario). */
export function patronNombre(n: string | null | undefined): string | null {
  const t = (n ?? "").trim();
  return t.length >= 3 ? t.replace(/[\\%_]/g, (m) => `\\${m}`) : null;
}

/** De los candidatos que trajo la base, el que es la misma persona: mismo teléfono (dígitos) o mismo nombre. */
export function buscaDuplicado<T extends ConDatos>(existentes: readonly T[], nuevo: { name?: string | null; phone?: string | null }): T | null {
  const tel = digitosTel(nuevo.phone);
  if (tel.length >= 7) {
    const porTel = existentes.find((c) => digitosTel(c.phone) === tel);
    if (porTel) return porTel;
  }
  const nombre = normalizeName(nuevo.name ?? "");
  if (nombre.length >= 3) return existentes.find((c) => normalizeName(c.name ?? "") === nombre) ?? null;
  return null;
}
