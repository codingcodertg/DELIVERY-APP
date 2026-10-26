/**
 * Las cuentas del formulario de orden salen de la app de Clientes (D-NEXT).
 *
 * El dueño, 2026-10-26: «cuando uno busca un customer en el order form […] esos customers tienen que ser los mismos que
 * están en el customer app […] Y eso tiene que estar conectado».
 *
 * La lista maestra es erp.customers (sin archivar), que llega por la función `cuentas_de_clientes` (migración 203): la
 * tabla tiene la puerta del módulo de Clientes y un despachador de Entregas no la pasa. Mientras la 203 no esté aplicada
 * —o si la llamada falla— la lista de Clientes llega vacía y el formulario se queda como antes: cuentas guardadas en
 * Ajustes y nombres de órdenes pasadas. Esas siguen saliendo también con la 203, marcadas «no está en Clientes», para no
 * perder ninguna; las cuentas internas de tienda (Intertienda) se marcan como tales.
 */

/** Una fila de `cuentas_de_clientes`: lo que el formulario necesita de un cliente, nada más. */
export interface ClienteParaOrden {
  account: string;
  store: string | null;
  contact: string | null;
  phone: string | null;
  address: string | null;
}

export type OrigenDeCuenta = "clientes" | "interna" | "fuera";

const clave = (s: string) => s.trim().toLowerCase();

/**
 * Las opciones del campo de cuenta, cada una con su origen. Un nombre que está en Clientes es «clientes» aunque también
 * esté guardado o en órdenes pasadas (gana la grafía de Clientes); lo guardado con la marca de sucursal es «interna»; el
 * resto, «fuera». Ordenadas por nombre.
 */
export function opcionesDeCuenta(a: {
  clientes: readonly ClienteParaOrden[];
  guardadas: readonly { name: string; intertienda?: boolean }[];
  pasadas: readonly (string | null | undefined)[];
  intertiendaPasadas?: ReadonlySet<string>;
}): { nombre: string; origen: OrigenDeCuenta }[] {
  const m = new Map<string, { nombre: string; origen: OrigenDeCuenta }>();
  for (const c of a.clientes) {
    const n = (c.account ?? "").trim();
    if (n && !m.has(clave(n))) m.set(clave(n), { nombre: n, origen: "clientes" });
  }
  for (const g of a.guardadas) {
    const n = g.name.trim();
    if (n && !m.has(clave(n))) m.set(clave(n), { nombre: n, origen: g.intertienda ? "interna" : "fuera" });
  }
  for (const p of a.pasadas) {
    const n = (p ?? "").trim();
    if (n && !m.has(clave(n))) m.set(clave(n), { nombre: n, origen: a.intertiendaPasadas?.has(clave(n)) ? "interna" : "fuera" });
  }
  return [...m.values()].sort((x, y) => x.nombre.localeCompare(y.nombre));
}

/**
 * El cliente de Clientes para una cuenta elegida, si lo hay. Si la cuenta está en varias tiendas, la primera que traiga
 * contacto o teléfono; si ninguna, la primera.
 */
export function clienteDeLaCuenta(clientes: readonly ClienteParaOrden[], cuenta: string): ClienteParaOrden | undefined {
  const k = clave(cuenta);
  if (!k) return undefined;
  const filas = clientes.filter((c) => clave(c.account ?? "") === k);
  return filas.find((c) => (c.contact ?? "").trim() || (c.phone ?? "").trim()) ?? filas[0];
}

/**
 * Lo que se rellena al elegir: lo de Clientes manda; lo que Clientes no tiene lo pone la cuenta guardada en Ajustes.
 * Devuelve `undefined` si no hay ni cliente ni guardada (entonces decide la última orden, como antes).
 */
export function contactoDeLaCuenta(
  cliente: ClienteParaOrden | undefined,
  guardada: { contact?: string | null; phone?: string | null; address?: string | null } | undefined,
): { contact: string | null; phone: string | null; address: string | null } | undefined {
  if (!cliente && !guardada) return undefined;
  const v = (x: string | null | undefined) => ((x ?? "").trim() ? (x as string).trim() : null);
  return {
    contact: v(cliente?.contact) ?? v(guardada?.contact),
    phone: v(cliente?.phone) ?? v(guardada?.phone),
    address: v(cliente?.address) ?? v(guardada?.address),
  };
}
