/**
 * «Esa vuelta no compensa» (D-NEXT): pocos pallets para ir hasta la tienda que queda lejos de las demás.
 *
 * El dueño, 2026-10-22, con una carga de 0.25 pallets entre la tienda lejana y una de las cercanas: si pasa algo así, que
 * el sistema diga que es muy poquito pallet para una vuelta tan larga y recomiende reprogramar esas cargas; que lo piense
 * él solo, y que si no hay cargas así, todo siga normal. La oficina ya las mueve a mano, pero sin regla: en la historia
 * (DECISIONS.md, D-NEXT) movió 12 de 59 cargas de menos de medio pallet y 1 de 36 de 2 a 4.
 *
 * Esto solo RECOMIENDA: devuelve qué cargas mover y a qué día, con el porqué; quien mueve es una persona, con un botón
 * del Gestor de Rutas. Como el resto del motor, es dato plano: ni red, ni base, ni reloj. El calendario —qué día de
 * trabajo sigue a otro— entra como función (`siguienteDia`): el motor no importa nada de fuera.
 *
 * Lo que decide, en este orden:
 *   1. **Qué tienda queda lejos**, calculado de los puntos de Ajustes (ningún nombre en el código): una tienda es lejana si
 *      la mediana de sus millas a las demás supera `factorDeLejania` veces la mediana de las millas ENTRE las demás. Entre
 *      las demás y no entre todas: con tres tiendas, dos juntas y una lejos, la mediana de todas ya es la distancia larga
 *      y nada sería lejano.
 *   2. **Qué cruza ese día**: toda orden con una punta «allí» —en la tienda lejana, o a menos de `radioMi` de ella— y la
 *      otra «aquí» —en una de las demás tiendas, o a menos de `radioMi` de alguna—. Una intertienda entre la lejana y otra
 *      cruza; una entrega de cliente de la tienda lejana en su propio pueblo, no. Una punta que no está cerca de ninguna
 *      tienda no cruza nada: en la base de verdad, de 108 entregas de cliente de la tienda lejana con pin, 33 eran de sitios
 *      a medio camino o más allá (la isla, a ~31 mi de ella y ~67 de las demás), y una tenía el pin a 1 400 mi. Contarlas
 *      como «aquí» decía que el viaje iba cuando nadie subía.
 *   3. **Si el viaje va igual, no se dice nada**: si lo que cruza suma `umbralPallets` o más, o si cruza algo que no se
 *      puede mover —una orden de cliente, una urgente (prioridad alta o crítica, primera hora, ventana dura), una que ya
 *      salió o se entregó—, alguien hace esa vuelta de todos modos y las cargas chicas van de paso. Una intertienda sin
 *      pallets apuntados tampoco se mueve: no se sabe cuánto lleva, y recomendar sobre un cero sería inventar.
 *   4. **Si no**, se recomienda mover todo lo que cruza (solo intertiendas que no han salido, ninguna urgente) al primer
 *      día de trabajo de los `diasAdelante` siguientes en que ese viaje ya va (por lo mismo del punto 3, contando ya lo
 *      que se mueve); si ninguno, al primero que tenga alguna carga con esa tienda; si tampoco, al día de trabajo
 *      siguiente, y el motivo lo dice.
 */

export interface PuntoGeo { lat: number; lng: number }

/** Una tienda de Ajustes con su punto verificado. */
export interface TiendaConPunto extends PuntoGeo { nombre: string }

/** Lo que hace falta saber de una orden, ya traducido de la fila de la base (`lib/recomienda-reprogramar.ts`). */
export interface OrdenParaLaVuelta {
  id: string;
  /** Su fecha de entrega, `AAAA-MM-DD`. */
  fecha: string;
  /** Solo una intertienda se recomienda mover; una orden de cliente nunca. */
  intertienda: boolean;
  /** La tienda donde se carga, por nombre. */
  origen: string | null;
  /** La tienda que la recibe, por nombre (intertienda). */
  destino: string | null;
  /** El pin de la entrega, si lo tiene: el de un cliente, o el de la tienda que recibe. */
  entrega?: PuntoGeo | null;
  pallets: number;
  /** Prioridad alta o crítica, primera hora, o ventana dura: se entrega ese día, compense o no. */
  urgente: boolean;
  /** Todavía no ha salido (pendiente, aprobada, preparando, lista): se puede reprogramar. */
  movible: boolean;
}

