import type { SupabaseClient } from "@supabase/supabase-js";
import { soloActivos } from "@/lib/baja";
import { creaUnaPorUna, type ResultadoDelAlta } from "./alta";
import { archivoDeLaBase, CUBO_DE_ARCHIVOS, MAX_BYTES_DE_ARCHIVO, rutaDeArchivo, type ArchivoDeCliente, type ClaseDeArchivo } from "./archivos";
import { sugerenciaDeLaBase, type Sugerencia } from "./empresas";
import { clienteDeLaBase, type Cliente, type Parche } from "./reglas";
import { clienteDeBusqueda } from "./vendedor-por-tienda";
import { cuerpoDeSolicitud, solicitudDeLaBase, type SolicitudDeCliente } from "./solicitud-de-cliente";
import { conVendedores, nombresDeVendedores, type Vendedor } from "./vendedores";

/**
 * Dónde viven los clientes: `erp.customers` (migración 180). Una interfaz con dos implementaciones —la base y el
 * demo— para que la pantalla sea la misma en las dos.
 *
 * **Se lee y se escribe con la sesión de quien mira**, con el cliente del ERP (esquema `erp`): la política decide
 * (`has_customers_access()` para leer, `erp.customers_can_write()` para escribir). Un UPDATE que la política no deja
 * pasar NO es un error para PostgREST: vuelve con cero filas. Por eso cada escritura pide la fila de vuelta
 * (`.select()`), y «cero filas» se cuenta como «no se guardó» y se dice.
 *
 * Sin la 180 aplicada (el código llega antes que la migración) se devuelve `sinTabla` y la pantalla lo dice.
 */
export type Res<T> = { ok: true; valor: T } | { ok: false; sinTabla: boolean; sinPermiso: boolean; duplicado: boolean; error: string };

export interface AlmacenDeClientes {
  leer(): Promise<Res<Cliente[]>>;
  guardar(id: number, parche: Parche): Promise<Res<Cliente>>;
  crear(fila: Parche): Promise<Res<Cliente>>;
  /**
   * El alta en varias tiendas (D-664): una fila por tienda (`filasDelAlta`). La que choca (la cuenta ya existe en esa
   * tienda) no se crea y se dice cuál; las demás, sí. Si no se crea ninguna, el fallo de siempre.
   */
  crearVarias(filas: Parche[]): Promise<Res<ResultadoDelAlta>>;
  /** Migración 189: la cola «Decidir si se juntan», solo las pendientes. Sin la 189, `sinTabla`. */
  sugerencias(): Promise<Res<Sugerencia[]>>;
  /** Juntar las empresas de dos filas (`erp.junta_clientes`): UNA llamada; la base hace todo o nada. Luego se relee. */
  juntar(aId: number, bId: number): Promise<Res<string>>;
  /** «No son la misma» (`erp.rechaza_sugerencia_de_clientes`): no se vuelve a proponer. */
  rechazar(sugerenciaId: number): Promise<Res<null>>;
  /** D-672 (195): los archivos de una fila (una tienda). Sin la 195, `sinTabla`. */
  archivos(clienteId: number): Promise<Res<ArchivoDeCliente[]>>;
  /** Sube el fichero al cubo y apunta su fila; si apuntarla falla, el fichero se quita (no queda huérfano). */
  subirArchivo(clienteId: number, fichero: File, clase: ClaseDeArchivo): Promise<Res<ArchivoDeCliente>>;
  /** Quita la fila y el fichero. */
  quitarArchivo(a: ArchivoDeCliente): Promise<Res<null>>;
  /** Un enlace para abrirlo (firmado, una hora). */
  enlaceDeArchivo(a: ArchivoDeCliente): Promise<Res<string>>;
  /** D-683 (198): los vendedores del hub (perfiles con rol `sales`), para el desplegable y para poner nombre a `rep_id`. */
  vendedores(): Promise<Res<Vendedor[]>>;
  /** D-684: pone el vendedor (null = libre) a muchas filas de golpe; devuelve cuántas cambió la base. */
  asignarVendedor(ids: readonly number[], repId: string | null): Promise<Res<number>>;
  /** D-685: el mismo parche a muchas filas de golpe (la barra de lo elegido); devuelve cuántas cambió la base. */
  guardarVarios(ids: readonly number[], parche: Parche): Promise<Res<number>>;
  /**
   * D-740 (215): la búsqueda a nivel de toda la empresa, saltando la política de la fila, con pocas columnas (sin
   * teléfonos, correos ni direcciones). Para el vendedor, que en su lista solo tiene su tienda y los suyos.
   */
  buscarEnTodaLaEmpresa(q: string): Promise<Res<Cliente[]>>;
  /** D-743 (216): el alta de vendedor y gerente es una solicitud; el admin la aprueba (crea las filas) o la rechaza. */
  solicitarAlta(parche: Parche, tiendas: readonly string[]): Promise<Res<SolicitudDeCliente>>;
  /** Las solicitudes que la política deja ver: las suyas, o todas si es admin. Con el nombre de quien pidió. */
  solicitudes(): Promise<Res<SolicitudDeCliente[]>>;
  aprobarSolicitud(id: number): Promise<Res<number[]>>;
  rechazarSolicitud(id: number, nota: string): Promise<Res<null>>;
}

