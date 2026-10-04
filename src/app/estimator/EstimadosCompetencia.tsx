"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CampoDecimal } from "@/components/CampoDecimal";
import { dinero } from "@/lib/estimator/modelo";
import {
  LIMITES_DE_COMPETENCIA, TOPES_DE_TEXTO, faltaEnSuelto, filtraEstimados, masNuevoPrimero,
  mensajeDeCompetencia, metaSueltaVacia, puedeQuitar, tamanoLegible, validaArchivos,
  type AlmacenDeCompetencia, type EstimadoDeCompetencia, type MetaSuelta,
} from "@/lib/estimator/competencia";
import { competidoresUsados, empresaDe, totalDe, type AlmacenDeLecturas, type LecturaGuardada } from "@/lib/estimator/lectura";
import { BotonesDeArchivo } from "./Competencia";
import { AvisoSin161, LISTA_DE_COMPETIDORES, ListaDeCompetidores, ProductosDeCompetencia } from "./ProductosCompetencia";

type T = (en: string, es: string) => string;
type Yo = { id: string; name: string; admin: boolean; store?: string | null };

/** Sin la 156: la pestaña no puede listar ni subir sueltos, y lo dice. Aparte para probarlo sin navegador. */
export function AvisoSin156({ t }: { t: T }) {
  return (
    <p className="hint" data-competencia-sin-156>
      {t(
        "Not available yet: the database has not been updated (migration 156). Competitor estimates attached to a quote still work in the Quote tab.",
        "Todavía no disponible: falta actualizar la base (migración 156). Los estimados de la competencia pegados a una cotización siguen funcionando en la pestaña Cotización.",
      )}
    </p>
  );
}

/**
 * La lista de TODOS los estimados de la competencia (D-451): de quién es (cliente o # de estimado), tienda, competidor,
 * su total, nota, quién y cuándo, y el archivo. «Quitar» solo a quien lo subió o al admin (la misma regla que la 156).
 */
export function ListaDeEstimados({ estimados, me, t, lang, confirmando, ocupado, onAbrir, onQuitar, onConfirmar, filtrando = false, lecturas, abierto, onProductos, detalle }: {
  estimados: EstimadoDeCompetencia[]; me: Yo; t: T; lang: string; confirmando: string | null; ocupado: boolean;
  /** Hay filtro puesto: una lista vacía dice «nada coincide», no «no hay ninguno». */
  filtrando?: boolean;
  /** Los productos guardados de cada estimado (161, D-466): la fila dice la empresa, el total y cuántos son. */
  lecturas?: Record<string, LecturaGuardada>; abierto?: string | null; onProductos?: (id: string | null) => void;
  /** La tabla de productos del estimado abierto. */
  detalle?: (e: EstimadoDeCompetencia) => ReactNode;
  onAbrir: (e: EstimadoDeCompetencia) => void; onQuitar: (e: EstimadoDeCompetencia) => void; onConfirmar: (id: string | null) => void;
}) {
  if (!estimados.length) {
    return (
      <p className="hint" data-estimados-vacia>
        {filtrando ? t("Nothing matches the filter.", "Nada coincide con el filtro.") : t("No competitor estimates yet.", "Todavía no hay estimados de la competencia.")}
      </p>
    );
  }
  const fecha = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "medium", timeStyle: "short" });
  };
  return (
    <ul className="est-comp-lista" data-estimados-lista>
      {estimados.map((e) => (
        <li key={e.id} className="est-comp-item" data-estimado={e.id}>
          <div className="est-comp-cab">
            <b data-estimado-cliente>
              {e.customer_name ?? (e.estimate_num ? `${t("Estimate", "Estimado")} #${e.estimate_num}` : t("(no customer)", "(sin cliente)"))}
            </b>
            <span className="hint" data-estimado-tienda>{e.store ?? t("No store", "Sin tienda")}</span>
          </div>
          <div className="est-comp-meta">
            {e.customer_name && e.estimate_num && <span>{t("Estimate", "Estimado")} #<b>{e.estimate_num}</b></span>}
            {empresaDe(e, lecturas?.[e.id]) && <span>{t("Competitor", "Competidor")}: <b data-estimado-empresa>{empresaDe(e, lecturas?.[e.id])}</b></span>}
            {totalDe(e, lecturas?.[e.id]) !== null && <span>{t("Their total", "Su total")}: <b data-estimado-total>{dinero(totalDe(e, lecturas?.[e.id])!)}</b></span>}
            {lecturas?.[e.id] && <span data-estimado-n-productos>{lecturas[e.id].items.length} {t("product(s)", "producto(s)")}</span>}
            {e.note && <span>{t("Note", "Nota")}: {e.note}</span>}
            <span data-estimado-origen>{e.quote_id ? t("Attached to a quote", "Pegado a una cotización") : t("Uploaded on its own", "Subido suelto")}</span>
          </div>
          <div className="hint">{e.uploaded_by_name ?? "?"} · {fecha(e.uploaded_at)}</div>
          <div className="est-acciones" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" data-estimado-abrir onClick={() => onAbrir(e)}>
              {e.mime_type === "application/pdf" ? "📄" : "🖼️"} {e.file_name} · {tamanoLegible(e.size_bytes)}
            </button>
            {onProductos && (
              <button type="button" className={"btn btn-sm " + (abierto === e.id ? "btn-primary" : "btn-ghost")} data-estimado-productos
                aria-expanded={abierto === e.id} onClick={() => onProductos(abierto === e.id ? null : e.id)}>
                🧾 {t("Products", "Productos")}{lecturas?.[e.id] ? ` (${lecturas[e.id].items.length})` : ""}
              </button>
            )}
            {puedeQuitar(e, me) && (confirmando === e.id ? (
              <>
                <button type="button" className="btn btn-danger btn-sm" data-estimado-confirmar disabled={ocupado} onClick={() => onQuitar(e)}>
                  {t("Yes, remove", "Sí, quitar")}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onConfirmar(null)}>{t("Cancel", "Cancelar")}</button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost btn-sm" data-estimado-quitar disabled={ocupado} onClick={() => onConfirmar(e.id)}>
                ✕ {t("Remove", "Quitar")}
              </button>
            ))}
          </div>
          {abierto === e.id && detalle?.(e)}
        </li>
      ))}
    </ul>
  );
}

