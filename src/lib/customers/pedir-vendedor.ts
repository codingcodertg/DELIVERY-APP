/**
 * El gerente pide al admin la asignación de un vendedor (D-742, 2026-10-29).
 *
 * El dueño: «admin view in customers, they can see their whole store but to assign a customer to a sales rep they have
 * to request it to admin» (la vista del GERENTE: ve toda su tienda, pero no asigna; lo pide). Y: «en vendedor en customer
 * si está empty que se ponga unassigned».
 *
 * - Asigna solo el admin (`puedeAsignarVendedores`, en `reglas.ts`; antes también el gerente, D-728).
 * - El gerente (`puedePedirVendedor`) ve «Vendedor» bloqueado y un botón «Pedir al admin», que manda una solicitud de ayuda
 *   (`/api/help`, D-311/D-530): llega a «Solicitudes de ayuda» del hub con su globo, y por correo. No se inventa un canal
 *   nuevo: el admin ya mira ese. El texto de la solicitud lo arma `mensajeDePeticion`.
 * - «Sin asignar» (`SIN_ASIGNAR`) es lo que se pinta cuando no hay vendedor, en la lista y en la ficha.
 */
import type { UserRole } from "@/lib/types";

export const SIN_ASIGNAR = { en: "Unassigned", es: "Sin asignar" } as const;

export function puedePedirVendedor(role: UserRole | null | undefined): boolean {
  return role === "manager";
}

export interface PeticionDeVendedor {
  cliente: { id: number; account: string; store: string };
  /** El vendedor pedido; `null` = que lo deje libre. */
  vendedor: { id: string; full_name: string } | null;
  /** El vendedor de hoy, por nombre, o `null`. */
  actual: string | null;
  nota: string;
}

/** La página a la que el admin vuelve desde la solicitud: la ficha de ese cliente, ya editando (D-648). */
export function paginaDeLaPeticion(clienteId: number): string {
  return `/customers?editar=${clienteId}`;
}

/** El texto de la solicitud, en el idioma de quien pide. Primera línea reconocible, para que el admin la vea de un vistazo. */
export function mensajeDePeticion(p: PeticionDeVendedor, lang: "en" | "es"): string {
  const es = lang === "es";
  const pedido = p.vendedor ? p.vendedor.full_name : es ? "sin vendedor (libre)" : "no rep (free)";
  const hoy = p.actual ?? (es ? SIN_ASIGNAR.es : SIN_ASIGNAR.en);
  const lineas = [
    es ? `Solicitud de asignación de vendedor (Clientes)` : `Sales rep assignment request (Customers)`,
    es ? `Cliente: ${p.cliente.account} (${p.cliente.store}, #${p.cliente.id})` : `Customer: ${p.cliente.account} (${p.cliente.store}, #${p.cliente.id})`,
    es ? `Vendedor hoy: ${hoy}` : `Rep today: ${hoy}`,
    es ? `Vendedor pedido: ${pedido}` : `Requested rep: ${pedido}`,
  ];
  const nota = p.nota.trim();
  if (nota) lineas.push(es ? `Nota: ${nota}` : `Note: ${nota}`);
  return lineas.join("\n");
}
