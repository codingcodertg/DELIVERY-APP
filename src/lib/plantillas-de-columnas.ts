/**
 * Las PLANTILLAS de columnas (D-394): guardar lo que se tiene puesto con un nombre, y volver a ello con un clic.
 *
 * El dueño, literal: «add template in columns that will be like [save] the current order so if they change it and then want
 * to go back to the old one they can», y «logistic manager needs to have the same template as in order view». Así que es lo
 * mismo en ⚙ Columnas de Órdenes y en los dos ⚙ del Gestor de Rutas, con el mismo componente (`PlantillasDeColumnas`).
 *
 * Aquí solo lo que decide: qué se guarda, qué se rechaza y qué se aplica. Dónde vive (la cuarta mitad de la fila de
 * `user_prefs`, `_plantillas`) y cómo se sanea lo leído está en `user-prefs.ts`.
 *
 * «Por defecto / Default» NO es una plantilla guardada: es lo que trae la app, y lo pone cada pantalla con su propio
 * defecto. Por eso su nombre está reservado: una plantilla que se llamara igual no se distinguiría de él en el menú.
 */
import { CLAVE_DE_PLANTILLAS, MAX_NOMBRE_DE_PLANTILLA, MAX_PLANTILLAS, anchosDeUnRol, plantillasValidas, type PlantillaDeColumnas } from "@/lib/user-prefs";

export { MAX_PLANTILLAS };

/** Los nombres que no se pueden usar: los dos del «Por defecto» fijo, sin distinguir mayúsculas. */
export const NOMBRES_RESERVADOS: readonly string[] = ["default", "por defecto"];

/**
 * Cuánto ocupa `valor` como `jsonb` en la base, en bytes: lo que mide `pg_column_size(value)` en el `check` de la 136
 * (`< 8192`). NO es el largo del texto. Medido en un Postgres 17 local (2026-09-25, D-394): la fila de Órdenes con un rol y
 * diez plantillas llenas son 5 294 bytes de texto y 7 561 de `jsonb` (×1,43), porque cada ancho pasa a `numeric` con su
 * cabecera, alineado a 4, y cada elemento lleva 4 bytes de índice. Una guarda sobre el texto habría dejado pasar filas que
 * la base rechaza — y ese rechazo no se ve: la pantalla da la plantilla por guardada y al recargar no está.
 *
 * Reproduce el formato de `jsonb` (jsonb_util.c, `convertToJsonb`): cabecera de 4 del varlena; cada contenedor, 4 de
 * cabecera + 4 por elemento (por clave y por valor en un objeto), alineado a 4; las claves de un objeto van ordenadas por
 * largo y luego por bytes, y todas antes que los valores; un texto, sus bytes sin relleno; un número, alineado a 4 y con
 * 4 + 2 + 2 por cada grupo de 4 cifras (solo enteros: aquí no hay otros); `true`/`false`/`null`, nada. La prueba lo compara
 * con lo medido en Postgres, caso por caso.
 */
export function bytesEnLaBase(valor: unknown): number {
  const enc = new TextEncoder();
  let off = 4;                                                         // la cabecera del varlena
  const alinea = () => { off = (off + 3) & ~3; };
  const compara = (a: Uint8Array, b: Uint8Array) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  // Grupos de 4 cifras de un entero, sin los grupos de ceros del final (`numeric` los quita: 10000 es un grupo).
  const cifras = (n: number) => { let a = Math.abs(Math.trunc(n)), g = 0; while (a > 0 && a % 10000 === 0) a /= 10000; while (a > 0) { g++; a = Math.floor(a / 10000); } return g; };
  const escalar = (v: unknown) => {
    if (typeof v === "string") off += enc.encode(v).length;
    else if (typeof v === "number") { alinea(); off += 4 + 2 + 2 * cifras(v); }
    else if (v && typeof v === "object") contenedor(v);
  };
  const contenedor = (v: object) => {
    alinea();
    if (Array.isArray(v)) { off += 4 + 4 * v.length; for (const x of v) escalar(x); return; }
    const pares = Object.entries(v).filter(([, x]) => x !== undefined)
      .map(([k, x]) => [enc.encode(k), x] as const)
      .sort(([a], [b]) => a.length - b.length || compara(a, b));
    off += 4 + 8 * pares.length;
    for (const [k] of pares) off += k.length;
    for (const [, x] of pares) escalar(x);
  };
  escalar(valor);
  return off;
}

