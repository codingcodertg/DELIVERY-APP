"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CampoDecimal } from "@/components/CampoDecimal";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { dinero } from "@/lib/estimator/modelo";
import {
  MOTIVOS_DE_PERDIDA, TOPES_DE_PERDIDA, UNIDADES_DE_PERDIDA, csvDePerdidas, faltaEnPerdida,
  metaDePerdidaVacia, puedeQuitarPerdida, resumenDePerdidas,
  type AlmacenDePerdidas, type FiltroDePerdidas, type MetaDePerdida, type MotivoDePerdida, type UnidadDePerdida, type VentaPerdida,
} from "@/lib/estimator/ventas-perdidas";
import { downloadCSV, shiftDateISO, todayISO } from "@/lib/utils";

type T = (en: string, es: string) => string;
type Yo = { id: string; name: string; admin: boolean; store?: string | null };

/** El rótulo de cada motivo, en el idioma de quien mira (y en el CSV). */
export function rotuloDeMotivo(m: MotivoDePerdida, t: T): string {
  switch (m) {
    case "out_of_stock": return t("Out of stock", "Sin existencia");
    case "not_enough_stock": return t("Not enough stock", "No había suficiente");
    case "discontinued": return t("Discontinued", "Descontinuado");
    default: return t("Other", "Otro");
  }
}

/** El rótulo de cada unidad. «SF» se queda igual en los dos idiomas: es la medida de la casa. */
export function rotuloDeUnidad(u: UnidadDePerdida | null, t: T): string {
  switch (u) {
    case "SF": return "SF";
    case "boxes": return t("boxes", "cajas");
    case "pieces": return t("pieces", "piezas");
    case "bags": return t("bags", "bolsas");
    case "other": return t("other", "otra");
    default: return "";
  }
}

/** Lo que dice la base cuando la 308 no está: la tabla no existe (los códigos de siempre). */
export function AvisoSin308({ t }: { t: T }) {
  return (
    <div className="est-aviso ambar" data-perdidas-sin-308>
      {t(
        "Not available yet: the database has not been updated (migration 308). Nothing can be recorded or listed until it is applied.",
        "Todavía no disponible: la base no está actualizada (migración 308). No se puede anotar ni listar nada hasta que se aplique.",
      )}
    </div>
  );
}

/**
 * La pestaña «Lost sales / Ventas perdidas» (migración 308): lo que el cliente quiso y no había. Arriba, anotar una;
 * abajo, la lista con filtros de fecha y tienda, los totales y el CSV. Quién ve y quién borra lo decide la 308; aquí
 * solo se pinta lo que la base devuelve.
 */
