import { cuentaRequiereAprobacion } from "@/lib/cuenta-aprobacion";
import type { AccountRecord, Delivery, OrderEvent } from "@/lib/types";

/**
 * Por qué una orden está en «Pending Approval» (D-NEXT). Roberto Rodriguez Jr (admin), 2026-10-24, con la ficha de #FV220
 * en «Pending Approval»: «Need to know what needs review if it didn't pass the auto approval».
 *
 * Una orden nueva nace pendiente en vez de aprobada (`naceAprobada`, `cuenta-aprobacion.ts`) por una de estas, y cada una
 * se puede volver a decir al mirarla:
 *  - su cuenta está marcada «siempre con aprobación» (D-292);
 *  - es una Intertienda sin PO;
 *  - su tienda no aprueba sola (`auto_approve` en Ajustes);
 *  - pasada la hora de corte o con el cupo de la mañana lleno (D-639). Esa NO se puede recalcular (depende de la hora en
 *    que se creó y de cuántas había entonces): se lee de lo que se apuntó en el historial al crearla o al enviarla
 *    (`created` / `pending` con nota).
 * Lo que no se sabe no se inventa: si no hay nada de eso, se dice que no quedó motivo apuntado.
 */
export interface MotivoDePendiente { clave: "cuenta" | "intertienda_sin_po" | "tienda" | "apuntado" | "sin_motivo"; en: string; es: string }

type Orden = Pick<Delivery, "stage" | "store" | "account" | "order_type" | "po2">;

/** La nota con la que la orden entró en pendiente: la del ÚLTIMO evento `created` o `pending` (el que la dejó así), si tiene. */
export function notaDeEntradaEnPendiente(eventos: readonly Pick<OrderEvent, "kind" | "note" | "created_at">[]): string | null {
  const entradas = eventos.filter((e) => e.kind === "created" || e.kind === "pending")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ultima = entradas.at(-1);
  const nota = (ultima?.note ?? "").trim();
  return nota || null;
}

export function porQueEsperaAprobacion(
  o: Orden,
  ctx: { tiendas: readonly { name: string; auto_approve?: boolean | null }[]; cuentas: AccountRecord[] | null | undefined; eventos: readonly Pick<OrderEvent, "kind" | "note" | "created_at">[] },
): MotivoDePendiente[] {
  if (o.stage !== "pending") return [];
  const out: MotivoDePendiente[] = [];
  if (cuentaRequiereAprobacion(ctx.cuentas, o.account)) {
    out.push({ clave: "cuenta", en: `The account «${o.account}» always needs office approval`, es: `La cuenta «${o.account}» siempre pasa por oficina` });
  }
  if (o.order_type === "Intertienda" && !(o.po2 ?? "").trim()) {
    out.push({ clave: "intertienda_sin_po", en: "It's an Intertienda without a PO #", es: "Es una Intertienda sin PO" });
  }
  const tienda = ctx.tiendas.find((s) => s.name === o.store);
  if (o.store && !tienda?.auto_approve) {
    out.push({ clave: "tienda", en: `${o.store} doesn't approve its orders on its own`, es: `${o.store} no aprueba sola sus órdenes` });
  }
  const nota = notaDeEntradaEnPendiente(ctx.eventos);
  if (nota) for (const parte of nota.split(/;\s*/).filter(Boolean)) out.push({ clave: "apuntado", en: parte, es: motivoApuntadoEnEspanol(parte) });
  if (!out.length) {
    out.push({
      clave: "sin_motivo",
      en: "No reason was recorded: it was sent for approval by hand, or before reasons were recorded",
      es: "No quedó motivo apuntado: se envió a aprobación a mano, o antes de que se apuntaran los motivos",
    });
  }
  return out;
}

/**
 * Lo apuntado va en inglés (`textoDelMotivo(m, false)`, D-639: es lo que lee la oficina en el aviso). Sus tres formas se
 * dicen en español; otra nota, tal cual.
 */
export function motivoApuntadoEnEspanol(nota: string): string {
  let m = /^It's for today and it's past (.+)$/.exec(nota);
  if (m) return `Es para hoy y ya pasaron las ${m[1]}`;
  m = /^It's for tomorrow morning and it's past (.+)$/.exec(nota);
  if (m) return `Es para mañana temprano y ya pasaron las ${m[1]}`;
  m = /^The (.+) window already has (\d+) of (\d+) orders that day$/.exec(nota);
  if (m) return `La ventana ${m[1]} ya tiene ${m[2]} de ${m[3]} órdenes ese día`;
  return nota;
}
