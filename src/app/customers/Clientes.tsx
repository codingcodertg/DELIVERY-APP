"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarraSuperior } from "@/components/BarraSuperior";
import { ColumnFilterMenu } from "@/components/OrdersTable";
import { posicionDelMenu, useCierraAlSalir } from "@/lib/menu-desplegable";
import { columnasFiltradas, textoDeColumnas } from "@/lib/filtros-activos";
import type { FiltrosPorColumna } from "@/lib/orden-y-filtro";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/erp/supabase/client";
import { Badge } from "@/components/erp/ui/badge";
import { Button } from "@/components/erp/ui/button";
import { Input } from "@/components/erp/ui/input";
import { cn } from "@/lib/erp/utils";
import { SelectorDeColumnas } from "@/components/SelectorDeColumnas";
import { almacenDeLaBase, type AlmacenDeClientes } from "@/lib/customers/almacen";
import { almacenDemo } from "@/lib/customers/demo";
import { CAMPOS_EN_MAYUSCULAS } from "@/lib/customers/formato";
import { MOLDE_DEL_TELEFONO, telefonoAlEscribir, telefonoParaVer } from "@/lib/telefono-de-la-orden";
import { agrupaEnEmpresas, empresasPorTienda, filasDeLaEmpresa, ordenarEmpresas } from "@/lib/customers/empresas";
import { alPulsarCabecera, esOrdenInicial, filtraEmpresas, MAX_NIVELES, nivelDeOrden, opcionesDeColumna, ordenDesdeMenu, ORDENES_INICIALES } from "@/lib/customers/cabeceras";
import {
  alternaColumna, CAMPOS, celda, claveDeColumnasDeClientes, CLAVE_HEREDADA_DE_COLUMNAS, colocaColumnaDeClientes, columnasAPintar, columnasDelSelector,
  ESTADOS, estadoClase, estadoLabel, estaArchivado, fecha, FILTRO_INICIAL, formDe, HISTORIAS, historiaLabel,
  mailUrl, MOTIVOS_DE_ARCHIVO, motivoLabel, mueveColumnaDeClientes, nombreDeTienda, PARCHE_DESARCHIVAR, parcheArchivar,
  parcheDe, PREFERENCIA_INICIAL, preferenciaDeTexto, QB_ESTADOS, qbLabel, seMueveColumnaDeClientes, telUrl, TIENDAS, tieneOrdenPropio,
  type ClaveDeColumna, type Cliente, type Filtro, type Orden, type PreferenciaDeColumnas,
} from "@/lib/customers/reglas";

type Estado = { tipo: "cargando" } | { tipo: "sinTabla" } | { tipo: "error"; texto: string } | { tipo: "listo" };
type Ficha = { tipo: "ver"; cliente: Cliente } | { tipo: "nuevo" };

/** Cuántas filas se pintan de entrada y cuántas más con cada «ver más»: 1.349 filas de golpe pesan en un teléfono. */
const TANDA = 100;

const selCls =
  "h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900 disabled:bg-slate-50 disabled:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500";

/**
 * «Clientes» (migración 180): la lista maestra, con búsqueda, filtros por tienda y por columna, columnas elegibles y una
 * ficha lateral con todos los campos, que edita quien puede. Las reglas viven en `lib/customers/reglas` y están
 * probadas sin navegador; la base las vuelve a exigir (RLS de la 180). Este componente lee, filtra y pinta, y cada
 * escritura va por el almacén, que devuelve la fila como quedó en la base: eso es lo que se pinta.
 */
