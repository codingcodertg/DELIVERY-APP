import { facturaYId } from "@/lib/route-plan/etiqueta";

/**
 * Cómo se nombra una orden en el MAPA (D-NEXT, a): por su FACTURA. El dueño, 2026-10-06 (dictado, literal): «remove id and
 * have invoice in the map view».
 *
 * Los pines del mapa decían «#1013 — Diego (Parada D2)»: el ID. En las tablas del Gestor la factura manda desde D-456 («Invoice
 * number is more important»); el mapa se había quedado con el ID. Ahora el pin dice la factura. Una orden sin factura (una
 * intertienda, D-465) se nombra por su ID y se dice que está sin factura, para que no se confunda con una factura.
 */
export function nombreEnElMapa(d: { order_no: number; order_code?: string | null; order_suffix?: string | null; invoice_num?: string | null }, t: (en: string, es: string) => string): string {
  const n = facturaYId(d);
  return n.esFactura ? n.principal : `${n.principal} (${t("no invoice", "sin factura")})`;
}
