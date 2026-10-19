import type { Candidate, Contact } from "./types";

// ============================================================
// El candidato se guarda como contacto en RingCentral al llamarlo o mandarle un texto (D-NEXT, 2026-10-19). El dueño:
// «cuando le pongo mandar texto o llamar, puedes automaticamente guardar ese contacto en ring central, y ponerle el
// nombre iniciales del puesto y tienda como decir Andres Ugarte WA BRO warehouse associate brownville».
//
// Reglas puras: el nombre que lleva, el teléfono en E.164, el cuerpo que se manda y cuándo ya está hecho. La escritura
// la hace `/api/recruiting/rc-contact` con el JWT del servidor (la extensión «Careers», la misma línea desde la que
// RR. HH. llama y textea).
// ============================================================

/** Los códigos de tienda como los lee el dueño («BRO»): los mismos de Entregas (`STORE_TAGS`), por el nombre corto que
 *  usa RR. HH. en `LOCATIONS` («Brownsville», sin «RDZ»). */
export const CODIGOS_DE_TIENDA: Record<string, string> = {
  brownsville: "BRO", weslaco: "WES", pharr: "PHR", mcallen: "MCA", mission: "MIS", edinburg: "EDG",
};

/** «Brownsville» → «BRO»; «RDZ McAllen» → «MCA»; una tienda desconocida, sus tres primeras letras; «TBD» o vacío, nada. */
export function codigoDeTienda(location: string | null | undefined): string {
  const limpio = (location ?? "").trim().replace(/^rdz\s+/i, "").toLowerCase();
  if (!limpio || limpio === "tbd") return "";
  return CODIGOS_DE_TIENDA[limpio] ?? limpio.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase();
}

/** «Warehouse Associate» → «WA»; «Sales» → «S»; sin puesto, nada. Solo letras: «Sales/Ventas» da «SV». */
export function inicialesDelPuesto(role: string | null | undefined): string {
  return (role ?? "").split(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]+/).filter(Boolean).map((p) => p[0].toUpperCase()).join("");
}

/** El nombre del contacto: nombre y apellidos del candidato, y detrás las iniciales del puesto y el código de la tienda:
 *  «Andres Ugarte WA BRO». `firstName` es la primera palabra; el resto, con el sufijo, va en `lastName` (así RingCentral
 *  lo ordena por nombre y el sufijo se ve en la lista). Sin apellido, el sufijo va solo en `lastName`. */
export function nombreParaRingCentral(c: Pick<Candidate, "name" | "role" | "location">): { firstName: string; lastName: string; display: string } {
  const palabras = c.name.trim().split(/\s+/).filter(Boolean);
  const sufijo = [inicialesDelPuesto(c.role), codigoDeTienda(c.location)].filter(Boolean).join(" ");
  const firstName = palabras[0] ?? "";
  const lastName = [...palabras.slice(1), sufijo].filter(Boolean).join(" ");
  return { firstName, lastName, display: [firstName, lastName].filter(Boolean).join(" ") };
}

/** El teléfono como lo quiere RingCentral (E.164): 10 dígitos → «+1…»; 11 que empiezan por 1 → «+…»; otra cosa, null. */
export function telefonoE164(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

/** Lo que se manda a `POST /address-book/contact`: nombre con el sufijo, el puesto y la tienda enteros donde RingCentral
 *  los enseña (cargo y empresa), el móvil, y en notas de dónde salió. `null` sin teléfono válido. */
export function cuerpoDelContacto(c: Pick<Candidate, "id" | "name" | "phone" | "role" | "location">): Record<string, string> | null {
  const movil = telefonoE164(c.phone);
  if (!movil) return null;
  const { firstName, lastName } = nombreParaRingCentral(c);
  return {
    firstName, lastName, mobilePhone: movil,
    jobTitle: (c.role ?? "").trim(), company: (c.location ?? "").trim(),
    notes: `RTG Hub · candidato ${c.id}`,
  };
}

/** Los dígitos de un teléfono, para comparar el del candidato con los de la agenda sin que importe el formato. */
export const digitos = (phone: string | null | undefined): string => (phone ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/** ¿Ya hay en la agenda un contacto con este teléfono? Se mira en todos los campos de teléfono del contacto. */
export function yaEstaEnLaAgenda(agenda: readonly Record<string, unknown>[], phone: string): boolean {
  const mio = digitos(phone);
  if (!mio) return false;
  const campos = ["mobilePhone", "homePhone", "businessPhone", "otherPhone", "homePhone2", "businessPhone2", "callbackPhone", "assistantPhone", "carPhone", "companyPhone"];
  return agenda.some((k) => campos.some((f) => typeof k[f] === "string" && digitos(k[f] as string) === mio));
}

/** Los contactos que lo disparan: llamar y textear. Nada más. */
export const TIPOS_QUE_GUARDAN = new Set(["Call", "SMS"]);
export const TIPO_RINGCENTRAL = "RingCentral";
export const RESULTADO_GUARDADO = "saved";

/** ¿Ya se guardó este candidato en RingCentral? Lo dice su historial: un contacto «RingCentral / saved». */
export function yaGuardadoEnRingCentral(contactos: readonly Pick<Contact, "type" | "result">[]): boolean {
  return contactos.some((k) => k.type === TIPO_RINGCENTRAL && k.result === RESULTADO_GUARDADO);
}

/** El contacto que deja en el historial cuando se guardó (o ya estaba): «RingCentral · saved · Andres Ugarte WA BRO». */
export function contactoDelGuardado(display: string): Pick<Contact, "type" | "result" | "note"> {
  return { type: TIPO_RINGCENTRAL, result: RESULTADO_GUARDADO, note: display };
}
