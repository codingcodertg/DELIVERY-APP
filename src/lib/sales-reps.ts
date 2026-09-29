import { ordersLikeOfficeManager, tieneAccesoAEntregas } from "./constants";
import { isStoreToStore, type OrderTypeRules } from "./required";
import { mismaTiendaOGrupo } from "./store-group";
import type { NamedLocation, Profile } from "./types";

/**
 * Quién puede figurar como «Vendedor» de una orden, y cuáles ofrece el desplegable (D-290).
 *
 * El dueño: «en Weslaco, Jose Briseno es el gerente pero también vendedor, así que tiene que poder
 * elegirse a sí mismo, y el desplegable debería mostrar solo los vendedores de esa tienda». Eran dos
 * cosas: la lista se limitaba al rol `sales` —un gerente que vende no aparecía ni para sí mismo— y no
 * se limitaba a la tienda —salían los vendedores de todas—.
 *
 * Quién califica **no se decide aquí con una lista de roles nueva**: es `canCreate`, la misma capacidad
 * con la que la app decide quién puede registrar una orden (`ROLE_CAPS`: admin, manager, sales y office;
 * más quien la tenga concedida a mano en su perfil). Un segundo criterio paralelo se habría separado del
 * primero en cuanto alguien cambiara uno de los dos.
 *
 * La tienda que manda es la **de la orden**, no la de quien mira: una oficinista de una tienda puede
 * registrar una orden vendida desde otra, y quien la vendió es de esa otra.
 */

/** Dos nombres de tienda que son el mismo. Vacío no es igual a nada, ni a otro vacío: «sin tienda» no
 *  empareja a la gente sin tienda con las órdenes sin tienda, que no significan lo mismo. */
const mismaTienda = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = (a ?? "").trim().toLowerCase();
  const y = (b ?? "").trim().toLowerCase();
  return x !== "" && x === y;
};

/** Lo mínimo que hace falta saber de una persona para colocarla en la lista. */
type Candidato = Pick<Profile, "id" | "full_name" | "role" | "store">
  & { permissions?: string[] | null; module_access?: string[] | null };

const porNombre = <T extends Candidato>(a: T, b: T) => a.full_name.localeCompare(b.full_name);

/**
 * Quien puede ser el vendedor de una orden: **rol `sales` o `manager`, y con acceso a Entregas**.
 *
 * **Esto revisa D-290**, que usó `canCreate` —la capacidad de registrar órdenes— a propósito, para no
 * tener dos listas de roles que se separen. El dueño lo corrigió al verlo: *«me están saliendo todos los
 * usuarios y solo deberían ser sales people o managers en el sales rep del form»*. `canCreate` incluía
 * también a office y a los admin, que registran órdenes pero no las venden. Lo que D-290 resolvió sigue
 * resuelto: un gerente que además vende —el caso de Weslaco— entra por ser `manager`.
 *
 * Y quien no puede abrir Entregas no es asignable: una orden no se le acredita a alguien que no puede
 * verla. El acceso se mira como lo mira la base (`has_deliveries_access()` de la 083).
 */
export function puedeSerVendedor(u: Candidato): boolean {
  if (u.role !== "sales" && u.role !== "manager") return false;
  return tieneAccesoAEntregas(u);
}

/** Los candidatos que pertenecen a esa tienda **o a las que trabajan con ella** (D-293: el grupo de
 *  `settings.stores[*].group`; sin grupo, solo la suya, que es como estaba). En el orden en que vengan —quien los enseñe los ordena;
 *  ordenarlos aquí era código que ningún mutante podía matar, porque `vendedoresParaLaOrden` vuelve a
 *  ordenar después—. **Puede quedar vacía** —una tienda sin nadie, o una orden que aún no tiene tienda—
 *  y por eso no es lo que se ofrece: eso lo decide `vendedoresParaLaOrden`. */
export function vendedoresDeLaTienda<T extends Candidato>(
  users: readonly T[],
  tiendaDeLaOrden: string | null | undefined,
  tiendas: readonly NamedLocation[] = [],
): T[] {
  return users.filter((u) => puedeSerVendedor(u)
    && (mismaTienda(u.store, tiendaDeLaOrden) || mismaTiendaOGrupo(u.store, tiendaDeLaOrden, tiendas)));
}