/** El tope de la base (136): `pg_column_size(value) < 8192`. */
export const TOPE_DE_LA_BASE = 8192;
/**
 * Lo que se deja libre al guardar una plantilla: lo que ocupan las tres mitades de UN rol llenas (medido: 697 bytes de
 * `jsonb`, 14 columnas visibles, en orden, y 15 anchos), redondeado. Guardar una plantilla nunca debe dejar la fila tan llena
 * que la próxima casilla, flecha o ancho —de este rol o del siguiente que mire un admin con «Ver como»— ya no quepa: esa
 * escritura fallaría en silencio.
 */
export const BYTES_DE_UN_ROL_LLENO = 697;
export const RESERVA_PARA_LO_DEMAS = 800;
export const cabeEnLaFila = (valor: Record<string, unknown>): boolean => bytesEnLaBase(valor) + RESERVA_PARA_LO_DEMAS < TOPE_DE_LA_BASE;

const clave = (nombre: string) => nombre.trim().toLowerCase();

/** La plantilla que se llama así, sin distinguir mayúsculas ni espacios de los lados. */
export function plantillaLlamada(lista: readonly PlantillaDeColumnas[], nombre: string): PlantillaDeColumnas | undefined {
  const k = clave(nombre);
  return k ? lista.find((p) => clave(p.n) === k) : undefined;
}

export type MotivoDeRechazo = "sin-nombre" | "reservado" | "lleno" | "no-cabe";
export type ResultadoDeGuardar =
  | { ok: true; lista: PlantillaDeColumnas[]; reemplaza: boolean }
  | { ok: false; motivo: MotivoDeRechazo };

/**
 * Guarda `foto` con el nombre `nombre`. Un nombre que ya existe se REEMPLAZA en su sitio (la pantalla lo avisa en el botón:
 * «Reemplazar»); uno nuevo va al final, si no se ha llegado a `MAX_PLANTILLAS`. Devuelve una lista nueva: no toca la de entrada.
 */
export function guardaPlantilla(lista: readonly PlantillaDeColumnas[], nombre: string, foto: Omit<PlantillaDeColumnas, "n">): ResultadoDeGuardar {
  const n = nombre.trim().slice(0, MAX_NOMBRE_DE_PLANTILLA);
  if (!n) return { ok: false, motivo: "sin-nombre" };
  if (NOMBRES_RESERVADOS.includes(clave(n))) return { ok: false, motivo: "reservado" };
  const nueva: PlantillaDeColumnas = { n, v: [...foto.v] };
  if (foto.o) nueva.o = [...foto.o];
  const anchos = anchosDeUnRol(foto.a);
  if (Object.keys(anchos).length) nueva.a = anchos;
  const i = lista.findIndex((p) => clave(p.n) === clave(n));
  if (i >= 0) { const r = [...lista]; r[i] = nueva; return { ok: true, lista: r, reemplaza: true }; }
  if (lista.length >= MAX_PLANTILLAS) return { ok: false, motivo: "lleno" };
  return { ok: true, lista: [...lista, nueva], reemplaza: false };
}

/** Quita la plantilla de ese nombre. Si no está, la lista sale igual (copia). */
export function borraPlantilla(lista: readonly PlantillaDeColumnas[], nombre: string): PlantillaDeColumnas[] {
  const k = clave(nombre);
  return lista.filter((p) => clave(p.n) !== k);
}

/**
 * Lo que se pone en Órdenes al aplicar una plantilla. Las columnas que ya no existen se caen; `orden: null` = el canónico
 * (una plantilla guardada sin orden propio); `anchos: {}` = los de la app (una plantilla guardada sin anchos arrastrados).
 * Aplicar es poner EXACTAMENTE la foto: si la plantilla no traía orden o anchos, se quita el que hubiera ahora.
 */