export interface ParametrosDeVuelta {
  /** Cuántas veces la distancia entre las demás tiene que ser la suya para que una tienda sea lejana. */
  factorDeLejania: number;
  /** Por debajo de estos pallets, la vuelta no compensa. */
  umbralPallets: number;
  /** A cuántas millas de la tienda lejana una entrega todavía es «allí». */
  radioMi: number;
  /** Cuántos días de trabajo hacia delante se busca dónde juntarlas. */
  diasAdelante: number;
}

/** Los de por defecto, decididos por el orquestador con la historia delante (D-NEXT). Editables en Ajustes → Motor de rutas. */
export const PARAMETROS_DE_VUELTA_POR_DEFECTO: ParametrosDeVuelta = { factorDeLejania: 2, umbralPallets: 1, radioMi: 15, diasAdelante: 3 };

/** Lo que una carretera alarga la línea recta: el mismo 1.3 que el proveedor «estimado» de tiempos
 *  (`route-times/proveedores.ts`, `FACTOR_DE_RODEO`). Copiado y no importado para que el motor no dependa de fuera; una
 *  prueba compara los dos. */
export const FACTOR_DE_RODEO_DE_LA_VUELTA = 1.3;

/** Millas por carretera, estimadas: línea recta por el factor de rodeo. */
export function millasEstimadasEntre(a: PuntoGeo, b: PuntoGeo): number {
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.8 * Math.asin(Math.min(1, Math.sqrt(h))) * FACTOR_DE_RODEO_DE_LA_VUELTA;
}

const mediana = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export interface TiendaLejana {
  nombre: string;
  punto: PuntoGeo;
  /** La mediana de sus millas a las demás tiendas. */
  millasALasDemas: number;
  /** La mediana de las millas entre las demás, sin ella. */
  millasEntreLasDemas: number;
}

/** Las tiendas que quedan lejos de las demás (punto 1 de arriba). Hacen falta tres con punto: con dos no hay «las demás». */
export function tiendasLejanas(tiendas: readonly TiendaConPunto[], factor: number): TiendaLejana[] {
  const con = tiendas.filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lng));
  const out: TiendaLejana[] = [];
  for (const t of con) {
    const demas = con.filter((x) => x !== t);
    if (demas.length < 2) continue;
    const aLasDemas = mediana(demas.map((x) => millasEstimadasEntre(t, x)));
    const entre: number[] = [];
    for (let i = 0; i < demas.length; i++) for (let j = i + 1; j < demas.length; j++) entre.push(millasEstimadasEntre(demas[i], demas[j]));
    const entreLasDemas = mediana(entre);
    if (aLasDemas > factor * entreLasDemas) out.push({ nombre: t.nombre, punto: { lat: t.lat, lng: t.lng }, millasALasDemas: aLasDemas, millasEntreLasDemas: entreLasDemas });
  }
  return out;
}

/**
 * Las tiendas lejanas, juntas por sitio: dos que están a menos de `radioMi` la una de la otra son el mismo «allí» (en la
 * base de verdad hay una bodega al lado de la tienda lejana, y las dos salían lejanas). Sin esto, cada una daba su propia
 * recomendación con las mismas cargas, y una intertienda entre las dos contaba como vuelta larga.
 */