export function Clientes({ demo, puedeEditar, userId }: { demo: boolean; puedeEditar: boolean; userId: string }) {
  const { t, lang } = usePrefs();
  const almacen: AlmacenDeClientes = useMemo(() => (demo ? almacenDemo() : almacenDeLaBase(createClient())), [demo]);

  const [lista, setLista] = useState<Cliente[]>([]);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [filtro, setFiltro] = useState<Filtro>(FILTRO_INICIAL);
  // El orden en niveles (D-650): el 1 manda, el 2 y el 3 desempatan. Y los filtros por columna, que se suman a los de
  // arriba. Son de la pantalla: al salir se pierden, como en las tablas del Gestor (D-360).
  const [ordenes, setOrdenes] = useState<Orden[]>([...ORDENES_INICIALES]);
  const [filtrosCol, setFiltrosCol] = useState<FiltrosPorColumna>({});
  const [prefCols, setPrefCols] = useState<PreferenciaDeColumnas>(PREFERENCIA_INICIAL);
  const [cuantos, setCuantos] = useState(TANDA);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const cajaRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const r = await almacen.leer();
    if (!r.ok) { setEstado(r.sinTabla ? { tipo: "sinTabla" } : { tipo: "error", texto: r.error }); return; }
    setLista(r.valor);
    setEstado({ tipo: "listo" });
  }, [almacen]);
  useEffect(() => { void cargar(); }, [cargar]);

  // «✏️ Editar» de la página del cliente (D-648) llega con `?editar=<id>`: al cargar la lista se abre la ficha lateral de ese
  // cliente —la que edita y guarda— y el parámetro se quita, para que recargar no la vuelva a abrir.
  const [editarPendiente, setEditarPendiente] = useState<number | null>(null);
  useEffect(() => {
    const n = Number(new URLSearchParams(window.location.search).get("editar"));
    if (Number.isInteger(n) && n > 0) setEditarPendiente(n);
  }, []);
  useEffect(() => {
    if (editarPendiente == null || estado.tipo !== "listo") return;
    const c = lista.find((x) => x.id === editarPendiente);
    if (c) setFicha({ tipo: "ver", cliente: c });
    setEditarPendiente(null);
    try { window.history.replaceState(null, "", window.location.pathname); } catch { /* sin historial: se queda el parámetro */ }
  }, [editarPendiente, estado.tipo, lista]);

  // Qué columnas y en qué orden: POR PERSONA, en este navegador (clave con el id del usuario, como los filtros guardados
  // de Órdenes). Si no hay nada suyo, se hereda la clave vieja sin usuario (`customers_cols`); si no hay nada o está
  // roto, las de entrada.
  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(claveDeColumnasDeClientes(userId)) ?? window.localStorage.getItem(CLAVE_HEREDADA_DE_COLUMNAS);
      if (guardado) setPrefCols(preferenciaDeTexto(guardado));
    } catch { /* privado, bloqueado o basura: se queda lo de entrada */ }
  }, [userId]);
  const cambiaColumnas = (f: (p: PreferenciaDeColumnas) => PreferenciaDeColumnas) => {
    setPrefCols((p) => {
      const next = f(p);
      try { window.localStorage.setItem(claveDeColumnasDeClientes(userId), JSON.stringify(next)); } catch { /* no se recuerda */ }
      return next;
    });
  };
  const alternar = (key: string) => cambiaColumnas((p) => ({ ...p, elegidas: alternaColumna(p.elegidas, key) }));

  // UNA fila por EMPRESA (189): las filas de la misma compañía en varias tiendas se pintan juntas, con sus tiendas en
  // pastillas; con una tienda elegida sale toda empresa con fila allí, enseñando la fila de esa tienda.
  const empresas = useMemo(() => agrupaEnEmpresas(lista, filtro), [lista, filtro]);
  const visibles = useMemo(() => ordenarEmpresas(filtraEmpresas(empresas, filtrosCol), ordenes), [empresas, filtrosCol, ordenes]);
  useEffect(() => { setCuantos(TANDA); }, [filtro, filtrosCol, ordenes]);
  // Los archivados (181) se esconden por defecto: las cuentas de las tiendas y el «N clientes» son de lo que se está viendo
  // (vivos, o archivados con el chip), no de la tabla entera. Y cuentan EMPRESAS, no filas.
  const vista = useMemo(() => agrupaEnEmpresas(lista, { ...FILTRO_INICIAL, archivados: filtro.archivados }), [lista, filtro.archivados]);
  const archivados = useMemo(() => agrupaEnEmpresas(lista, { ...FILTRO_INICIAL, archivados: true }).length, [lista]);
  const porTienda = useMemo(() => empresasPorTienda(vista), [vista]);
  const colsVisibles = columnasAPintar(prefCols);
  const todasLasClaves = columnasDelSelector(prefCols).map((c) => c.key as string);
  const filtradas = columnasFiltradas(filtrosCol, todasLasClaves);
  const nombreDe = (k: string) => { const c = columnasDelSelector(prefCols).find((x) => x.key === k); return c ? t(c.en, c.es) : k; };

  // El menú de la columna (el de Órdenes, D-275), en un portal: la caja de la tabla se desplaza y lo recortaría.
  const [abierta, setAbierta] = useState<ClaveDeColumna | null>(null);
  const [ancla, setAncla] = useState<DOMRect | null>(null);
  const celdas = useRef(new Map<string, HTMLElement>());
  const menuRef = useRef<HTMLDivElement>(null);
  const abrir = (key: ClaveDeColumna) => {
    if (abierta === key) { setAbierta(null); return; }
    const el = celdas.current.get(key);
    if (el) setAncla(el.getBoundingClientRect());
    setAbierta(key);
  };
  useEffect(() => {
    if (!abierta) return;
    const recoloca = () => { const el = celdas.current.get(abierta); if (el) setAncla(el.getBoundingClientRect()); };
    window.addEventListener("scroll", recoloca, true);
    window.addEventListener("resize", recoloca);
    return () => { window.removeEventListener("scroll", recoloca, true); window.removeEventListener("resize", recoloca); };
  }, [abierta]);
  useCierraAlSalir(!!abierta, () => setAbierta(null), () => [menuRef.current, abierta ? celdas.current.get(abierta) : null]);
  const quitaFiltroDe = (key: string) => setFiltrosCol((f) => { const n = { ...f }; delete n[key]; return n; });

  // Arrastrar una cabecera y soltarla en otra (D-650): HTML5 drag & drop, de escritorio; en el teléfono las columnas
  // se mueven con las flechas de «⚙ Columnas». El orden es el mismo que guarda el selector.
  const [arrastrada, setArrastrada] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const suelta = (destino: string) => {
    if (arrastrada && arrastrada !== destino) cambiaColumnas((p) => colocaColumnaDeClientes(p, arrastrada, destino));
    setArrastrada(null);
    setSobre(null);
  };

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
            {t(
              "The master customer list: one row per company, with the stores where it buys. Click a row to open its card and switch stores.",
              "La lista maestra de clientes: una fila por empresa, con las tiendas donde compra. Toca una fila para abrir su ficha y cambiar de tienda.",
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SelectorDeColumnas
            columnas={columnasDelSelector(prefCols)}
            elegidas={prefCols.elegidas}
            onAlterna={alternar}
            rotulo={(c) => t(c.en, c.es)}
            titulo={t("Columns", "Columnas")}
            nota={t("All the columns of the Excel. Remembered for you in this browser.", "Todas las columnas del Excel. Se recuerdan para ti en este navegador.")}
            t={t}
            mover={{
              seMueve: (key, delta) => seMueveColumnaDeClientes(prefCols, key, delta),
              onMueve: (key, delta) => cambiaColumnas((p) => mueveColumnaDeClientes(p, key, delta)),
              ordenPropio: tieneOrdenPropio(prefCols.orden),
              onRestablece: () => cambiaColumnas((p) => ({ ...p, orden: null })),
            }}
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
        {/* Sin el desplegable de estado (D-650, el dueño: «we don't need the all statuses in the customer view»): el estado
            se filtra en el menú de su columna, «Estado (tienda)». */}
        <select className={selCls} value={filtro.qb} onChange={(e) => setFiltro((f) => ({ ...f, qb: e.target.value }))} aria-label="QuickBooks">
          <option value="">{t("QB: all", "QB: todos")}</option>
          {QB_ESTADOS.map((q) => <option key={q} value={q}>{qbLabel(q, t)}</option>)}
        </select>
        {(filtro.busca || filtro.tienda || filtro.qb || filtro.archivados || filtradas.length > 0) && (
          <Button variant="ghost" size="sm" onClick={() => { setFiltro(FILTRO_INICIAL); setFiltrosCol({}); }}>{t("Clear filters", "Quitar filtros")}</Button>
        )}
        <span className="ml-auto text-sm text-slate-500">
          {visibles.length === vista.length ? `${vista.length}` : `${visibles.length} / ${vista.length}`}{" "}
          {filtro.archivados ? t("archived", "archivados") : t("customers", "clientes")}
        </span>
      </div>

      {/* Qué columnas filtran y por qué columnas se ordena, dicho con palabras: un filtro que se olvida puesto esconde
          clientes (D-297), y el orden en niveles no se lee de un vistazo en las flechas. */}
      {(filtradas.length > 0 || !esOrdenInicial(ordenes)) && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          {filtradas.length > 0 && (
            <span data-filtrado-por>
              🔎 <b>{t("Filtered by", "Filtrado por")}:</b> {textoDeColumnas(filtradas.map(nombreDe), t("and", "y"), (n) => t(`${n} more`, `${n} más`))}
            </span>
          )}
          {!esOrdenInicial(ordenes) && (
            <span className="inline-flex flex-wrap items-center gap-1" data-ordenado-por>
              <b>{t("Sorted by", "Ordenado por")}:</b>
              {ordenes.map((o, i) => (
                <span key={o.por} className="rounded-full border border-clay-200 bg-clay-50 px-2 py-0.5 text-xs text-clay-700">
                  {i + 1} · {nombreDe(o.por)} {o.desc ? "↓" : "↑"}
                </span>
              ))}
              <Button variant="ghost" size="sm" onClick={() => setOrdenes([...ORDENES_INICIALES])}>✕ {t("Remove sort", "Quitar orden")}</Button>
            </span>
          )}
        </div>
      )}

      {estado.tipo === "cargando" && <p className="text-sm text-slate-500">{t("Loading…", "Cargando…")}</p>}
      {estado.tipo === "sinTabla" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {t("The customers table does not exist yet (migration 180 is not applied).", "La tabla de clientes aún no existe (la migración 180 no está aplicada).")}
        </p>
      )}
      {estado.tipo === "error" && <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{t("Could not load the customers: ", "No se pudieron cargar los clientes: ")}{estado.texto}</p>}

      {/* Cabecera bloqueada y barra de arriba (D-649), como Órdenes desde D-398. Roberto: «Need to be able to scroll down and
          still see headers» y «the bar is at the very bottom so probably better to have the bar above the locked headers». La
          caja lleva alto propio (el de la ventana menos 150 px, el de `.tbl-caja`): se desplaza ella en las dos direcciones, la
          cabecera se pega a su borde de arriba (`sticky top-0`) y su barra de abajo queda en pantalla; `BarraSuperior` pone
          otra encima de la cabecera que mueve la caja a lo ancho. */}
      {estado.tipo === "listo" && <BarraSuperior caja={cajaRef} />}
      {estado.tipo === "listo" && (
        <div ref={cajaRef} data-caja-de-clientes className="max-h-[calc(100dvh-150px)] overflow-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
              <tr>
                {colsVisibles.map((c) => {
                  // D-650: el nombre ordena (Mayús+clic añade un nivel), el ▾ abre el menú de la columna, y la cabecera
                  // entera se arrastra para cambiarla de sitio.
                  const nivel = nivelDeOrden(ordenes, c.key);
                  const hayFiltro = (filtrosCol[c.key]?.size ?? 0) > 0;
                  return (
                    <th
                      key={c.key}
                      data-columna={c.key}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.key); e.dataTransfer.effectAllowed = "move"; setArrastrada(c.key); }}
                      onDragOver={(e) => { if (arrastrada && arrastrada !== c.key) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setSobre(c.key); } }}
                      onDragLeave={() => setSobre((s) => (s === c.key ? null : s))}
                      onDrop={(e) => { e.preventDefault(); suelta(c.key); }}
                      onDragEnd={() => { setArrastrada(null); setSobre(null); }}
                      className={cn(
                        "select-none whitespace-nowrap px-3 py-2",
                        arrastrada === c.key && "opacity-40",
                        sobre === c.key && "bg-clay-100",
                      )}
                      aria-sort={nivel?.nivel === 1 ? (nivel.desc ? "descending" : "ascending") : "none"}
                    >
                      <span className="inline-flex items-center gap-0.5" ref={(el) => { if (el) celdas.current.set(c.key, el); else celdas.current.delete(c.key); }}>
                        <button
                          type="button"
                          className="cursor-grab hover:text-clay-700"
                          onClick={(e) => setOrdenes((o) => alPulsarCabecera(o, c.key, e.shiftKey))}
                          title={t("Click: sort by this · Shift+click: add as next sort level · Drag: move the column", "Clic: ordenar por esta · Mayús+clic: añadirla como siguiente orden · Arrastrar: mover la columna")}
                        >
                          {t(c.en, c.es)}
                          {nivel && (
                            <span className="ml-1 font-semibold text-clay-700" data-nivel={nivel.nivel}>
                              <sup>{nivel.nivel}</sup>{nivel.desc ? "↓" : "↑"}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          className={cn("rounded px-1 text-sm leading-none", hayFiltro ? "bg-clay-100 font-bold text-clay-700" : "text-slate-400 hover:bg-slate-100 hover:text-slate-700")}
                          onClick={(e) => { e.stopPropagation(); abrir(c.key); }}
                          aria-label={t(`Sort and filter ${c.en}`, `Ordenar y filtrar ${c.es}`)}
                          title={t("Sort and filter", "Ordenar y filtrar")}
                          data-filtro-de={c.key}
                          data-filtrada={hayFiltro ? "1" : undefined}
                        >
                          ▾
                        </button>
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibles.length === 0 && (
                <tr><td colSpan={colsVisibles.length} className="px-3 py-6 text-center text-slate-500">{t("No customers match.", "Ningún cliente coincide.")}</td></tr>
              )}
              {visibles.slice(0, cuantos).map(({ clave, filas, principal: c }) => (
                <tr
                  key={clave}
                  onClick={() => setFicha({ tipo: "ver", cliente: c })}
                  className={cn("cursor-pointer border-t border-slate-100 hover:bg-clay-50", estaArchivado(c) && "opacity-60")}
                  data-archivado={estaArchivado(c) ? "1" : undefined}
                >
                  {colsVisibles.map((col) => (
                    <td key={col.key} className={cn("px-3 py-2", col.key === "account" && "font-medium text-slate-900", (col.key === "credit_limit" || col.key === "euler_limit") && "text-right tabular-nums")}>
                      {col.key === "account" ? (
                        <span className="inline-flex flex-wrap items-center gap-1.5">
                          {estaArchivado(c) ? (
                            <>
                              <span className="line-through">{c.account}</span>
                              <Badge className="border-slate-200 bg-slate-100 text-slate-500">{t("Archived", "Archivado")} · {motivoLabel(c.archived_reason, t)}</Badge>
                            </>
                          ) : c.account}
                          {/* La ficha completa (/customers/[id]), como el «Ficha completa →» de un artículo del ERP. El clic no abre el cajón. */}
                          <Link
                            href={`/customers/${c.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs font-normal text-clay-600 hover:underline"
                            aria-label={t(`Full details of ${c.account}`, `Ficha completa de ${c.account}`)}
                          >
                            {t("details", "ficha")}
                          </Link>
                        </span>
                      ) : col.key === "store" ? (
                        // Las tiendas de la empresa (189): la que se enseña, resaltada.
                        <span className="inline-flex flex-wrap gap-1" data-tiendas={filas.length}>
                          {filas.map((f) => (
                            <span
                              key={f.id}
                              className={cn("whitespace-nowrap rounded-full border px-2 py-0.5 text-xs", f.id === c.id ? "border-clay-200 bg-clay-50 font-medium text-clay-700" : "border-slate-200 text-slate-500")}
                              title={f.account}
                            >
                              {nombreDeTienda(f.store)}
                            </span>
                          ))}
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

      {abierta && ancla && createPortal(
        (() => {
          const col = colsVisibles.find((c) => c.key === abierta);
          if (!col) return null;
          const opciones = opcionesDeColumna(empresas, filtrosCol, abierta, t);
          const nivel = nivelDeOrden(ordenes, abierta);
          return (
            <ColumnFilterMenu
              key={abierta}
              menuRef={menuRef}
              col={col}
              options={opciones}
              active={filtrosCol[abierta]}
              orden={nivel ? (nivel.desc ? "desc" : "asc") : null}
              onOrdenar={(dir) => { setOrdenes((o) => ordenDesdeMenu(o, abierta, dir)); setAbierta(null); }}
              masOrden={!nivel && (
                // En una línea: el menú mide 320 px y con dos líneas «Limpiar» y «Aplicar» quedaban cortados (medido a 1440).
                <button
                  type="button"
                  className="col-opt col-orden"
                  data-anade-nivel
                  onClick={() => { setOrdenes((o) => alPulsarCabecera(o, abierta, true)); setAbierta(null); }}
                  title={ordenes.length < MAX_NIVELES
                    ? t("Add as the next sort: it breaks ties of the levels above", "Añadir como siguiente orden: desempata a los niveles de arriba")
                    : t(`Replaces level ${MAX_NIVELES}, the last one to break ties`, `Sustituye al nivel ${MAX_NIVELES}, el último en desempatar`)}
                >
                  + {t(`Then by this (level ${Math.min(ordenes.length + 1, MAX_NIVELES)})`, `Añadir como nivel ${Math.min(ordenes.length + 1, MAX_NIVELES)}`)}
                </button>
              )}
              lang={lang}
              t={t}
              style={posicionDelMenu(ancla, { ancho: window.innerWidth, alto: window.innerHeight })}
              // Con todo marcado no filtra nada: se quita, para que el ▾ no diga que hay filtro.
              onApply={(marcados) => {
                if (opciones.every((o) => marcados.has(o.key))) quitaFiltroDe(abierta);
                else setFiltrosCol((f) => ({ ...f, [abierta]: marcados }));
                setAbierta(null);
              }}
              onClear={() => { quitaFiltroDe(abierta); setAbierta(null); }}
              onClose={() => setAbierta(null)}
            />
          );
        })(),
        document.body,
      )}

      {ficha && (
        <FichaDeCliente
          cliente={ficha.tipo === "ver" ? ficha.cliente : null}
          hermanas={ficha.tipo === "ver" ? filasDeLaEmpresa(lista, lista.find((x) => x.id === ficha.cliente.id) ?? ficha.cliente) : []}
          onCambia={(c) => setFicha({ tipo: "ver", cliente: c })}
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
function FichaDeCliente({ cliente, hermanas, onCambia, puedeEditar, almacen, onClose, onGuardado, t }: {
  cliente: Cliente | null;
  /** Las filas de la misma empresa (189), una por tienda, en orden: las pestañas. Con una sola, no hay pestañas. */
  hermanas: Cliente[];
  onCambia: (c: Cliente) => void;
  puedeEditar: boolean; almacen: AlmacenDeClientes; onClose: () => void; onGuardado: (c: Cliente) => void;
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
  // Separar (189): esta fila deja la empresa y pasa a ser la suya propia (otra clave). Las demás no se tocan.
  const separar = async () => {
    if (nuevo) return;
    await aplicar(() => almacen.guardar(cliente.id, { company_id: crypto.randomUUID() }), t("Split ✓", "Separada ✓"));
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
            {!nuevo && (
              <Link href={`/customers/${cliente.id}`} className="whitespace-nowrap text-sm text-clay-600 hover:underline">
                {t("Full details →", "Ficha completa →")}
              </Link>
            )}
            <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label={t("Close", "Cerrar")}>✕</button>
          </div>
        </div>

        {/* Las tiendas de la empresa (189): cada pestaña es la fila de esa tienda, con su contacto, su vendedor y su CRM. */}
        {!nuevo && hermanas.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 px-4 py-2" role="tablist" aria-label={t("Stores of this company", "Tiendas de esta empresa")}>
            {hermanas.map((h) => {
              const repetida = hermanas.filter((x) => x.store === h.store).length > 1;
              return (
                <button
                  key={h.id}
                  type="button"
                  role="tab"
                  aria-selected={h.id === cliente.id}
                  disabled={h.id !== cliente.id && cambiado}
                  title={h.id !== cliente.id && cambiado ? t("Save or undo your changes first", "Guarda o deshaz los cambios primero") : h.account}
                  onClick={() => onCambia(h)}
                  className={cn("rounded-full border px-3 py-1 text-xs disabled:opacity-50", h.id === cliente.id ? "border-clay-200 bg-clay-50 font-medium text-clay-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50")}
                >
                  {nombreDeTienda(h.store)}{repetida ? ` · ${h.account}` : ""}
                </button>
              );
            })}
            {puedeEditar && (
              <Button variant="ghost" size="sm" className="ml-auto text-xs text-slate-500" onClick={separar} disabled={ocupado || cambiado}
                title={t("This store's row stops being part of this company (nothing is deleted)", "La fila de esta tienda deja de ser de esta empresa (no se borra nada)")}>
                {t("Split from company", "Separar de la empresa")}
              </Button>
            )}
          </div>
        )}

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
              ) : f.key === "phone" ? (
                // D-635: como el teléfono de la orden de Entregas (D-630): solo números, y el formato se pone solo.
                <Input
                  disabled={!puedeEditar}
                  value={telefonoParaVer(form[f.key])}
                  onChange={(e) => campo(f.key, telefonoAlEscribir(e.target.value))}
                  type="tel"
                  inputMode="numeric"
                  placeholder={MOLDE_DEL_TELEFONO}
                  className={inputCls(f.key)}
                />
              ) : (
                <Input
                  disabled={!puedeEditar}
                  value={form[f.key] ?? ""}
                  // D-635: los nombres salen en MAYÚSCULAS según se escriben.
                  onChange={(e) => campo(f.key, (CAMPOS_EN_MAYUSCULAS as readonly string[]).includes(f.key) ? e.target.value.toUpperCase() : e.target.value)}
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
