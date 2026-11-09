import { tiendasQueVe } from "./auto-aprueban-las-mias";

/**
 * ALCANCE DE DATOS POR ROL — la «segunda capa» de permisos, pareja en toda la app (petición 8 de Roberto, junta 8 nov).
 *
 * El permiso de MÓDULO (lo de `constants.ts`/`module_access`) decide sí/no: si entras a Clientes, a Leads, a Órdenes.
 * Esto decide el «cuánto ves DENTRO»:
 *
 *   1.ª capa — ALCANCE POR TIENDA (ya existía): `tiendasQueVe(yo)` / `visible_stores`. `null` = todas las tiendas
 *      (admin, chofer, almacén, o quien tenga el permiso de todas); si no, solo las suyas.
 *   2.ª capa — PROPIOS (lo nuevo): un vendedor (`sales`) ve solo lo SUYO —el registro cuyo dueño es él— dentro de su
 *      alcance de tienda. La oficina y el gerente ven TODA la tienda. El admin (y quien ve todas las tiendas) lo ve todo.
 *
 * Helper PURO y central: cada módulo le pasa dos hechos ya calculados con SU propia normalización (los códigos de tienda
 * de Clientes no son los nombres de Entregas), y aquí vive la regla, una sola vez, con pruebas. No sustituye a la RLS de
 * la base —que es quien manda de verdad en producción—: es su gemelo para el filtrado en memoria (modo demo, listas que
 * se pintan con una sesión que no es la de quien mira) y la referencia única para escribir esa RLS.
 */

/** Lo mínimo de una persona para decidir su alcance. Mismo campo que `tiendasQueVe`, más `id` para la capa de propios. */
export interface QuienMiraAlcance {
  id: string;
  role?: string | null;
  store?: string | null;
  visible_stores?: readonly string[] | null;
}

/**
 * Los roles acotados a «solo lo suyo» en la 2.ª capa. Hoy solo `sales` (el dueño: «un vendedor ve solo lo SUYO,
 * oficina/gerente ve toda la tienda»). Es una lista y no un `=== "sales"` suelto para que, el día que otro rol necesite
 * el mismo acote, se añada aquí y lo respeten todos los módulos a la vez.
 */
export const ROLES_SOLO_LO_SUYO: readonly string[] = ["sales"];

/** ¿A esta persona la 2.ª capa la acota a lo suyo? */
export function soloVeLoSuyo(yo: Pick<QuienMiraAlcance, "role"> | null | undefined): boolean {
  return !!yo && ROLES_SOLO_LO_SUYO.includes((yo.role ?? "").trim());
}

/** ¿Ve TODAS las tiendas? (admin, chofer, almacén, o quien tenga el permiso de todas). Espejo de `tiendasQueVe === null`. */
export function veTodasLasTiendas(yo: QuienMiraAlcance | null | undefined): boolean {
  return tiendasQueVe(yo ?? null) === null;
}

/**
 * Los dos hechos de un registro, ya calculados por el módulo con su propia normalización:
 *   - `deMiTienda`: la tienda del registro está entre las que la persona ve (1.ª capa).
 *   - `mio`: el dueño/representante/creador del registro es la persona (2.ª capa).
 */
export interface HechosDelRegistro {
  deMiTienda: boolean;
  mio: boolean;
}

/**
 * La regla, sobre los dos hechos. `tieneDueno` dice si el módulo tiene un campo de dueño con el que acotar:
 *   - `true`  → un `sales` ve solo lo suyo; los demás, toda su tienda (o lo suyo aunque sea de otra tienda, p. ej. un
 *               lead que le asignaron).
 *   - `false` → el módulo no tiene dueño claro: NO se fuerza la 2.ª capa, se cae al alcance por tienda para todos
 *               (así un `sales` no se queda sin ver nada en un módulo donde no se puede distinguir «lo suyo»).
 */
export function registroVisible(
  yo: QuienMiraAlcance | null | undefined,
  hechos: HechosDelRegistro,
  opts: { tieneDueno: boolean },
): boolean {
  if (veTodasLasTiendas(yo)) return true;
  if (soloVeLoSuyo(yo) && opts.tieneDueno) return hechos.mio;
  return hechos.deMiTienda || hechos.mio;
}

/**
 * Accesos de un módulo para el camino genérico: cómo sacar la tienda del registro (ya normalizada al MISMO espacio que
 * `tiendasQueVe`, es decir minúsculas y sin espacios) y, si lo hay, el id del dueño. Sin `dueno`, el módulo no tiene
 * campo de dueño y la 2.ª capa no se fuerza.
 */
export interface CamposDeAlcance<T> {
  tienda: (r: T) => string | null | undefined;
  dueno?: (r: T) => string | null | undefined;
}

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();

/** Calcula los dos hechos de un registro con los accesos del módulo y la lista de tiendas de la persona. */
export function hechosDe<T>(r: T, yo: QuienMiraAlcance | null | undefined, campos: CamposDeAlcance<T>): HechosDelRegistro {
  const tiendas = tiendasQueVe(yo ?? null);
  const t = norm(campos.tienda(r));
  const deMiTienda = tiendas === null ? true : !!t && tiendas.includes(t);
  const d = campos.dueno ? campos.dueno(r) : undefined;
  const mio = !!yo && d != null && String(d) === yo.id;
  return { deMiTienda, mio };
}