export function sitiosLejanos(lejanas: readonly TiendaLejana[], radioMi: number): TiendaLejana[][] {
  const sitios: TiendaLejana[][] = [];
  for (const t of lejanas) {
    const suyo = sitios.find((s) => s.some((x) => millasEstimadasEntre(x.punto, t.punto) <= radioMi));
    if (suyo) suyo.push(t); else sitios.push([t]);
  }
  return sitios;
}

export interface RecomendacionDeVuelta {
  /** La tienda lejana. */
  tienda: string;
  /** El día que se mira. */
  fecha: string;
  /** Las órdenes que se recomienda mover, en el orden en que llegaron. */
  ids: string[];
  pallets: number;
  millasIdaYVuelta: number;
  fechaSugerida: string;
  /** Los pallets que ya cruzan el día sugerido, sin contar los que se mueven. */
  palletsEseDia: number;
  /** Por qué ese día: ya va el viaje, ya hay alguna carga, o no hay nada en los días que se miran. */
  seJuntaCon: "viaje" | "cargas" | "nada";
  motivo: { es: string; en: string };
}

const clave = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const centesimas = (n: number) => Math.round(n * 100) / 100;

const DIAS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const DIAS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** 0 = domingo. Aritmética (Sakamoto) y no `Date`: el motor no toca el reloj, y una prueba lo vigila. */
const diaDeLaSemana = (fecha: string): number => {
  const [a, m, d] = fecha.split("-").map(Number);
  const y = m < 3 ? a - 1 : a;
  return (y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) + [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4][m - 1] + d) % 7;
};

export interface EntradaDeLaVuelta {
  /** El día que se mira, `AAAA-MM-DD`. */
  fecha: string;
  /** Las órdenes de ese día y de los siguientes (las demás se ignoran). */
  ordenes: readonly OrdenParaLaVuelta[];
  tiendas: readonly TiendaConPunto[];
  parametros?: Partial<ParametrosDeVuelta>;
  /** El día de trabajo que sigue a una fecha (`siguienteDiaDeTrabajo`, que salta el domingo). */
  siguienteDia: (fecha: string) => string;
}

