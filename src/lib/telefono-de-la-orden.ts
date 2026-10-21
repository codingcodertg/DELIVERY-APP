import { telefonoEstandar } from "@/lib/recruiting/formato";

/**
 * El teléfono de la orden de Entregas (D-630, 2026-10-21): solo números, y el formato se pone solo.
 *
 * El dueño: «Permite que solo el usuario solo pueda poner números y tú lo vas poniendo como en el código de área […]
 * que se miren los dos paréntesis y después el dash […] hemos tenido problemas que los salespeople ponen el número
 * plus, así no sirve, o ponen punto […] que solo esa parte solo acepte números, nada más, no acepte símbolos ni nada.
 * El sistema automáticamente lo hace».
 *
 * Medido en producción (2026-10-21, 379 órdenes con teléfono): 362 son un número de 10 dígitos escrito de mil formas
 * («956-340-5910» 192, «9563405910» 78, «956*340*5910» 72, «956 340-5910» 13…); unas 13 llevan dos números en el mismo
 * campo y 5 tienen menos de 10 dígitos.
 *
 * Es el mismo formato que RR. HH. (`telefonoEstandar`, D-610): «(956) 340-5910».
 */

/**
 * Lo que se ve mientras se escribe: se quedan solo los dígitos (un «+1», puntos, asteriscos, letras… fuera), sin el 1
 * del país (ningún código de área empieza por 1), hasta 10, y con el formato ya puesto según se llenan:
 * «9» → «(9», «9563» → «(956) 3», «9563405» → «(956) 340-5», «9563405910» → «(956) 340-5910».
 * Borrar funciona sin trabarse: los símbolos solo aparecen cuando ya hay un dígito detrás.
 */
export function telefonoAlEscribir(texto: string | null | undefined): string {
  const d = (texto ?? "").replace(/\D/g, "").replace(/^1+/, "").slice(0, 10);
  if (!d) return "";
  if (d.length <= 3) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Lo que se ve en el campo: un número completo (el de una orden vieja, o el que trae la cuenta elegida) ya con su
 * formato; lo que no es un número completo (a medio escribir, o dos números juntos de antes), tal cual. Así abrir una
 * orden vieja no le cambia nada hasta que alguien toca el campo.
 */
export const telefonoParaVer = (t: string | null | undefined): string => telefonoEstandar(t ?? "");

/** Lo que se le enseña a quien va a escribir: el molde con los paréntesis y el guion. */
export const MOLDE_DEL_TELEFONO = "(___) ___-____";

/**
 * Al guardar, venga de donde venga (el formulario, la importación, la cuenta guardada): un número de 10 dígitos (o 11
 * con el 1) queda «(956) 340-5910»; lo demás (dos números juntos de antes, uno corto) se guarda tal cual, sin perder
 * nada. Vacío → `null`. Si la escritura no trae el teléfono, no se toca.
 */
export function conTelefonoEstandar<T extends { delivery_phone?: string | null }>(o: T): T {
  if (!("delivery_phone" in o) || typeof o.delivery_phone !== "string") return o;
  return { ...o, delivery_phone: telefonoEstandar(o.delivery_phone) || null };
}
