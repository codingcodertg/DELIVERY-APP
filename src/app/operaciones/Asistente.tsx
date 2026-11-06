"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney } from "@/lib/utils";
import { jpegComprimido } from "@/lib/camara-de-varias-fotos";
import { INFO_DE_TIPO, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import {
  TIPOS_DE_MERMA, costoDelCampo, empleadosDelReporte, etiquetaDeOpcion, pasoCompleto, pasosVisibles, primerHueco, productoLibre,
  respuestasParaGuardar, type Paso, type ProductoElegido, type Respuestas,
} from "@/lib/almacen-ops/pasos";
import { enteroDelCampo, perdida, piezasPorCajaInicial, piezasTotales, type Cantidades } from "@/lib/almacen-ops/perdida";
import { DEMO_PRODUCTOS, buscarProductos, productoParaEnviar, registrar, subirFoto, type Envio } from "@/lib/almacen-ops/datos";
import { personasParaElegir } from "@/lib/almacen-ops/personas";
import { borrarBorrador, guardarBorrador, hayCambios, leerBorrador } from "@/lib/almacen-ops/borradores";
import type { Contexto } from "./Operaciones";

const MAX_FOTOS = 3;

/**
 * El asistente de un reporte (D-883, 247): una pregunta por pantalla, con botones grandes para el teléfono; luego el
 * resumen, donde cada fila se toca para corregirla, la tienda (la de la persona por defecto) y «Enviar».
 */
export function Asistente({ tipo, ctx }: { tipo: TipoDeReporte; ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const info = INFO_DE_TIPO[tipo];
  const router = useRouter();
  const idDeBorrador = useSearchParams().get("borrador");
  // Un borrador (pedido 4a1123bb) se reabre con ?borrador=<id>; solo los del mismo tipo y de quien mira.
  const [inicial] = useState(() => {
    const b = idDeBorrador ? leerBorrador(ctx.yo.id, idDeBorrador) : null;
    return b && b.tipo === tipo ? b : null;
  });
  const [borradorId, setBorradorId] = useState<string>(() => inicial?.id ?? crypto.randomUUID());
  const [r, setR] = useState<Respuestas>(() => inicial?.r ?? {});
  const [i, setI] = useState(() => inicial?.paso ?? 0);
  const [volverAlResumen, setVolverAlResumen] = useState(false);
  const [tienda, setTiendaCruda] = useState(() => (inicial?.tienda && ctx.tiendas.includes(inicial.tienda) ? inicial.tienda
    : ctx.yo.store && ctx.tiendas.includes(ctx.yo.store) ? ctx.yo.store : ctx.tiendas[0] ?? ""));
  const [guardadoComo, setGuardadoComo] = useState<{ r: Respuestas; tienda: string }>(() => ({ r: inicial?.r ?? {}, tienda: inicial?.tienda ?? tienda }));
  const [avisoBorrador, setAvisoBorrador] = useState<string | null>(null);
  const [cerrando, setCerrando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  const pasos = pasosVisibles(tipo, r);
  const enResumen = i >= pasos.length;
  const paso = pasos[i];
  const listo = paso ? pasoCompleto(paso, r) : false;
  const pon = (id: string, v: unknown) => setR((x) => ({ ...x, [id]: v }));
  const cambiado = hayCambios(r, guardadoComo.r) || (Object.keys(r).length > 0 && tienda !== guardadoComo.tienda);

  /** Cambiar de tienda quita a la gente elegida que no es del almacén de la nueva (el selector solo muestra esa). */
  const setTienda = (nueva: string) => {
    setTiendaCruda(nueva);
    const deAhi = new Set(personasParaElegir(ctx.personas, nueva).map((p) => p.id));
    setR((x) => {
      const y = { ...x };
      for (const p of pasosVisibles(tipo, x)) {
        if (p.tipo === "personas" && Array.isArray(y[p.id])) y[p.id] = (y[p.id] as string[]).filter((id) => deAhi.has(id));
        if (p.tipo === "persona" && typeof y[p.id] === "string" && !deAhi.has(y[p.id] as string)) delete y[p.id];
      }
      return y;
    });
  };

  const guardar = () => {
    const res = guardarBorrador(ctx.yo.id, { id: borradorId, tipo, r, paso: i, tienda, guardado: new Date().toISOString() });
    if (res === "error") { setAvisoBorrador(t("The draft could not be saved on this device.", "No se pudo guardar el borrador en este aparato.")); return; }
    setGuardadoComo({ r, tienda });
    setAvisoBorrador(res === "sin-fotos"
      ? t("Draft saved without the photos (not enough space). Add them again before sending.", "Borrador guardado sin las fotos (no hay espacio). Vuelve a agregarlas antes de enviar.")
      : t("Draft saved. Open it again from the Warehouse Ops home.", "Borrador guardado. Ábrelo otra vez desde el inicio de Operaciones."));
  };
  const cerrar = () => { if (cambiado) setCerrando(true); else router.push("/operaciones"); };

  const siguiente = () => {
    if (volverAlResumen) { setVolverAlResumen(false); setI(pasos.length); return; }
    setI((n) => n + 1);
  };
  const editar = (n: number) => { setVolverAlResumen(true); setI(n); };

  const enviar = async () => {
    if (primerHueco(tipo, r) >= 0 || !tienda) return;
    setEnviando(true); setError(null);
    try {
      if (ctx.demo) { await new Promise((ok) => setTimeout(ok, 300)); borrarBorrador(ctx.yo.id, borradorId); setHecho(true); return; }
      const sb = createClient();
      const fotos: string[] = [];
      for (const f of (r.photo as string[] | undefined) ?? []) fotos.push(await subirFoto(sb, ctx.yo.id, f));
      const q = r.qty as Cantidades | undefined;
      const p = r.product as ProductoElegido | undefined;
      const envio: Envio = {
        kind: tipo, store: tienda, subjectIds: empleadosDelReporte(tipo, r), answers: respuestasParaGuardar(tipo, r), photos: fotos,
        scrap: tipo === "scrap" && p && q ? {
          ...productoParaEnviar(p), scrap_type: String(r.scrap_type), boxes: q.boxes, pieces_per_box: q.piecesPerBox, loose_pieces: 0,
          return_type: String(r.return_type), reason: String(r.reason), broken_by: (r.broken_by as string[] | undefined) ?? [],
          crma: typeof r.crma === "string" && r.crma.trim() ? r.crma.trim() : null,
        } : null,
      };
      if (envio.scrap) { delete envio.answers.broken_by; delete envio.answers.crma; }
      await registrar(sb, envio);
      borrarBorrador(ctx.yo.id, borradorId);
      setHecho(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
    } finally {
      setEnviando(false);
    }
  };

  if (hecho) {
    return (
      <section className="ops-hecho" data-enviado={tipo}>
        <span className="ops-hecho-icono" aria-hidden>✅</span>
        <h2>{t("Report sent", "Reporte enviado")}</h2>
        {esDeRrhh(tipo) && <p>{t("It was added to the employee's HR file. Only managers and HR can see it.", "Se agregó al expediente del empleado. Solo lo ven los gerentes y RR. HH.")}</p>}
        <div className="ops-hecho-acciones">
          <Link href="/operaciones" className="ops-boton-ancho ops-boton-primario">{t("Done", "Listo")}</Link>
          <button type="button" className="ops-boton-ancho" onClick={() => { setR({}); setI(0); setGuardadoComo({ r: {}, tienda }); setBorradorId(crypto.randomUUID()); setHecho(false); }}>{t("File another", "Llenar otro")}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="ops-asistente" data-tipo={tipo}>
      <header className="ops-asistente-cabeza">
        <div className="ops-asistente-barra">
          <span className="ops-asistente-tipo"><span aria-hidden>{info.emoji}</span> {lang === "es" ? info.es : info.en}</span>
          <span className="ops-asistente-acciones">
            <button type="button" className="ops-boton ops-boton-chico" onClick={guardar} disabled={enviando || !cambiado} data-accion="guardar-borrador">💾 {t("Save draft", "Guardar borrador")}</button>
            <button type="button" className="ops-boton ops-boton-chico" onClick={cerrar} disabled={enviando} data-accion="cerrar">✕ {t("Close", "Cerrar")}</button>
          </span>
        </div>
        {ctx.tiendas.length > 1 && (
          <label className="ops-tienda ops-tienda-arriba">
            <span>{t("Store", "Tienda")}</span>
            <select value={tienda} onChange={(e) => setTienda(e.target.value)} data-campo="tienda-arriba">
              {ctx.tiendas.map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        )}
        {avisoBorrador && <p className="ops-aviso" role="status" data-aviso="borrador">{avisoBorrador}</p>}
        <ol className="ops-progreso" aria-label={t(`Step ${Math.min(i + 1, pasos.length + 1)} of ${pasos.length + 1}`, `Paso ${Math.min(i + 1, pasos.length + 1)} de ${pasos.length + 1}`)}>
          {[...pasos, null].map((_, n) => <li key={n} className={n < i ? "hecho" : n === i ? "ahora" : ""} />)}
        </ol>
      </header>

      {!enResumen && paso && (
        <div className="ops-pregunta" data-paso={paso.id}>
          <h2>{lang === "es" ? paso.es : paso.en}</h2>
          <Respuesta paso={paso} r={r} pon={pon} ctx={ctx} tienda={tienda} onElegirUno={() => { if (!volverAlResumen) setTimeout(() => setI((n) => n + 1), 120); }} />
        </div>
      )}

      {enResumen && (
        <div className="ops-resumen">
          <h2>{t("Check and send", "Revisa y envía")}</h2>
          {tipo === "scrap" && <Perdida r={r} grande />}
          <dl>
            {pasos.map((p, n) => (
              <button type="button" key={p.id} className={`ops-fila${pasoCompleto(p, r) ? "" : " falta"}`} onClick={() => editar(n)} data-editar={p.id}>
                <dt>{lang === "es" ? p.es : p.en}</dt>
                <dd>{textoDeRespuesta(tipo, p, r, ctx, lang) || <span className="hint">{pasoCompleto(p, r) ? "—" : t("Missing", "Falta")}</span>}</dd>
              </button>
            ))}
          </dl>
          <label className="ops-tienda">
            <span>{t("Store", "Tienda")}</span>
            <select value={tienda} onChange={(e) => setTienda(e.target.value)} data-campo="tienda">
              {ctx.tiendas.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          {error && <p className="ops-aviso ops-aviso-error" role="alert">{t("Not sent: ", "No se envió: ")}{error}</p>}
        </div>
      )}

      {cerrando && (
        <div className="overlay" onClick={() => setCerrando(false)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()} data-dialogo="descartar">
            <h3>{t("Discard this report?", "¿Descartar este reporte?")}</h3>
            <p className="sub">{t("You have changes that are not saved. Save a draft to finish it later.", "Tienes cambios sin guardar. Guarda un borrador para terminarlo después.")}</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setCerrando(false)} data-accion="seguir">{t("Keep editing", "Seguir llenando")}</button>
              <button type="button" className="btn" onClick={() => { guardar(); router.push("/operaciones"); }} data-accion="guardar-y-cerrar">{t("Save draft and close", "Guardar borrador y cerrar")}</button>
              <button type="button" className="btn btn-danger" onClick={() => router.push("/operaciones")} data-accion="descartar">{t("Discard", "Descartar")}</button>
            </div>
          </div>
        </div>
      )}

      <footer className="ops-botonera">
        {i === 0
          ? <button type="button" className="ops-boton" onClick={cerrar}>{t("Cancel", "Cancelar")}</button>
          : <button type="button" className="ops-boton" onClick={() => { setVolverAlResumen(false); setI((n) => n - 1); }} disabled={enviando}>{t("Back", "Atrás")}</button>}
        {enResumen
          ? <button type="button" className="ops-boton ops-boton-primario" onClick={enviar} disabled={enviando || primerHueco(tipo, r) >= 0 || !tienda} data-accion="enviar">
              {enviando ? t("Sending…", "Enviando…") : t("Send report", "Enviar reporte")}
            </button>
          : <button type="button" className="ops-boton ops-boton-primario" onClick={siguiente} disabled={!listo} data-accion="siguiente">
              {volverAlResumen ? t("Back to summary", "Volver al resumen") : i === pasos.length - 1 ? t("Review", "Revisar") : t("Next", "Siguiente")}
            </button>}
      </footer>
    </section>
  );
}

function nombreDe(ctx: Contexto, id: string): string {
  return ctx.personas.find((p) => p.id === id)?.full_name ?? "—";
}

function textoDeRespuesta(tipo: TipoDeReporte, p: Paso, r: Respuestas, ctx: Contexto, lang: "en" | "es"): string {
  const v = r[p.id];
  switch (p.tipo) {
    case "personas": return Array.isArray(v) ? (v as string[]).map((id) => nombreDe(ctx, id)).join(", ") : "";
    case "persona": return typeof v === "string" ? nombreDe(ctx, v) : "";
    case "opcion": case "sino": return etiquetaDeOpcion(tipo, p.id, v, lang);
    case "texto": return typeof v === "string" ? v : "";
    case "foto": { const n = Array.isArray(v) ? v.length : 0; return n ? (lang === "es" ? `${n} foto${n > 1 ? "s" : ""}` : `${n} photo${n > 1 ? "s" : ""}`) : ""; }
    case "producto": {
      const x = v as ProductoElegido | undefined;
      if (!x) return "";
      return x.libre ? `${x.name} (${lang === "es" ? "no está en el catálogo" : "not in catalog"})` : `${x.sku} · ${x.name}`;
    }
    case "cantidad": {
      const q = v as Cantidades | undefined;
      if (!q) return "";
      const piezas = piezasTotales(q);
      const clase = etiquetaDeOpcion("scrap", "scrap_type", r.scrap_type, lang);
      const cuenta = lang === "es" ? `${q.boxes} cajas × ${q.piecesPerBox} = ${piezas} piezas` : `${q.boxes} boxes × ${q.piecesPerBox} = ${piezas} pieces`;
      return clase ? `${clase} · ${cuenta}` : cuenta;
    }
  }
}

function Perdida({ r, grande = false }: { r: Respuestas; grande?: boolean }) {
  const { t } = usePrefs();
  const p = r.product as ProductoElegido | undefined;
  const q = r.qty as Cantidades | undefined;
  if (!p || !q) return null;
  const piezas = piezasTotales(q);
  const total = perdida(p.cost, piezas);
  return (
    <div className={`ops-perdida${grande ? " grande" : ""}`} data-perdida={total ?? ""}>
      <span className="ops-perdida-cifra">{total == null ? t("No cost", "Sin costo") : fmtMoney(total)}</span>
      <span className="ops-perdida-cuenta">
        {p.cost == null
          ? p.libre
            ? t("No cost entered; a manager can add it later.", "Sin costo; un gerente lo puede poner después.")
            : t("This product has no cost in the catalog; the loss is saved without a $ amount.", "Este producto no tiene costo en el catálogo; la pérdida se guarda sin monto.")
          : t(`${piezas} pieces × ${fmtMoney(p.cost)} per piece`, `${piezas} piezas × ${fmtMoney(p.cost)} por pieza`)}
      </span>
    </div>
  );
}

function Respuesta({ paso, r, pon, ctx, tienda, onElegirUno }: {
  paso: Paso; r: Respuestas; pon: (id: string, v: unknown) => void; ctx: Contexto; tienda: string; onElegirUno: () => void;
}) {
  const { t, lang } = usePrefs();
  const v = r[paso.id];
  switch (paso.tipo) {
    case "opcion":
      return (
        <div className="ops-opciones">
          {paso.opciones.map((o) => (
            <button type="button" key={o.v} className={`ops-opcion${v === o.v ? " elegida" : ""}`} aria-pressed={v === o.v}
              onClick={() => { pon(paso.id, o.v); onElegirUno(); }} data-opcion={o.v}>{lang === "es" ? o.es : o.en}</button>
          ))}
        </div>
      );
    case "sino":
      return (
        <div className="ops-opciones ops-dos">
          {(["yes", "no"] as const).map((o) => (
            <button type="button" key={o} className={`ops-opcion${v === o ? " elegida" : ""}`} aria-pressed={v === o}
              onClick={() => { pon(paso.id, o); onElegirUno(); }} data-opcion={o}>{o === "yes" ? t("Yes", "Sí") : "No"}</button>
          ))}
        </div>
      );
    case "texto":
      return paso.corto
        ? <input className="ops-campo" value={typeof v === "string" ? v : ""} onChange={(e) => pon(paso.id, e.target.value)} autoFocus data-campo={paso.id} />
        : <textarea className="ops-campo" rows={5} value={typeof v === "string" ? v : ""} onChange={(e) => pon(paso.id, e.target.value)} autoFocus data-campo={paso.id}
            placeholder={t("Write what you saw", "Escribe lo que viste")} />;
    case "personas":
    case "persona":
      return <ElegirPersonas multiple={paso.tipo === "personas"} valor={v} onCambio={(x) => { pon(paso.id, x); if (paso.tipo === "persona") onElegirUno(); }} ctx={ctx} tienda={tienda} />;
    case "foto":
      return <Fotos fotos={(v as string[] | undefined) ?? []} onCambio={(x) => pon(paso.id, x)} />;
    case "producto":
      return <ElegirProducto valor={v as ProductoElegido | undefined} ctx={ctx} onElegir={(p) => {
        pon("product", p);
        const q = r.qty as Cantidades | undefined;
        pon("qty", { boxes: q?.boxes ?? 1, piecesPerBox: p.libre ? (q?.piecesPerBox ?? 1) : piezasPorCajaInicial(p.pieces_per_box), loosePieces: 0 });
        if (!p.libre) onElegirUno();
      }} />;
    case "cantidad":
      return <Cantidad r={r} onCambio={(q) => pon("qty", q)} onTipo={(x) => pon("scrap_type", x)} />;
  }
}

function ElegirPersonas({ multiple, valor, onCambio, ctx, tienda }: {
  multiple: boolean; valor: unknown; onCambio: (v: string | string[]) => void; ctx: Contexto; tienda: string;
}) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const elegidos = multiple ? ((valor as string[] | undefined) ?? []) : typeof valor === "string" ? [valor] : [];
  // Solo la gente del almacén de la tienda del reporte, aunque quien llena sea admin (pedido fec8a78d).
  const lista = useMemo(() => personasParaElegir(ctx.personas, tienda, q).slice(0, 60), [ctx.personas, q, tienda]);
  const toca = (id: string) => {
    if (!multiple) return onCambio(id);
    onCambio(elegidos.includes(id) ? elegidos.filter((x) => x !== id) : [...elegidos, id]);
  };
  return (
    <div className="ops-personas">
      <input className="ops-campo" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search by name", "Buscar por nombre")} data-campo="buscar-persona" />
      {multiple && elegidos.length > 0 && <p className="ops-elegidos">{elegidos.map((id) => nombreDe(ctx, id)).join(", ")}</p>}
      <div className="ops-opciones">
        {lista.map((p) => (
          <button type="button" key={p.id} className={`ops-opcion ops-persona${elegidos.includes(p.id) ? " elegida" : ""}`} aria-pressed={elegidos.includes(p.id)} onClick={() => toca(p.id)} data-persona={p.id}>
            <span>{p.full_name}</span>{p.store && <span className="ops-persona-tienda">{p.store}</span>}
          </button>
        ))}
        {lista.length === 0 && <p className="hint">{q.trim()
          ? t("Nobody matches that name.", "Nadie coincide con ese nombre.")
          : t(`No warehouse employees in ${tienda || "this store"}.`, `No hay empleados de almacén en ${tienda || "esta tienda"}.`)}</p>}
      </div>
    </div>
  );
}

function ElegirProducto({ valor, ctx, onElegir }: { valor: ProductoElegido | undefined; ctx: Contexto; onElegir: (p: ProductoElegido) => void }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProductoElegido[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [costo, setCosto] = useState(() => (valor?.libre && valor.cost != null ? String(valor.cost) : ""));
  const [libre, setLibre] = useState(!!valor?.libre);
  const [nombreLibre, setNombreLibre] = useState(valor?.libre ? valor.name : "");
  const costoNum = costoDelCampo(costo);
  const usaLibre = (nombre: string, c: string) => {
    const n = costoDelCampo(c);
    if (nombre.trim().length >= 2 && !Number.isNaN(n)) onElegir(productoLibre(nombre, n));
  };
  useEffect(() => {
    const texto = q.trim();
    if (texto.length < 2) { setLista([]); return; }
    let vivo = true;
    const id = setTimeout(async () => {
      try {
        const res = ctx.demo
          ? DEMO_PRODUCTOS.filter((p) => (p.sku + " " + p.name).toLowerCase().includes(texto.toLowerCase()))
          : await buscarProductos(createClient(), texto);
        if (vivo) { setLista(res); setError(null); }
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String((e as { message?: string })?.message ?? e));
      }
    }, 250);
    return () => { vivo = false; clearTimeout(id); };
  }, [q, ctx.demo]);
  return (
    <div className="ops-personas">
      <input className="ops-campo" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus
        placeholder={t("Product name or SKU", "Nombre o SKU del producto")} data-campo="buscar-producto" />
      {valor && <p className="ops-elegidos" data-elegido={valor.libre ? "libre" : "catalogo"}>{valor.libre
        ? <>{valor.name} <span className="ops-fuera-de-catalogo">{t("Not in catalog", "No está en el catálogo")}</span></>
        : <>{valor.sku} · {valor.name}</>}</p>}
      {error && <p className="ops-aviso ops-aviso-error">{error}</p>}
      <div className="ops-opciones">
        {lista.map((p) => (
          <button type="button" key={p.id} className={`ops-opcion ops-producto${valor?.id === p.id ? " elegida" : ""}`} onClick={() => { setLibre(false); onElegir(p); }} data-producto={p.id}>
            <span className="ops-producto-nombre">{p.name}</span>
            <span className="ops-producto-meta">{p.sku} · {p.cost == null ? t("no cost", "sin costo") : t(`${fmtMoney(p.cost)}/piece`, `${fmtMoney(p.cost)}/pieza`)}{p.pieces_per_box ? t(` · ${p.pieces_per_box} per box`, ` · ${p.pieces_per_box} por caja`) : ""}</span>
          </button>
        ))}
        {q.trim().length >= 2 && lista.length === 0 && !error && <p className="hint">{t("No product found. Try the SKU, or add it by hand below.", "No se encontró. Prueba con el SKU, o escríbelo abajo.")}</p>}
        {q.trim().length >= 2 && !libre && (
          <button type="button" className="ops-opcion ops-producto" onClick={() => { setLibre(true); setNombreLibre(q.trim()); usaLibre(q.trim(), costo); }} data-accion="producto-libre">
            <span className="ops-producto-nombre">{t(`Use "${q.trim()}"`, `Usar «${q.trim()}»`)}</span>
            <span className="ops-producto-meta">{t("Not in the catalog. A manager can fix it later.", "No está en el catálogo. Un gerente lo corrige después.")}</span>
          </button>
        )}
      </div>
      {libre && (
        <div className="ops-libre" data-libre>
          <p className="hint">{t("Not in catalog. Write the name and, if you know it, the cost per piece. A manager can link it to the real product later.",
            "No está en el catálogo. Escribe el nombre y, si lo sabes, el costo por pieza. Un gerente lo vincula al producto real después.")}</p>
          <label className="ops-cantidad"><span>{t("Product name", "Nombre del producto")}</span>
            <input className="ops-campo" value={nombreLibre} onChange={(e) => { setNombreLibre(e.target.value); usaLibre(e.target.value, costo); }} data-campo="producto-libre-nombre" />
          </label>
          <label className="ops-cantidad"><span>{t("Cost per piece (optional)", "Costo por pieza (opcional)")}</span>
            <input className="ops-campo" inputMode="decimal" value={costo} placeholder="$0.00" onChange={(e) => { setCosto(e.target.value); usaLibre(nombreLibre, e.target.value); }} data-campo="producto-libre-costo" />
          </label>
          {Number.isNaN(costoNum) && <p className="ops-aviso ops-aviso-error">{t("Write the cost as a number, like 12.50.", "Escribe el costo como número, por ejemplo 12.50.")}</p>}
          <button type="button" className="ops-boton" onClick={() => setLibre(false)}>{t("Search the catalog instead", "Mejor buscar en el catálogo")}</button>
        </div>
      )}
    </div>
  );
}

function Cantidad({ r, onCambio, onTipo }: { r: Respuestas; onCambio: (q: Cantidades) => void; onTipo: (v: string) => void }) {
  const { t, lang } = usePrefs();
  const q: Cantidades = { ...((r.qty as Cantidades | undefined) ?? { boxes: 1, piecesPerBox: 1 }), loosePieces: 0 };
  const fila = (k: keyof Cantidades, en: string, es: string, min: number) => (
    <div className="ops-cantidad" data-cantidad={k}>
      <span>{t(en, es)}</span>
      <div className="ops-paso-a-paso">
        <button type="button" className="ops-boton" aria-label={t("Less", "Menos")} onClick={() => onCambio({ ...q, [k]: Math.max(min, (Number.isFinite(q[k]) ? q[k] : min) - 1) })}>−</button>
        <input className="ops-campo" inputMode="numeric" value={Number.isFinite(q[k]) ? String(q[k]) : ""} onChange={(e) => onCambio({ ...q, [k]: enteroDelCampo(e.target.value) })} />
        <button type="button" className="ops-boton" aria-label={t("More", "Más")} onClick={() => onCambio({ ...q, [k]: (Number.isFinite(q[k]) ? q[k] : min) + 1 })}>+</button>
      </div>
    </div>
  );
  return (
    <div className="ops-cantidades">
      <div className="ops-opciones ops-dos" data-cantidad="scrap_type">
        {TIPOS_DE_MERMA.map((o) => (
          <button type="button" key={o.v} className={`ops-opcion${r.scrap_type === o.v ? " elegida" : ""}`} aria-pressed={r.scrap_type === o.v}
            onClick={() => onTipo(o.v)} data-opcion={o.v}>{lang === "es" ? o.es : o.en}</button>
        ))}
      </div>
      {fila("boxes", "Boxes", "Cajas", 0)}
      {fila("piecesPerBox", "Pieces per box", "Piezas por caja", 1)}
      <Perdida r={{ ...r, qty: q }} />
    </div>
  );
}

function Fotos({ fotos, onCambio }: { fotos: string[]; onCambio: (f: string[]) => void }) {
  const { t } = usePrefs();
  const ref = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const agrega = async (f: File | undefined) => {
    if (!f) return;
    try {
      const img = await createImageBitmap(f);
      const jpg = jpegComprimido(img, img.width, img.height);
      img.close();
      onCambio([...fotos, jpg].slice(0, MAX_FOTOS));
      setError(null);
    } catch {
      setError(t("That photo could not be read. Try another one, or tap Next to skip.", "No se pudo leer esa foto. Prueba otra, o toca Siguiente para saltarla."));
    }
  };
  return (
    <div className="ops-fotos">
      <div className="ops-fotos-lista">
        {fotos.map((f, n) => (
          <figure key={n}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={f} alt={t(`Photo ${n + 1}`, `Foto ${n + 1}`)} />
            <button type="button" className="ops-boton" onClick={() => onCambio(fotos.filter((_, m) => m !== n))}>{t("Remove", "Quitar")}</button>
          </figure>
        ))}
      </div>
      {fotos.length < MAX_FOTOS && (
        <button type="button" className="ops-opcion ops-camara" onClick={() => ref.current?.click()} data-accion="foto">📷 {t("Take or choose a photo", "Tomar o elegir una foto")}</button>
      )}
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void agrega(e.target.files?.[0]); e.target.value = ""; }} />
      {error && <p className="ops-aviso ops-aviso-error">{error}</p>}
    </div>
  );
}
