import type { Delivery, NamedLocation, OrderTypeRule } from "@/lib/types";
import { orderOwner } from "@/lib/utils";
import { tiendaDeLaOrdenEsMia } from "@/lib/order-endpoints";

/**
 * Qué órdenes le tocan a un vendedor (D-NEXT).
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
 * Tres caminos, y ninguno depende de los otros:
 *   1. **Un borrador lo ve cualquiera** (D-286): el dueño pidió que se pudiera volver a editar, y un
 *      borrador que no se ve no se edita.
 *   2. **La suya**, por `orderOwner` — que incluye las que oficina o un admin le asignaron.
 *   3. **De tienda a tienda, y una de sus tiendas es la suya** (o la de su grupo, D-293). Solo aquí
 *      mira la tienda: en una orden de cliente el dueño dijo que ventas sigue viendo solo lo suyo.
 *
 * Lo que NO decide esta función: las anuladas y la ventana de fechas, que son cortes aparte y valen
 * para más gente. Siguen donde estaban.
 */
export function ventasVeLaOrden(args: {
  /** El id de quien mira. */
  miId: string;
  /** Su tienda, o null/vacío si no tiene. */
  miTienda: string | null | undefined;
  orden: Pick<Delivery, "stage" | "created_by" | "assigned_sales_rep"> &
    Pick<Partial<Delivery>, "store" | "pickup_name" | "delivery_name">;
  /** La regla del tipo de ESA orden, ya resuelta por quien llama. */
  regla: Pick<OrderTypeRule, "storeToStore">;
  tiendas: NamedLocation[];
}): boolean {
  const { miId, miTienda, orden, regla, tiendas } = args;
  if (orden.stage === "draft") return true;
  if (orderOwner(orden) === miId) return true;
  return regla.storeToStore === true && tiendaDeLaOrdenEsMia(orden, regla, miTienda, tiendas);
}
