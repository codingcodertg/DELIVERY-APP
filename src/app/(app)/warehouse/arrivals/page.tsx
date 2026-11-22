"use client";

// ============================================================
// Warehouse · Llegadas (D-1125). La lógica pura vive en `@/lib/almacen-llegadas`; aquí, los datos y la pantalla.
// Lee el plan PUBLICADO de hoy (almacén puede leerlo: política de la 133) y cruza cada parada con la orden viva, así que
// lo que hace almacén (Listo, Recibir, quitar, asignar) se ve al momento y el plan solo da el orden y las horas.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { orderLabel, todayISO } from "@/lib/utils";
import { orderTypeRule } from "@/lib/required";
import { idsRecibidasPorAlmacen, puedeRecibir, recibirOrden } from "@/lib/recibir";
import { subirFotosDeEntrega, type AlmacenDeFotos } from "@/lib/fotos-en-storage";
import { OrderModal } from "@/components/OrderModalLazy";
import { PARADAS_DEMO } from "@/lib/almacen-llegadas-demo";
import {
  choferesDeLaTienda, hhmm, minutosDeHoy, ordenaChoferes, pasadaMasCercana, picoDeCarga, type ParadaDeAlmacen,
} from "@/lib/almacen-llegadas";
import type { Delivery } from "@/lib/types";

const DEMO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
const CAPACIDAD = 10;
const HECHAS = ["ready", "picked_up", "delivered"];
const RAZONES_QUITAR = [["Not ready", "No está lista"], ["Customer canceled", "Cliente canceló"], ["Doesn't fit", "No cabe"], ["Other", "Otro"], ["No reason", "Sin razón"]] as const;
const L = (m: number) => ((m - 450) / 600) * 100 + "%";
const ciudad = (dir?: string | null) => (dir ?? "").split(",").map((x) => x.trim()).filter(Boolean)[1] ?? "";

const leeComoDataUrl = (f: File) => new Promise<string>((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => mal(r.error); r.readAsDataURL(f); });

