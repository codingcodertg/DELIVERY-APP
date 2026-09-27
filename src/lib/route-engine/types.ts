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
  /** La prioridad de la orden (D-412), como OptimoRoute. Sin ella —una base sin la 147, un plan guardado de
   *  antes—, normal: el motor planifica exactamente como antes de que existiera. */
  prioridad?: PrioridadDeOrden | null;
  /** Lo que pide del camión (D-418, 151; OptimoRoute `skills`): solo va con un chofer que lo tenga todo. Sin ella, o
   *  vacía, va con cualquiera, como antes. Un chofer fijado por una persona se respeta aunque no lo tenga. */
  requisitos?: string[] | null;
  /** La zona de la entrega (D-421, 152): la CIUDAD de su dirección, como la columna «Ciudad de entrega» del Gestor. Sin
   *  ella —sin ciudad, o sin ningún chofer con zonas—, ninguna preferencia la toca. Se compara sin mayúsculas. */
  zona?: string | null;
}

/** Los cuatro niveles de la 147. El motor no importa `lib/prioridad`: se queda sin nada de fuera. */
export type PrioridadDeOrden = "low" | "normal" | "high" | "critical";

/** Qué mide el balance entre choferes (OptimoRoute `balanceBy`): los minutos de jornada, o las entregas. */
export type BalancePor = "tiempo" | "ordenes";

export interface ChoferEntrada {
  id: string;
  nombre: string;
  base: Punto;
  capacidad: number;
  /** Turno, en minutos desde la medianoche. */
  entrada: number;
  salida: number;
  vuelveABase: boolean;
  /** Lo que tiene su camión (D-418, 151; OptimoRoute `vehicleFeatures`). Se compara sin mayúsculas. */
  habilidades?: string[] | null;
  /** Sus zonas preferidas (D-421, 152): ciudades de entrega. Es PREFERENCIA, no regla: llevar una entrega de una zona que
   *  prefiere OTRO chofer le cuesta el peso `zona`; nunca la prohíbe. Sin zonas, no paga nada por ninguna. */
  zonas?: string[] | null;
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
  /** Por entrega que un chofer con zonas lleva FUERA de ellas, siendo de una zona que prefiere otro chofer (D-421). En
   *  minutos equivalentes, como `manejo`. Ausente = el de por defecto; 0 = las zonas no deciden nada. */
  zona?: number;
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
  /** Qué reparte el peso `balance`. Ausente = `"tiempo"`, lo de siempre: un plan guardado antes de que
   *  existiera se revalida igual. */
  balancePor?: BalancePor;
  /** «Usar todos los choferes disponibles» (OptimoRoute): a cada chofer que rutea se le da al menos una
   *  orden si hay con qué, aunque cueste más manejo. Nunca a costa de dejar una orden fuera. Ausente = no. */
  usarTodos?: boolean;
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
  /** Diferencia entre el chofer más cargado y el menos, en minutos. Con `balancePor: "ordenes"`, las
   *  entregas de diferencia pasadas a minutos (`MINUTOS_POR_ORDEN_EN_BALANCE` cada una). */
  balanceMin: number;
  /** Entregas fuera de la zona de su chofer (D-421). SOLO está si algún chofer tiene zonas: sin zonas, el desglose es
   *  exactamente el de antes, byte a byte. */
  fueraDeZona?: number;
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
  /** Entregas de esta ruta fuera de las zonas de su chofer (D-421). Solo si el chofer tiene zonas. */
  fueraDeZona?: number;
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
  | "no_cabe_con_el_resto"
  /** Ningún chofer que rutea tiene lo que pide (D-418). `faltan` dice qué. */
  | "falta_requisito";

export interface SinAsignar {
  orden: string;
  motivo: MotivoSinAsignar;
  /** Solo con `falta_requisito`: lo que le falta al chofer que más cerca estaba de tenerlo todo. */
  faltan?: string[];
}

/** Lo que costaría llevar una orden con OTRO chofer, término a término. `null` = con ese no se puede. */
export interface Alternativa {
  chofer: string;
  diferencia: Desglose | null;
  motivo?: TipoDeViolacion | "no_permitido" | "falta_requisito";
  /** Solo con `falta_requisito`: lo que ese chofer no tiene. */
  faltan?: string[];
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