export function aplicaEnOrdenes(p: PlantillaDeColumnas, claves: readonly string[]): { visibles: string[]; orden: string[] | null; anchos: Record<string, number> } {
  const existe = new Set(claves);
  return {
    visibles: p.v.filter((k) => existe.has(k)),
    orden: p.o ? p.o.filter((k) => existe.has(k)) : null,
    anchos: anchosDeUnRol(p.a ?? {}, ["__id", ...claves]),
  };
}

/** Lo que dice el mensaje de un rechazo, en los dos idiomas. */
export function textoDelRechazo(motivo: MotivoDeRechazo, t: (en: string, es: string) => string): string {
  switch (motivo) {
    case "sin-nombre": return t("Write a name first.", "Escriba primero un nombre.");
    case "reservado": return t("That name is the built-in Default. Pick another.", "Ese nombre es el de «Por defecto». Elija otro.");
    case "lleno": return t(`You already have ${MAX_PLANTILLAS} templates. Delete one to save another.`, `Ya tiene ${MAX_PLANTILLAS} plantillas. Borre una para guardar otra.`);
    case "no-cabe": return t("It does not fit: delete a template to make room.", "No cabe: borre una plantilla para hacer sitio.");
  }
}

/** Dónde guarda el DEMO las plantillas (no tiene base): una llave por pantalla, en este navegador. */
export const claveDePlantillasEnElNavegador = (pantalla: string): string => `rtg_plantillas_${pantalla}`;

/** Las plantillas que el demo tiene en este navegador, saneadas. Un JSON roto no es ninguna plantilla. */
export function plantillasDelNavegador(leer: (clave: string) => string | null, pantalla: string): PlantillaDeColumnas[] {
  try { return plantillasValidas(JSON.parse(leer(claveDePlantillasEnElNavegador(pantalla)) ?? "null")); } catch { return []; }
}

/** Lo que cada pantalla pone para guardar: dónde, y cómo sería la fila entera con la lista nueva. */
export interface DestinoDePlantillas {
  /** El demo: no hay base, las plantillas van al navegador. */
  sinBase: boolean;
  guardaEnElNavegador: (lista: PlantillaDeColumnas[]) => void;
  /** Si la fila de la base se pudo leer. Sin leerla no se escribe: la fila se escribe entera y se borraría lo que hubiera. */
  baseLeida: boolean;
  /** La fila entera tal como quedaría: las otras mitades TAL COMO SE LEYERON, y esta lista. */
  filaCon: (lista: PlantillaDeColumnas[]) => Record<string, unknown>;
  /** Escribe la fila y dice si la base la aceptó (`guardaColumnas` mide la fila escrita). */
  escribe: (lista: PlantillaDeColumnas[]) => Promise<boolean>;
}

/**
 * Guarda la lista de plantillas donde toque. Devuelve `null` si quedó guardada, o el texto del problema; la pantalla solo
 * cambia lo que pinta cuando es `null`, para no enseñar una plantilla que al recargar no estaría.
 * `crece`: la lista nueva ocupa más que la vieja (guardar). Solo entonces se mira si cabe: borrar nunca se impide.
 */
export async function persistePlantillas(lista: PlantillaDeColumnas[], crece: boolean, d: DestinoDePlantillas, t: (en: string, es: string) => string): Promise<string | null> {
  if (d.sinBase) {
    try { d.guardaEnElNavegador(lista); return null; } catch { return t("This browser would not save it.", "Este navegador no la guardó."); }
  }
  if (!d.baseLeida) return t("Your saved columns could not be read yet. Reload and try again.", "Aún no se pudieron leer sus columnas guardadas. Recargue e inténtelo otra vez.");
  if (crece && !cabeEnLaFila(d.filaCon(lista))) return textoDelRechazo("no-cabe", t);
  return (await d.escribe(lista)) ? null : t("Could not save. Try again.", "No se pudo guardar. Inténtelo otra vez.");
}

export { CLAVE_DE_PLANTILLAS };
