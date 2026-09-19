/**
 * La ruta asignada A MANO, leída como secuencia de recogidas y entregas: `Base → P1·P2 → P3 → D1 → D3 → D2` (D-NEXT).
 *
 * El dueño: «I don't see P1 pickup 1, pickup 2 as P2 and D1 and D2… and so on». Las etiquetas P/D solo existían dentro
 * de «Plan del día», DESPUÉS de planificar con el motor; el Gestor de Rutas de siempre —que es donde él mira— numeraba
 * las paradas 1, 2, 3 y no decía nada de las recogidas. Esto NO cambia ninguna asignación ni escribe nada: es solo cómo
 * se LEE lo que ya hay (`assigned_driver`, `load_no`, `route_seq`, «Vendido desde»).
 *
 * Las reglas, y de dónde sale cada una:
 *   · **`Dk` es SIEMPRE la entrega de la orden recogida en `Pk`.** El número es de la orden.
 *   · **El número sigue el orden de RECOGIDA, igual que en un plan del motor** (`route-engine/evalua.ts`): los P se leen
 *     1, 2, 3 y son los D los que saltan — `P1·P2 — Pharr → P3 — McAllen → D1 → D3 → D2`. Es la definición del dueño
 *     («P1, P2, P3… = Pickup 1, 2, 3») y su propio ejemplo: `Base → P1 → P2 → D2 → P3 → D1 → D3`. Una primera versión
 *     numeraba por entrega y las recogidas salían «P1, P3, P2»: se leía como un error. El recorrido de recogidas sigue
 *     saliendo de `route_seq` —lo único que una persona decidió—: las tiendas, en el orden de su primera entrega.
 *   · **Por viaje: primero se carga, luego se entrega.** Un viaje es un camión que sale cargado de tienda.
 *   · **Una tienda es UNA parada de recogida por viaje**, con todas sus órdenes dentro («P1·P2 — Tienda»), en el
 *     orden en que aparece la primera. El orden de recogidas de una ruta manual no lo decidió nadie: ir dos veces a la
 *     misma tienda en el mismo viaje sería inventarse un rodeo.
 *   · **La numeración NO se reinicia por viaje**: la orden 4 es la cuarta que ese chofer recoge en el día, en el viaje que sea.
 *   · **Sin horas.** Donde no planificó el motor no hay hora estimada, y no se inventa.
 *   · **Pallets a bordo tras cada parada**: sube en P, baja en D. En centésimas, como el motor, para que 0,1 + 0,2 sea 0,3.
 */

export interface OrdenDeRuta { id: string; store: string | null; pallets: number | null }

export interface ParadaPD {
  tipo: "P" | "D";
  /** Una entrega lleva una; una recogida, una por cada orden que se carga en esa tienda. */
  etiquetas: string[];
  ordenes: string[];
  /** Solo en P: la tienda. `null` = la orden no dice de qué tienda sale, y se dice en vez de adivinarlo. */
  tienda: string | null;
  viaje: number;
  /** Pallets en el camión al SALIR de esta parada. */
  aBordo: number;
  /** Alguna orden de esta parada no tiene pallets contados: el «a bordo» se queda corto, y se avisa. */
  sinConteo: boolean;
}

const normaliza = (s: string | null) => (s ?? "").trim().toLowerCase();
const centesimas = (n: number | null) => Math.round((n ?? 0) * 100);

/** `viajes`: los viajes del chofer, en orden, cada uno con sus entregas en el orden en que se hacen. */
export function secuenciaPD(viajes: readonly (readonly OrdenDeRuta[])[]): ParadaPD[] {
  const paradas: ParadaPD[] = [];
  let k = 0;
  viajes.forEach((entregas, v) => {
    let aBordo = 0;
    // Las recogidas: una por tienda, en el orden en que aparece la primera orden de cada una.
    const porTienda = new Map<string, OrdenDeRuta[]>();
    for (const o of entregas) {
      // Una orden sin tienda no se junta con otra sin tienda: no se sabe que salgan del mismo sitio.
      const clave = normaliza(o.store) || `sin-tienda:${o.id}`;
      porTienda.set(clave, [...(porTienda.get(clave) ?? []), o]);
    }
    // El número se da AL RECOGER: tienda por tienda, y dentro de cada una en el orden de entrega.
    const numero = new Map<string, number>();
    for (const suyas of porTienda.values()) for (const o of suyas) numero.set(o.id, ++k);
    for (const suyas of porTienda.values()) {
      aBordo += suyas.reduce((s, o) => s + centesimas(o.pallets), 0);
      paradas.push({
        tipo: "P", etiquetas: suyas.map((o) => `P${numero.get(o.id)}`), ordenes: suyas.map((o) => o.id), tienda: (suyas[0].store ?? "").trim() || null,
        viaje: v + 1, aBordo: aBordo / 100, sinConteo: suyas.some((o) => o.pallets == null),
      });
    }
    for (const o of entregas) {
      aBordo -= centesimas(o.pallets);
      paradas.push({ tipo: "D", etiquetas: [`D${numero.get(o.id)}`], ordenes: [o.id], tienda: null, viaje: v + 1, aBordo: aBordo / 100, sinConteo: o.pallets == null });
    }
  });
  return paradas;
}

/** La etiqueta de entrega de cada orden (`D3`), para pintarla en el mapa y en las filas que ya existen. */
export function etiquetaDeEntrega(paradas: readonly ParadaPD[]): Map<string, string> {
  return new Map(paradas.filter((p) => p.tipo === "D").map((p) => [p.ordenes[0], p.etiquetas[0]]));
}

/** De las órdenes de un viaje a lo que esto necesita. La tienda de recogida es «Vendido desde» en TODOS los tipos desde
 *  D-312 (`origenDeLaOrden`): también en una Intertienda, donde es la tienda que manda el material. Pallets: los reales si
 *  ya se contaron; si no, los estimados; si no hay ninguno, `null` — y se avisa. */
export const ordenesDeRuta = (entregas: readonly { id: string; store?: string | null; actual_pallets?: number | null; est_pallets?: number | null }[]): OrdenDeRuta[] =>
  entregas.map((d) => ({ id: d.id, store: d.store ?? null, pallets: d.actual_pallets ?? d.est_pallets ?? null }));
