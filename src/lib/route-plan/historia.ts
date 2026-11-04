import type { Antecedente } from "../route-engine/afinidad";

/** Una ruta hecha, como sale de `deliveries` (D-834). */
export interface FilaDeHistoria { assigned_driver: string | null; delivery_date: string | null; store: string | null; pickup_name?: string | null; account: string | null; delivery_lat: number | null; delivery_lng: number | null }

/** Las filas de rutas hechas → antecedentes para `aprendeAfinidad`. Sin chofer o sin fecha, no cuentan. */
export function antecedentesDeRutas(filas: readonly FilaDeHistoria[]): Antecedente[] {
  return filas.filter((f) => (f.assigned_driver ?? "").trim() && f.delivery_date).map((f) => ({
    chofer: f.assigned_driver!.trim(), fecha: String(f.delivery_date).slice(0, 10), tienda: f.store, cuenta: f.account, lat: f.delivery_lat, lng: f.delivery_lng,
  }));
}

/** Lo mínimo del cliente de Supabase que hace falta para leer la historia. */
export type ClienteDeHistoria = { from: (tabla: string) => unknown };

/**
 * Las rutas hechas de los `dias` anteriores a `fecha` (D-834), con la sesión de quien planifica. NUNCA falla: si la lectura
 * no sale (sin red, una columna que falta, un cliente de pruebas), se planifica sin historia, como antes.
 */
export async function leeHistoriaDeRutas(cliente: ClienteDeHistoria, fecha: string, dias = 120): Promise<Antecedente[]> {
  try {
    const desde = new Date(Date.parse(fecha + "T12:00:00Z") - dias * 86_400_000).toISOString().slice(0, 10);
    const q = (cliente.from("deliveries") as any).select("assigned_driver, delivery_date, store, pickup_name, account, delivery_lat, delivery_lng")
      .not("assigned_driver", "is", null).gte("delivery_date", desde).lt("delivery_date", fecha).in("stage", ["delivered", "picked_up"]).limit(5000);
    const { data, error } = await q;
    if (error || !Array.isArray(data)) return [];
    return antecedentesDeRutas(data as FilaDeHistoria[]);
  } catch { return []; }
}
