"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/erp/supabase/client";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { cn } from "@/lib/erp/utils";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import { almacenDeLaBase, type AlmacenDeClientes } from "@/lib/customers/almacen";
import { almacenDemo } from "@/lib/customers/demo";
import {
  alOrdenarPor, alternaColumna, CAMPOS, celda, COLUMNAS, COLUMNAS_INICIALES, columnasValidas, cuentaArchivados, cuentaPor, ESTADOS, estadoClase,
  estadoLabel, estaArchivado, fecha, filtrar, FILTRO_INICIAL, formDe, HISTORIAS, historiaLabel, mailUrl, MOTIVOS_DE_ARCHIVO, motivoLabel,
  nombreDeTienda, ordenar, ORDEN_INICIAL, PARCHE_DESARCHIVAR, parcheArchivar, parcheDe, QB_ESTADOS, qbLabel, telUrl, TIENDAS,
  type Cliente, type Filtro, type Orden,
} from "@/lib/customers/reglas";

type Estado = { tipo: "cargando" } | { tipo: "sinTabla" } | { tipo: "error"; texto: string } | { tipo: "listo" };
type Ficha = { tipo: "ver"; cliente: Cliente } | { tipo: "nuevo" };

const CLAVE_COLUMNAS = "customers_cols";
/** Cuántas filas se pintan de entrada y cuántas más con cada «ver más»: 1.349 filas de golpe pesan en un teléfono. */
const TANDA = 100;

const selCls =
  "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

/**
 * «Clientes» (migración 180): la lista maestra, con búsqueda, filtros por tienda y estado, columnas elegibles y una
 * ficha lateral con todos los campos, que edita quien puede. Las reglas viven en `lib/customers/reglas` y están
 * probadas sin navegador; la base las vuelve a exigir (RLS de la 180). Este componente lee, filtra y pinta, y cada
 * escritura va por el almacén, que devuelve la fila como quedó en la base: eso es lo que se pinta.
 */
