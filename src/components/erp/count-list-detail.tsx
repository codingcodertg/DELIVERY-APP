"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCountList,
  addProductsToCountList,
  setCountListQty,
  removeCountListLine,
  submitCountList,
  searchProductsForCount,
  type DetalleDeLista,
  type HitDeConteo,
  type RenglonDeLista,
} from "@/lib/erp/actions";
import { failText, type ErpCode } from "@/lib/erp/messages";
import { coincidenciasDeBusqueda, type CampoDeBusqueda } from "@/lib/erp/busqueda-productos";
import {
  altaDeResultados,
  cantidadDesdeTexto,
  diferencia,
  puedeEnviar,
  resumenDeRenglones,
  TOPE_DE_ALTA,
} from "@/lib/erp/listas-de-conteo";
import { cn } from "@/lib/erp/utils";
import { usePrefs } from "@/lib/prefs";

// Detalle de una lista de conteo: buscar y agregar productos, contar cada renglón (guardado solo, por renglón)
// y enviar. Pensado para el teléfono de la bodega: entradas grandes, teclado numérico, nada más ancho que la pantalla.

type Estado = "guardada" | "pendiente" | "guardando" | "error";
type Msg = { kind: "ok" | "err"; text: string };
type Pantalla = { total: number; rows: HitDeConteo[] } | null;

const MUESTRA_DE_RESULTADOS = 50;
const ESPERA_DE_GUARDADO_MS = 700;
const ESPERA_DE_BUSQUEDA_MS = 250;

function fecha(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const cantidad = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString());