/** ¿Es «la 180 no está aplicada»? PGRST205 (tabla) de PostgREST; 42P01 de Postgres. Solo esos. */
export function faltaLaTabla(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "PGRST205" || code === "42P01";
}

/** ¿La base dijo que no por permisos? 42501 es insufficient_privilege (también lo que lanza una política RLS al escribir). */
export function esSinPermiso(error: { code?: string | null; message?: string } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42501" || /row-level security|permission denied/i.test(error?.message ?? "");
}

/** Las columnas que la pantalla usa. */
export const COLUMNAS =
  "id, store, account, unified_account, house_no, added_batch, qb_status, activity_status, status_store, status_group, " +
  "history_store, history_group, crm_type_store, crm_type_group, associated_with, rep_history, rep_qb, rep_store, contact_name, contact_title, address, phone, email, " +
  "credit_limit, euler_limit, terms, account_no, notes, updated_at, updated_by, archived_at, archived_reason, company_id, contacts, tax_terms, website, socials, rep_id, created_by";

/** Las tres de la 182 (CRM). El código llega antes que la migración: si la base aún no las tiene, se lee sin ellas. */
export const COLUMNAS_DE_LA_182 = ["crm_type_store", "crm_type_group", "associated_with"] as const;
/** La de la 189 (la empresa). Igual: si la base aún no la tiene, se lee sin ella y cada fila es su propia empresa. */
export const COLUMNAS_DE_LA_189 = ["company_id"] as const;
/** La de la 193 (los contactos, D-668). Sin ella, los contactos salen de las cuatro columnas de antes (`contactosDe`). */
export const COLUMNAS_DE_LA_193 = ["contacts"] as const;
/** Las de la 195 (D-672): los impuestos de la tienda y el sitio web. Sin ella llegan como null. */
export const COLUMNAS_DE_LA_195 = ["tax_terms", "website"] as const;
/** La de la 197 (D-682): las redes sociales. Sin ella llega como null. */
export const COLUMNAS_DE_LA_197 = ["socials"] as const;
/** La de la 198 (D-683): el vendedor. Sin ella llega como null. */
export const COLUMNAS_DE_LA_198 = ["rep_id"] as const;
const sin = (fuera: readonly string[]) => COLUMNAS.split(",").map((c) => c.trim()).filter((c) => !fuera.includes(c)).join(", ");
export const COLUMNAS_SIN_198 = sin(COLUMNAS_DE_LA_198);
export const COLUMNAS_SIN_197 = sin([...COLUMNAS_DE_LA_197, ...COLUMNAS_DE_LA_198]);
export const COLUMNAS_SIN_195 = sin([...COLUMNAS_DE_LA_195, ...COLUMNAS_DE_LA_197, ...COLUMNAS_DE_LA_198]);
export const COLUMNAS_SIN_193 = sin([...COLUMNAS_DE_LA_193, ...COLUMNAS_DE_LA_195, ...COLUMNAS_DE_LA_197, ...COLUMNAS_DE_LA_198]);
export const COLUMNAS_SIN_189 = sin([...COLUMNAS_DE_LA_189, ...COLUMNAS_DE_LA_193, ...COLUMNAS_DE_LA_195, ...COLUMNAS_DE_LA_197, ...COLUMNAS_DE_LA_198]);
export const COLUMNAS_SIN_182 = sin([...COLUMNAS_DE_LA_182, ...COLUMNAS_DE_LA_189, ...COLUMNAS_DE_LA_193, ...COLUMNAS_DE_LA_195, ...COLUMNAS_DE_LA_197, ...COLUMNAS_DE_LA_198]);