/** Las recomendaciones del día, una por tienda lejana cuya vuelta no compensa. Vacío = todo normal. */
export function vueltasQueNoCompensan(e: EntradaDeLaVuelta): RecomendacionDeVuelta[] {
  const p: ParametrosDeVuelta = { ...PARAMETROS_DE_VUELTA_POR_DEFECTO, ...e.parametros };
  const puntoDe = new Map(e.tiendas.map((t) => [clave(t.nombre), { lat: t.lat, lng: t.lng } as PuntoGeo]));
  const out: RecomendacionDeVuelta[] = [];

  for (const sitio of sitiosLejanos(tiendasLejanas(e.tiendas, p.factorDeLejania), p.radioMi)) {
    const delSitio = new Set(sitio.map((t) => clave(t.nombre)));
    const lasDemas = e.tiendas.filter((t) => !delSitio.has(clave(t.nombre)));
    const cerca = (punto: PuntoGeo, tiendas: readonly PuntoGeo[]) => tiendas.some((t) => millasEstimadasEntre(punto, t) <= p.radioMi);
    // ¿De qué lado está esta punta? «allí» (el sitio lejano), «aquí» (las demás tiendas), o `null`: ni cerca de una ni de
    // otra, o no se sabe dónde está.
    const lado = (tienda: string | null, pin: PuntoGeo | null | undefined): "alli" | "aqui" | null => {
      if (tienda && delSitio.has(clave(tienda))) return "alli";
      const punto = pin ?? (tienda ? puntoDe.get(clave(tienda)) : undefined);
      if (!punto) return null;
      if (cerca(punto, sitio.map((t) => t.punto))) return "alli";
      return cerca(punto, lasDemas) ? "aqui" : null;
    };
    const cruza = (o: OrdenParaLaVuelta): boolean => {
      const a = lado(o.origen, null);
      // La punta de la entrega: el pin si lo hay; si no, la tienda que recibe.
      const b = lado(o.destino, o.entrega);
      return a != null && b != null && a !== b;
    };
    const seMueve = (o: OrdenParaLaVuelta) => o.intertienda && o.movible && !o.urgente && o.pallets > 0;
    const cruzanEl = (fecha: string) => e.ordenes.filter((o) => o.fecha === fecha && cruza(o));
    const suma = (xs: readonly OrdenParaLaVuelta[]) => centesimas(xs.reduce((s, o) => s + o.pallets, 0));

    const delDia = cruzanEl(e.fecha);
    if (delDia.length === 0) continue;
    // El nombre que se enseña: la tienda del sitio que más sale en lo que cruza ese día (con una sola, esa).
    const veces = (t: TiendaLejana) => delDia.filter((o) => clave(o.origen) === clave(t.nombre) || clave(o.destino) === clave(t.nombre)).length;
    const lejana = sitio.reduce((a, b) => (veces(b) > veces(a) ? b : a));
    const pallets = suma(delDia);
    // El viaje va igual: se juntan pallets de sobra, o cruza algo que no se mueve.
    if (pallets >= p.umbralPallets || delDia.some((o) => !seMueve(o))) continue;

    // El día al que se mueven: el primero en que el viaje ya va, si no el primero con alguna carga, si no el siguiente.
    const dias: string[] = [];
    for (let d = e.fecha, i = 0; i < Math.max(1, Math.floor(p.diasAdelante)); i++) dias.push((d = e.siguienteDia(d)));
    const conCargas = dias.map((d) => ({ d, xs: cruzanEl(d) }));
    const vaElViaje = conCargas.find(({ xs }) => xs.length > 0 && (suma(xs) + pallets >= p.umbralPallets || xs.some((o) => !seMueve(o))));
    const alguna = conCargas.find(({ xs }) => xs.length > 0);
    const elegido = vaElViaje ?? alguna ?? { d: dias[0], xs: [] };
    const seJuntaCon: RecomendacionDeVuelta["seJuntaCon"] = vaElViaje ? "viaje" : alguna ? "cargas" : "nada";
    const palletsEseDia = suma(elegido.xs);

    const ida = Math.round(lejana.millasALasDemas), entre = Math.round(lejana.millasEntreLasDemas);
    const vuelta = Math.round(2 * lejana.millasALasDemas);
    const dw = diaDeLaSemana(elegido.d);
    const es = `${pallets} pallets para una vuelta de ~${vuelta} mi (${lejana.nombre} está a ~${ida} mi de las demás tiendas; entre las otras, ~${entre} mi). `
      + (seJuntaCon === "nada"
        ? `Ningún día de los próximos ${dias.length} tiene cargas con ${lejana.nombre}: se juntarán con lo que salga el ${DIAS_ES[dw]} ${elegido.d}.`
        : `El ${DIAS_ES[dw]} ${elegido.d} ya hay ${palletsEseDia} pallets con ${lejana.nombre}${seJuntaCon === "viaje" ? "" : "; se juntan con ellos"}.`);
    const en = `${pallets} pallets for a ~${vuelta} mi round trip (${lejana.nombre} is ~${ida} mi from the other stores; between the others, ~${entre} mi). `
      + (seJuntaCon === "nada"
        ? `None of the next ${dias.length} days has loads with ${lejana.nombre}: they'll go with whatever leaves on ${DIAS_EN[dw]} ${elegido.d}.`
        : `On ${DIAS_EN[dw]} ${elegido.d} there are already ${palletsEseDia} pallets with ${lejana.nombre}${seJuntaCon === "viaje" ? "" : "; they'll go together"}.`);

    out.push({
      tienda: lejana.nombre, fecha: e.fecha, ids: delDia.map((o) => o.id), pallets, millasIdaYVuelta: vuelta,
      fechaSugerida: elegido.d, palletsEseDia, seJuntaCon, motivo: { es, en },
    });
  }
  return out.sort((a, b) => a.tienda.localeCompare(b.tienda));
}
