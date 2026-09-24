import { ordersLikeOfficeManager } from "@/lib/constants";
import { nombreNormalizado } from "@/lib/store-pins";
import type { Delivery, NamedLocation, Profile } from "@/lib/types";

/**
 * Almacén deshace un paso en SUS órdenes, y borrar pasa a ser del borrador (D-383, pantalla de la 142).
 *
 * El dueño, literal: *«deja que warehouse y office tengan la opción de deshacer un stage, como por
 * ejemplo deshacer un delivered o un fulfilling o un ready, y también que los draft, si no los ocupan,
 * los puedan borrar o seguir editando; igual las duplicadas»*.
 *
 * La base ya lo decide desde la 142 (D-377). Esto es **el espejo** de lo que decide, y las pruebas lo
 * comparan contra el texto del `.sql`: un botón que la base rechaza es el fallo de D-044, y un DELETE
 * que la política no deja pasar ni siquiera da error — borra cero filas y vuelve limpio.
 */

type TiendasDeLaOrden = Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name" | "pickup_address">;

/**
 * ¿Esta orden es de mis tiendas? **Espejo de `public.orden_de_mis_tiendas` (142)**, línea por línea.
 *
 * - **Mis tiendas** = la mía (`profiles.store`), **siempre**, aunque ya no esté en Ajustes, más las del
 *   catálogo que se llaman como la mía o comparten su grupo (D-293).
 * - **La orden es mía** si alguna de sus tres columnas de tienda —`store`, `pickup_name`,
 *   `delivery_name`— es una de mis tiendas, **o** su `pickup_address` es la dirección de una de ellas.
 *
 * Mira las tres columnas **sin mirar el tipo de orden**, igual que la base, y por eso es más ancha que
 * la cola de almacén (`esDeMisTiendas` solo mira `delivery_name` en tienda-a-tienda). Se copia la base y
 * no la cola a propósito: lo que decide aquí es un botón que acaba en la base, y la pregunta que importa
 * es «¿la base lo va a dejar?».
 *
 * Los nombres se normalizan como en la base (espacios colapsados, recortado, minúsculas); el grupo,
 * recortado y en minúsculas; la dirección, **solo recortada** (la base compara `btrim` contra `btrim`).
 */
export function ordenDeMisTiendas(
  d: TiendasDeLaOrden,
  miTienda: string | null | undefined,
  tiendas: readonly Pick<NamedLocation, "name" | "address" | "group">[],
): boolean {
  const yo = nombreNormalizado(miTienda);
  // Sin tienda propia, nada es «mío»: falla cerrado, como la base. Ojo con la tentación de copiar la
  // cola de almacén, que SIN tienda enseña TODO: aquí eso sería ofrecer un botón que la base rechaza.
  if (!yo) return false;
  const catalogo = tiendas.map((s) => ({
    nombre: nombreNormalizado(s.name),
    grupo: (s.group ?? "").trim().toLowerCase(),
    direccion: (s.address ?? "").trim(),
  }));
  const miGrupo = catalogo.find((c) => c.nombre === yo && c.grupo !== "")?.grupo ?? null;
  const mias = [
    { nombre: yo, direccion: "" },
    ...catalogo.filter((c) => c.nombre === yo || (miGrupo !== null && c.grupo === miGrupo)),
  ];
  const nombresDeLaOrden = [d.store, d.pickup_name, d.delivery_name].map(nombreNormalizado);
  const recogida = (d.pickup_address ?? "").trim();
  return mias.some((m) =>
    (m.nombre !== "" && nombresDeLaOrden.includes(m.nombre))
    || (m.direccion !== "" && m.direccion === recogida));
}

/**
 * ¿Puede esta persona **borrar** esta orden? **Espejo de la política `"deliveries delete"` (142)**:
 *
 * - el admin, cualquier orden;
 * - cualquiera, **su propio borrador** (`created_by` = yo);
 * - office (`accounting`) y gerente (`manager`), **cualquier borrador de sus tiendas** y su grupo, sea
 *   de quien sea (respuesta del dueño, 2026-09-23).
 *
 * Una pendiente, aprobada o entregada no la borra nadie más que el admin: se anula, que deja rastro en la
 * propia orden. Tener el módulo de Entregas (`has_deliveries_access`) se da por hecho: quien no lo tiene
 * no llega a abrir la ficha.
 */
export function puedeBorrar(
  yo: Pick<Profile, "id" | "role" | "store">,
  d: TiendasDeLaOrden & Pick<Delivery, "stage" | "created_by">,
  tiendas: readonly Pick<NamedLocation, "name" | "address" | "group">[],
): boolean {
  if (yo.role === "admin") return true;
  if (d.stage !== "draft") return false;
  if (d.created_by === yo.id) return true;
  return ordersLikeOfficeManager(yo.role) && ordenDeMisTiendas(d, yo.store, tiendas);
}

/** Lo que devuelve un `DELETE … .select("id")` de PostgREST, reducido a lo que se mira. */
export interface RespuestaDeBorrar {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

/**
 * Borra una orden y **solo si la base confirma una fila** la quita de la lista.
 *
 * Un DELETE que la RLS no deja pasar **no da error**: borra cero filas y vuelve limpio. Antes de la 142
 * el botón era solo del admin y nunca se notó; ahora lo ven más roles, y la política puede decir que no
 * (el borrador ya se envió, alguien cambió la tienda…). Por eso se pide `.select("id")` y se cuenta: sin
 * fila, se dice y la orden se queda en la lista, porque sigue existiendo.
 *
 * La usan los dos proveedores —el real y el del demo—, así que el orden «primero confirmar, luego
 * quitar» vive una sola vez.
 */
export async function borrarOrden(opts: {
  borrar: () => Promise<RespuestaDeBorrar>;
  quitarDeLaLista: () => void;
  avisar: (mensaje: string) => void;
  lang: "en" | "es";
}): Promise<boolean> {
  const { data, error } = await opts.borrar();
  if (error) { opts.avisar("Error: " + error.message); return false; }
  if (!data || data.length === 0) {
    opts.avisar(opts.lang === "es"
      ? "No se borró: solo se puede borrar un borrador propio (o, office y gerente, uno de su tienda). La orden sigue en la lista."
      : "Not deleted: you can only delete your own draft (or, office and managers, a draft of their store). The order is still listed.");
    return false;
  }
  opts.quitarDeLaLista();
  return true;
}
