"use client";

import { useEffect, useState } from "react";
import { CampoDecimal } from "@/components/CampoDecimal";
import { dinero, numero } from "@/lib/estimator/modelo";
import { TOPES_DE_TEXTO } from "@/lib/estimator/competencia";
import {
  TOPES_DE_LECTURA, diferenciaDePrecio, lecturaEnBlanco, lecturaVacia, lineaEmparejada, mensajeDeLectura, productoVacio,
  type AlmacenDeLecturas, type LecturaDeCompetencia, type LecturaGuardada, type LineaPropia, type ProductoDeCompetencia,
} from "@/lib/estimator/lectura";

type T = (en: string, es: string) => string;

/** La lista de empresas ya usadas, para todos los campos «Empresa competidora» de la pantalla (`list=`). */
export const LISTA_DE_COMPETIDORES = "est-competidores";

export function ListaDeCompetidores({ nombres }: { nombres: string[] }) {
  return (
    <datalist id={LISTA_DE_COMPETIDORES} data-competidores>
      {nombres.map((n) => <option key={n} value={n} />)}
    </datalist>
  );
}

/** Sin la 161: no hay dónde guardar los productos, y se dice. El archivo se sigue viendo y abriendo. */
export function AvisoSin161({ t }: { t: T }) {
  return (
    <p className="hint" data-productos-sin-161>
      {t(
        "Products are not available yet: the database has not been updated (migration 161). The file itself still opens.",
        "Los productos todavía no están disponibles: falta actualizar la base (migración 161). El archivo se sigue abriendo.",
      )}
    </p>
  );
}

const precio = (n: number | null) => (n === null ? "—" : `$${numero(n, Number.isInteger(n * 100) ? 2 : 4)}`);

/** Lo nuestro al lado de lo suyo, cuando el vendedor emparejó la fila. La diferencia solo con la misma unidad. */
export function LadoALado({ p, propia, t }: { p: ProductoDeCompetencia; propia: LineaPropia; t: T }) {
  const dif = diferenciaDePrecio(p, propia);
  return (
    <div className="est-prod-lado" data-lado-a-lado={p.id}>
      <span data-suyo>{t("Theirs", "Suyo")}: <b>{precio(p.unit_price)}</b>{p.unit ? ` / ${p.unit}` : ""} · {t("total", "total")} <b>{p.line_total === null ? "—" : dinero(p.line_total)}</b></span>
      <span data-nuestro>{t("Ours", "Nuestro")} ({propia.etiqueta}): <b>{precio(propia.precio)}</b>{propia.unidad ? ` / ${propia.unidad}` : ""} · {t("total", "total")} <b>{propia.total === null ? "—" : dinero(propia.total)}</b></span>
      {dif !== null && (
        <span data-diferencia className={dif > 0 ? "est-prod-caro" : dif < 0 ? "est-prod-barato" : undefined}>
          {dif === 0 ? t("Same unit price", "Mismo precio unitario")
            : dif > 0 ? t(`We are ${precio(dif)} / ${p.unit} higher`, `Estamos ${precio(dif)} / ${p.unit} más caros`)
            : t(`We are ${precio(-dif)} / ${p.unit} lower`, `Estamos ${precio(-dif)} / ${p.unit} más baratos`)}
        </span>
      )}
    </div>
  );
}

/**
 * La tabla de productos del estimado de la competencia. `editable`: campos para corregir, añadir y quitar filas. Si
 * no, solo se lee. Con `propias` (dentro de una cotización) cada fila se puede emparejar **a mano** con una línea
 * propia, y entonces sale lado a lado. Aparte para pintarla en una prueba sin navegador.
 */
