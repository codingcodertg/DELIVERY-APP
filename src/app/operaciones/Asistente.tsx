"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney } from "@/lib/utils";
import { jpegComprimido } from "@/lib/camara-de-varias-fotos";
import { INFO_DE_TIPO, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import {
  empleadosDelReporte, etiquetaDeOpcion, pasoCompleto, pasosVisibles, primerHueco, respuestasParaGuardar,
  type Paso, type ProductoElegido, type Respuestas,
} from "@/lib/almacen-ops/pasos";
import { enteroDelCampo, perdida, piezasPorCajaInicial, piezasTotales, type Cantidades } from "@/lib/almacen-ops/perdida";
import { DEMO_PRODUCTOS, buscarProductos, registrar, subirFoto, type Envio } from "@/lib/almacen-ops/datos";
import type { Contexto } from "./Operaciones";

const MAX_FOTOS = 3;

/**
 * El asistente de un reporte (D-NEXT, 247): una pregunta por pantalla, con botones grandes para el teléfono; luego el
 * resumen, donde cada fila se toca para corregirla, la tienda (la de la persona por defecto) y «Enviar».
 */
export function Asistente({ tipo, ctx }: { tipo: TipoDeReporte; ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const info = INFO_DE_TIPO[tipo];
  const [r, setR] = useState<Respuestas>({});
  const [i, setI] = useState(0);
  const [volverAlResumen, setVolverAlResumen] = useState(false);
  const [tienda, setTienda] = useState(() => (ctx.yo.store && ctx.tiendas.includes(ctx.yo.store) ? ctx.yo.store : ctx.tiendas[0] ?? ""));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState(false);

  const pasos = pasosVisibles(tipo, r);
  const enResumen = i >= pasos.length;
  const paso = pasos[i];
  const listo = paso ? pasoCompleto(paso, r) : false;
  const pon = (id: string, v: unknown) => setR((x) => ({ ...x, [id]: v }));

  const siguiente = () => {
    if (volverAlResumen) { setVolverAlResumen(false); setI(pasos.length); return; }
    setI((n) => n + 1);
  };
  const editar = (n: number) => { setVolverAlResumen(true); setI(n); };

  const enviar = async () => {
    if (primerHueco(tipo, r) >= 0 || !tienda) return;
    setEnviando(true); setError(null);
    try {
      if (ctx.demo) { await new Promise((ok) => setTimeout(ok, 300)); setHecho(true); return; }
      const sb = createClient();
      const fotos: string[] = [];
      for (const f of (r.photo as string[] | undefined) ?? []) fotos.push(await subirFoto(sb, ctx.yo.id, f));
      const q = r.qty as Cantidades | undefined;
      const p = r.product as ProductoElegido | undefined;
      const envio: Envio = {
        kind: tipo, store: tienda, subjectIds: empleadosDelReporte(tipo, r), answers: respuestasParaGuardar(tipo, r), photos: fotos,
        scrap: tipo === "scrap" && p && q ? {
          product_id: p.id, scrap_type: String(r.scrap_type), boxes: q.boxes, pieces_per_box: q.piecesPerBox, loose_pieces: q.loosePieces,
          return_type: String(r.return_type), reason: String(r.reason), broken_by: (r.broken_by as string[] | undefined) ?? [],
          crma: typeof r.crma === "string" && r.crma.trim() ? r.crma.trim() : null,
        } : null,
      };
      if (envio.scrap) { delete envio.answers.broken_by; delete envio.answers.crma; }
      await registrar(sb, envio);
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
          <button type="button" className="ops-boton-ancho" onClick={() => { setR({}); setI(0); setHecho(false); }}>{t("File another", "Llenar otro")}</button>
        </div>
      </section>
    );
  }

  return (
    <section className="ops-asistente" data-tipo={tipo}>
      <header className="ops-asistente-cabeza">
        <span className="ops-asistente-tipo"><span aria-hidden>{info.emoji}</span> {lang === "es" ? info.es : info.en}</span>
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

      <footer className="ops-botonera">
        {i === 0
          ? <Link href="/operaciones" className="ops-boton">{t("Cancel", "Cancelar")}</Link>
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
    case "producto": { const x = v as ProductoElegido | undefined; return x ? `${x.sku} · ${x.name}` : ""; }
    case "cantidad": {
      const q = v as Cantidades | undefined;
      if (!q) return "";
      const piezas = piezasTotales(q);
      return lang === "es" ? `${q.boxes} cajas × ${q.piecesPerBox} + ${q.loosePieces} sueltas = ${piezas} piezas` : `${q.boxes} boxes × ${q.piecesPerBox} + ${q.loosePieces} loose = ${piezas} pieces`;
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
          ? t("This product has no cost in the catalog; the loss is saved without a $ amount.", "Este producto no tiene costo en el catálogo; la pérdida se guarda sin monto.")
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
        pon("qty", { boxes: q?.boxes ?? 1, piecesPerBox: piezasPorCajaInicial(p.pieces_per_box), loosePieces: q?.loosePieces ?? 0 });
        onElegirUno();
      }} />;
    case "cantidad":
      return <Cantidad r={r} onCambio={(q) => pon("qty", q)} />;
  }
}

function ElegirPersonas({ multiple, valor, onCambio, ctx, tienda }: {
  multiple: boolean; valor: unknown; onCambio: (v: string | string[]) => void; ctx: Contexto; tienda: string;
}) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const elegidos = multiple ? ((valor as string[] | undefined) ?? []) : typeof valor === "string" ? [valor] : [];
  const lista = useMemo(() => {
    const n = q.trim().toLowerCase();
    return ctx.personas
      .filter((p) => !n || p.full_name.toLowerCase().includes(n))
      .sort((a, b) => Number(b.store === tienda) - Number(a.store === tienda) || a.full_name.localeCompare(b.full_name))
      .slice(0, 40);
  }, [ctx.personas, q, tienda]);
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
        {lista.length === 0 && <p className="hint">{t("Nobody matches that name.", "Nadie coincide con ese nombre.")}</p>}
      </div>
    </div>
  );
}

