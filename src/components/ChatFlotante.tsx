"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { soloActivos } from "@/lib/baja";
import { usePathname } from "next/navigation";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { EVENTO_ABRIR_CHAT, EVENTO_CHAT_SIN_LEER } from "@/lib/boton-general";
import {
  CLAVE_DE_ESTADO, type Contacto, type EstadoDeLaBurbuja, type Hilo, type Mensaje,
  chatEnLaRuta, conMensaje, cuerpoValido, esDeMiTienda, estadoInicial, hilos, hilosRecientes, listaVisible, noLeidosTotal,
} from "@/lib/chat/chat";

/**
 * «💬 Chat» (D-609, 2026-10-20): la burbuja arriba a la derecha, en todas las apps (está en el layout raíz, como la de
 * Ayuda). Se oculta (queda una pestañita en el borde para volver a sacarla) y se abre en un panel: contactos —los de mi
 * tienda primero, búsqueda por nombre— y el hilo con cada uno. Los mensajes llegan por tiempo real; mandar pasa por
 * `/api/chat/send` (mensaje + aviso en la campana + push si quien escribe es admin). Sin sesión no se monta.
 */
type Yo = { id: string; full_name: string; store: string | null; role: string | null };

/** `sinBurbuja` (D-623, 2026-10-21): la burbuja general es la única que se ve; aquí solo el panel, cuando ella lo pide. */
export function ChatFlotante({ sinBurbuja = false }: { sinBurbuja?: boolean } = {}) {
  const pathname = usePathname();
  const { t, lang } = usePrefs();
  const supabase = useMemo(() => createClient(), []);
  const [yo, setYo] = useState<Yo | null>(null);
  const [contactos, setContactos] = useState<Contacto[]>([]);
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [estado, setEstado] = useState<EstadoDeLaBurbuja>("burbuja");
  const [con, setCon] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fin = useRef<HTMLDivElement | null>(null);
  const sale = chatEnLaRuta(pathname);
  useEffect(() => {
    const abre = () => cambiaEstado("abierta");
    window.addEventListener(EVENTO_ABRIR_CHAT, abre);
    return () => window.removeEventListener(EVENTO_ABRIR_CHAT, abre);
  }, []);

  useEffect(() => {
    try { setEstado(estadoInicial(localStorage.getItem(CLAVE_DE_ESTADO))); } catch { /* sin almacenamiento */ }
  }, []);
  const cambiaEstado = (e: EstadoDeLaBurbuja) => {
    setEstado(e);
    try { if (e === "oculta") localStorage.setItem(CLAVE_DE_ESTADO, "oculta"); else localStorage.removeItem(CLAVE_DE_ESTADO); } catch { /* nada */ }
  };

  // Sesión, perfil, contactos y mensajes; luego la suscripción. Todo con la sesión del navegador (la RLS filtra).
  useEffect(() => {
    if (!sale) return;
    let vivo = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !vivo) return;
      const { data: p } = await supabase.from("profiles").select("id, full_name, store, role").eq("id", user.id).maybeSingle();
      if (!p || !vivo) return;
      setYo({ id: p.id, full_name: p.full_name ?? "", store: p.store ?? null, role: p.role ?? null });
      const [{ data: cs }, { data: ms }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, store, role, title, left_at").order("full_name"),
        supabase.from("chat_messages").select("id, from_user, to_user, body, created_at, read_at").order("created_at", { ascending: false }).limit(500),
      ]);
      if (!vivo) return;
      setContactos((cs ?? []) as Contacto[]);
      setMensajes((ms ?? []) as Mensaje[]);
    })();
    return () => { vivo = false; };
  }, [sale, supabase]);

  useEffect(() => {
    if (!yo) return;
    const ch = supabase.channel(`chat-${yo.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `to_user=eq.${yo.id}` },
        (p) => setMensajes((l) => conMensaje(l, p.new as Mensaje)))
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "chat_messages", filter: `from_user=eq.${yo.id}` },
        (p) => setMensajes((l) => conMensaje(l, p.new as Mensaje)))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [yo, supabase]);

  const porId = useMemo(() => new Map(contactos.map((c) => [c.id, c])), [contactos]);
  const h = useMemo(() => (yo ? hilos(mensajes, yo.id) : new Map<string, Hilo>()), [mensajes, yo]);
  const sinLeer = noLeidosTotal(h);
  // La burbuja general enseña el contador (D-623): se le manda cada vez que cambia.
  useEffect(() => { window.dispatchEvent(new CustomEvent(EVENTO_CHAT_SIN_LEER, { detail: sinLeer })); }, [sinLeer]);
  const hilo = con ? h.get(con) : undefined;

  // Al abrir un hilo, lo que me mandaron queda leído (solo `read_at`, y solo el destinatario: la 184).
  const marcarLeido = useCallback(async (otro: string) => {
    if (!yo) return;
    const ids = mensajes.filter((m) => m.from_user === otro && m.to_user === yo.id && !m.read_at).map((m) => m.id);
    if (!ids.length) return;
    const ahora = new Date().toISOString();
    setMensajes((l) => l.map((m) => (ids.includes(m.id) ? { ...m, read_at: ahora } : m)));
    await supabase.from("chat_messages").update({ read_at: ahora }).in("id", ids);
  }, [yo, mensajes, supabase]);

  useEffect(() => { if (con && estado === "abierta") void marcarLeido(con); }, [con, estado, mensajes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [hilo?.mensajes.length, con]);

  const enviar = async () => {
    if (!yo || !con) return;
    const cuerpo = cuerpoValido(texto);
    if (!cuerpo) return;
    setEnviando(true); setError(null);
    try {
      const r = await fetch("/api/chat/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: con, body: cuerpo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j?.error ?? t("Could not send", "No se pudo mandar")); return; }
      setMensajes((l) => conMensaje(l, { id: j.id, from_user: yo.id, to_user: con, body: cuerpo, created_at: j.created_at ?? new Date().toISOString(), read_at: null }));
      setTexto("");
    } finally { setEnviando(false); }
  };

  if (!sale || !yo) return null;
  if (sinBurbuja && estado !== "abierta") return null;

  const hora = (iso: string) => new Date(iso).toLocaleTimeString(lang === "es" ? "es-MX" : "en-US", { hour: "numeric", minute: "2-digit" });
  const nombreDe = (id: string) => porId.get(id)?.full_name ?? "…";
  const lista = listaVisible(soloActivos(contactos), yo, busqueda); // D-NEXT
  const recientes = hilosRecientes(h);
  const badge = sinLeer > 0 ? <span className="chat-badge" data-sin-leer={sinLeer}>{sinLeer > 99 ? "99+" : sinLeer}</span> : null;

  if (estado === "oculta") {
    return (
      <button className="chat-tab no-print" data-chat="oculta" title={t("Show chat", "Mostrar chat")} onClick={() => cambiaEstado("burbuja")}>💬{badge}</button>
    );
  }
  if (estado === "burbuja") {
    return (
      <button className="chat-fab no-print" data-chat="burbuja" onClick={() => cambiaEstado("abierta")} title={t("Internal chat", "Chat interno")}>
        <span>💬</span><span className="chat-fab-label">{t("Chat", "Chat")}</span>{badge}
      </button>
    );
  }
  return (
    <div className="chat-panel no-print" data-chat="abierta" role="dialog" aria-label={t("Internal chat", "Chat interno")}>
      <div className="chat-head">
        {con ? (
          <button className="btn btn-ghost btn-sm" onClick={() => setCon(null)}>← {t("Contacts", "Contactos")}</button>
        ) : (
          <strong>💬 {t("Chat", "Chat")}</strong>
        )}
        {con && <strong style={{ flex: 1, textAlign: "center" }}>{nombreDe(con)}</strong>}
        <span style={{ marginLeft: "auto", display: "inline-flex", gap: 4 }}>
          <button className="btn btn-ghost btn-sm" title={t("Minimize", "Minimizar")} onClick={() => cambiaEstado("burbuja")}>—</button>
          <button className="btn btn-ghost btn-sm" title={t("Hide chat", "Ocultar chat")} onClick={() => cambiaEstado("oculta")}>✕</button>
        </span>
      </div>

      {!con ? (
        <div className="chat-body">
          <input className="chat-buscar" placeholder={t("Search anyone by name…", "Buscar a cualquiera por nombre…")} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} autoFocus />
          {!busqueda && recientes.length > 0 && (
            <>
              <div className="chat-grupo">{t("Recent", "Recientes")}</div>
              {recientes.map((x) => (
                <button key={x.con} className="chat-contacto" onClick={() => setCon(x.con)}>
                  <span className="chat-nombre">{nombreDe(x.con)}</span>
                  <span className="chat-ultimo">{x.ultimo?.body}</span>
                  {x.noLeidos > 0 && <span className="chat-badge chat-badge-fila">{x.noLeidos}</span>}
                </button>
              ))}
            </>
          )}
          <div className="chat-grupo">{yo.store ? `🏪 ${yo.store}` : t("People", "Personas")}</div>
          {lista.map((c, i) => {
            const cambiaATodos = yo.store && i > 0 && esDeMiTienda(lista[i - 1], yo) && !esDeMiTienda(c, yo);
            const nl = h.get(c.id)?.noLeidos ?? 0;
            return (
              <div key={c.id}>
                {cambiaATodos && <div className="chat-grupo">{t("Everyone else", "Los demás")}</div>}
                <button className="chat-contacto" onClick={() => setCon(c.id)}>
                  <span className="chat-nombre">{c.full_name}</span>
                  <span className="chat-ultimo">{[c.title, c.store].filter(Boolean).join(" · ")}</span>
                  {nl > 0 && <span className="chat-badge chat-badge-fila">{nl}</span>}
                </button>
              </div>
            );
          })}
          {lista.length === 0 && (
            <div className="hint" style={{ padding: 8 }}>
              {busqueda.trim() ? t("Nobody matches", "Nadie coincide") : t("Search anyone from another store by name.", "A los de otra tienda se les busca por nombre.")}
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="chat-body chat-hilo">
            {(hilo?.mensajes ?? []).map((m) => (
              <div key={m.id} className={"chat-msg " + (m.from_user === yo.id ? "mio" : "suyo")}>
                <div>{m.body}</div>
                <div className="chat-hora">{hora(m.created_at)}{m.from_user === yo.id && m.read_at ? " · ✓✓" : ""}</div>
              </div>
            ))}
            {!hilo && <div className="hint" style={{ padding: 8 }}>{t("Say hi 👋", "Saluda 👋")}</div>}
            <div ref={fin} />
          </div>
          {error && <div className="hint" style={{ color: "var(--red)", padding: "0 8px" }}>{error}</div>}
          <form className="chat-escribir" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
            <textarea rows={2} value={texto} placeholder={t("Write a message…", "Escribe un mensaje…")} autoFocus
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={enviando || !cuerpoValido(texto)}>{t("Send", "Enviar")}</button>
          </form>
        </>
      )}
    </div>
  );
}
