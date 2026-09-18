/**
 * El motor de rutas: tipos (D-314). Diseño en `docs/route-algorithm-design.md`.
 *
 * Todo lo que entra y sale de aquí es dato plano: nada de red, de base ni de reloj. La matriz de tiempos
 * es una ENTRADA. Por eso el motor es determinista, se prueba sin simular nada, y un plan guardado con su
 * entrada se puede volver a calcular dentro de un año y sale igual.
 *
 * Unidades, para que ninguna suma dependa de cómo redondea un decimal:
 *   · tiempo   → minutos enteros desde la medianoche del día de la ruta;
 *   · pallets  → entran con decimales (0.15, 2.5) y por dentro se cuentan en CENTÉSIMAS enteras;
 *   · millas   → entran con decimales y por dentro se cuentan en centésimas de milla enteras.
 */

/** La clave de un sitio en la matriz de tiempos: una tienda, un destino. */
export type Punto = string;

export type Tramo = { minutos: number; millas: number };

/** `matriz[a][b]` = ir de `a` a `b`. De un punto a sí mismo no hace falta: es cero. */
export type Matriz = Record<Punto, Record<Punto, Tramo>>;

/** Cada cuántos minutos cambia el bloque horario del tráfico. Media hora: el grano de la caché. */
export const MINUTOS_POR_BLOQUE = 30;

/**
 * Tiempos CON tráfico, que dependen de la hora a la que se sale: `porHora[a][b][bloque]`, donde el bloque
 * es la media hora de salida (16 = 08:00–08:29). Es un DATO, no una función: así un plan calculado con
 * tráfico se guarda entero, y EVALUAR su secuencia vuelve a dar las mismas horas. (Volver a PLANIFICAR con
 * él no tiene por qué dar el mismo plan: solo trae tráfico para los tramos que se probaron.) Donde falte un
 * tramo o un bloque, vale la `matriz` base.
 */
export type TiemposPorHora = Record<Punto, Record<Punto, Record<number, Tramo>>>;

export interface OrdenEntrada {
  id: string;
  /** El código humano de la orden; segundo criterio de desempate. */
  codigo?: string | null;
  /** Fecha y hora en que entró, en un texto que ordene bien ("2026-09-18 0815"). Primer criterio de
   *  desempate: «la que entró primero va primero». Sin ella, va detrás de las que la tienen. */
  entrada?: string | null;
  /** La tienda donde se recoge, y el sitio donde se entrega. `null` = la orden no tiene punto. */
  origen: Punto | null;
  destino: Punto | null;
  pallets: number;
  /** Ventana de entrega en minutos `[abre, cierra]`, o `null` si no tiene. */
  ventana: [number, number] | null;
  /** Ventana estrecha: no se llega tarde nunca. Qué ventanas lo son lo dice Ajustes, no el motor. */
  estrecha?: boolean;
  builder?: boolean;
  servicioRecogidaMin: number;
  servicioEntregaMin: number;
  /** El chofer que ya puso una persona: se respeta el CHOFER; la posición la decide el motor. */
  choferFijado?: string | null;
  /** La recogida ya ocurrió: la carga va en el camión de `choferFijado` desde el principio, y solo queda
   *  la entrega. */
  recogidaHecha?: boolean;
}

export interface ChoferEntrada {
  id: string;
  nombre: string;
  base: Punto;
  capacidad: number;
  /** Turno, en minutos desde la medianoche. */
  entrada: number;
  salida: number;
  vuelveABase: boolean;
}

export type TipoDeParada = "P" | "D";

/** Una parada, sin evaluar: de qué orden es y si es su recogida o su entrega. */
export type ParadaRef = { orden: string; tipo: TipoDeParada };

/** Los pesos de los cuatro objetivos suaves, en el orden que dio el dueño. Vienen de Ajustes. */
export interface Pesos {
  /** Por minuto que tarda en llegar la entrega de un builder desde que su chofer empieza el turno. */
  builder: number;
  /** Por minuto de manejo, y por milla. Los dos son «ruta más corta». */
  manejo: number;
  millas: number;
  /** Por minuto tarde en una ventana ancha. */
  tarde: number;
  /** Por minuto de diferencia entre el chofer más cargado y el menos. */
  balance: number;
}