function ElegirProducto({ valor, ctx, onElegir }: { valor: ProductoElegido | undefined; ctx: Contexto; onElegir: (p: ProductoElegido) => void }) {
  const { t } = usePrefs();
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<ProductoElegido[]>([]);
  const [error, setError] = useState<string | null>(null);
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
      {valor && <p className="ops-elegidos">{valor.sku} · {valor.name}</p>}
      {error && <p className="ops-aviso ops-aviso-error">{error}</p>}
      <div className="ops-opciones">
        {lista.map((p) => (
          <button type="button" key={p.id} className={`ops-opcion ops-producto${valor?.id === p.id ? " elegida" : ""}`} onClick={() => onElegir(p)} data-producto={p.id}>
            <span className="ops-producto-nombre">{p.name}</span>
            <span className="ops-producto-meta">{p.sku} · {p.cost == null ? t("no cost", "sin costo") : t(`${fmtMoney(p.cost)}/piece`, `${fmtMoney(p.cost)}/pieza`)}{p.pieces_per_box ? t(` · ${p.pieces_per_box} per box`, ` · ${p.pieces_per_box} por caja`) : ""}</span>
          </button>
        ))}
        {q.trim().length >= 2 && lista.length === 0 && !error && <p className="hint">{t("No product found. Try the SKU.", "No se encontró. Prueba con el SKU.")}</p>}
      </div>
    </div>
  );
}

function Cantidad({ r, onCambio }: { r: Respuestas; onCambio: (q: Cantidades) => void }) {
  const { t } = usePrefs();
  const q = (r.qty as Cantidades | undefined) ?? { boxes: 1, piecesPerBox: 1, loosePieces: 0 };
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
      {fila("boxes", "Boxes", "Cajas", 0)}
      {fila("piecesPerBox", "Pieces per box", "Piezas por caja", 1)}
      {fila("loosePieces", "Loose pieces", "Piezas sueltas", 0)}
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