/** ¿Alcanza la persona este registro, con la regla de las dos capas? Camino genérico (tienda ya en el espacio de nombres). */
export function alcanzaRegistro<T>(r: T, yo: QuienMiraAlcance | null | undefined, campos: CamposDeAlcance<T>): boolean {
  return registroVisible(yo, hechosDe(r, yo, campos), { tieneDueno: !!campos.dueno });
}

/** Filtra una lista con la regla de las dos capas. */
export function filtrarPorAlcance<T>(filas: readonly T[], yo: QuienMiraAlcance | null | undefined, campos: CamposDeAlcance<T>): T[] {
  return filas.filter((r) => alcanzaRegistro(r, yo, campos));
}

// ---------------------------------------------------------------------------------------------------------------
// Adaptadores por módulo — mapean el registro de cada módulo a los dos hechos, reutilizando SU normalización.
// No sustituyen a la RLS: son el gemelo en memoria. Ver el informe al final de este fichero.
// ---------------------------------------------------------------------------------------------------------------

/**
 * ENTREGAS (órdenes). La tienda de la orden es un NOMBRE («Pharr»), igual que `visible_stores`, así que el camino
 * genérico vale directo. Dueño: `created_by` o `assigned_sales_rep` (el vendedor que la creó o al que se le acreditó).
 */
export const CAMPOS_ENTREGAS: CamposDeAlcance<{ store?: string | null; created_by?: string | null; assigned_sales_rep?: string | null }> = {
  tienda: (o) => o.store,
  dueno: (o) => o.assigned_sales_rep ?? o.created_by,
};

/**
 * CLIENTES. La tienda del registro es un CÓDIGO («PHR») y la de la persona un nombre: se comparan por código. El dueño
 * es `rep_id` (representante asignado) o `created_by`. `codigoTienda` convierte el nombre del perfil a código (lo trae
 * `customers/visibilidad.ts`); aquí se recibe ya hecho para no acoplar los ficheros al importar.
 */
export function hechosClientes(
  c: { store?: string | null; rep_id?: string | null; created_by?: string | null },
  yo: QuienMiraAlcance | null | undefined,
  codigoDeMiTienda: string,
): HechosDelRegistro {
  const tiendas = tiendasQueVe(yo ?? null);
  const codigoFila = norm(c.store).toUpperCase();
  const deMiTienda = tiendas === null ? true : !!codigoDeMiTienda && codigoFila === codigoDeMiTienda.toUpperCase();
  const d = c.rep_id ?? c.created_by;
  const mio = !!yo && d != null && String(d) === yo.id;
  return { deMiTienda, mio };
}

/**
 * LEADS. Ya tiene dueño (`holder`) y alcance por banco de tienda (`src/lib/leads/alcance.ts`): este módulo YA es de dos
 * capas. OJO: un `sales` necesita ver los leads LIBRES de su banco para poder tomarlos, así que «solo lo suyo» a secas
 * rompería el producto. Por eso aquí `tieneDueno` se deja en manos del llamador: para la lista del banco va `false`
 * (todos ven su banco), y «lo suyo» se cuenta por `holder` cuando se quiera la vista «Mi pool». Se reporta abajo.
 */
export function hechosLeads(
  l: { pool?: string | null; holder?: string | null },
  yo: QuienMiraAlcance | null | undefined,
  poolDeMiTienda: string | null,
): HechosDelRegistro {
  const tiendas = tiendasQueVe(yo ?? null);
  const deMiTienda = tiendas === null ? true : !!poolDeMiTienda && norm(l.pool) === norm(poolDeMiTienda);
  const mio = !!yo && l.holder != null && String(l.holder) === yo.id;
  return { deMiTienda, mio };
}

/**
 * INFORME DE COBERTURA (para el que lo wire en producción vía RLS):
 *
 *  - CLIENTES    → campo de dueño: `rep_id` / `created_by`. SE PUEDE. RLS actual: `erp.customers_ve_la_fila` (migr. 217).
 *                  Para «sales solo lo suyo» hay que acotar esa función (o su política) con la 2.ª capa.
 *  - ENTREGAS    → campo de dueño: `created_by` / `assigned_sales_rep`. SE PUEDE. RLS actual: política de `deliveries`
 *                  por `visible_stores` (migr. 131). Añadir la 2.ª capa para `sales`.
 *  - LEADS       → campo de dueño: `holder`. YA es de dos capas (`leads_my_scope()` + `holder`, migr. 162/163). No se
 *                  fuerza más: un `sales` debe ver los libres de su banco para tomarlos.
 *  - PROMOS      → NO tiene campo de dueño por persona: una ronda es por TIENDA y por grupo (`promo_group`), y la aprueba
 *                  un rol (manager/office), no un vendedor. FALTA una columna de dueño si se quisiera «solo lo suyo».
 *                  Hoy el alcance correcto de Promos es solo por tienda/grupo; la 2.ª capa de «propios» no aplica.
 *
 * Las migraciones 278 y 279 están reservadas para la RLS de Clientes y Entregas, cuando el dueño lo apruebe.
 */