export function CountListDetail({ listId, onVolver }: { listId: number; onVolver: () => void }) {
  const { t } = usePrefs();
  const [detalle, setDetalle] = useState<DetalleDeLista | null>(null);
  const [cargando, setCargando] = useState(true);
  const [msg, setMsg] = useState<Msg | null>(null);

  // Texto escrito en cada renglón (lo que la persona ve) y su estado de guardado.
  const [textos, setTextos] = useState<Record<number, string>>({});
  const textosRef = useRef<Record<number, string>>({});
  const [estados, setEstados] = useState<Record<number, Estado>>({});
  const esperas = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const inputs = useRef<Record<number, HTMLInputElement | null>>({});
  const enfocarDespues = useRef<number | null>(null);
  const [resaltada, setResaltada] = useState<number | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [pantalla, setPantalla] = useState<Pantalla>(null);
  const [confirmaAltaTodos, setConfirmaAltaTodos] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [confirmaEnvio, setConfirmaEnvio] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const soloLectura = detalle?.list.status === "submitted";
  const lineas: RenglonDeLista[] = useMemo(() => detalle?.lines ?? [], [detalle]);
  const resumen = useMemo(() => resumenDeRenglones(lineas), [lineas]);
  const porProducto = useMemo(() => new Map(lineas.map((l) => [l.product_id, l.id])), [lineas]);

  function avisarError(res: { ok: false; error?: string; code?: ErpCode; params?: Record<string, string> }) {
    const mensaje = res.code ? { code: res.code, params: res.params } : { error: res.error || "" };
    setMsg({ kind: "err", text: failText(mensaje, t) });
  }

  async function recargar(): Promise<DetalleDeLista | null> {
    const res = await getCountList(listId);
    if (!res.ok) { avisarError(res); return null; }
    setDetalle(res.value);
    // Lo guardado pasa a la casilla, salvo los renglones que tienen una espera de guardado en curso.
    const siguiente = { ...textosRef.current };
    for (const l of res.value.lines) {
      if (esperas.current[l.id] === undefined) siguiente[l.id] = l.counted_qty == null ? "" : String(l.counted_qty);
    }
    textosRef.current = siguiente;
    setTextos(siguiente);
    return res.value;
  }

  useEffect(() => {
    let vigente = true;
    getCountList(listId).then((res) => {
      if (!vigente) return;
      setCargando(false);
      if (!res.ok) { avisarError(res); return; }
      setDetalle(res.value);
      const inicial: Record<number, string> = {};
      for (const l of res.value.lines) inicial[l.id] = l.counted_qty == null ? "" : String(l.counted_qty);
      textosRef.current = inicial;
      setTextos(inicial);
    });
    const tiempos = esperas.current;
    return () => {
      vigente = false;
      Object.values(tiempos).forEach(clearTimeout);
    };
    // Una sola carga por lista abierta: la pantalla padre la monta con key={listId}.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId]);

  // Tras agregar un producto, enfocar su renglón para escribir la cantidad de una vez.
  useEffect(() => {
    const id = enfocarDespues.current;
    if (id == null) return;
    enfocarDespues.current = null;
    inputs.current[id]?.focus();
    document.getElementById(`linea-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [detalle]);

  /* ----------------------------- Cantidades ----------------------------- */

  async function guardar(lineId: number, texto: string) {
    const leida = cantidadDesdeTexto(texto);
    if (!leida.ok) { setEstados((e) => ({ ...e, [lineId]: "error" })); return; }
    setEstados((e) => ({ ...e, [lineId]: "guardando" }));
    const res = await setCountListQty(lineId, leida.valor);
    if (!res.ok) {
      setEstados((e) => ({ ...e, [lineId]: "error" }));
      avisarError(res);
      return;
    }
    setDetalle((d) => (d ? { ...d, lines: d.lines.map((l) => (l.id === lineId ? res.value : l)) } : d));
    // Si la persona escribió mientras se guardaba, este renglón sigue pendiente (la siguiente espera lo manda).
    setEstados((e) => ({ ...e, [lineId]: textosRef.current[lineId] === texto ? "guardada" : "pendiente" }));
  }

  function escribir(lineId: number, texto: string) {
    textosRef.current = { ...textosRef.current, [lineId]: texto };
    setTextos(textosRef.current);
    clearTimeout(esperas.current[lineId]);
    const leida = cantidadDesdeTexto(texto);
    if (!leida.ok) { setEstados((e) => ({ ...e, [lineId]: "error" })); return; }
    setEstados((e) => ({ ...e, [lineId]: "pendiente" }));
    esperas.current[lineId] = setTimeout(() => {
      delete esperas.current[lineId];
      void guardar(lineId, textosRef.current[lineId] ?? "");
    }, ESPERA_DE_GUARDADO_MS);
  }

  function salirDelCampo(lineId: number) {
    if (esperas.current[lineId] === undefined) return;
    clearTimeout(esperas.current[lineId]);
    delete esperas.current[lineId];
    void guardar(lineId, textosRef.current[lineId] ?? "");
  }

  /** Espera a que se guarde todo lo que quedó pendiente (antes de enviar). */
  async function guardarPendientes() {
    const ids = Object.keys(esperas.current).map(Number);
    for (const id of ids) {
      clearTimeout(esperas.current[id]);
      delete esperas.current[id];
      await guardar(id, textosRef.current[id] ?? "");
    }
  }

  async function quitar(lineId: number) {
    if (!window.confirm(t("Remove this line from the list?", "¿Quitar este renglón de la lista?"))) return;
    const res = await removeCountListLine(lineId);
    if (!res.ok) { avisarError(res); return; }
    clearTimeout(esperas.current[lineId]);
    delete esperas.current[lineId];
    await recargar();
  }

  /* ----------------------------- Búsqueda y altas ----------------------------- */

  useEffect(() => {
    if (!busqueda.trim()) { setPantalla(null); setConfirmaAltaTodos(false); return; }
    let vigente = true;
    const espera = setTimeout(async () => {
      const res = await searchProductsForCount(busqueda);
      if (!vigente) return;
      if (res.ok) setPantalla({ total: res.total, rows: res.rows });
      else avisarError(res);
    }, ESPERA_DE_BUSQUEDA_MS);
    return () => { vigente = false; clearTimeout(espera); };
  }, [busqueda]);

  async function agregar(productIds: number[]) {
    if (productIds.length === 0) return;
    setAgregando(true); setMsg(null);
    const res = await addProductsToCountList(listId, productIds);
    setAgregando(false);
    if (!res.ok) { avisarError(res); return; }
    setConfirmaAltaTodos(false);
    const nueva = await recargar();
    if (!nueva) return;
    if (productIds.length === 1) {
      const linea = nueva.lines.find((l) => l.product_id === productIds[0]);
      if (linea) enfocarDespues.current = linea.id;
    } else {
      setMsg({ kind: "ok", text: t(`Added ${res.value.added} products.`, `Se agregaron ${res.value.added} productos.`) });
    }
  }

  function irAlRenglon(productId: number) {
    const lineId = porProducto.get(productId);
    if (lineId == null) return;
    setResaltada(lineId);
    inputs.current[lineId]?.focus();
    document.getElementById(`linea-${lineId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* ----------------------------- Envío ----------------------------- */

  async function enviar() {
    setEnviando(true); setMsg(null);
    await guardarPendientes();
    const fresca = await recargar();
    if (!fresca) { setEnviando(false); return; }
    const listo = puedeEnviar(resumenDeRenglones(fresca.lines));
    if (!listo.ok) {
      setEnviando(false);
      setConfirmaEnvio(false);
      setMsg({ kind: "err", text: listo.motivo === "vacia"
        ? t("The list has no products yet.", "La lista aún no tiene productos.")
        : t("Some lines are still not counted. Count them or remove them.", "Hay renglones sin contar. Cuéntalos o quítalos.") });
      return;
    }
    const res = await submitCountList(listId);
    setEnviando(false);
    setConfirmaEnvio(false);
    if (!res.ok) { avisarError(res); return; }
    setMsg({ kind: "ok", text: t(`Submitted: ${res.value.recorded} counts recorded for review.`, `Enviada: ${res.value.recorded} conteos registrados para revisión.`) });
    await recargar();
  }

  /* ----------------------------- Pantalla ----------------------------- */

  const alta = pantalla ? altaDeResultados(pantalla.total, pantalla.rows.map((r) => r.id), new Set(porProducto.keys())) : null;
  const pendientes = Object.keys(estados).filter((k) => estados[Number(k)] === "pendiente" || estados[Number(k)] === "error").length;

  if (cargando) return <p className="p-4 text-sm text-slate-500">{t("Loading list…", "Cargando la lista…")}</p>;
  if (!detalle) {
    return (
      <div className="space-y-3 p-4">
        {msg && <Aviso kind={msg.kind}>{msg.text}</Aviso>}
        <button type="button" onClick={onVolver} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm">{t("Back to lists", "Volver a las listas")}</button>
      </div>
    );
  }
  const { list } = detalle;

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onVolver} className="mb-2 min-h-9 text-sm font-medium text-clay-700 hover:underline">
            ← {t("Back to lists", "Volver a las listas")}
          </button>
          <h3 className="break-words text-lg font-semibold text-slate-900">{list.name}</h3>
          <p className="text-xs text-slate-500">
            {list.store_name ?? list.store_id} · {t("created by", "creada por")} {list.created_by_name ?? "—"} · {fecha(list.created_at)}
          </p>
          <p className="text-xs text-slate-500">
            {t("Last change", "Último cambio")}: {fecha(list.updated_at)}{list.updated_by_name ? ` · ${list.updated_by_name}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("rounded-full border px-2.5 py-0.5 text-xs font-medium",
            soloLectura ? "border-slate-300 bg-slate-100 text-slate-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
            {soloLectura ? t("Submitted", "Enviada") : t("Open", "Abierta")}
          </span>
          <span className="text-sm font-semibold tabular-nums text-slate-800" data-testid="conteo-de-lista">
            {t(`${resumen.contadas} of ${resumen.total} counted`, `${resumen.contadas} de ${resumen.total} contados`)}
          </span>
        </div>
      </div>

      {soloLectura && (
        <Aviso kind="ok">
          {t(`Submitted by ${list.submitted_by_name ?? "—"} on ${fecha(list.submitted_at)}. Read-only.`,
             `Enviada por ${list.submitted_by_name ?? "—"} el ${fecha(list.submitted_at)}. Solo lectura.`)}
        </Aviso>
      )}
      {msg && <Aviso kind={msg.kind}>{msg.text}</Aviso>}

      {!soloLectura && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <label className="block">
            <span className="sr-only">{t("Search products", "Buscar productos")}</span>
            <input
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder={t("Search supplier, SKU, name, category… (several words = all of them)", "Buscar proveedor, SKU, nombre, categoría… (varias palabras = todas)")}
              className="h-12 w-full rounded-lg border border-slate-300 bg-white px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
            />
          </label>

          {pantalla && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500" data-testid="total-de-busqueda">
                {t(`${pantalla.total} products match`, `${pantalla.total} productos coinciden`)}
                {pantalla.rows.length > MUESTRA_DE_RESULTADOS ? t(` · showing ${MUESTRA_DE_RESULTADOS}`, ` · se muestran ${MUESTRA_DE_RESULTADOS}`) : ""}
              </p>

              {alta && pantalla.total > 0 && (
                <div className="rounded-lg bg-slate-50 p-2 text-sm">
                  {alta.excede ? (
                    <span className="text-amber-700">{t(`Too many to add at once (max ${TOPE_DE_ALTA}). Narrow the search to add them.`, `Son demasiados para agregar de una vez (máx. ${TOPE_DE_ALTA}). Afina la búsqueda para agregarlos.`)}</span>
                  ) : alta.nuevos.length === 0 ? (
                    <span className="text-slate-600">{t("All of them are already in the list.", "Todos ya están en la lista.")}</span>
                  ) : confirmaAltaTodos ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>{t(`Add ${alta.nuevos.length} products to this list?`, `¿Agregar ${alta.nuevos.length} productos a esta lista?`)}</span>
                      <button type="button" disabled={agregando} onClick={() => agregar(alta.nuevos)} className="min-h-10 rounded-lg bg-clay-600 px-3 text-sm font-medium text-white disabled:opacity-50">
                        {t("Yes, add them", "Sí, agregarlos")}
                      </button>
                      <button type="button" onClick={() => setConfirmaAltaTodos(false)} className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm">{t("Cancel", "Cancelar")}</button>
                    </div>
                  ) : (
                    <button type="button" disabled={agregando} onClick={() => setConfirmaAltaTodos(true)} className="min-h-10 rounded-lg border border-clay-300 bg-white px-3 text-sm font-medium text-clay-700 disabled:opacity-50">
                      {t(`Add all ${alta.nuevos.length}${alta.yaEnLista ? ` (${alta.yaEnLista} already in the list)` : ""}`, `Agregar los ${alta.nuevos.length}${alta.yaEnLista ? ` (${alta.yaEnLista} ya están en la lista)` : ""}`)}
                    </button>
                  )}
                </div>
              )}

              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {pantalla.rows.slice(0, MUESTRA_DE_RESULTADOS).map((h) => {
                  const enLista = porProducto.has(h.id);
                  const porQue = coincidenciasDeBusqueda(h, busqueda);
                  return (
                    <li key={h.id} className="flex items-start justify-between gap-3 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="break-words font-medium text-slate-900">{h.name}</div>
                        <div className="font-mono text-xs text-slate-400">{h.sku}</div>
                        {porQue.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {porQue.map((c) => (
                              <span key={c.campo} className="max-w-full break-words rounded bg-clay-50 px-1.5 py-0.5 text-xs text-clay-800">
                                <span className="text-clay-600">{etiquetaDeCampo(c.campo, t)}:</span> {c.valor}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {enLista ? (
                        <button type="button" onClick={() => irAlRenglon(h.id)} className="min-h-11 shrink-0 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-sm font-medium text-emerald-800">
                          {t("In list ✓", "En la lista ✓")}
                        </button>
                      ) : (
                        <button type="button" disabled={agregando} onClick={() => agregar([h.id])} className="min-h-11 shrink-0 rounded-lg bg-clay-600 px-3 text-sm font-medium text-white disabled:opacity-50">
                          {t("Add", "Agregar")}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      )}

      {lineas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          {t("No products yet. Search above and add the ones you have.", "Aún no hay productos. Busca arriba y agrega los que tienes.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {lineas.map((l) => {
            const texto = textos[l.id] ?? "";
            const leida = cantidadDesdeTexto(texto);
            const cantidadEscrita = leida.ok ? leida.valor : null;
            const dif = diferencia(l.system_qty, cantidadEscrita);
            const estado = estados[l.id];
            const contada = l.counted_qty !== null;
            return (
              <li
                key={l.id}
                id={`linea-${l.id}`}
                className={cn(
                  "min-w-0 rounded-xl border bg-white p-3 transition-colors",
                  resaltada === l.id ? "border-clay-500 ring-2 ring-clay-300" : contada || cantidadEscrita !== null ? "border-emerald-200" : "border-amber-300 bg-amber-50/40",
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="break-words font-medium text-slate-900">{l.name}</div>
                    <div className="font-mono text-xs text-slate-400">{l.sku}</div>
                    <div className="break-words text-xs text-slate-500">
                      {[l.vendor_name, l.category_path, l.base_unit].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  {!soloLectura && (
                    <button type="button" onClick={() => quitar(l.id)} aria-label={t(`Remove ${l.sku}`, `Quitar ${l.sku}`)} className="min-h-9 shrink-0 rounded-md px-2 text-xs text-slate-500 hover:bg-red-50 hover:text-red-700">
                      {t("Remove", "Quitar")}
                    </button>
                  )}
                </div>

                {soloLectura ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
                    <span>{t("Counted", "Contado")} <b>{cantidad(l.counted_qty)}</b></span>
                    <span className="text-slate-500">{t("System", "Sistema")} {cantidad(l.system_qty)}</span>
                    <span className={cn(diferencia(l.system_qty, l.counted_qty) ? "font-medium text-amber-700" : "text-slate-400")}>
                      {t("Difference", "Diferencia")} {signo(diferencia(l.system_qty, l.counted_qty))}
                    </span>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      ref={(el) => { inputs.current[l.id] = el; }}
                      inputMode="decimal"
                      enterKeyHint="done"
                      value={texto}
                      onChange={(e) => escribir(l.id, e.target.value)}
                      onBlur={() => salirDelCampo(l.id)}
                      placeholder={t("Count", "Contado")}
                      aria-label={t(`Counted quantity for ${l.sku}`, `Cantidad contada de ${l.sku}`)}
                      className="h-14 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-right text-2xl font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-clay-500"
                    />
                    <SenalDeGuardado estado={estado} contada={contada} texto={texto} onReintentar={() => guardar(l.id, texto)} t={t} />
                  </div>
                )}

                {!soloLectura && cantidadEscrita !== null && l.system_qty !== null && (
                  <div className="mt-2 flex flex-wrap gap-x-4 text-sm tabular-nums">
                    <span className="text-slate-500">{t("System", "Sistema")} <b className="text-slate-700">{cantidad(l.system_qty)}</b></span>
                    <span className={cn(dif ? "font-medium text-amber-700" : "text-slate-400")}>{t("Difference", "Diferencia")} <b>{signo(dif)}</b></span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!soloLectura && lineas.length > 0 && (
        <section className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          {resumen.sinContar > 0 && (
            <p className="text-sm text-amber-700">
              {t(`${resumen.sinContar} lines still not counted. Count them or remove them to submit.`, `Faltan ${resumen.sinContar} renglones por contar. Cuéntalos o quítalos para enviar.`)}
            </p>
          )}
          {pendientes > 0 && (
            <p className="text-xs text-slate-500">{t("Some counts are not saved yet — they are saved when you leave the box.", "Hay conteos sin guardar: se guardan al salir de la casilla.")}</p>
          )}
          {confirmaEnvio ? (
            <div className="space-y-2">
              <p className="text-sm">
                {t(`Submit ${resumen.total} counted lines? They are recorded as cycle counts for review and the list becomes read-only.`,
                   `¿Enviar los ${resumen.total} renglones contados? Se registran como conteos cíclicos para revisión y la lista queda de solo lectura.`)}
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={enviando} onClick={enviar} className="min-h-11 rounded-lg bg-clay-600 px-4 text-sm font-medium text-white disabled:opacity-50">
                  {enviando ? t("Submitting…", "Enviando…") : t("Yes, submit", "Sí, enviar")}
                </button>
                <button type="button" disabled={enviando} onClick={() => setConfirmaEnvio(false)} className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm">{t("Cancel", "Cancelar")}</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!puedeEnviar(resumen).ok || enviando}
              onClick={() => setConfirmaEnvio(true)}
              className="min-h-11 w-full rounded-lg bg-clay-600 px-4 text-sm font-medium text-white hover:bg-clay-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t("Submit count", "Enviar conteo")}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

function signo(n: number | null) {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${Number(n).toLocaleString()}`;
}

function etiquetaDeCampo(campo: CampoDeBusqueda, t: (en: string, es: string) => string): string {
  const etiquetas: Record<CampoDeBusqueda, string> = {
    sku: "SKU",
    name: t("Name", "Nombre"),
    vendor_name: t("Supplier", "Proveedor"),
    category_path: t("Category", "Categoría"),
    product_type: t("Type", "Tipo"),
    mpn: "MPN",
    collection: t("Collection", "Colección"),
    size_in: t("Size", "Tamaño"),
    finish: t("Finish", "Acabado"),
    material: t("Material", "Material"),
    color1: t("Color", "Color"),
    color2: t("Color 2", "Color 2"),
    style: t("Style", "Estilo"),
    look: t("Look", "Look"),
    origin: t("Origin", "Origen"),
    description: t("Description", "Descripción"),
  };
  return etiquetas[campo];
}

function SenalDeGuardado({
  estado, contada, texto, onReintentar, t,
}: {
  estado: Estado | undefined; contada: boolean; texto: string; onReintentar: () => void; t: (en: string, es: string) => string;
}) {
  if (estado === "error") {
    return (
      <button type="button" onClick={onReintentar} className="min-h-11 shrink-0 rounded-lg border border-red-300 bg-red-50 px-2 text-xs font-medium text-red-700">
        {t("Not saved · retry", "No guardado · reintentar")}
      </button>
    );
  }
  if (estado === "guardando") return <span className="shrink-0 text-xs text-slate-500">{t("Saving…", "Guardando…")}</span>;
  if (estado === "pendiente") return <span className="shrink-0 text-xs font-medium text-amber-700">{t("Unsaved", "Sin guardar")}</span>;
  if (contada || texto.trim() !== "") return <span className="shrink-0 text-xs font-medium text-emerald-700">{t("Saved ✓", "Guardado ✓")}</span>;
  return <span className="shrink-0 text-xs text-slate-400">{t("Not counted", "Sin contar")}</span>;
}

function Aviso({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  return (
    <p role={kind === "err" ? "alert" : "status"} className={cn("rounded-md border p-3 text-sm",
      kind === "ok" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>
      {children}
    </p>
  );
}
