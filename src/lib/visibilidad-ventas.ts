import type { Delivery } from "@/lib/types";
import { orderOwner } from "@/lib/utils";

/**
 * Qué órdenes le tocan a un vendedor (D-309).
 *
 * **Es la decisión entera, en una función, y eso no es estilo: es lo que hacía falta.** La primera
 * versión dejaba la decisión repartida —el tablero llamaba a `tiendaDeLaOrdenEsMia` y el `storeToStore`
 * se daba por supuesto en el comentario de al lado— y ahí se coló el defecto: `tiendasDeLaOrden`
 * devuelve `[store]` en una orden de **cliente**, así que un vendedor pasaba a ver las de sus
 * compañeros de tienda. El comentario decía «solo en tipos tienda-a-tienda» y el código no lo hacía.
 *
 * Las piezas sueltas están bien y se siguen usando: la cola de almacén **sí** quiere `[store]` en una
 * orden de cliente. Lo que no se puede es probar la pieza y dar por hecha la decisión.
 *
 * Dos caminos, y ninguno depende del otro:
 *   1. **Un borrador lo ve cualquiera** (D-286): el dueño pidió *«para borrador, deja que cualquiera
 *      pueda volver y editarlo»*, y un borrador que no se ve no se edita.
 *   2. **La suya**, por `orderOwner` — que incluye las que oficina o un admin le asignaron.
 *
 * **HABÍA UN TERCERO Y SE FUE**: «de tienda a tienda, y una de sus tiendas es la suya». El dueño lo
 * cambió: *«ventas solo ve sus propias órdenes, pero en cualquier tienda»*. Ese camino era justo el
 * que le enseñaba a un vendedor las Intertiendas de sus compañeros de tienda, y era **el único sitio
 * donde esta función miraba la tienda**. Al quitarlo, la tienda deja de importar aquí del todo — que
 * es la otra mitad de lo que pidió: sus órdenes las ve **en cualquier tienda**.
 *
 * Por eso `miTienda`, `regla` y `tiendas` ya no se usan y **se han quitado de la firma**: un
 * argumento que no se lee es una invitación a creer que se sigue mirando la tienda.
 *
 * Lo que NO decide esta función: las anuladas y la ventana de fechas, que son cortes aparte y valen
 * para más gente. Siguen donde estaban.
 */
export function ventasVeLaOrden(args: {
  /** El id de quien mira. */
  miId: string;
  orden: Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep">;
}): boolean {
  const { miId, orden } = args;
  if (orden.stage === "draft") return true;
  return orderOwner(orden) === miId;
}