export default function WarehouseArrivalsPage() {
  const { me, realRole, deliveries, settings, events, setStage, updateDelivery, addNote, notify } = useData();
  const { t } = usePrefs();
  const esAdmin = realRole === "admin" || me?.role === "admin";
  // D-1126: el admin cambia de día con las flechas o el calendario; almacén siempre ve hoy.
  const hoy = DEMO ? "2026-11-23" : todayISO();
  const [fechaElegida, setFechaElegida] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [pasada, setPasada] = useState<number | null | undefined>(undefined);
  const fecha = esAdmin && fechaElegida ? fechaElegida : hoy;
  const mueveDia = (n: number) => { const d = new Date(fecha + "T12:00:00"); d.setDate(d.getDate() + n); setFechaElegida(d.toISOString().slice(0, 10)); setSel(null); setPasada(undefined); };
  const [tiendaElegida, setTiendaElegida] = useState<string>("");
  const suya = DEMO && me?.store && !me.store.startsWith("RDZ ") ? "RDZ " + me.store : (me?.store ?? "");
  const tienda = esAdmin ? (tiendaElegida || suya || "RDZ Pharr") : suya;

  // ---- La ruta publicada de hoy
  const [plan, setPlan] = useState<{ paradas: { id: string; dr: string; seq: number; k: "P" | "D"; place: string; eta: number }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (DEMO) return;
    let vivo = true;
    setPlan(null); setError(null);
    void (async () => {
      const db = createClient();
      const { data: p, error: e1 } = await db.from("route_plans").select("id").eq("plan_date", fecha).eq("status", "published").order("version", { ascending: false }).limit(1).maybeSingle();
      if (!vivo) return;
      if (e1) { setError(e1.message); return; }
      if (!p) { setPlan({ paradas: [] }); return; }
      const { data: s, error: e2 } = await db.from("route_plan_stops").select("delivery_id, driver_name, seq, kind, place, eta").eq("plan_id", p.id);
      if (!vivo) return;
      if (e2) { setError(e2.message); return; }
      setPlan({ paradas: (s ?? []).filter((x) => x.delivery_id).map((x) => ({ id: x.delivery_id as string, dr: x.driver_name as string, seq: x.seq as number, k: x.kind === "P" ? "P" : "D", place: (x.place as string) ?? "", eta: x.eta as number })) });
    })();
    return () => { vivo = false; };
  }, [fecha]);

  // ---- En el demo, lo que se marca vive aquí (no hay base).
  const [demo, setDemo] = useState<{ dueno: Record<string, string | null>; etapa: Record<string, string> }>({ dueno: {}, etapa: {} });

  const porId = useMemo(() => new Map(deliveries.map((d) => [d.id, d])), [deliveries]);
  const paradas: ParadaDeAlmacen[] = useMemo(() => {
    if (DEMO) return fecha === hoy ? PARADAS_DEMO.map((p) => ({ ...p, stage: demo.etapa[p.id] ?? p.stage })) : [];
    return (plan?.paradas ?? []).flatMap((s) => {
      const d = porId.get(s.id);
      if (!d) return [];
      return [{ ...s, code: orderLabel(d), no: d.order_no, inv: d.invoice_num ?? "", type: d.order_type ?? "", from: d.pickup_name || d.store || "", to: d.delivery_name ?? "",
        pal: Number(d.actual_pallets ?? d.est_pallets ?? 0), stage: d.stage, win: d.delivery_windows ?? "", city: ciudad(d.delivery_address) }];
    });
  }, [plan, porId, demo, fecha, hoy]);
  const dueno = useCallback((p: ParadaDeAlmacen): string | null => {
    if (DEMO) return p.id in demo.dueno ? demo.dueno[p.id] : p.dr;
    const d = porId.get(p.id);
    return d ? (d.assigned_driver || null) : p.dr;
  }, [porId, demo]);

  // ---- La hora (cada minuto)
  const [reloj, setReloj] = useState(() => (DEMO ? 500 : minutosDeHoy(new Date())));
  const ahora = fecha === hoy ? reloj : fecha < hoy ? 24 * 60 : 0;
  useEffect(() => { if (DEMO) return; const i = setInterval(() => setReloj(minutosDeHoy(new Date())), 60000); return () => clearInterval(i); }, []);

  const choferes = useMemo(() => ordenaChoferes(choferesDeLaTienda(paradas, tienda, dueno), tienda, ahora), [paradas, tienda, dueno, ahora]);
  const actual = choferes.find((x) => x.c.dr === sel) ?? choferes[0] ?? null;
  const pasadaVista = pasada === undefined ? (actual ? pasadaMasCercana(actual.c, ahora) : null) : pasada;
  const grupo = actual && pasadaVista != null ? actual.c.pasadas.find((g) => g[0].eta === pasadaVista) ?? null : null;
  const enGrupo = (p: ParadaDeAlmacen) => !grupo || grupo.some((x) => x.id === p.id && x.k === p.k);
  const deja = actual ? actual.c.aqui.filter((p) => p.k === "D" && enGrupo(p)) : [];
  const lleva = actual ? actual.c.aqui.filter((p) => p.k === "P" && enGrupo(p)) : [];
  const estaAqui = actual?.e.tipo === "aqui";

  // ---- Sin asignar: órdenes de hoy que salen de esta tienda y no tienen chofer.
  const sinAsignar = useMemo(() => {
    if (DEMO) return PARADAS_DEMO.filter((p) => p.k === "P" && p.place === tienda && demo.dueno[p.id] === null);
    return deliveries.filter((d) => d.delivery_date === fecha && !d.assigned_driver && (d.pickup_name || d.store) === tienda && !["delivered", "canceled", "draft"].includes(d.stage))
      .map((d) => ({ id: d.id, dr: "", seq: 0, k: "P" as const, place: tienda, eta: 0, code: orderLabel(d), no: d.order_no, inv: d.invoice_num ?? "", type: d.order_type ?? "", from: tienda, to: d.delivery_name ?? "", pal: Number(d.actual_pallets ?? d.est_pallets ?? 0), stage: d.stage, win: d.delivery_windows ?? "", city: ciudad(d.delivery_address) }));
  }, [deliveries, fecha, tienda, demo]);

  // ---- Acciones
  const recibidas = useMemo(() => idsRecibidasPorAlmacen(events), [events]);
  const [abierta, setAbierta] = useState<Delivery | null>(null);
  const [quitando, setQuitando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; deshacer?: () => void } | null>(null);
  const [fotos, setFotos] = useState<Record<string, number>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verRuta, setVerRuta] = useState(false);

  const hechaLleva = (p: ParadaDeAlmacen) => HECHAS.includes(p.stage);
  const hechaDeja = (p: ParadaDeAlmacen) => p.stage === "delivered" || recibidas.has(p.id);

  async function listo(p: ParadaDeAlmacen) {
    if (hechaLleva(p)) return;
    if (DEMO) { setDemo((s) => ({ ...s, etapa: { ...s.etapa, [p.id]: "ready" } })); return; }
    setOcupado(p.id);
    await setStage(p.id, "ready", t("Ready (Warehouse · arrivals)", "Lista (Almacén · llegadas)"));
    setOcupado(null);
  }
  async function recibir(p: ParadaDeAlmacen) {
    if (hechaDeja(p)) return;
    if (DEMO) { setDemo((s) => ({ ...s, etapa: { ...s.etapa, [p.id]: "delivered" } })); return; }
    const d = porId.get(p.id);
    if (!d || !puedeRecibir(me, d, orderTypeRule(d.order_type, settings.order_type_rules), settings.stores)) {
      notify(t("This order can't be received yet (it has to be on its way to your store).", "Esta orden aún no se puede recibir (tiene que venir en camino a tu tienda)."));
      return;
    }
    setOcupado(p.id);
    await recibirOrden(setStage, p.id);
    setOcupado(null);
  }
  async function quitar(p: ParadaDeAlmacen, razon: string | null) {
    setQuitando(null);
    const antes = dueno(p);
    const texto = t(`${p.code} is now unassigned`, `${p.code} quedó sin asignar`) + (razon ? ` · ${razon}` : "");
    if (DEMO) {
      setDemo((s) => ({ ...s, dueno: { ...s.dueno, [p.id]: null } }));
      setAviso({ texto, deshacer: () => { setDemo((s) => ({ ...s, dueno: { ...s.dueno, [p.id]: antes } })); setAviso(null); } });
      return;
    }
    setOcupado(p.id);
    const ok = await updateDelivery(p.id, { assigned_driver: null } as Partial<Delivery>);
    if (ok) await addNote(p.id, t(`Warehouse removed it from ${antes ?? "—"}'s route`, `Almacén la quitó de la ruta de ${antes ?? "—"}`) + (razon ? ` · ${razon}` : ""));
    setOcupado(null);
    if (ok) setAviso({ texto, deshacer: async () => { setAviso(null); await updateDelivery(p.id, { assigned_driver: antes } as Partial<Delivery>); } });
  }
  async function asignar(p: ParadaDeAlmacen, dr: string) {
    if (!estaAqui) return;
    if (DEMO) { setDemo((s) => ({ ...s, dueno: { ...s.dueno, [p.id]: dr } })); setAviso({ texto: t(`${p.code} assigned to ${dr}`, `${p.code} asignada a ${dr}`) }); return; }
    setOcupado(p.id);
    const ok = await updateDelivery(p.id, { assigned_driver: dr } as Partial<Delivery>);
    if (ok) await addNote(p.id, t(`Warehouse assigned it to ${dr} at the store`, `Almacén se la asignó a ${dr} en la tienda`));
    setOcupado(null);
    if (ok) setAviso({ texto: t(`${p.code} assigned to ${dr}`, `${p.code} asignada a ${dr}`), deshacer: async () => { setAviso(null); await updateDelivery(p.id, { assigned_driver: null } as Partial<Delivery>); } });
  }
  async function subeFotos(p: ParadaDeAlmacen, files: FileList | null) {
    const lista = Array.from(files ?? []);
    if (!lista.length) return;
    if (DEMO) { setFotos((f) => ({ ...f, [p.id]: (f[p.id] ?? 0) + lista.length })); return; }
    const d = porId.get(p.id);
    if (!d) return;
    setOcupado(p.id);
    try {
      const datos = await Promise.all(lista.map(leeComoDataUrl));
      const r = await subirFotosDeEntrega(createClient().storage as unknown as AlmacenDeFotos, p.id, datos, Date.now());
      if (!r.ok) { notify(t("Couldn't upload the photos: ", "No se pudieron subir las fotos: ") + r.message); return; }
      const ok = await updateDelivery(p.id, { photos: [...((d.photos as string[] | null) ?? []), ...r.rutas] } as Partial<Delivery>);
      if (ok) setFotos((f) => ({ ...f, [p.id]: (f[p.id] ?? 0) + lista.length }));
    } finally { setOcupado(null); }
  }
  const abre = (p: ParadaDeAlmacen) => { const d = porId.get(p.id); if (d) setAbierta(d); else notify(t("Order card isn't available in the demo.", "La ficha no está en el demo.")); };

  // ---- Pantalla
  const tiendas = DEMO ? ["RDZ McAllen", "RDZ Pharr", "RDZ Brownsville", "RDZ Weslaco", "RDZ Edinburg", "RDZ Mission"] : (settings.stores ?? []).map((s) => s.name);
  const cabecera = (num: string, titulo: string, sub: string, color: string, fondo: string, cuenta: string, todo?: () => void, todoTxt?: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: fondo, borderBottom: "1px solid var(--line)" }}>
      <span style={{ width: 30, height: 30, flex: "none", borderRadius: 9, background: color, color: "var(--on-color, #fff)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 800 }}>{num}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}><b style={{ fontSize: 16 }}>{titulo}</b><span className="hint" style={{ margin: 0 }}>{sub}</span></span>
      <b style={{ color }}>{cuenta}</b>
      {todo && <button className="btn btn-sm" style={{ border: `1px solid ${color}`, color, background: "var(--card)" }} onClick={todo}>{todoTxt}</button>}
    </div>
  );
  const fila = (p: ParadaDeAlmacen, tipo: "deja" | "lleva") => {
    const hecha = tipo === "deja" ? hechaDeja(p) : hechaLleva(p);
    const color = tipo === "deja" ? "var(--green)" : "var(--amber-text)";
    const nf = fotos[p.id] ?? 0;
    return (
      <div key={p.id + p.k} style={{ borderBottom: "1px solid var(--row-line)", background: hecha ? "var(--green-soft)" : "var(--card)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
          <button aria-label={tipo === "deja" ? t("Receive", "Recibir") : t("Ready", "Listo")} title={tipo === "deja" ? t("Receive", "Recibir") : t("Ready", "Listo")}
            disabled={ocupado === p.id} onClick={() => void (tipo === "deja" ? recibir(p) : listo(p))}
            style={{ flex: "none", width: 46, height: 46, borderRadius: 12, border: `2px solid ${color}`, background: hecha ? color : "var(--card)", color: hecha ? "var(--on-color, #fff)" : color, fontSize: 22, fontWeight: 800 }}>✓</button>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span><button onClick={() => abre(p)} style={{ padding: 0, fontSize: 16, fontWeight: 800, color: "var(--text)", textDecoration: "underline", textDecorationColor: "var(--line)", textUnderlineOffset: 3 }}>{p.code}</button>
              <span className="hint" style={{ margin: "0 0 0 8px" }}>#{p.no}{p.inv ? ` · Inv ${p.inv}` : ""}</span></span>
            <span className="hint" style={{ margin: 0, fontSize: 13 }}>
              {tipo === "deja" ? `${t("Arrives", "Llega")} ${hhmm(p.eta)} · ${t("From", "Viene de")} ${p.from.replace("RDZ ", "")}` : `${t("Picks up", "Recoge")} ${hhmm(p.eta)} · ${p.type === "Intertienda" ? t("To store", "A tienda") + " " + p.to.replace("RDZ ", "") : t("Customer in", "Cliente en") + " " + p.city}`} · {p.pal} pallet{p.win ? ` · ${t("window", "ventana")} ${p.win}` : ""}
            </span>
            {nf > 0 && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--green)" }}>{nf} {t(nf === 1 ? "photo" : "photos", nf === 1 ? "foto" : "fotos")}</span>}
          </span>
          <label title={t("Photos: camera or gallery, as many as you want", "Fotos: cámara o galería, las que quieras")} className="btn btn-sm" style={{ flex: "none", width: 40, height: 40, justifyContent: "center", border: "1px solid var(--line)", background: "var(--card)", cursor: "pointer", padding: 0 }}>
            📷<input type="file" accept="image/*" multiple hidden onChange={(e) => { void subeFotos(p, e.target.files); e.target.value = ""; }} />
          </label>
          {tipo === "lleva" && (
            <button aria-label={t("Unassign", "Quitar")} title={t("Unassign", "Quitar")} onClick={() => setQuitando(quitando === p.id ? null : p.id)}
              style={{ flex: "none", width: 40, height: 40, borderRadius: 8, border: "1px solid var(--line)", background: "var(--card)", color: "var(--red)", fontSize: 18 }}>✕</button>
          )}
        </div>
        {quitando === p.id && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 12px 12px 68px", alignItems: "center" }}>
            <span style={{ flexBasis: "100%", fontSize: 12, fontWeight: 700, color: "var(--red-chip-text)" }}>{t("Why isn't it going?", "¿Por qué no se va?")} <span className="hint" style={{ margin: 0 }}>· {t("optional", "opcional")}</span></span>
            {RAZONES_QUITAR.map(([en, es]) => <button key={en} className="chip" onClick={() => void quitar(p, en === "No reason" ? null : t(en, es))}>{t(en, es)}</button>)}
          </div>
        )}
      </div>
    );
  };

  if (!me) return null;
  if (!tienda) return <div className="card empty">{t("You're not assigned to a store yet — ask an admin to set one in Users.", "Aún no tienes tienda asignada — pide a un administrador que te asigne una en Usuarios.")}</div>;

  return (
    <div style={{ paddingBottom: 96 }}>
      {esAdmin && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <button className="btn btn-sm btn-ghost" aria-label={t("Previous day", "Día anterior")} onClick={() => mueveDia(-1)}>◀</button>
            <input type="date" value={fecha} onChange={(e) => { if (e.target.value) { setFechaElegida(e.target.value); setSel(null); setPasada(undefined); } }} style={{ width: "auto", padding: "5px 7px" }} />
            <button className="btn btn-sm btn-ghost" aria-label={t("Next day", "Día siguiente")} onClick={() => mueveDia(1)}>▶</button>
            {fecha !== hoy && <button className="btn btn-sm btn-primary" onClick={() => { setFechaElegida(null); setSel(null); setPasada(undefined); }}>{t("Today", "Hoy")}</button>}
          </span>
          <span className="hint" style={{ margin: 0 }}>{t("Store", "Tienda")}</span>
          <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 2, background: "var(--card)", border: "1px solid var(--line)", borderRadius: 8, padding: 2 }}>
            {tiendas.map((s) => <button key={s} onClick={() => { setTiendaElegida(s); setSel(null); setPasada(undefined); }}
              style={{ padding: "5px 10px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: s === tienda ? "var(--accent)" : "transparent", color: s === tienda ? "var(--on-color, #fff)" : "var(--ink-soft)" }}>{s.replace("RDZ ", "")}</button>)}
          </span>
        </div>
      )}

      {error && <div className="banner err">{t("Couldn't read the route: ", "No se pudo leer la ruta: ")}{error}</div>}

      <div className="card" style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 640, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 10 }}>
            <span style={{ width: 150, flex: "none" }} />
            <div style={{ position: "relative", flex: 1, height: 20 }}>
              {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((h) => <span key={h} className="hint" style={{ position: "absolute", left: L(h * 60), transform: "translateX(-50%)", margin: 0, fontSize: 11 }}>{(h > 12 ? h - 12 : h) + (h >= 12 ? "pm" : "am")}</span>)}
            </div>
          </div>
          {choferes.map(({ c }) => {
            const todasOn = actual?.c.dr === c.dr && pasadaVista == null;
            return (
              <div key={c.dr} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 150, flex: "none", display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ flex: 1, minWidth: 0 }}>{c.dr.split(" ")[0]}</b>
                  <button className={"chip" + (todasOn ? " on" : "")} style={{ padding: "3px 10px" }} onClick={() => { setSel(c.dr); setPasada(null); }}>{t("All", "Todas")}</button>
                </span>
                <div style={{ position: "relative", flex: 1, height: 34, borderRadius: 10, background: "var(--paper)" }}>
                  <span style={{ position: "absolute", left: L(ahora), top: -4, bottom: -4, width: 2, background: "var(--red)" }} />
                  {c.pasadas.map((g) => {
                    const t0 = g[0].eta, t1 = g[g.length - 1].eta;
                    const aqui = ahora >= t0 && ahora <= t1 + 15, paso = ahora > t1 + 15;
                    const on = actual?.c.dr === c.dr && pasadaVista === t0;
                    return <button key={t0} onClick={() => { setSel(c.dr); setPasada(t0); }} title={hhmm(t0)}
                      style={{ position: "absolute", left: L(t0), top: "50%", transform: "translate(-50%,-50%)", minWidth: 46, height: 26, padding: "0 8px", borderRadius: 999, border: `3px solid ${on ? "var(--ink)" : "var(--card)"}`, background: aqui ? "var(--green)" : paso ? "var(--gray)" : "var(--amber)", color: "var(--on-color, #fff)", fontSize: 11, fontWeight: 800 }}>
                      {hhmm(t0).replace(" am", "").replace(" pm", "")}</button>;
                  })}
                </div>
              </div>
            );
          })}
          {!choferes.length && <div className="hint">{plan || DEMO ? (fecha === hoy ? t("No driver comes by this store today.", "Ningún chofer pasa por esta tienda hoy.") : t("No published route passes by this store that day.", "Ninguna ruta publicada pasa por esta tienda ese día.")) : t("Loading today's route…", "Cargando la ruta de hoy…")}</div>}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 260px", maxWidth: 320, minWidth: 0, display: "grid", gap: 8 }}>
          <span className="hint" style={{ margin: 0, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>{t("Drivers coming by", "Choferes que pasan por")} {tienda.replace("RDZ ", "")}</span>
          {choferes.map(({ c, e }) => {
            const on = actual?.c.dr === c.dr;
            const tag = e.tipo === "aqui" ? t("At the store", "En la tienda") : e.tipo === "viene" ? t(`On the way · ${e.min} min`, `Viene para acá · ${e.min} min`) : e.tipo === "antes" ? t(`${e.paradas} stops before · ${hhmm(e.llega)}`, `${e.paradas} paradas antes · ${hhmm(e.llega)}`) : t("Done here", "Ya pasó");
            const cls = e.tipo === "aqui" ? "var(--green-soft)" : e.tipo === "viene" ? "var(--amber-soft)" : "var(--paper)";
            return (
              <button key={c.dr} className="card" onClick={() => { setSel(c.dr); setPasada(undefined); }}
                style={{ margin: 0, padding: 12, textAlign: "left", border: on ? "2px solid var(--ink)" : undefined, background: on ? "var(--accent-soft)" : undefined }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><b style={{ fontSize: 16 }}>{c.dr}</b><span className="hint" style={{ margin: 0 }}>{hhmm((c.aqui.find((h) => h.eta > ahora) ?? c.aqui[0]).eta)}</span></div>
                <span style={{ display: "inline-block", marginTop: 6, fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 999, background: cls }}>{tag}</span>
                <div className="hint">{t(`Drops ${c.aqui.filter((x) => x.k === "D").length} · Takes ${c.aqui.filter((x) => x.k === "P").length}`, `Deja ${c.aqui.filter((x) => x.k === "D").length} · Se lleva ${c.aqui.filter((x) => x.k === "P").length}`)}</div>
              </button>
            );
          })}
          {actual && (
            <div className="card" style={{ margin: "6px 0 0", padding: 0, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
                <b style={{ flex: 1, minWidth: 0 }}>{t("Today's whole route", "Toda su ruta de hoy")} · {new Set(actual.c.mias.map((x) => x.id)).size} {t("orders", "órdenes")}</b>
                <button className="btn btn-sm btn-ghost" onClick={() => setVerRuta(!verRuta)}>{verRuta ? t("Hide", "Ocultar") : t("See all", "Ver todas")}</button>
              </div>
              {verRuta && Array.from(new Set(actual.c.mias.map((x) => x.id))).map((id) => {
                const P = paradas.find((x) => x.id === id && x.k === "P"), D = paradas.find((x) => x.id === id && x.k === "D");
                if (!P) return null;
                return (
                  <div key={id} style={{ borderTop: "1px solid var(--row-line)", padding: "8px 12px", display: "grid", gap: 2 }}>
                    <span className="between"><button onClick={() => abre(P)} style={{ padding: 0, fontWeight: 800, textDecoration: "underline", textDecorationColor: "var(--line)", textUnderlineOffset: 3 }}>{P.code}</button>
                      {P.place === tienda && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--amber-text)" }}>{t("Leaves from here", "Sale de aquí")}</span>}</span>
                    <span className="hint" style={{ margin: 0, overflowWrap: "anywhere" }}>{P.place.replace("RDZ ", "")} {hhmm(P.eta)} → {P.type === "Intertienda" ? P.to.replace("RDZ ", "") : P.city} {D ? hhmm(D.eta) : ""} · {P.pal} pallet</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ flex: "999 1 600px", minWidth: 0, display: "grid", gap: 16 }}>
          {actual && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16, alignItems: "start" }}>
              <div className="card" style={{ margin: 0, padding: 0, overflow: "hidden" }}>
                {cabecera("1", t("Dropping off", "Viene a dejar"), t("Tap ✓ when you receive it", "Toca ✓ al recibirlo"), "var(--green)", "var(--green-soft)", `${deja.filter(hechaDeja).length}/${deja.length}`)}
                {deja.length ? deja.map((p) => fila(p, "deja")) : <div className="hint" style={{ padding: 16, margin: 0 }}>{t("Nothing to drop at this store.", "No trae nada para esta tienda.")}</div>}
              </div>
              <div className="card" style={{ margin: 0, padding: 0, overflow: "hidden" }}>
                {cabecera("2", t("Taking", "Se va a llevar"), t("Tap ✓ when it's ready", "Toca ✓ cuando esté listo"), "var(--amber-text)", "var(--amber-soft)", `${lleva.filter(hechaLleva).length}/${lleva.length}`,
                  lleva.some((p) => !hechaLleva(p)) ? () => { for (const p of lleva) void listo(p); } : undefined, t("All ready", "Listo todo"))}
                {lleva.length ? lleva.map((p) => fila(p, "lleva")) : <div className="hint" style={{ padding: 16, margin: 0 }}>{t("Nothing to pick up here.", "No recoge nada aquí.")}</div>}
              </div>
            </div>
          )}

          {actual && sinAsignar.length > 0 && (
            <div className="card" style={{ margin: 0, background: "var(--accent-soft)" }}>
              <div className="between" style={{ flexWrap: "wrap", gap: 6 }}>
                <b>{t("Unassigned at this store", "Sin asignar en esta tienda")}</b>
                <span className="hint" style={{ margin: 0 }}>{t(`Truck up to ${picoDeCarga(paradas, actual.c.dr, dueno)} of ${CAPACIDAD} pallets`, `Camión hasta ${picoDeCarga(paradas, actual.c.dr, dueno)} de ${CAPACIDAD} pallets`)}</span>
              </div>
              {!estaAqui && <div className="hint" style={{ color: "var(--amber-text)", fontWeight: 700 }}>{t("You can only assign to a driver while they're here at the store. For other stops, contact the logistics manager.", "Solo se le puede asignar cuando está aquí en la tienda. Para cambios en otras paradas, contacta al logistic manager.")}</div>}
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {sinAsignar.map((p) => {
                  const pk = picoDeCarga(paradas, actual.c.dr, dueno, p.id), cabe = pk <= CAPACIDAD, nombre = actual.c.dr.split(" ")[0];
                  return (
                    <div key={p.id} style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                      <span style={{ flex: "1 1 220px", minWidth: 0 }}><button onClick={() => abre(p)} style={{ padding: 0, fontWeight: 800, textDecoration: "underline", textDecorationColor: "var(--line)", textUnderlineOffset: 3 }}>{p.code}</button>
                        <span className="hint" style={{ margin: 0, display: "block" }}>{p.type === "Intertienda" ? t("To store", "A tienda") + " " + p.to.replace("RDZ ", "") : p.city} · {p.pal} pallet</span></span>
                      <button className={"btn btn-sm " + (estaAqui ? (cabe ? "btn-primary" : "btn-ghost") : "")} disabled={!estaAqui || ocupado === p.id} onClick={() => void asignar(p, actual.c.dr)}
                        style={!estaAqui ? { background: "var(--paper)", color: "var(--gray)" } : !cabe ? { color: "var(--amber-text)", boxShadow: "inset 0 0 0 1.5px var(--amber)" } : undefined}>
                        {!estaAqui ? t("Only while at the store", "Solo cuando esté en la tienda") : cabe ? t(`Assign to ${nombre} · fits ${pk}/${CAPACIDAD}`, `Asignar a ${nombre} · cabe ${pk}/${CAPACIDAD}`) : t(`Assign to ${nombre} · over ${pk}/${CAPACIDAD}`, `Asignar a ${nombre} · se pasa ${pk}/${CAPACIDAD}`)}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {aviso && (
        <div role="status" style={{ position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", width: "min(92vw, 520px)", background: "var(--ink)", color: "var(--on-color, #fff)", borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 12, zIndex: 60 }}>
          <b style={{ flex: 1 }}>{aviso.texto}</b>
          {aviso.deshacer && <button className="btn btn-sm" style={{ color: "var(--on-color, #fff)", border: "1px solid var(--on-color, #fff)" }} onClick={() => void aviso.deshacer?.()}>{t("Undo", "Deshacer")}</button>}
          <button aria-label={t("Close", "Cerrar")} style={{ color: "var(--on-color, #fff)", fontSize: 16 }} onClick={() => setAviso(null)}>✕</button>
        </div>
      )}
      {abierta && <OrderModal me={me} existing={abierta} startEditing={false} onClose={() => setAbierta(null)} />}
    </div>
  );
}
