import { EVENTO_ENTRAR, EVENTO_VOLVER, IMPERSONACION_MINUTOS, esAdmin, impersonacionCaducada } from "./impersonation";
import { desempaquetar, type SesionDeVuelta } from "./impersonation-cookie";

/**
 * Quién entra a la vista móvil (`/home/vista-movil`), D-278 y D-NEXT.
 *
 * D-278 la dejó **solo para el admin**, por el rol de la sesión. Pero dentro de «Entrar como» (D-243) la
 * sesión es la de la otra persona —un chofer, un vendedor—, así que el admin que estaba mirando la app de
 * Ernesto y pulsaba «📱 Vista móvil» acababa echado a `/driver`. El dueño, 2026-10-11, con la vista móvil
 * abierta: «EN ESE MISMO AMARILLO QUIERO QUE ESTE PARA CMABIAR DE DESKTOP VIEW A MOBILE VIEW».
 *
 * Ahora entran dos:
 *
 *  1. **El admin**, por el rol de la sesión, como siempre.
 *  2. **Un admin dentro de la cuenta de otra persona**, y esto no se fía de la cookie de vuelta. Esa cookie
 *     es `httpOnly` pero NO va firmada (D-243 explica por qué), así que una persona cualquiera podría
 *     escribirse una en su propio navegador. Lo que no puede escribirse es el **rastro**: la fila
 *     `impersonation_start` de `security_events` solo la escribe el servidor con la llave de servicio, con
 *     el admin como `actor_id` (la RLS de esa tabla, 053/080, solo deja insertar filas donde `actor_id` sea
 *     uno mismo, y solo deja leerlas a un admin). Así que hace falta todo esto a la vez:
 *       · la cookie se entiende (`desempaquetar`) y es de ESTA sesión (`comoId` = el usuario de la sesión);
 *       · no ha caducado (los 60 minutos de D-243, contados desde que empezó);
 *       · quien la abrió es admin HOY, leído de `profiles`;
 *       · y la última fila del rastro entre ese admin y esta persona es una ENTRADA (no una vuelta), de la
 *         última hora. Una vuelta posterior quiere decir que esa suplantación ya se cerró.
 *
 * Cualquier duda —una lectura que falla, un campo vacío— es «no»: la persona va a su pantalla de inicio,
 * que es lo que pasaba antes con todos los que no eran admin.
 *
 * Las lecturas llegan por argumento (`leerSuplantacion`), para probar la regla con datos y sin red; el
 * layout le pasa Supabase de verdad.
 */

/** La última fila del rastro entre el admin de la cookie y la persona de la sesión. */
export type RastroDeSuplantacion = { kind: string | null; created_at: string | null } | null;

/** Lo que se sabe de la suplantación en curso: la cookie, el rol HOY de quien la abrió y su rastro. */
export type PruebaDeSuplantacion = {
  vuelta: SesionDeVuelta;
  rolDeQuienEntro: string | null | undefined;
  ultimoRastro: RastroDeSuplantacion;
};

/** ¿Es esto un admin dentro de la cuenta de `usuarioId`, ahora mismo? Las cuatro condiciones de arriba. */
export function esSuplantacionDeUnAdmin(
  prueba: PruebaDeSuplantacion | null | undefined,
  usuarioId: string | null | undefined,
  ahora: number,
): boolean {
  if (!prueba || !usuarioId) return false;
  const { vuelta, rolDeQuienEntro, ultimoRastro } = prueba;
  if (vuelta.comoId !== usuarioId) return false;
  if (impersonacionCaducada(vuelta.inicio, ahora)) return false;
  if (!esAdmin(rolDeQuienEntro)) return false;
  if (!ultimoRastro || ultimoRastro.kind !== EVENTO_ENTRAR) return false;
  // La fila de entrar se escribe un instante ANTES de poner la cookie (y al saltar de persona, después de su
  // `inicio`): se pide que sea de la última hora, con el mismo minuto de margen que la propia cookie.
  const cuando = Date.parse(ultimoRastro.created_at ?? "");
  if (!Number.isFinite(cuando) || cuando > ahora + 60_000) return false;
  return !impersonacionCaducada(cuando, ahora, IMPERSONACION_MINUTOS + 1);
}

/** La puerta de la vista móvil: el admin, o un admin dentro de la cuenta de otra persona. */
export function puedeAbrirLaVistaMovil(a: {
  rolDeLaSesion: string | null | undefined;
  usuarioId: string | null | undefined;
  suplantacion: PruebaDeSuplantacion | null;
  ahora: number;
}): boolean {
  if (esAdmin(a.rolDeLaSesion)) return true;
  return esSuplantacionDeUnAdmin(a.suplantacion, a.usuarioId, a.ahora);
}

/**
 * Reúne la prueba: la cookie, y solo si es de esta sesión, el rol de quien la abrió y su último rastro.
 *
 * Sin cookie, o con una que es de otra persona, **no pregunta nada a la base**: esa es la visita de casi
 * todos los que no son admin, y no tiene por qué costar más que antes.
 */
export async function leerSuplantacion(a: {
  cookie: string | null | undefined;
  usuarioId: string;
  rolDe: (id: string) => Promise<string | null>;
  ultimoRastro: (adminId: string, usuarioId: string) => Promise<RastroDeSuplantacion>;
}): Promise<PruebaDeSuplantacion | null> {
  const vuelta = desempaquetar(a.cookie ?? null);
  if (!vuelta || vuelta.comoId !== a.usuarioId) return null;
  try {
    const [rolDeQuienEntro, ultimoRastro] = await Promise.all([
      a.rolDe(vuelta.adminId),
      a.ultimoRastro(vuelta.adminId, a.usuarioId),
    ]);
    return { vuelta, rolDeQuienEntro, ultimoRastro };
  } catch {
    return null;
  }
}

/** Las dos clases de fila que abren o cierran una suplantación: lo que se pide al leer el rastro. */
export const RASTRO_DE_SUPLANTACION = [EVENTO_ENTRAR, EVENTO_VOLVER] as const;