/**
 * La pestaña «Competitor estimates / Estimados de la competencia» (D-451). El dueño, 2026-09-29: «THE COMEPTITORS
 * ESTIMATE YOU CAN UPLOAD IT WITHOUT NEEDE TO CREATE AN ESTIMATE / AND I WANT IT TO SHOW ALL ESTIAMTES IN A TAB AND ALL
 * SALES REP COULD SEE IT». Arriba se sube uno **suelto** (sin cotización); abajo, **todos**, de todas las tiendas.
 * Quién ve lo decide la 156; esto solo pinta lo que la base devuelve. Interno: nada de aquí llega a la hoja del cliente.
 */
export function EstimadosCompetencia({ almacen, lecturas: almacenLecturas, me, tiendas, tiendaDePartida, t, lang }: {
  almacen: AlmacenDeCompetencia; me: Yo; tiendas: string[]; tiendaDePartida: string; t: T; lang: string;
  /** Dónde viven los productos de cada estimado (161) y quién los lee (D-466). */
  lecturas: AlmacenDeLecturas;
}) {
  /** null = aún no se sabe; false = falta la 161: la lista sigue, sin productos. */
  const [base161, setBase161] = useState<boolean | null>(null);
  const [lecturas, setLecturas] = useState<Record<string, LecturaGuardada>>({});
  const [abierto, setAbierto] = useState<string | null>(null);
  const [estado, setEstado] = useState<"cargando" | "sin-156" | "lista">("cargando");
  const [estimados, setEstimados] = useState<EstimadoDeCompetencia[]>([]);
  const [archivos, setArchivos] = useState<File[]>([]);
  const [meta, setMeta] = useState<MetaSuelta>(() => metaSueltaVacia(tiendaDePartida));
  const [filtro, setFiltro] = useState({ tienda: "", texto: "" });
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  // La tienda del perfil llega después (en demo, «Ver como»): se pone mientras nadie haya elegido otra.
  useEffect(() => { setMeta((m) => (m.store ? m : { ...m, store: tiendaDePartida })); }, [tiendaDePartida]);

  const cargar = useCallback(async () => {
    const r = await almacen.listarTodos();
    if (r.ok) {
      setEstimados(masNuevoPrimero(r.valor));
      setEstado("lista");
      const l = await almacenLecturas.cargar(r.valor.map((e) => e.id));
      if (l.ok) { setBase161(true); setLecturas(l.valor); }
      else if (l.sinTabla) setBase161(false);
      return;
    }
    if (r.sinTabla) { setEstado("sin-156"); return; }
    setEstado("lista");
    setError(`${t("Could not read the competitor estimates", "No se pudieron leer los estimados de la competencia")}: ${r.error}`);
  }, [almacen, almacenLecturas, t]);
  useEffect(() => { void cargar(); }, [cargar]);

  const visibles = useMemo(() => filtraEstimados(estimados, filtro), [estimados, filtro]);
  /** Las empresas ya escritas, al subir o al corregir una lectura: se ofrecen al teclear una nueva. */
  const competidores = useMemo(
    () => competidoresUsados([...estimados.map((e) => e.competitor), ...Object.values(lecturas).map((l) => l.competitor)]),
    [estimados, lecturas],
  );
  const tiendasDelFiltro = useMemo(
    () => [...new Set([...tiendas, ...estimados.map((e) => e.store ?? "").filter(Boolean)])],
    [tiendas, estimados],
  );

  const elegir = (lista: FileList | null) => {
    const nuevos = Array.from(lista ?? []);
    if (entrada.current) entrada.current.value = "";
    if (!nuevos.length) return;
    const juntos = [...archivos, ...nuevos];
    const fallo = validaArchivos(juntos, 0);
    if (fallo) { setError(mensajeDeCompetencia(fallo, t)); return; }
    setError(null);
    setArchivos(juntos);
  };

  const subir = async () => {
    if (!archivos.length || estado !== "lista") return;
    if (faltaEnSuelto(meta)) { setError(t("Write the customer's name.", "Escribe el nombre del cliente.")); return; }
    const fallo = validaArchivos(archivos, 0);
    if (fallo) { setError(mensajeDeCompetencia(fallo, t)); return; }
    setOcupado(true);
    setError(null);
    setHecho(null);
    const quedan: File[] = [];
    for (const f of archivos) {
      const r = await almacen.subirSuelto(me.id, f, meta);
      if (r.ok) continue;
      if (r.sinTabla) { setEstado("sin-156"); setOcupado(false); return; }
      quedan.push(f);
      setError(`${t("Not uploaded", "No se subió")} «${f.name}»: ${r.error}`);
    }
    setArchivos(quedan);
    if (!quedan.length) {
      setMeta(metaSueltaVacia(meta.store));
      setHecho(t("Uploaded. Every sales rep with the Quote Builder can see it.", "Subido. Lo ve todo vendedor con el Quote Builder."));
    }
    await cargar();
    setOcupado(false);
  };

  const abrir = async (e: EstimadoDeCompetencia) => {
    const r = await almacen.abrir(e);
    if (!r.ok) { setError(`${t("Could not open the file", "No se pudo abrir el archivo")}: ${r.error}`); return; }
    window.open(r.valor, "_blank", "noopener,noreferrer");
  };

  const quitar = async (e: EstimadoDeCompetencia) => {
    if (!puedeQuitar(e, me)) return;
    setOcupado(true);
    const r = await almacen.quitar(e);
    setOcupado(false);
    setConfirmando(null);
    if (!r.ok) { setError(`${t("Not removed", "No se quitó")}: ${r.error}`); return; }
    await cargar();
  };

  const mb = Math.round(LIMITES_DE_COMPETENCIA.maxBytes / (1024 * 1024));
  const max = LIMITES_DE_COMPETENCIA.maxPorCotizacion;

  return (
    <div data-pestana-competencia={estado}>
      <div className="card">
        <h2>🕵️ {t("Upload a competitor's estimate", "Subir un estimado de la competencia")}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          <b>{t("No quote needed. Internal — never printed on the customer copy.", "Sin crear cotización. Interno — nunca sale en la copia del cliente.")}</b>{" "}
          {t(`PDF or photo, up to ${mb} MB each, ${max} at a time.`, `PDF o foto, hasta ${mb} MB cada uno, ${max} a la vez.`)}
        </p>
        {estado === "sin-156" && <AvisoSin156 t={t} />}
        {error && <div className="est-aviso rojo" data-estimados-error>{error}</div>}
        {hecho && <div className="est-aviso verde" data-estimados-hecho>{hecho}</div>}
        {estado === "lista" && (
          <>
            <div className="grid g3">
              <div className="field">
                <label htmlFor="suelto-cliente">{t("Customer", "Cliente")}</label>
                <input id="suelto-cliente" value={meta.customer_name} maxLength={TOPES_DE_TEXTO.cliente} data-suelto-cliente
                  className={archivos.length > 0 && !meta.customer_name.trim() ? "invalid" : undefined}
                  onChange={(e) => setMeta({ ...meta, customer_name: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="suelto-tienda">{t("Store", "Tienda")}</label>
                <select id="suelto-tienda" value={meta.store} data-suelto-tienda onChange={(e) => setMeta({ ...meta, store: e.target.value })}>
                  <option value="">{t("— No store —", "— Sin tienda —")}</option>
                  {tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="suelto-estimado">{t("Our estimate # (optional)", "Nuestro # de estimado (opcional)")}</label>
                <input id="suelto-estimado" value={meta.estimate_num} maxLength={TOPES_DE_TEXTO.estimado}
                  onChange={(e) => setMeta({ ...meta, estimate_num: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="suelto-competidor">{t("Competitor company", "Empresa competidora")}</label>
                <input id="suelto-competidor" value={meta.competitor} maxLength={TOPES_DE_TEXTO.competidor} list={LISTA_DE_COMPETIDORES} data-suelto-competidor
                  placeholder={t("Pick one or type a new one", "Elige una o escribe una nueva")}
                  onChange={(e) => setMeta({ ...meta, competitor: e.target.value })} />
              </div>
              <div className="field">
                <label>{t("Their total $ (optional)", "Su total $ (opcional)")}</label>
                <CampoDecimal value={meta.competitor_total} onValor={(n) => setMeta((m) => ({ ...m, competitor_total: n }))} />
              </div>
              <div className="field">
                <label htmlFor="suelto-nota">{t("Note (optional)", "Nota (opcional)")}</label>
                <input id="suelto-nota" value={meta.note} maxLength={TOPES_DE_TEXTO.nota}
                  onChange={(e) => setMeta({ ...meta, note: e.target.value })} />
              </div>
            </div>
            {archivos.length > 0 && (
              <ul className="est-comp-lista" data-suelto-pendientes>
                {archivos.map((f, i) => (
                  <li key={`${i}-${f.name}`} className="est-comp-item est-comp-cab">
                    <span>⬆ {f.name} · {tamanoLegible(f.size)}</span>
                    <button type="button" className="btn btn-danger btn-sm" disabled={ocupado}
                      onClick={() => setArchivos((a) => a.filter((_, j) => j !== i))}>✕</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="est-acciones">
              <BotonesDeArchivo t={t} marca="suelto" refEntrada={entrada} onArchivos={elegir} apagado={ocupado || archivos.length >= max} />
              {archivos.length > 0 && (
                <button type="button" className="btn btn-primary btn-sm" data-suelto-subir
                  disabled={ocupado || faltaEnSuelto(meta) !== null} onClick={() => void subir()}>
                  ⬆ {t(`Upload ${archivos.length}`, `Subir ${archivos.length}`)}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {estado === "lista" && (
        <div className="card">
          <h2>📚 {t("All competitor estimates", "Todos los estimados de la competencia")} <span className="hint">({visibles.length})</span></h2>
          <p className="hint" style={{ marginTop: 0 }}>
            {t("Every sales rep with the Quote Builder sees these, from every store.", "Los ve todo vendedor con el Quote Builder, de todas las tiendas.")}
          </p>
          <div className="grid g3" style={{ marginBottom: 10 }}>
            <div className="field">
              <label htmlFor="filtro-tienda">{t("Store", "Tienda")}</label>
              <select id="filtro-tienda" value={filtro.tienda} data-filtro-tienda onChange={(e) => setFiltro({ ...filtro, tienda: e.target.value })}>
                <option value="">{t("All stores", "Todas las tiendas")}</option>
                {tiendasDelFiltro.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="filtro-texto">{t("Search", "Buscar")}</label>
              <input id="filtro-texto" value={filtro.texto} data-filtro-texto placeholder={t("Customer, competitor, estimate #…", "Cliente, competidor, # de estimado…")}
                onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
            </div>
          </div>
          <ListaDeCompetidores nombres={competidores} />
          <ListaDeEstimados estimados={visibles} me={me} t={t} lang={lang} confirmando={confirmando} ocupado={ocupado}
            filtrando={!!(filtro.tienda || filtro.texto.trim())}
            onAbrir={(e) => void abrir(e)} onQuitar={(e) => void quitar(e)} onConfirmar={setConfirmando}
            lecturas={lecturas} abierto={abierto} onProductos={setAbierto}
            detalle={(e) => (base161 === false ? <AvisoSin161 t={t} /> : (
              <ProductosDeCompetencia archivo={e} almacen={almacenLecturas} guardada={lecturas[e.id] ?? null}
                puedeEditar={puedeQuitar(e, me)} t={t}
                onGuardada={(l) => setLecturas((m) => ({ ...m, [l.file_id]: l }))} onSin161={() => setBase161(false)} />
            ))} />
        </div>
      )}
    </div>
  );
}