export interface Parametros {
  pesos: Pesos;
  /** Una ventana ancha admite retraso hasta aquí; por encima, la orden no cabe. */
  topeTardeAnchaMin: number;
  /** Lo mínimo que dura una visita a una tienda para cargar, se recoja lo que se recoja. */
  recargaMinimaMin: number;
  /** Cuántos movimientos de mejora se aplican como mucho. Se corta por CUENTA, nunca por reloj: un
   *  límite de tiempo haría que el plan dependiera de lo rápida que sea la máquina. */
  maxMovimientos: number;
}

export interface Entrada {
  ordenes: OrdenEntrada[];
  choferes: ChoferEntrada[];
  matriz: Matriz;
  /** Opcional: tiempos con tráfico por hora de salida, encima de la matriz base. */
  porHora?: TiemposPorHora;
  /** Paradas que el despachador fijó: se quedan con ese chofer y en ese orden entre sí. El motor coloca
   *  lo demás alrededor. */
  secuenciaFijada?: Record<string, ParadaRef[]>;
}

/** Los cuatro términos del coste, por separado. Nunca se enseña solo el total. */
export interface Desglose {
  /** Minutos-builder: suma de lo que tarda en llegar cada builder. */
  builder: number;
  manejoMin: number;
  millas: number;
  tardeMin: number;
  balanceMin: number;
  /** La suma ponderada, en unidades internas enteras. Solo sirve para comparar dos planes. */
  total: number;
}

export type TipoDeViolacion =
  | "precedencia"
  | "capacidad"
  | "ventana_estrecha"
  | "retraso_sobre_el_tope"
  | "fuera_de_turno"
  | "sin_tiempo_de_viaje"
  | "chofer_distinto_del_fijado";

export interface Violacion {
  tipo: TipoDeViolacion;
  chofer: string;
  orden?: string;
  detalle?: string;
}

export interface ParadaEvaluada extends ParadaRef {
  punto: Punto;
  /** «P1», «D1»… El número lo comparte el par, y empieza en 1. */
  etiqueta: string;
  /** Paradas seguidas en el mismo sitio son una sola visita física: comparten este número. */
  visita: number;
  tramoMin: number;
  tramoMillas: number;
  llegada: number;
  esperaMin: number;
  inicioServicio: number;
  servicioMin: number;
  salida: number;
  tardeMin: number;
  /** Pallets a bordo al salir de esta parada, con sus decimales. */
  cargaAlSalir: number;
  fijada: boolean;
}

export interface RutaEvaluada {
  chofer: string;
  paradas: ParadaEvaluada[];
  inicio: number;
  fin: number;
  duracionMin: number;
  manejoMin: number;
  millas: number;
  tardeMin: number;
  builderMin: number;
  violaciones: Violacion[];
}

export type MotivoSinAsignar =
  | "sin_punto"
  | "sin_chofer_disponible"
  | "supera_capacidad"
  | "ventana_imposible"
  | "retraso_sobre_el_tope"
  | "fuera_de_turno"
  | "chofer_fijado_sin_hueco"
  | "no_cabe_con_el_resto";

export interface SinAsignar {
  orden: string;
  motivo: MotivoSinAsignar;
}

/** Lo que costaría llevar una orden con OTRO chofer, término a término. `null` = con ese no se puede. */
export interface Alternativa {
  chofer: string;
  diferencia: Desglose | null;
  motivo?: TipoDeViolacion | "no_permitido";
}

export interface Explicacion {
  orden: string;
  chofer: string;
  /** Lo que aporta esta orden al coste del plan: quitarla lo bajaría en esto. */
  aporta: Desglose;
  alternativas: Alternativa[];
}

export interface PlanEvaluado {
  rutas: RutaEvaluada[];
  coste: Desglose;
  violaciones: Violacion[];
}

export interface Plan extends PlanEvaluado {
  sinAsignar: SinAsignar[];
  explicaciones: Explicacion[];
  /** Una orden mayor que el camión se parte en cargas del mismo chofer: aquí, qué partes salieron de cuál. */
  partes: Record<string, string[]>;
  movimientos: number;
  /** `false` = se agotó `maxMovimientos` antes de dejar de mejorar. El plan vale; no es el mejor posible. */
  convergio: boolean;
  version: string;
}
