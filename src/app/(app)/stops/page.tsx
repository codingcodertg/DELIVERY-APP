"use client";

import { useEffect, useMemo, useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { usePausasDelChofer } from "@/lib/usePausasDelChofer";
import { PausaDelChoferVista, DialogoDeReciboPendiente, avisoDeFalloDePausa } from "@/components/PausaDelChofer";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { MOTIVOS_DE_PAUSA, reciboTardio, pideRecibo, nombreDelMotivo, type PausaDelChofer } from "@/lib/pausas-del-chofer";
import {
  lineaDelDia, limitesDelDia, puedeIrAlDiaSiguiente, totalesDelDia, turnosDelDia, type ItemDelDia, type ParadaDeLaLinea,
} from "@/lib/paradas-del-dia";
import { NOTA_TURNO_AUTOMATICO } from "@/lib/turno-automatico";
import { shiftDateISO, todayISO } from "@/lib/utils";

// ============================================================
// «Paradas» (2026-11-19): la tercera pestaña del chofer, con «Mi ruta» y «Órdenes». Es la bitácora de SU día: cuándo entró
// y salió del turno, cada parada que registró (con su foto y su monto) y los totales. No es el Time Tracker ni enseña
// entregas: solo lo que el chofer marcó y el turno.
//
// Desde aquí también se registra o se termina una parada (la misma pieza de «Mi ruta», `PausaDelChoferVista`), y se le puede
// añadir la foto a una ya cerrada. Se puede mirar ayer o antes; nunca un día futuro. Lo que se pinta lo decide
// `lib/paradas-del-dia.ts`.
// ============================================================

const hora = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const TARJETA: React.CSSProperties = { display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: "1px solid var(--line, #e5e5e5)", borderRadius: 10, background: "var(--card, #fff)", minWidth: 0 };
const ICONO: React.CSSProperties = { flex: "0 0 36px", width: 36, height: 36, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, background: "var(--bg-soft, #f3f4f6)" };

export default function StopsPage() {
  const { me, shifts, teaching, notify } = useData();
  const { t, lang } = usePrefs();
  const hoy = todayISO();
  const [dia, setDia] = useState(hoy);
  const [ahora, setAhora] = useState(() => new Date());
  const [viendo, setViendo] = useState<string | null>(null);
  const [anadiendo, setAnadiendo] = useState<PausaDelChofer | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esHoy = dia === hoy;

  // Las paradas en curso cuentan su tiempo: se refresca cada 30 s, solo mientras se mira el día de hoy.
  useEffect(() => {
    if (!esHoy) return;
    const id = setInterval(() => setAhora(new Date()), 30_000);
    return () => clearInterval(id);
  }, [esHoy]);

  const driverId = me?.id ?? null;
  const store = usePausasDelChofer(driverId, dia, { practica: teaching });
  const { desde, hasta } = limitesDelDia(dia);
  const turnos = useMemo(
    () => turnosDelDia((shifts ?? []).filter((s) => s.driver_id === driverId), desde, hasta),
    [shifts, driverId, desde, hasta],
  );
  const linea = useMemo(() => lineaDelDia({ turnos, paradas: store.pausas, ahora }), [turnos, store.pausas, ahora]);
  const totales = useMemo(() => totalesDelDia(store.pausas, ahora), [store.pausas, ahora]);

  const nombreDia = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`);
  const cargando = store.estado === "cargando";

  const alAnadirFoto = async (p: PausaDelChofer, entrada: { foto: string | null; monto: string; galones: string }) => {
    if (ocupado) return;
    const recibo = reciboTardio(entrada, p.motivo);
    if ("falta" in recibo) return;
    setOcupado(true);
    setError(null);
    const r = await store.recibir(p, recibo);
    setOcupado(false);
    if (!r.ok) { const m = avisoDeFalloDePausa(r, t, lang, true); setError(m); notify(m); return; }
    setAnadiendo(null);
    notify(t("Photo saved", "Foto guardada"));
  };

  const etiquetaDelTurno = (it: Extract<ItemDelDia, { tipo: "turno-inicio" | "turno-fin" }>) => {
    if (it.tipo === "turno-inicio") {
      return (
        <>
          <b>{t("Clocked in", "Entrada al turno")}</b>
          {it.nota === NOTA_TURNO_AUTOMATICO && (
            <span className="hint" style={{ display: "block", margin: 0 }}>{t("Started with your first pickup", "Empezó con tu primera carga")}</span>
          )}
        </>
      );
    }
    return <b>{t("Clocked out", "Salida del turno")}</b>;
  };

  const filaDeParada = (p: ParadaDeLaLinea) => {
    const motivo = MOTIVOS_DE_PAUSA.find((m) => m.clave === p.motivo);
    const gas = pideRecibo(p.motivo);
    const original = store.pausas.find((x) => x.id === p.id) ?? null;
    const enCurso = p.enCurso;
    return (
      <div key={p.id} data-parada-de-la-linea={p.id} data-en-curso={enCurso ? "si" : "no"} style={{ ...TARJETA, borderColor: enCurso ? "var(--amber, #e9a13b)" : undefined }}>
        <div style={ICONO} aria-hidden>{motivo?.icono ?? "⏸"}</div>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
            <b>{nombreDelMotivo(p.motivo, lang)}</b>
            <span className="hint" style={{ margin: 0 }}>
              {hora(p.desde)} – {p.hasta ? hora(p.hasta) : t("now", "ahora")}
            </span>
          </div>
          <div className="hint" style={{ margin: 0 }} data-duracion>
            {enCurso
              ? <b style={{ color: "var(--amber-text, #92400e)" }}>{t("In progress", "En curso")} · {fmtMin(p.minutos)}</b>
              : fmtMin(p.minutos)}
          </div>
          {p.nota && <div className="hint" style={{ margin: "2px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.nota}</div>}
          {(p.monto != null || (gas && p.galones != null)) && (
            <div style={{ marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }} data-monto-de-la-parada>
              {p.monto != null && <span><b>${p.monto.toFixed(2)}</b></span>}
              {gas && p.galones != null && <span className="hint" style={{ margin: 0 }}>{p.galones} {t("gal", "gal")}</span>}
            </div>
          )}
          {gas && p.reciboPendiente && (
            <div className="hint" data-recibo-pendiente style={{ margin: "4px 0 0", color: "var(--amber-text, #92400e)" }}>
              🧾 {t("Receipt pending", "Recibo pendiente")}
            </div>
          )}
          {gas && p.sinRecibo && (
            <div className="hint" style={{ margin: "4px 0 0" }}>{t("No receipt (you said so)", "Sin recibo (lo dijiste)")}</div>
          )}
          {p.puedeAnadirFoto && original && (
            <button className="btn btn-primary" data-anadir-foto-parada style={{ minHeight: 44, marginTop: 6 }} disabled={ocupado}
              onClick={() => { setError(null); setAnadiendo(original); }}>
              📷 {gas ? t("Add receipt", "Añadir recibo") : t("Add photo", "Añadir foto")}
            </button>
          )}
        </div>
        {p.foto && (
          <button type="button" data-foto-de-la-parada aria-label={t("Open the photo", "Abrir la foto")} onClick={() => setViendo(p.foto)}
            style={{ flex: "0 0 auto", padding: 0, border: 0, background: "none", cursor: "zoom-in", minHeight: 44 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.foto} alt="" loading="lazy" decoding="async" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, display: "block" }} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div data-paradas-del-chofer>
      <h2 style={{ margin: "8px 0 4px" }}>⏸ {t("Stops", "Paradas")}</h2>

      {/* El día: el de ayer y el de antes, nunca uno futuro. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }} data-dia-de-paradas>
        <button className="btn btn-ghost" data-dia-anterior style={{ minHeight: 44, flex: "0 0 auto" }} onClick={() => setDia(shiftDateISO(dia, -1))}>
          ‹ {t("Previous", "Anterior")}
        </button>
        <div style={{ flex: "1 1 auto", textAlign: "center", fontWeight: 700, minWidth: 0 }} data-dia-mostrado={dia}>
          {esHoy ? t("Today", "Hoy") : nombreDia(dia)}
          {esHoy && <span className="hint" style={{ display: "block", margin: 0, fontWeight: 400 }}>{nombreDia(dia)}</span>}
        </div>
        <button className="btn btn-ghost" data-dia-siguiente style={{ minHeight: 44, flex: "0 0 auto" }} disabled={!puedeIrAlDiaSiguiente(dia, hoy)}
          onClick={() => setDia(shiftDateISO(dia, 1))}>
          {t("Next", "Siguiente")} ›
        </button>
      </div>

      {/* Registrar, terminar o añadir el recibo de la parada: la misma pieza de «Mi ruta», con el estado de esta pantalla. */}
      <div style={{ marginBottom: 10 }}>
        <PausaDelChoferVista store={store} dia={dia} mostrarPendientes={false} />
      </div>

      {/* Totales del día. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, marginBottom: 12 }} data-totales-del-dia>
        <div className="card" style={{ margin: 0, padding: 10 }}>
          <div className="hint" style={{ margin: 0 }}>{t("Stops", "Paradas")}</div>
          <b style={{ fontSize: 18 }} data-total-paradas>{totales.paradas}</b>
        </div>
        <div className="card" style={{ margin: 0, padding: 10 }}>
          <div className="hint" style={{ margin: 0 }}>{t("Stop time", "Tiempo parado")}</div>
          <b style={{ fontSize: 18 }} data-total-minutos>{fmtMin(totales.minutos)}</b>
        </div>
        <div className="card" style={{ margin: 0, padding: 10 }}>
          <div className="hint" style={{ margin: 0 }}>⛽ {t("Gas paid", "Gasolina pagada")}</div>
          <b style={{ fontSize: 18 }} data-total-gas-monto>${totales.gasolinaMonto.toFixed(2)}</b>
        </div>
        <div className="card" style={{ margin: 0, padding: 10 }}>
          <div className="hint" style={{ margin: 0 }}>⛽ {t("Gallons", "Galones")}</div>
          <b style={{ fontSize: 18 }} data-total-gas-galones>{totales.gasolinaGalones}</b>
        </div>
      </div>

      {error && <div className="hint" data-error-de-paradas style={{ color: "var(--red)", marginBottom: 8 }}>{error}</div>}

      {/* La línea de tiempo del día. */}
      {cargando ? (
        <div className="empty">{t("Loading…", "Cargando…")}</div>
      ) : store.estado === "sin-tabla" ? (
        <div className="empty">{t("Stops aren't available yet: the database is missing its update.", "Las paradas aún no están disponibles: a la base le falta su actualización.")}</div>
      ) : store.estado === "error" ? (
        <div className="empty">{t("Couldn't read the stops of the day.", "No se pudieron leer las paradas del día.")}</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }} data-linea-del-dia>
          {!linea.huboTurno && esHoy && (
            <div className="hint" data-sin-turno style={{ margin: 0 }}>
              {t("No shift yet today. It starts with your first pickup, or when you tap Clock in on Orders.", "Aún no hay turno hoy. Empieza con tu primera carga, o cuando marques entrada en Órdenes.")}
            </div>
          )}
          {linea.items.length === 0 && (
            <div className="card" data-vacio style={{ margin: 0, textAlign: "center", padding: 18 }}>
              <div style={{ fontSize: 28 }} aria-hidden>🛣️</div>
              <b>{esHoy ? t("No stops yet today", "Todavía no hay paradas hoy") : t("Nothing logged that day", "No hay nada registrado ese día")}</b>
              <div className="hint" style={{ margin: "4px 0 0" }}>
                {t("When you stop for gas, food or anything else, log it with «Log a stop» and it shows up here.", "Cuando pares por gasolina, comida o cualquier otra cosa, regístrala con «Registrar parada» y aparece aquí.")}
              </div>
            </div>
          )}
          {linea.items.map((it) => {
            if (it.tipo === "parada") return filaDeParada(it);
            return (
              <div key={`${it.tipo}-${it.at}`} data-turno={it.tipo} style={{ ...TARJETA, background: "var(--bg-soft, #f9fafb)" }}>
                <div style={ICONO} aria-hidden>{it.tipo === "turno-inicio" ? "🟢" : "🔴"}</div>
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
                    {etiquetaDelTurno(it)}
                    <span className="hint" style={{ margin: 0 }}>{hora(it.at)}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {linea.turnoAbierto && esHoy && (
            <div className="hint" data-turno-abierto style={{ margin: 0, textAlign: "center" }}>
              {t("Still on the clock", "Sigues en turno")}
            </div>
          )}
        </div>
      )}

      {anadiendo && (
        <DialogoDeReciboPendiente p={anadiendo} t={t} lang={lang} ocupado={ocupado} error={error}
          onCancelar={() => setAnadiendo(null)} onConfirmar={(entrada) => void alAnadirFoto(anadiendo, entrada)} />
      )}
      {viendo && <PhotoLightbox photos={[viendo]} index={0} onIndex={() => {}} onClose={() => setViendo(null)} t={t} />}
    </div>
  );
}