export function Clientes({ demo, puedeEditar }: { demo: boolean; puedeEditar: boolean }) {
  const { t } = usePrefs();
  const almacen: AlmacenDeClientes = useMemo(() => (demo ? almacenDemo() : almacenDeLaBase(createClient())), [demo]);

  const [lista, setLista] = useState<Cliente[]>([]);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_INICIAL);
  const [orden, setOrden] = useState<Orden>(ORDEN_INICIAL);
  const [columnas, setColumnas] = useState<string[]>([...COLUMNAS_INICIALES]);
  const [cuantos, setCuantos] = useState(TANDA);
  const [ficha, setFicha] = useState<Ficha | null>(null);

  const cargar = useCallback(async () => {
    const r = await almacen.leer();
    if (!r.ok) { setEstado(r.sinTabla ? { tipo: "sinTabla" } : { tipo: "error", texto: r.error }); return; }
    setLista(r.valor);
    setEstado({ tipo: "listo" });
  }, [almacen]);
  useEffect(() => { void cargar(); }, [cargar]);

  // Las columnas elegidas se recuerdan en este navegador. Si no hay nada (o está roto), las de entrada.
  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(CLAVE_COLUMNAS);
      if (guardado) setColumnas(columnasValidas(JSON.parse(guardado)));
    } catch { /* privado, bloqueado o basura: se queda lo de entrada */ }
  }, []);
  const alternar = (key: string) => {
    setColumnas((c) => {
      const next = alternaColumna(c, key);
      try { window.localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify(next)); } catch { /* no se recuerda */ }
      return next;
    });
  };

  const visibles = useMemo(() => ordenar(filtrar(lista, filtro), orden), [lista, filtro, orden]);
  useEffect(() => { setCuantos(TANDA); }, [filtro, orden]);
  // Los archivados (181) se esconden por defecto: las cuentas de las tiendas y el «N clientes» son de lo que se está viendo
  // (vivos, o archivados con el chip), no de la tabla entera.
  const vista = useMemo(() => lista.filter((c) => estaArchivado(c) === filtro.archivados), [lista, filtro.archivados]);
  const archivados = useMemo(() => cuentaArchivados(lista), [lista]);
  const porTienda = useMemo(() => cuentaPor(vista, "store"), [vista]);
  const porEstado = useMemo(() => cuentaPor(filtrar(lista, { ...filtro, estado: "" }), "status_store"), [lista, filtro]);
  const colsVisibles = COLUMNAS.filter((c) => columnas.includes(c.key));

  /** Lo que devolvió la base se pone en su sitio. */
  const alGuardar = (c: Cliente) => {
    setLista((l) => (l.some((x) => x.id === c.id) ? l.map((x) => (x.id === c.id ? c : x)) : [...l, c]));
    setFicha({ tipo: "ver", cliente: c });
  };

  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("Customers", "Clientes")}</h1>
          <p className="text-sm text-slate-500">
            {t("The master customer list, by store. Click a row to open its card.", "La lista maestra de clientes, por tienda. Toca una fila para abrir su ficha.")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorDeColumnas
            columnas={COLUMNAS}
            elegidas={columnas}
            onAlterna={alternar}
            rotulo={(c) => t(c.en, c.es)}
            titulo={t("Columns", "Columnas")}
            nota={t("Remembered in this browser.", "Se recuerdan en este navegador.")}
            t={t}
          />
          {puedeEditar && <Button onClick={() => setFicha({ tipo: "nuevo" })}>+ {t("New customer", "Nuevo cliente")}</Button>}
        </div>
      </div>

      {/* Las tiendas, con su cuenta: pulsar una filtra; otra vez, todas. */}
      <div className="mb-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setFiltro((f) => ({ ...f, tienda: "" }))} className={chip(filtro.tienda === "")}>
          {t("All stores", "Todas las tiendas")} <span className="text-slate-400">{vista.length}</span>
        </button>
        {[...TIENDAS.map((x) => x.code), ...[...porTienda.keys()].filter((k) => !TIENDAS.some((x) => x.code === k))].map((code) => (
          <button key={code} type="button" onClick={() => setFiltro((f) => ({ ...f, tienda: f.tienda === code ? "" : code }))} className={chip(filtro.tienda === code)}>
            {nombreDeTienda(code)} <span className="text-slate-400">{porTienda.get(code) ?? 0}</span>
          </button>
        ))}
        {/* Los archivados (181): escondidos por defecto; el chip enseña SOLO esos. */}
        <button
          type="button"
          onClick={() => setFiltro((f) => ({ ...f, archivados: !f.archivados }))}
          className={cn(chip(filtro.archivados), "ml-auto")}
          aria-pressed={filtro.archivados}
        >
          {t("Archived", "Archivados")} <span className="text-slate-400">{archivados}</span>
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          className="max-w-xs"
          placeholder={t("Search account, contact, phone, email, rep…", "Buscar cuenta, contacto, teléfono, correo, vendedor…")}
          value={filtro.busca}
          onChange={(e) => setFiltro((f) => ({ ...f, busca: e.target.value }))}
        />
        <select className={selCls} value={filtro.estado} onChange={(e) => setFiltro((f) => ({ ...f, estado: e.target.value }))} aria-label={t("Status", "Estado")}>
          <option value="">{t("All statuses", "Todos los estados")}</option>
          {ESTADOS.map((e) => <option key={e} value={e}>{estadoLabel(e, t)} ({porEstado.get(e) ?? 0})</option>)}
          <option value="none">{estadoLabel(null, t)} ({porEstado.get("") ?? 0})</option>
        </select>
        <select className={selCls} value={filtro.qb} onChange={(e) => setFiltro((f) => ({ ...f, qb: e.target.value }))} aria-label="QuickBooks">
          <option value="">{t("QB: all", "QB: todos")}</option>
          {QB_ESTADOS.map((q) => <option key={q} value={q}>{qbLabel(q, t)}</option>)}
        </select>
        {(filtro.busca || filtro.tienda || filtro.estado || filtro.qb || filtro.archivados) && (
          <Button variant="ghost" size="sm" onClick={() => setFiltro(FILTRO_INICIAL)}>{t("Clear filters", "Quitar filtros")}</Button>
        )}
        <span className="ml-auto text-sm text-slate-500">
          {visibles.length === vista.length ? `${vista.length}` : `${visibles.length} / ${vista.length}`}{" "}
          {filtro.archivados ? t("archived", "archivados") : t("customers", "clientes")}
        </span>
      </div>

      {estado.tipo === "cargando" && <p className="text-sm text-slate-500">{t("Loading…", "Cargando…")}</p>}
      {estado.tipo === "sinTabla" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t("The customers table does not exist yet (migration 180 is not applied).", "La tabla de clientes aún no existe (la migración 180 no está aplicada).")}
        </p>
      )}
      {estado.tipo === "error" && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t("Could not load the customers: ", "No se pudieron cargar los clientes: ")}{estado.texto}</p>}

      {estado.tipo === "listo" && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {colsVisibles.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2" aria-sort={orden.por === c.key ? (orden.desc ? "descending" : "ascending") : "none"}>
                    <button type="button" className="hover:text-clay-700" onClick={() => setOrden((o) => alOrdenarPor(o, c.key))}>
                      {t(c.en, c.es)}{orden.por === c.key ? (orden.desc ? " ↓" : " ↑") : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr><td colSpan={colsVisibles.length} className="px-3 py-6 text-center text-slate-500">{t("No customers match.", "Ningún cliente coincide.")}</td></tr>
              )}
              {visibles.slice(0, cuantos).map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setFicha({ tipo: "ver", cliente: c })}
                  className={cn("cursor-pointer border-t border-slate-100 hover:bg-clay-50", estaArchivado(c) && "opacity-60")}
                  data-archivado={estaArchivado(c) ? "1" : undefined}
                >
                  {colsVisibles.map((col) => (
                    <td key={col.key} className={cn("px-3 py-2", col.key === "account" && "font-medium text-slate-900", (col.key === "credit_limit" || col.key === "euler_limit") && "text-right tabular-nums")}>
                      {col.key === "account" && estaArchivado(c) ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          <span className="line-through">{c.account}</span>
                          <Badge className="border-slate-200 bg-slate-100 text-slate-500">{t("Archived", "Archivado")} · {motivoLabel(c.archived_reason, t)}</Badge>
                        </span>
                      ) : col.key === "status_store" || col.key === "status_group" ? (
                        <Badge className={estadoClase(c[col.key])}>{estadoLabel(c[col.key], t)}</Badge>
                      ) : col.key === "qb_status" && c.qb_status === "NOT FOUND IN UPDATE" ? (
                        <span className="text-amber-700">{qbLabel(c.qb_status, t)}</span>
                      ) : (
                        celda(c, col.key, t)
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {visibles.length > cuantos && (
            <div className="border-t border-slate-100 p-3 text-center">
              <Button variant="outline" size="sm" onClick={() => setCuantos((n) => n + TANDA)}>
                {t(`Show more (${visibles.length - cuantos} left)`, `Ver más (quedan ${visibles.length - cuantos})`)}
              </Button>
            </div>
          )}
        </div>
      )}

      {ficha && (
        <FichaDeCliente
          cliente={ficha.tipo === "ver" ? ficha.cliente : null}
          puedeEditar={puedeEditar}
          almacen={almacen}
          onClose={() => setFicha(null)}
          onGuardado={alGuardar}
          t={t}
        />
      )}
    </main>
  );
}

const chip = (activo: boolean) =>
  cn("rounded-full border px-3 py-1 text-sm", activo ? "border-clay-200 bg-clay-50 font-medium text-clay-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50");

/**
 * La ficha lateral: todos los campos; quien puede editar, edita y guarda con un botón (no al vuelo: una lista
 * maestra se corrige con intención). `cliente` null = alta.
 */
function FichaDeCliente({ cliente, puedeEditar, almacen, onClose, onGuardado, t }: {
  cliente: Cliente | null; puedeEditar: boolean; almacen: AlmacenDeClientes; onClose: () => void; onGuardado: (c: Cliente) => void;
  t: (en: string, es: string) => string;
}) {
  const original = useMemo(() => formDe(cliente), [cliente]);
  const [form, setForm] = useState<Record<string, string>>(original);
  useEffect(() => { setForm(original); }, [original]);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tono: "rojo" | "verde"; texto: string } | null>(null);
  const nuevo = cliente === null;
  const { parche, errores } = useMemo(() => parcheDe(form, original, nuevo), [form, original, nuevo]);
  const cambiado = Object.keys(parche).length > 0;

  // Archivar (181): se pide el motivo en la propia ficha (uno de los del script, o escrito), y se escribe por el mismo
  // almacén que todo lo demás: la fila vuelve de la base y es lo que se pinta.
  const archivado = cliente !== null && estaArchivado(cliente);
  const [archivando, setArchivando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [motivoLibre, setMotivoLibre] = useState("");
  useEffect(() => { setArchivando(false); setMotivo(""); setMotivoLibre(""); }, [cliente]);

  /** Escribe y pinta lo que devolvió la base; en rojo lo que no se guardó. */
  const aplicar = async (escritura: () => ReturnType<AlmacenDeClientes["guardar"]>, hecho: string) => {
    setOcupado(true);
    setAviso(null);
    const r = await escritura();
    setOcupado(false);
    if (!r.ok) {
      setAviso({
        tono: "rojo",
        texto: r.duplicado
          ? t("That account already exists in that store.", "Esa cuenta ya existe en esa tienda.")
          : r.sinPermiso
            ? t("Not saved: the database did not accept the change (no permission).", "No se guardó: la base no aceptó el cambio (sin permiso).")
            : t("Not saved: ", "No se guardó: ") + r.error,
      });
      return;
    }
    setAviso({ tono: "verde", texto: hecho });
    onGuardado(r.valor);
  };

  const guardar = async () => {
    if (errores.length) { setAviso({ tono: "rojo", texto: t("Check the highlighted fields.", "Revisa los campos marcados.") }); return; }
    await aplicar(() => (nuevo ? almacen.crear(parche) : almacen.guardar(cliente.id, parche)), t("Saved ✓", "Guardado ✓"));
  };
  const archivar = async () => {
    if (nuevo) return;
    await aplicar(() => almacen.guardar(cliente.id, parcheArchivar(motivo === "otro" ? motivoLibre : motivo)), t("Archived ✓", "Archivado ✓"));
    setArchivando(false);
  };
  const desarchivar = async () => {
    if (nuevo) return;
    await aplicar(() => almacen.guardar(cliente.id, PARCHE_DESARCHIVAR), t("Restored ✓", "Desarchivado ✓"));
  };

  const campo = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const inputCls = (k: string) => cn(errores.includes(k) && "border-red-400 ring-1 ring-red-300");
  const tel = telUrl(form.phone ?? null);
  const mail = mailUrl(form.email ?? null);

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{nuevo ? t("New customer", "Nuevo cliente") : cliente.account}</div>
            <div className="text-xs text-slate-400">
              {nuevo ? "" : `${nombreDeTienda(cliente.store)} · ${t("updated", "actualizado")} ${fecha(cliente.updated_at)}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {aviso && <span className={cn("text-xs", aviso.tono === "verde" ? "text-emerald-600" : "text-red-600")}>{aviso.texto}</span>}
            <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label={t("Close", "Cerrar")}>✕</button>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {archivado && (
            <p className="rounded-md border border-slate-200 bg-slate-100 p-2 text-xs text-slate-600">
              <span className="font-medium">{t("Archived", "Archivado")}</span> {fecha(cliente.archived_at)} · {motivoLabel(cliente.archived_reason, t)}
              {" — "}{t("hidden from the list; not a customer. It can be restored.", "escondido de la lista; no es un cliente. Se puede desarchivar.")}
            </p>
          )}
          {!puedeEditar && (
            <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">
              {t("Read-only — admins and managers can edit.", "Solo lectura — editan los admins y los managers.")}
            </p>
          )}
          {!nuevo && (tel || mail) && (
            <div className="flex flex-wrap gap-3 text-sm">
              {tel && <a href={tel} className="text-clay-600 hover:underline">📞 {form.phone}</a>}
              {mail && <a href={mail} className="text-clay-600 hover:underline">✉️ {form.email}</a>}
            </div>
          )}
          {CAMPOS.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-xs text-slate-500">{t(f.en, f.es)}{(f.key === "account" || f.key === "store") && nuevo ? " *" : ""}</span>
              {f.tipo === "tienda" ? (
                <select className={cn(selCls, "w-full", inputCls(f.key))} disabled={!puedeEditar} value={form[f.key] ?? ""} onChange={(e) => campo(f.key, e.target.value)}>
                  <option value="">—</option>
                  {TIENDAS.map((x) => <option key={x.code} value={x.code}>{x.nombre} ({x.code})</option>)}
                  {form[f.key] && !TIENDAS.some((x) => x.code === form[f.key]) && <option value={form[f.key]}>{form[f.key]}</option>}
                </select>
              ) : f.tipo === "estado" ? (
                <select className={cn(selCls, "w-full")} disabled={!puedeEditar} value={form[f.key] ?? ""} onChange={(e) => campo(f.key, e.target.value)}>
                  <option value="">{estadoLabel(null, t)}</option>
                  {ESTADOS.map((e) => <option key={e} value={e}>{estadoLabel(e, t)}</option>)}
                </select>
              ) : f.tipo === "historia" ? (
                <select className={cn(selCls, "w-full")} disabled={!puedeEditar} value={form[f.key] ?? ""} onChange={(e) => campo(f.key, e.target.value)}>
                  <option value="">—</option>
                  {HISTORIAS.map((h) => <option key={h} value={h}>{historiaLabel(h, t)}</option>)}
                </select>
              ) : f.tipo === "qb" ? (
                <select className={cn(selCls, "w-full")} disabled={!puedeEditar} value={form[f.key] ?? ""} onChange={(e) => campo(f.key, e.target.value)}>
                  <option value="">—</option>
                  {QB_ESTADOS.map((q) => <option key={q} value={q}>{qbLabel(q, t)}</option>)}
                </select>
              ) : f.tipo === "textarea" ? (
                <textarea
                  disabled={!puedeEditar}
                  rows={3}
                  value={form[f.key] ?? ""}
                  onChange={(e) => campo(f.key, e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm disabled:bg-slate-50 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
                />
              ) : (
                <Input
                  disabled={!puedeEditar}
                  value={form[f.key] ?? ""}
                  onChange={(e) => campo(f.key, e.target.value)}
                  inputMode={f.tipo === "num" ? "decimal" : undefined}
                  className={inputCls(f.key)}
                />
              )}
            </label>
          ))}
          {!nuevo && cliente.house_no !== null && (
            <p className="text-xs text-slate-400">{t("House #", "N.º House")} {cliente.house_no}</p>
          )}
        </div>

        {puedeEditar && !nuevo && archivando && (
          <div className="space-y-2 border-t border-slate-200 bg-slate-50 px-4 py-3">
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">{t("Why is it archived?", "¿Por qué se archiva?")}</span>
              <select className={cn(selCls, "w-full")} value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label={t("Reason", "Motivo")}>
                <option value="">{t("Choose a reason…", "Elige un motivo…")}</option>
                {MOTIVOS_DE_ARCHIVO.map((m) => <option key={m} value={m}>{motivoLabel(m, t)}</option>)}
                <option value="otro">{t("Other (write it)", "Otro (escríbelo)")}</option>
              </select>
            </label>
            {motivo === "otro" && (
              <Input value={motivoLibre} onChange={(e) => setMotivoLibre(e.target.value)} placeholder={t("Reason", "Motivo")} />
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setArchivando(false)}>{t("Cancel", "Cancelar")}</Button>
              <Button size="sm" onClick={archivar} disabled={ocupado || motivo === "" || (motivo === "otro" && motivoLibre.trim() === "")}>
                {ocupado ? t("Saving…", "Guardando…") : t("Archive", "Archivar")}
              </Button>
            </div>
          </div>
        )}
        {puedeEditar && (
          <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3">
            {!nuevo && (archivado ? (
              <Button variant="ghost" className="mr-auto" onClick={desarchivar} disabled={ocupado}>{t("Restore", "Desarchivar")}</Button>
            ) : (
              <Button variant="ghost" className="mr-auto text-slate-500" onClick={() => setArchivando(true)} disabled={ocupado || archivando}>{t("Archive…", "Archivar…")}</Button>
            ))}
            <Button variant="outline" onClick={onClose}>{t("Close", "Cerrar")}</Button>
            <Button onClick={guardar} disabled={ocupado || !cambiado}>
              {ocupado ? t("Saving…", "Guardando…") : nuevo ? t("Create", "Crear") : t("Save", "Guardar")}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