/** ¿«La 182 no está aplicada»? 42703 es undefined_column (Postgres); PGRST204 es lo mismo dicho por PostgREST. Solo esos. */
export function faltaLa182(error: { code?: string | null } | null | undefined): boolean {
  const code = error?.code ?? "";
  return code === "42703" || code === "PGRST204";
}

/**
 * Una lectura con respaldo: con las columnas de hoy, y si la base dice que una no existe, otra vez sin la de la 198
 * (`rep_id`), luego sin la de la 197
 * (`socials`), luego sin las de la 195, luego sin la de la 193
 * (`contacts`: salen de las cuatro de antes), luego también sin la de la 189 (`company_id`: cada fila, su empresa), y si
 * aún falta, también sin las tres de la 182 (llegan como null). Así la lista no se queda en blanco el rato entre el
 * deploy y la migración. Una escritura con `.select(cols)` falla ENTERA si una columna pedida no existe (no escribe
 * nada), así que también se puede repetir así; la que ESCRIBE `contacts` sin la 193 falla las cuatro veces y se dice.
 */
export async function leeConRespaldo<T>(consulta: (columnas: string) => PromiseLike<{ data: T; error: { code?: string | null; message: string } | null }>) {
  let r = await consulta(COLUMNAS);
  for (const cols of [COLUMNAS_SIN_198, COLUMNAS_SIN_197, COLUMNAS_SIN_195, COLUMNAS_SIN_193, COLUMNAS_SIN_189, COLUMNAS_SIN_182]) {
    if (!(r.error && faltaLa182(r.error))) return r;
    r = await consulta(cols);
  }
  return r;
}

/** Las columnas de una solicitud de cliente (216). */
export const COLUMNAS_DE_SOLICITUD = "id, requested_by, stores, payload, status, created_at, decided_at, decision_note, created_ids";

/** PostgREST corta en 1.000 filas por petición: se pagina hasta que una página venga corta. */
export const PAGINA = 1000;
export const MAX_PAGINAS = 20;

/** La clave natural (tienda + cuenta) ya existe: 23505 es unique_violation. */
export function esDuplicado(error: { code?: string | null } | null | undefined): boolean {
  return (error?.code ?? "") === "23505";
}

const fallo = (error: { code?: string | null; message: string }): Res<never> =>
  ({ ok: false, sinTabla: faltaLaTabla(error), sinPermiso: esSinPermiso(error), duplicado: esDuplicado(error), error: error.message });

/** Cero filas de vuelta: la política no dejó pasar la escritura (o la fila ya no existe). PostgREST no lo cuenta como error. */
const sinFila = (): Res<never> => ({ ok: false, sinTabla: false, sinPermiso: true, duplicado: false, error: "not saved: no row came back" });