export function VentasPerdidas({ almacen, me, tiendas, tiendaDePartida, t }: {
  almacen: AlmacenDePerdidas; me: Yo; tiendas: string[]; tiendaDePartida: string; t: T;
}) {
  const hoy = useMemo(() => todayISO(), []);
  const [estado, setEstado] = useState<"cargando" | "sin-308" | "lista">("cargando");
  const [filas, setFilas] = useState<VentaPerdida[]>([]);
  const [filtro, setFiltro] = useState<FiltroDePerdidas>(() => ({ desde: shiftDateISO(hoy, -30), hasta: hoy, tienda: "" }));
  const [meta, setMeta] = useState<MetaDePerdida>(() => metaDePerdidaVacia(tiendaDePartida, hoy));
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  // La tienda del perfil llega después (en demo, «Ver como»): se pone mientras nadie haya elegido otra.
  useEffect(() => { setMeta((m) => (m.store ? m : { ...m, store: tiendaDePartida })); }, [tiendaDePartida]);

  const cargar = useCallback(async () => {
    const r = await almacen.listar(filtro);
    if (r.ok) { setFilas(r.valor); setEstado("lista"); return; }
    if (r.sinTabla) { setEstado("sin-308"); return; }
    setEstado("lista");
    setError(`${t("Could not read the lost sales", "No se pudieron leer las ventas perdidas")}: ${r.error}`);
  }, [almacen, filtro, t]);
  useEffect(() => { void cargar(); }, [cargar]);

  const tiendasDelFiltro = useMemo(
    () => [...new Set([...tiendas, ...filas.map((p) => p.store ?? "").filter(Boolean)])],
    [tiendas, filas],
  );
  const resumen = useMemo(() => resumenDePerdidas(filas), [filas]);

  const anotar = async () => {
    const falta = faltaEnPerdida(meta);
    if (falta === "articulo") { setError(t("Write the item that was not in stock.", "Escribe el artículo que no había.")); return; }
    if (falta === "fecha") { setError(t("Pick the date of the sale.", "Elige la fecha de la venta.")); return; }
    setOcupado(true);
    setError(null);
    setHecho(null);
    const r = await almacen.anotar(meta);
    setOcupado(false);
    if (!r.ok) {
      if (r.sinTabla) { setEstado("sin-308"); return; }
      setError(`${t("Not saved", "No se guardó")}: ${r.error}`);
      return;
    }
    setMeta(metaDePerdidaVacia(meta.store, meta.sale_date));
    setHecho(t("Saved. It is in the list below.", "Guardada. Está en la lista de abajo."));
    await cargar();
  };

  const quitar = async (p: VentaPerdida) => {
    if (!puedeQuitarPerdida(p, me)) return;
    setOcupado(true);
    const r = await almacen.quitar(p);
    setOcupado(false);
    setConfirmando(null);
    if (!r.ok) { setError(`${t("Not removed", "No se quitó")}: ${r.error}`); return; }
    setHecho(t("Removed.", "Quitada."));
    await cargar();
  };

  const bajarCsv = () => {
    const { nombre, csv } = csvDePerdidas(filas, {
      motivo: (m) => rotuloDeMotivo(m, t),
      cabeceras: [
        t("Date", "Fecha"), t("Store", "Tienda"), t("Sales rep", "Vendedor"), t("Item", "Artículo"),
        t("Qty", "Cantidad"), t("Unit", "Unidad"), t("Reason", "Motivo"), t("Est. value", "Valor est."),
        t("Customer", "Cliente"), t("Notes", "Notas"),
      ],
    }, hoy);
    downloadCSV(nombre, csv);
  };

  const columnas: ColumnaEstandar<VentaPerdida>[] = [
    { key: "fecha", en: "Date", es: "Fecha", valor: (p) => p.sale_date, ancho: 110 },
    { key: "tienda", en: "Store", es: "Tienda", valor: (p) => p.store, ancho: 110 },
    { key: "vendedor", en: "Sales rep", es: "Vendedor", valor: (p) => p.created_by_name, ancho: 130 },
    { key: "articulo", en: "Item", es: "Artículo", valor: (p) => p.item, ancho: 240 },
    { key: "cantidad", en: "Qty", es: "Cantidad", valor: (p) => p.quantity, numerico: true, ancho: 90 },
    { key: "unidad", en: "Unit", es: "Unidad", valor: (p) => rotuloDeUnidad(p.unit, t), ancho: 80 },
    { key: "motivo", en: "Reason", es: "Motivo", valor: (p) => rotuloDeMotivo(p.reason, t), ancho: 150 },
    { key: "valor", en: "Est. value", es: "Valor est.", valor: (p) => p.est_value, numerico: true, celda: (p) => (p.est_value === null ? "—" : dinero(p.est_value)), ancho: 110 },
    { key: "cliente", en: "Customer", es: "Cliente", valor: (p) => p.customer, ancho: 150, oculta: true },
    { key: "notas", en: "Notes", es: "Notas", valor: (p) => p.notes, ancho: 240, envuelve: true, oculta: true },
  ];

  const totales = {
    fecha: `${resumen.filas} ${t("lost", "perdidas")}`,
    valor: dinero(resumen.dinero),
  };

  return (
    <div data-pestana-perdidas={estado}>
      <div className="card">
        <h2>📉 {t("Lost sales", "Ventas perdidas")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            "Record what a customer wanted and we did not have in stock. Every sales rep with the Quote Builder can see the list.",
            "Anota lo que un cliente quiso y no teníamos en existencia. Todo vendedor con el Quote Builder ve la lista.",
          )}
        </p>
        {estado === "sin-308" && <AvisoSin308 t={t} />}
        {error && <div className="est-aviso rojo" data-perdidas-error>{error}</div>}
        {hecho && <div className="est-aviso verde" data-perdidas-hecho>{hecho}</div>}
        {estado === "lista" && (
          <form data-perdidas-form onSubmit={(e) => { e.preventDefault(); void anotar(); }}>
            <div className="grid g3">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="perdida-articulo">{t("Item (name, SKU or description)", "Artículo (nombre, SKU o descripción)")}</label>
                <input id="perdida-articulo" value={meta.item} maxLength={TOPES_DE_PERDIDA.articulo} data-perdida-articulo
                  className={error && !meta.item.trim() ? "invalid" : undefined}
                  onChange={(e) => setMeta({ ...meta, item: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="perdida-cantidad">{t("Quantity", "Cantidad")}</label>
                <CampoDecimal id="perdida-cantidad" inputMode="decimal" data-perdida-cantidad value={meta.quantity}
                  onValor={(n) => setMeta({ ...meta, quantity: n })} />
              </div>
              <div className="field">
                <label htmlFor="perdida-unidad">{t("Unit", "Unidad")}</label>
                <select id="perdida-unidad" value={meta.unit} data-perdida-unidad onChange={(e) => setMeta({ ...meta, unit: e.target.value as UnidadDePerdida | "" })}>
                  <option value="">—</option>
                  {UNIDADES_DE_PERDIDA.map((u) => <option key={u} value={u}>{rotuloDeUnidad(u, t)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="perdida-tienda">{t("Store", "Tienda")}</label>
                <select id="perdida-tienda" value={meta.store} data-perdida-tienda onChange={(e) => setMeta({ ...meta, store: e.target.value })}>
                  <option value="">{t("— No store —", "— Sin tienda —")}</option>
                  {tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="perdida-fecha">{t("Date of the sale", "Fecha de la venta")}</label>
                <input id="perdida-fecha" type="date" value={meta.sale_date} data-perdida-fecha onChange={(e) => setMeta({ ...meta, sale_date: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="perdida-motivo">{t("Reason", "Motivo")}</label>
                <select id="perdida-motivo" value={meta.reason} data-perdida-motivo onChange={(e) => setMeta({ ...meta, reason: e.target.value as MotivoDePerdida })}>
                  {MOTIVOS_DE_PERDIDA.map((m) => <option key={m} value={m}>{rotuloDeMotivo(m, t)}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="perdida-valor">{t("Est. $ lost (optional)", "$ perdidos est. (opcional)")}</label>
                <CampoDecimal id="perdida-valor" data-perdida-valor value={meta.est_value}
                  onValor={(n) => setMeta({ ...meta, est_value: n })} />
              </div>
              <div className="field">
                <label htmlFor="perdida-cliente">{t("Customer (optional)", "Cliente (opcional)")}</label>
                <input id="perdida-cliente" value={meta.customer} maxLength={TOPES_DE_PERDIDA.cliente} data-perdida-cliente
                  onChange={(e) => setMeta({ ...meta, customer: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="perdida-notas">{t("Notes (optional)", "Notas (opcional)")}</label>
                <input id="perdida-notas" value={meta.notes} maxLength={TOPES_DE_PERDIDA.notas} data-perdida-notas
                  onChange={(e) => setMeta({ ...meta, notes: e.target.value })} />
              </div>
            </div>
            <div className="est-acciones" style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-primary btn-sm" data-perdida-guardar disabled={ocupado || !meta.item.trim()}>
                {t("Save lost sale", "Guardar venta perdida")}
              </button>
            </div>
          </form>
        )}
      </div>

      {estado === "lista" && (
        <div className="card">
          <h2>📋 {t("Lost sales list", "Lista de ventas perdidas")} <span className="hint">({filas.length})</span></h2>
          <div className="grid g3" style={{ marginBottom: 10 }}>
            <div className="field">
              <label htmlFor="perdida-desde">{t("From", "Desde")}</label>
              <input id="perdida-desde" type="date" value={filtro.desde} data-filtro-desde
                onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="perdida-hasta">{t("To", "Hasta")}</label>
              <input id="perdida-hasta" type="date" value={filtro.hasta} data-filtro-hasta
                onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="perdida-filtro-tienda">{t("Store", "Tienda")}</label>
              <select id="perdida-filtro-tienda" value={filtro.tienda} data-filtro-tienda onChange={(e) => setFiltro({ ...filtro, tienda: e.target.value })}>
                <option value="">{t("All stores", "Todas las tiendas")}</option>
                {tiendasDelFiltro.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="grid g3" style={{ marginBottom: 12 }} data-perdidas-resumen>
            <div className="field">
              <span className="hint">{t("Lost sales in range", "Ventas perdidas en el rango")}</span>
              <div><b data-resumen-filas>{resumen.filas}</b></div>
            </div>
            <div className="field">
              <span className="hint">{t("Est. $ lost", "$ perdidos est.")}</span>
              <div><b data-resumen-dinero>{dinero(resumen.dinero)}</b> <span className="hint">({resumen.conValor} {t("with a value", "con valor")})</span></div>
            </div>
            <div className="field">
              <span className="hint">{t("Top items (times asked)", "Artículos que más faltaron (veces)")}</span>
              <div data-resumen-top>
                {resumen.topArticulos.length
                  ? resumen.topArticulos.map((a) => <div key={a.articulo}>{a.articulo} <span className="hint">· {a.filas}</span></div>)
                  : <span className="hint">—</span>}
              </div>
            </div>
          </div>
          {resumen.porTienda.length > 0 && (
            <p className="hint" style={{ marginTop: 0 }} data-resumen-tiendas>
              {t("By store", "Por tienda")}: {resumen.porTienda.map((s) => `${s.tienda} ${s.filas} · ${dinero(s.dinero)}`).join("  |  ")}
            </p>
          )}

          <div className="est-acciones" style={{ marginBottom: 8 }}>
            <button type="button" className="btn btn-sm" data-accion="exportar-csv" disabled={!filas.length} onClick={bajarCsv}>
              ⬇ {t("Export CSV", "Exportar CSV")} <span className="cnt">{filas.length}</span>
            </button>
          </div>

          {filas.length === 0 ? (
            <p className="hint" data-perdidas-vacia>
              {filtro.tienda || filtro.desde || filtro.hasta
                ? t("Nothing matches the filter.", "Nada coincide con el filtro.")
                : t("No lost sales recorded yet.", "Todavía no hay ventas perdidas anotadas.")}
            </p>
          ) : (
            <TablaEstandar<VentaPerdida>
              id="ventas-perdidas" data-tabla="ventas-perdidas" sinCaja
              filas={filas} claveDe={(p) => p.id} columnas={columnas}
              ordenInicial={{ clave: "fecha", direccion: "desc" }}
              totales={totales}
              anchoDeAcciones={130}
              acciones={(p) => (puedeQuitarPerdida(p, me) ? (confirmando === p.id ? (
                <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
                  <button type="button" className="btn btn-danger btn-sm" data-perdida-confirmar disabled={ocupado} onClick={() => void quitar(p)}>
                    {t("Yes, remove", "Sí, quitar")}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmando(null)}>{t("Cancel", "Cancelar")}</button>
                </span>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm" data-perdida-quitar disabled={ocupado} onClick={() => setConfirmando(p.id)}>
                  ✕ {t("Remove", "Quitar")}
                </button>
              )) : null)}
            />
          )}
          <p className="hint" style={{ marginBottom: 0 }}>
            {t("Removing only hides the row (kept for the record). You can remove your own, or any if you are admin.",
              "Quitar solo la oculta (queda el registro). Puedes quitar las tuyas, o cualquiera si eres admin.")}
          </p>
        </div>
      )}
    </div>
  );
}