/**
 * Lo que se ofrece en el desplegable, que **nunca se queda sin opciones**:
 *
 * 1. los candidatos de la tienda de la orden; si esa tienda no tiene a nadie —o la orden todavía no
 *    tiene tienda—, **todos** los candidatos, que es preferible a un desplegable vacío que no deja
 *    guardar un campo obligatorio (el mismo respaldo que usa el reparto de choferes en
 *    `routes/page.tsx`: los de la misma tienda, y si no, cualquiera);
 * 2. y el vendedor **que ya tiene puesto**, aunque no cumpla ninguna de las dos cosas (D-267): una orden
 *    que se abre a corregir no puede enseñar el selector vacío con un valor guardado detrás.
 */
export function vendedoresParaLaOrden<T extends Candidato>(
  users: readonly T[],
  tiendaDeLaOrden: string | null | undefined,
  actual?: string | null,
  tiendas: readonly NamedLocation[] = [],
): T[] {
  const deLaTienda = vendedoresDeLaTienda(users, tiendaDeLaOrden, tiendas);
  const base = deLaTienda.length > 0 ? deLaTienda : users.filter(puedeSerVendedor);
  const suelto = actual && !base.some((u) => u.id === actual) ? users.filter((u) => u.id === actual) : [];
  return [...base, ...suelto].sort(porNombre);
}

/**
 * Quién elige el «Vendedor» al registrar una orden a cliente en nombre de otro: office (`accounting`), el
 * gerente, el admin y el chofer. Ventas no: la orden que escribe es suya.
 */
export function eligeVendedorAlCrear(rol: string | null | undefined): boolean {
  return ordersLikeOfficeManager(rol) || rol === "admin" || rol === "driver";
}

/**
 * El formulario pide «Vendedor» (obligatorio) en una orden **nueva a cliente** de alguien que lo elige. Un
 * movimiento tienda-a-tienda no tiene cliente, así que no tiene vendedor a quien acreditarlo.
 */
export function pideVendedor(rol: string | null | undefined, esNueva: boolean, tiendaATienda: boolean): boolean {
  return esNueva && eligeVendedorAlCrear(rol) && !tiendaATienda;
}

/**
 * **Office no encontraba el campo, y no porque no lo tuviera** (D-NEXT). El dueño: *«ADD VENDEDOR LIKE
 * ADMIN, ADD THAT TO ALL OFFICE PEOPLE SO THEY CAN CREATE AN ORDER AND ATTACHED A VENDEDOR»*; preguntado
 * qué faltaba: *«No le sale el campo»*.
 *
 * Medido en el demo: el admin abre una orden nueva en Customer y, tras «Siguiente», tiene «Vendedor» arriba
 * del todo. Office la abre en **Intertienda** (D-084, pedido del dueño: casi todo lo que registra office es
 * entre tiendas), y ahí el formulario completo sale directo y sin «Vendedor» —con razón: no hay cliente—.
 * Para verlo había que encontrar «Tipo de Orden» más abajo, cambiarlo a Customer, volver al paso 1 y pulsar
 * «Siguiente». Nada en pantalla lo decía.
 *
 * En ese hueco se ofrece el atajo: «Es para un cliente», que pasa la orden al tipo de cliente y deja el
 * «Vendedor» a la vista en el mismo sitio. Ni D-084 ni la regla de arriba cambian.
 */
export function ofrecePasarACliente(rol: string | null | undefined, esNueva: boolean, tiendaATienda: boolean): boolean {
  return esNueva && eligeVendedorAlCrear(rol) && tiendaATienda;
}

/**
 * A qué tipo pasa ese atajo: «Customer» si está y es de cliente —el que usan los demás al abrir
 * (`borradorInicial`)—; si no, el primer tipo configurado que no sea tienda-a-tienda. `null` si no hay
 * ninguno, y entonces el atajo no se pinta.
 */
export function tipoDeCliente(tipos: readonly string[], reglas?: OrderTypeRules): string | null {
  if (tipos.includes("Customer") && !isStoreToStore("Customer", reglas)) return "Customer";
  return tipos.find((t) => !isStoreToStore(t, reglas)) ?? null;
}