export function TablaDeProductos({ lectura, editable, propias, t, onFila, onQuitar }: {
  lectura: LecturaDeCompetencia; editable: boolean; propias?: LineaPropia[]; t: T;
  onFila?: (id: string, patch: Partial<ProductoDeCompetencia>) => void; onQuitar?: (id: string) => void;
}) {
  if (!lectura.items.length) {
    return <p className="hint" data-productos-vacia>{t("No products yet.", "Todavía no hay productos.")}</p>;
  }
  const txt = (p: ProductoDeCompetencia, k: "description" | "brand" | "sku" | "unit", tope: number, ancho: number) => (
    editable
      ? <input value={p[k] ?? ""} maxLength={tope} style={{ minWidth: ancho }} data-prod={k}
          onChange={(e) => onFila?.(p.id, { [k]: e.target.value || null })} />
      : <span data-prod={k}>{p[k] ?? "—"}</span>
  );
  const num = (p: ProductoDeCompetencia, k: "quantity" | "unit_price" | "line_total") => (
    editable
      ? <CampoDecimal value={p[k]} style={{ minWidth: 80 }} data-prod={k} onValor={(v) => onFila?.(p.id, { [k]: v })} />
      : <span data-prod={k}>{p[k] === null ? "—" : k === "quantity" ? numero(p[k]!, Number.isInteger(p[k]!) ? 0 : 2) : k === "unit_price" ? precio(p[k]) : dinero(p[k]!)}</span>
  );
  return (
    <div className="est-prod-tabla" data-productos-tabla>
      <table>
        <thead>
          <tr>
            <th>{t("Description", "Descripción")}</th>
            <th>{t("Brand", "Marca")}</th>
            <th>SKU</th>
            <th>{t("Qty", "Cant.")}</th>
            <th>{t("Unit", "Unidad")}</th>
            <th>{t("Unit price", "Precio unit.")}</th>
            <th>{t("Line total", "Total línea")}</th>
            {propias && <th>{t("Our line", "Nuestra línea")}</th>}
            {editable && <th />}
          </tr>
        </thead>
        <tbody>
          {lectura.items.map((p) => {
            const propia = propias ? lineaEmparejada(p, propias) : null;
            return [
              <tr key={p.id} data-producto={p.id}>
                <td>{txt(p, "description", TOPES_DE_LECTURA.descripcion, 180)}</td>
                <td>{txt(p, "brand", TOPES_DE_LECTURA.marca, 90)}</td>
                <td>{txt(p, "sku", TOPES_DE_LECTURA.sku, 90)}</td>
                <td>{num(p, "quantity")}</td>
                <td>{txt(p, "unit", TOPES_DE_LECTURA.unidad, 60)}</td>
                <td>{num(p, "unit_price")}</td>
                <td>{num(p, "line_total")}</td>
                {propias && (
                  <td>
                    {editable ? (
                      <select value={propia?.id ?? ""} data-emparejar style={{ minWidth: 140 }}
                        onChange={(e) => onFila?.(p.id, { matched_line_id: e.target.value || null })}>
                        <option value="">{t("— not matched —", "— sin emparejar —")}</option>
                        {propias.map((l) => <option key={l.id} value={l.id}>{l.etiqueta}</option>)}
                      </select>
                    ) : (propia?.etiqueta ?? "—")}
                  </td>
                )}
                {editable && (
                  <td><button type="button" className="btn btn-danger btn-sm" data-prod-quitar title={t("Remove row", "Quitar fila")} onClick={() => onQuitar?.(p.id)}>✕</button></td>
                )}
              </tr>,
              propia && (
                <tr key={`${p.id}-lado`} className="est-prod-fila-lado">
                  <td colSpan={8 + (editable ? 1 : 0)}><LadoALado p={p} propia={propia} t={t} /></td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Los productos de UN estimado de la competencia (D-NEXT): «Leer productos» pide la lectura al servidor y la deja en
 * la tabla **sin guardar**; se corrige, se añaden o quitan filas, y «Guardar». Sin la llave de la API (o si la lectura
 * falla) se dice por qué y la tabla sigue ahí para teclear a mano. Interno: nada de esto llega a la hoja del cliente.
 */
export function ProductosDeCompetencia({ archivo, almacen, guardada, puedeEditar, propias, t, onGuardada, onSin161 }: {
  archivo: { id: string; competitor: string | null; competitor_total: number | null };
  almacen: AlmacenDeLecturas; guardada: LecturaGuardada | null; puedeEditar: boolean; propias?: LineaPropia[]; t: T;
  onGuardada: (l: LecturaGuardada) => void; onSin161: () => void;
}) {
  const dePartida = (): LecturaDeCompetencia =>
    guardada ?? { ...lecturaVacia(), competitor: archivo.competitor, total: archivo.competitor_total };
  const [borrador, setBorrador] = useState<LecturaDeCompetencia>(dePartida);
  /** Cambia cuando la tabla se reemplaza entera (una lectura): los campos de número se vuelven a montar con lo nuevo. */
  const [version, setVersion] = useState(0);
  const [sucio, setSucio] = useState(false);
  const [leyendo, setLeyendo] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "verde" | "ambar" | "rojo"; texto: string } | null>(null);

  // Llega (o cambia) lo guardado y aquí no hay nada a medias: se enseña lo guardado.
  useEffect(() => {
    if (sucio) return;
    setBorrador(guardada ?? { ...lecturaVacia(), competitor: archivo.competitor, total: archivo.competitor_total });
    setVersion((v) => v + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guardada]);

  const cambia = (patch: Partial<LecturaDeCompetencia>) => { setBorrador((b) => ({ ...b, ...patch })); setSucio(true); };
  const fila = (id: string, patch: Partial<ProductoDeCompetencia>) =>
    cambia({ items: borrador.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const leer = async () => {
    if (!puedeEditar || leyendo) return;
    setLeyendo(true);
    setAviso(null);
    const r = await almacen.leer(archivo.id);
    setLeyendo(false);
    if (!r.ok) {
      if (r.codigo === "sin-161") { onSin161(); return; }
      setAviso({ tipo: r.codigo === "sin-llave" || r.codigo === "tope" ? "ambar" : "rojo", texto: mensajeDeLectura(r.codigo, r.error, t) });
      return;
    }
    // Lo leído reemplaza la tabla; la empresa y el total escritos al subir se quedan si el papel no los trae.
    setBorrador({ ...r.lectura, competitor: r.lectura.competitor ?? borrador.competitor, total: r.lectura.total ?? borrador.total });
    setVersion((v) => v + 1);
    setSucio(true);
    setAviso({
      tipo: "verde",
      texto: t(
        `Read ${r.lectura.items.length} product(s). Check them against the document, fix what is wrong, then Save. Blank fields could not be read.`,
        `Se leyeron ${r.lectura.items.length} producto(s). Compáralos con el documento, corrige lo que esté mal y pulsa Guardar. Los campos en blanco no se pudieron leer.`,
      ),
    });
  };

  const guardar = async () => {
    if (!puedeEditar || guardando || lecturaEnBlanco(borrador)) return;
    setGuardando(true);
    const r = await almacen.guardar(archivo.id, borrador);
    setGuardando(false);
    if (!r.ok) {
      if (r.sinTabla) { onSin161(); return; }
      setAviso({ tipo: "rojo", texto: `${t("Not saved", "No se guardó")}: ${r.error}` });
      return;
    }
    setSucio(false);
    setAviso({ tipo: "verde", texto: t("Saved.", "Guardado.") });
    onGuardada(r.valor);
  };

  const lleno = borrador.items.length >= TOPES_DE_LECTURA.maxProductos;

  return (
    <div className="est-productos" data-productos={archivo.id}>
      {aviso && <div className={`est-aviso ${aviso.tipo}`} data-productos-aviso>{aviso.texto}</div>}

      {puedeEditar ? (
        <>
          <div className="est-acciones" style={{ marginBottom: 10 }}>
            <button type="button" className="btn btn-primary btn-sm" data-leer-productos disabled={leyendo || guardando} onClick={() => void leer()}>
              {leyendo ? t("Reading…", "Leyendo…")
                : borrador.items.length ? `🔎 ${t("Read again (replaces the table)", "Leer otra vez (reemplaza la tabla)")}`
                : `🔎 ${t("Read products", "Leer productos")}`}
            </button>
            <span className="hint">{t("Reads the document and fills the table. Or type the products by hand.", "Lee el documento y llena la tabla. O teclea los productos a mano.")}</span>
          </div>
          <div className="grid g3" key={`cab-${version}`}>
            <div className="field">
              <label>{t("Competitor company", "Empresa competidora")}</label>
              <input value={borrador.competitor ?? ""} maxLength={TOPES_DE_TEXTO.competidor} list={LISTA_DE_COMPETIDORES} data-lectura-empresa
                onChange={(e) => cambia({ competitor: e.target.value || null })} />
            </div>
            <div className="field">
              <label>{t("Document date", "Fecha del documento")}</label>
              <input type="date" value={borrador.doc_date ?? ""} data-lectura-fecha onChange={(e) => cambia({ doc_date: e.target.value || null })} />
            </div>
            <div className="field">
              <label>{t("Their estimate #", "Su # de estimado")}</label>
              <input value={borrador.doc_number ?? ""} maxLength={TOPES_DE_LECTURA.numeroDeDocumento} data-lectura-numero
                onChange={(e) => cambia({ doc_number: e.target.value || null })} />
            </div>
            <div className="field">
              <label>{t("Subtotal $", "Subtotal $")}</label>
              <CampoDecimal value={borrador.subtotal} data-lectura-subtotal onValor={(v) => cambia({ subtotal: v })} />
            </div>
            <div className="field">
              <label>{t("Tax $", "Impuesto $")}</label>
              <CampoDecimal value={borrador.tax} data-lectura-impuesto onValor={(v) => cambia({ tax: v })} />
            </div>
            <div className="field">
              <label>{t("Total $", "Total $")}</label>
              <CampoDecimal value={borrador.total} data-lectura-total onValor={(v) => cambia({ total: v })} />
            </div>
          </div>
        </>
      ) : (
        <div className="est-comp-meta" data-lectura-cabecera style={{ marginBottom: 8 }}>
          {borrador.competitor && <span>{t("Competitor company", "Empresa competidora")}: <b>{borrador.competitor}</b></span>}
          {borrador.doc_date && <span>{t("Date", "Fecha")}: {borrador.doc_date}</span>}
          {borrador.doc_number && <span>#{borrador.doc_number}</span>}
          {borrador.subtotal !== null && <span>{t("Subtotal", "Subtotal")}: {dinero(borrador.subtotal)}</span>}
          {borrador.tax !== null && <span>{t("Tax", "Impuesto")}: {dinero(borrador.tax)}</span>}
          {borrador.total !== null && <span>{t("Total", "Total")}: <b>{dinero(borrador.total)}</b></span>}
        </div>
      )}

      <TablaDeProductos key={`tabla-${version}`} lectura={borrador} editable={puedeEditar} propias={propias} t={t}
        onFila={fila} onQuitar={(id) => cambia({ items: borrador.items.filter((p) => p.id !== id) })} />

      {puedeEditar && (
        <div className="est-acciones" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" data-prod-anadir disabled={lleno}
            onClick={() => cambia({ items: [...borrador.items, productoVacio()] })}>
            + {t("Add row", "Añadir fila")}
          </button>
          <button type="button" className="btn btn-primary btn-sm" data-guardar-productos
            disabled={guardando || leyendo || !sucio || lecturaEnBlanco(borrador)} onClick={() => void guardar()}>
            💾 {guardando ? t("Saving…", "Guardando…") : t("Save", "Guardar")}
          </button>
          {sucio && <span className="hint" data-productos-sucio>{t("Not saved yet.", "Sin guardar todavía.")}</span>}
          {guardada && !sucio && (
            <span className="hint">{t("Saved by", "Guardado por")} {guardada.saved_by_name ?? "?"}{guardada.source === "ocr" ? ` · ${t("read automatically, reviewed by hand", "leído automáticamente, revisado a mano")}` : ""}</span>
          )}
        </div>
      )}
    </div>
  );
}
