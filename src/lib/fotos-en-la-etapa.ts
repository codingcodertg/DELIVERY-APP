import type { Delivery, Profile } from "@/lib/types";
import type { Lang } from "@/lib/prefs";
import { conteoDeFotos } from "@/lib/columnas-de-la-lista";

/**
 * **La cámara junto a «Entregado»** (D-NEXT). El dueño, 2026-10-18: *«For users who can see pictures that the drivers
 * upload, Id like the stage column to say Delivered and have a camera icon next to it to know when driver took pics. If
 * no pics were uploaded then itll just say Delivered with no icon»*.
 *
 * Tres condiciones, y las tres aquí para que la lista, Almacén, el Gestor, la tarjeta del chofer y la ficha no se separen:
 * la orden está entregada, tiene fotos, y QUIEN MIRA puede verlas.
 */

/**
 * Quién ve las fotos del material: la regla que ya tenía la ficha (`OrderModal`, «sales reps don't see these»), sacada a
 * una función para que la pastilla y la rejilla de fotos la lean del mismo sitio. Ventas no; todos los demás sí (quien
 * entrega, y también oficina, gerencia y logística, que las revisan).
 */
export function puedeVerFotos(me: Pick<Profile, "role"> | null | undefined): boolean {
  if (!me) return false;
  return me.role !== "sales";
}

/**
 * «📷» si esta persona debe ver el icono en la pastilla de etapa de esta orden; `null` si no.
 *
 * - Solo `delivered`. Eso incluye «Recibido» (D-409), que es `delivered` en la base con otro evento: si un chofer subió
 *   fotos y luego el almacén la recibió, las fotos siguen ahí y siguen importando.
 * - Con fotos: `conteoDeFotos` (el `photo_count` de la fila de la lista, D-562, o las `photos` si la fila las trae).
 * - Y solo para quien puede verlas (`puedeVerFotos`): a ventas no se le enseña un icono de algo que no puede abrir.
 */
export function iconoDeFotos(
  me: Pick<Profile, "role"> | null | undefined,
  d: Pick<Delivery, "stage"> & { photo_count?: number | null; photos?: readonly unknown[] | null },
): "📷" | null {
  if (d.stage !== "delivered") return null;
  if (conteoDeFotos(d) <= 0) return null;
  if (!puedeVerFotos(me)) return null;
  return "📷";
}

/** El `title` del icono: cuántas fotos subió el chofer, en el idioma de quien mira. */
export function tituloDeFotos(n: number, lang: Lang): string {
  if (lang === "es") return n === 1 ? "El chofer subió 1 foto" : `El chofer subió ${n} fotos`;
  return n === 1 ? "Driver uploaded 1 photo" : `Driver uploaded ${n} photos`;
}