// El cliente del ERP (esquema `erp`): su tipo lleva el esquema, y el de Entregas no vale.
export function almacenDeLaBase(sb: SupabaseClient<any, "erp", "erp">): AlmacenDeClientes {
  // D-683: los nombres de los vendedores, una vez; cada fila que vuelve de la base sale con el suyo (`rep_name`).
  let nombres: ReadonlyMap<string, string> | null = null;
  const conNombres = async <T extends Pick<Cliente, "rep_id">>(filas: T[]) => {
    if (!nombres) { const r = await almacen.vendedores(); nombres = nombresDeVendedores(r.ok ? r.valor : []); }
    return conVendedores(filas, nombres);
  };
  const almacen: AlmacenDeClientes = {
    async leer() {
      const todos: Cliente[] = [];
      for (let p = 0; p < MAX_PAGINAS; p++) {
        const { data, error } = await leeConRespaldo((cols) => sb.from("customers").select(cols).order("account").order("id").range(p * PAGINA, (p + 1) * PAGINA - 1));
        if (error) return fallo(error);
        for (const f of data ?? []) todos.push(clienteDeLaBase(f as unknown as Record<string, unknown>));
        if ((data ?? []).length < PAGINA) break;
      }
      return { ok: true, valor: await conNombres(todos) };
    },
    async buscarEnTodaLaEmpresa(q) {
      const { data, error } = await sb.rpc("busca_clientes_en_toda_la_empresa", { p_q: q });
      if (error) return fallo(error);
      return { ok: true, valor: await conNombres(((data ?? []) as Record<string, unknown>[]).map(clienteDeBusqueda)) };
    },
    async solicitarAlta(parche, tiendas) {
      const { data, error } = await sb.from("customer_requests").insert(cuerpoDeSolicitud(parche, tiendas)).select(COLUMNAS_DE_SOLICITUD).maybeSingle();
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: solicitudDeLaBase(data as unknown as Record<string, unknown>) };
    },
    async solicitudes() {
      const { data, error } = await sb.from("customer_requests").select(COLUMNAS_DE_SOLICITUD).order("status").order("created_at", { ascending: false }).range(0, 499);
      if (error) return fallo(error);
      const filas = ((data ?? []) as unknown as Record<string, unknown>[]).map(solicitudDeLaBase);
      // El nombre de quien pidió: los perfiles son de `public`; si no se pueden leer, sale el id recortado.
      const ids = [...new Set(filas.map((f) => f.requested_by).filter(Boolean))];
      if (ids.length) {
        try {
          const { data: perfiles } = await sb.schema("public").from("profiles").select("id, full_name").in("id", ids);
          const nombre = new Map(((perfiles ?? []) as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name]));
          for (const f of filas) f.requested_name = nombre.get(f.requested_by) ?? null;
        } catch { /* sin nombres */ }
      }
      return { ok: true, valor: filas };
    },
    async aprobarSolicitud(id) {
      const { data, error } = await sb.rpc("aprueba_solicitud_de_cliente", { p_id: id });
      if (error) return fallo(error);
      return { ok: true, valor: Array.isArray(data) ? data.map(Number) : [] };
    },
    async rechazarSolicitud(id, nota) {
      const { error } = await sb.rpc("rechaza_solicitud_de_cliente", { p_id: id, p_nota: nota || null });
      if (error) return fallo(error);
      return { ok: true, valor: null };
    },
    async guardar(id, parche) {
      const { data, error } = await leeConRespaldo((cols) => sb.from("customers").update(parche).eq("id", id).select(cols).maybeSingle());
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: (await conNombres([clienteDeLaBase(data as unknown as Record<string, unknown>)]))[0] };
    },
    async crear(fila) {
      const { data, error } = await leeConRespaldo((cols) => sb.from("customers").insert(fila).select(cols).maybeSingle());
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: (await conNombres([clienteDeLaBase(data as unknown as Record<string, unknown>)]))[0] };
    },
    async asignarVendedor(ids, repId) { return almacen.guardarVarios(ids, { rep_id: repId }); },
    async guardarVarios(ids, parche) {
      // Por tandas: una URL con miles de ids se corta. Cuenta lo que la base devuelve (una fila que la RLS no deja, no vuelve).
      let n = 0;
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await sb.from("customers").update(parche).in("id", ids.slice(i, i + 200) as number[]).select("id");
        if (error) return fallo(error);
        n += (data ?? []).length;
      }
      if (ids.length && n === 0) return sinFila();
      return { ok: true, valor: n };
    },
    async vendedores() {
      // Los perfiles son de `public`, no de `erp`. Si no se pueden leer, la lista sale igual, sin nombres (el id).
      try {
        const { data, error } = await sb.schema("public").from("profiles").select("id, full_name, left_at").eq("role", "sales").order("full_name");
        if (error) return fallo(error);
        const todos = (data ?? []) as { id: string; full_name: string | null; left_at: string | null }[];
        nombres = nombresDeVendedores(todos.map((p) => ({ id: p.id, full_name: p.full_name ?? "" })));
        // D-707: los nombres de todos (un cliente viejo sigue diciendo quién lo llevaba); para elegir, solo activos.
        const valor = soloActivos(todos).map((p) => ({ id: p.id, full_name: p.full_name ?? "" }));
        return { ok: true, valor };
      } catch (e) {
        return fallo({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    // D-664: primero UNA llamada con todas las filas. Si una choca (23505) la sentencia entera no escribe nada (es una
    // sola sentencia: todo o nada), y entonces se repite una por una para saber cuál choca y crear las demás.
    async crearVarias(filas) {
      if (filas.length === 0) return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "no store chosen" };
      const { data, error } = await leeConRespaldo((cols) => sb.from("customers").insert(filas).select(cols));
      if (error) {
        if (esDuplicado(error) && filas.length > 1) return creaUnaPorUna(filas, (f) => almacen.crear(f));
        return fallo(error);
      }
      const creados = await conNombres(((data ?? []) as unknown as Record<string, unknown>[]).map(clienteDeLaBase));
      if (creados.length === 0) return sinFila();
      return { ok: true, valor: { creados, noCreadas: [] } };
    },
    async sugerencias() {
      const { data, error } = await sb.from("customer_merge_suggestions")
        .select("id, a_id, b_id, reason, score, status, created_at").eq("status", "pending").order("id").range(0, 4999);
      if (error) return fallo(error);
      return { ok: true, valor: (data ?? []).map((f) => sugerenciaDeLaBase(f as Record<string, unknown>)) };
    },
    async juntar(aId, bId) {
      const { data, error } = await sb.rpc("junta_clientes", { p_a: aId, p_b: bId });
      if (error) return fallo(error);
      if (!data) return sinFila();
      return { ok: true, valor: String(data) };
    },
    async rechazar(sugerenciaId) {
      const { error } = await sb.rpc("rechaza_sugerencia_de_clientes", { p_id: sugerenciaId });
      if (error) return fallo(error);
      return { ok: true, valor: null };
    },
    async archivos(clienteId) {
      const { data, error } = await sb.from("customer_files").select("id, customer_id, kind, name, path, size_bytes, content_type, uploaded_at")
        .eq("customer_id", clienteId).order("uploaded_at", { ascending: false }).range(0, 199);
      if (error) return fallo(error);
      return { ok: true, valor: (data ?? []).map((f) => archivoDeLaBase(f as Record<string, unknown>)) };
    },
    async subirArchivo(clienteId, fichero, clase) {
      if (fichero.size > MAX_BYTES_DE_ARCHIVO) return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: "file over 25 MB" };
      const path = rutaDeArchivo(clienteId, fichero.name, new Date(), crypto.randomUUID());
      const cubo = sb.storage.from(CUBO_DE_ARCHIVOS);
      const subido = await cubo.upload(path, fichero, { contentType: fichero.type || undefined, upsert: false });
      if (subido.error) return { ok: false, sinTabla: false, sinPermiso: /row-level security|unauthori[sz]ed|permission/i.test(subido.error.message), duplicado: false, error: subido.error.message };
      const { data, error } = await sb.from("customer_files")
        .insert({ customer_id: clienteId, kind: clase, name: fichero.name, path, size_bytes: fichero.size, content_type: fichero.type || null })
        .select("id, customer_id, kind, name, path, size_bytes, content_type, uploaded_at").maybeSingle();
      if (error || !data) {
        await cubo.remove([path]);
        return error ? fallo(error) : sinFila();
      }
      return { ok: true, valor: archivoDeLaBase(data as Record<string, unknown>) };
    },
    async quitarArchivo(a) {
      const { data, error } = await sb.from("customer_files").delete().eq("id", a.id).select("id");
      if (error) return fallo(error);
      if (!data?.length) return sinFila();
      await sb.storage.from(CUBO_DE_ARCHIVOS).remove([a.path]);
      return { ok: true, valor: null };
    },
    async enlaceDeArchivo(a) {
      const { data, error } = await sb.storage.from(CUBO_DE_ARCHIVOS).createSignedUrl(a.path, 3600);
      if (error || !data?.signedUrl) return { ok: false, sinTabla: false, sinPermiso: false, duplicado: false, error: error?.message ?? "no link" };
      return { ok: true, valor: data.signedUrl };
    },
  };
  return almacen;
}

/** Cuántas sugerencias pendientes hay (la pastilla de la barra). null = no se sabe (sin la 189, sin permiso, error). */
export async function cuentaPendientes(sb: SupabaseClient<any, "erp", "erp">): Promise<number | null> {
  const { count, error } = await sb.from("customer_merge_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending");
  return error ? null : count ?? 0;
}
