/**
 * Nombre corto y distinto para cada hoja de aprobación (grupo de merma), para poder distinguirlas en la lista, en la
 * columna GRUPO y en el título de la hoja:  «Hoja 12 · Nov 18 · McAllen» (en inglés: «Sheet 12 · Nov 18 · McAllen»).
 *
 * El número sale del ORDEN DE CREACIÓN dentro de cada tienda (created_at, luego id): no se guarda en la base, así que
 * es estable mientras no se borre un grupo viejo (si se borra, los siguientes no se recorren: solo cuentan los que
 * existen). Los borradores y los grupos de práctica no tienen número: se quedan con su nombre.
 *
 * Regla PURA (sin React ni red). Las fechas van por el día en Texas, como en el resto de la merma.
 */
import type { Lang } from "./etapas";
import { diaEnTexas } from "./fecha-del-dano";

export interface GrupoParaEtiqueta {
  id: string;
  store: string;
  created_at: string;
}

/** Nombres de mes en inglés (abreviados). Son identificadores de la hoja, no texto de interfaz: no cambian con el idioma. */
const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * El número de cada grupo: 1 es el primero creado en su tienda. `grupos` debe traer TODOS los grupos de cada tienda (si
 * solo viene una parte, los números salen mal); quien llama pide la lista completa de la tienda.
 */
export function numerosDeHoja(grupos: readonly GrupoParaEtiqueta[]): Map<string, number> {
  const porTienda = new Map<string, GrupoParaEtiqueta[]>();
  for (const g of grupos) {
    const lista = porTienda.get(g.store) ?? [];
    lista.push(g);
    porTienda.set(g.store, lista);
  }
  const out = new Map<string, number>();
  for (const lista of porTienda.values()) {
    const ordenados = [...lista].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    ordenados.forEach((g, i) => out.set(g.id, i + 1));
  }
  return out;
}

/** «Mon DD» del día (en Texas) en que se creó el grupo. */
export function diaCortoDeHoja(createdAt: string): string {
  const [, mes, dia] = diaEnTexas(createdAt).split("-").map(Number);
  return `${MESES[mes - 1]} ${String(dia).padStart(2, "0")}`;
}

/**
 * La etiqueta de una hoja. Sin número (borrador, práctica o un grupo que no está en la lista) devuelve `sinNumero`
 * (normalmente el nombre del grupo).
 */
export function etiquetaDeHoja(g: GrupoParaEtiqueta, numero: number | null | undefined, lang: Lang, sinNumero: string): string {
  if (numero == null) return sinNumero;
  const palabra = lang === "es" ? "Hoja" : "Sheet";
  return `${palabra} ${numero} · ${diaCortoDeHoja(g.created_at)} · ${g.store}`;
}

/**
 * El mapa id → etiqueta de una lista de grupos. `numerable` dice cuáles cuentan para el número (los borradores y los de
 * práctica no); los que no cuentan quedan con su nombre.
 */
export function etiquetasDeGrupos<G extends GrupoParaEtiqueta & { name: string }>(grupos: readonly G[], lang: Lang, numerable: (id: string) => boolean): Map<string, string> {
  const numeros = numerosDeHoja(grupos.filter((g) => numerable(g.id)));
  return new Map(grupos.map((g) => [g.id, etiquetaDeHoja(g, numeros.get(g.id), lang, g.name)]));
}
