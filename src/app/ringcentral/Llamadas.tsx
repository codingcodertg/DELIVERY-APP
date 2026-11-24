"use client";

import { useEffect, useRef, useState } from "react";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { usePrefs } from "@/lib/prefs";
import { fmtDateTime } from "@/lib/recruiting/utils";
import { CLAVE_DE_VELOCIDAD, rotuloDeVelocidad, siguienteVelocidad, velocidadGuardada } from "@/lib/recruiting/velocidad-de-audio";
import { duracionDeLlamada, esLlamadaPerdida, nombreVisible, numeroLegible } from "@/lib/ringcentral-choferes/choferes";
import {
  cargarLlamadas,
  fechaLocal,
  finDelDia,
  inicioDelDia,
  sincronizarAhora,
  urlDeGrabacion,
  type ChoferDeLaLista,
  type EstadoDeLaSincronizacion,
  type FilaDeLlamada,
} from "@/lib/ringcentral-choferes/cliente";

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Las llamadas de los choferes: una tabla con el estándar de columnas (▾ orden y filtro, ⚙ columnas, anchos) y, en cada
 * fila con grabación, ▶ para escucharla aquí mismo con la velocidad de siempre (1×, 1.5×, 2×). Arriba: los filtros, la
 * última sincronización, el botón «Sincronizar ahora» y, si RingCentral no da el permiso, el aviso que lo dice.
 */
export function Llamadas() {
  const { t } = usePrefs();
  const [extension, setExtension] = useState("");
  const [desdeFecha, setDesdeFecha] = useState(() => fechaLocal(6));
  const [hastaFecha, setHastaFecha] = useState(() => fechaLocal(0));
  const [direccion, setDireccion] = useState<"" | "in" | "out">("");
  const [conGrabacion, setConGrabacion] = useState(false);

  const [filas, setFilas] = useState<FilaDeLlamada[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [choferes, setChoferes] = useState<ChoferDeLaLista[]>([]);
  const [estado, setEstado] = useState<EstadoDeLaSincronizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargandoMas, setCargandoMas] = useState(false);

  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pidiendo, setPidiendo] = useState<string | null>(null);
  const [velocidad, setVelocidad] = useState(1);
  useEffect(() => { try { setVelocidad(velocidadGuardada(localStorage.getItem(CLAVE_DE_VELOCIDAD))); } catch { /* sin almacenamiento: 1× */ } }, []);
  const cambiaVelocidad = () => setVelocidad((v) => { const n = siguienteVelocidad(v); try { localStorage.setItem(CLAVE_DE_VELOCIDAD, String(n)); } catch { /* da igual */ } return n; });

  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [esperaHasta, setEsperaHasta] = useState(0);
  const [, latido] = useState(0);
  const restante = Math.max(0, Math.ceil((esperaHasta - Date.now()) / 1000));

  const valido = FECHA.test(desdeFecha) && FECHA.test(hastaFecha) && desdeFecha <= hastaFecha;
  const seq = useRef(0);

  const cargar = (pag: number, reemplaza: boolean) => {
    if (!valido) return;
    const mio = ++seq.current;
    if (reemplaza) setError(null);
    cargarLlamadas({ extension, desde: inicioDelDia(desdeFecha), hasta: finDelDia(hastaFecha), direccion, conGrabacion }, pag)
      .then((r) => {
        if (mio !== seq.current) return;
        setFilas((prev) => (reemplaza || pag === 1 ? r.rows : [...(prev ?? []), ...r.rows]));
        setPagina(r.pagina);
        setHayMas(r.hayMas);
        setChoferes(r.choferes);
        setEstado(r.estado);
        setEsperaHasta(Date.now() + r.estado.esperaSeg * 1000);
      })
      .catch(() => {
        if (mio !== seq.current) return;
        setError(t("Could not load the calls. Try again.", "No se pudieron cargar las llamadas. Intenta de nuevo."));
        if (pag === 1) setFilas([]);
      })
      .finally(() => { if (mio === seq.current) setCargandoMas(false); });
  };

  // Cada cambio de filtro vuelve a la primera página.
  useEffect(() => {
    cargar(1, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extension, desdeFecha, hastaFecha, direccion, conGrabacion, valido]);

  // Cuenta regresiva de la espera de «Sincronizar ahora».
  useEffect(() => {
    if (esperaHasta <= Date.now()) return;
    const id = setInterval(() => { latido((n) => n + 1); if (esperaHasta <= Date.now()) clearInterval(id); }, 1000);
    return () => clearInterval(id);
  }, [esperaHasta]);

  const sincronizar = async () => {
    setSincronizando(true);
    setAviso(null);
    const r = await sincronizarAhora();
    setSincronizando(false);
    if (r.motivo === "espera") {
      setEsperaHasta(Date.now() + (r.esperaSeg ?? 0) * 1000);
      setAviso(t("A sync ran a moment ago. Wait a little and try again.", "Hace un momento ya se sincronizó. Espera un poco y vuelve a intentar."));
    } else if (r.ok) {
      setAviso(t(
        `Done: ${r.llamadas ?? 0} calls read, ${r.grabaciones ?? 0} recordings downloaded, ${r.pendientes ?? 0} still pending.`,
        `Listo: ${r.llamadas ?? 0} llamadas leídas, ${r.grabaciones ?? 0} grabaciones bajadas, ${r.pendientes ?? 0} aún pendientes.`,
      ));
    } else if (r.motivo === "sin_permiso") {
      setAviso(null);
    } else if (r.motivo === "limite") {
      setAviso(t("RingCentral is limiting requests. Try again in a few minutes.", "RingCentral está limitando las peticiones. Intenta en unos minutos."));
    } else {
      setAviso(t("The sync did not finish. Try again later.", "La sincronización no terminó. Intenta más tarde."));
    }
    cargar(1, false);
  };

  const escuchar = async (id: string) => {
    setPidiendo(id);
    setError(null);
    try {
      const u = await urlDeGrabacion(id);
      setUrls((prev) => ({ ...prev, [id]: u }));
    } catch {
      setError(t("Could not load the recording.", "No se pudo cargar la grabación."));
    } finally {
      setPidiendo(null);
    }
  };

  const etiquetaSentido = (d: "in" | "out") => (d === "in" ? t("Inbound", "Entrante") : t("Outbound", "Saliente"));

  const columnas: ColumnaEstandar<FilaDeLlamada>[] = [
    { key: "fecha", en: "Date and time", es: "Fecha y hora", ancho: 150, valor: (f) => f.started_at, celda: (f) => fmtDateTime(f.started_at) },
    {
      key: "chofer", en: "Driver", es: "Chofer", ancho: 170,
      valor: (f) => `${nombreVisible(f.driverNombre, f.driverNumero)} ${f.driverNumero}`,
      celda: (f) => (
        <>
          <span>{nombreVisible(f.driverNombre, f.driverNumero)}</span>
          <span className="hint"> · {f.driverNumero}</span>
        </>
      ),
    },
    { key: "sentido", en: "Direction", es: "Sentido", ancho: 110, valor: (f) => etiquetaSentido(f.direction), celda: (f) => etiquetaSentido(f.direction) },
    {
      key: "otra", en: "Other party", es: "Otra parte", ancho: 200, envuelve: true,
      valor: (f) => {
        const nombre = f.direction === "in" ? f.from_name : f.to_name;
        const numero = f.direction === "in" ? f.from_number : f.to_number;
        return `${nombre ?? ""} ${numeroLegible(numero)}`.trim() || null;
      },
      celda: (f) => {
        const nombre = f.direction === "in" ? f.from_name : f.to_name;
        const numero = f.direction === "in" ? f.from_number : f.to_number;
        return (
          <>
            <span>{nombre || "—"}</span>
            {numero && <span className="hint" style={{ display: "block" }}>{numeroLegible(numero)}</span>}
          </>
        );
      },
    },
    { key: "duracion", en: "Duration", es: "Duración", ancho: 90, numerico: true, valor: (f) => f.duration_s, celda: (f) => duracionDeLlamada(f.duration_s) },
    { key: "resultado", en: "Result", es: "Resultado", ancho: 120, valor: (f) => f.result, celda: (f) => f.result ?? "—" },
    {
      key: "grabacion", en: "Recording", es: "Grabación", ancho: 210,
      valor: (f) => (f.hasRecording ? t("Yes", "Sí") : f.recording_pending ? t("Pending", "Pendiente") : null),
      celda: (f) => {
        if (!f.hasRecording) {
          return f.recording_pending ? <span className="hint">{t("Pending", "Pendiente")}</span> : <span className="hint">—</span>;
        }
        if (!urls[f.id]) {
          return (
            <button type="button" className="btn btn-ghost btn-sm" data-escuchar={f.id} disabled={pidiendo === f.id}
              onClick={() => escuchar(f.id)}>
              ▶ {t("Play", "Escuchar")}
            </button>
          );
        }
        return (
          <span className="rcc-audio">
            <audio controls preload="none" src={urls[f.id]} className="rcc-audio-reproductor"
              ref={(el) => { if (el) el.playbackRate = velocidad; }} onPlay={(e) => { e.currentTarget.playbackRate = velocidad; }} />
            <button type="button" data-velocidad-de-audio={velocidad} onClick={cambiaVelocidad}
              title={t("Playback speed: tap to change", "Velocidad: toque para cambiarla")}
              aria-label={t(`Playback speed ${rotuloDeVelocidad(velocidad)}`, `Velocidad ${rotuloDeVelocidad(velocidad)}`)}
              className={`rcc-velocidad${velocidad === 1 ? "" : " rcc-velocidad-activa"}`}>
              {rotuloDeVelocidad(velocidad)}
            </button>
          </span>
        );
      },
    },
  ];

  const ultima = estado?.ultimaSincronizacion ? fmtDateTime(estado.ultimaSincronizacion) : t("never", "nunca");
  const sinChoferes = estado !== null && choferes.length === 0;

  return (
    <section className="rcc-seccion" aria-label={t("Calls", "Llamadas")}>
      {estado?.sinPermiso && (
        <div className="rcc-aviso" role="alert" data-aviso-sin-permiso>
          {t(
            "RingCentral has not granted permission to read other extensions' calls (ReadCompanyCallLog). Until the administrator grants it, this list stays empty.",
            "RingCentral no ha dado permiso para leer las llamadas de otras extensiones (ReadCompanyCallLog). Hasta que el administrador lo conceda, esta lista queda vacía.",
          )}
        </div>
      )}

      <div className="rcc-sincronizar">
        <span className="hint">{t("Last sync", "Última sincronización")}: {ultima}</span>
        <button type="button" className="btn btn-sm" onClick={sincronizar} disabled={sincronizando || restante > 0} data-sincronizar>
          {sincronizando
            ? t("Syncing…", "Sincronizando…")
            : restante > 0
              ? t(`Sync now (${restante} s)`, `Sincronizar ahora (${restante} s)`)
              : t("Sync now", "Sincronizar ahora")}
        </button>
      </div>
      {aviso && <div className="hint" role="status">{aviso}</div>}

      <div className="rcc-filtros">
        <label className="rcc-campo">
          <span>{t("Driver", "Chofer")}</span>
          <select value={extension} onChange={(e) => setExtension(e.target.value)} data-filtro="chofer">
            <option value="">{t("All drivers", "Todos los choferes")}</option>
            {choferes.map((c) => (
              <option key={c.id} value={c.id}>{nombreVisible(c.nombre, c.numero)} · {c.numero}</option>
            ))}
          </select>
        </label>
        <label className="rcc-campo">
          <span>{t("From", "Desde")}</span>
          <input type="date" value={desdeFecha} onChange={(e) => setDesdeFecha(e.target.value)} data-filtro="desde" />
        </label>
        <label className="rcc-campo">
          <span>{t("To", "Hasta")}</span>
          <input type="date" value={hastaFecha} onChange={(e) => setHastaFecha(e.target.value)} data-filtro="hasta" />
        </label>
        <label className="rcc-campo">
          <span>{t("Direction", "Sentido")}</span>
          <select value={direccion} onChange={(e) => setDireccion(e.target.value as "" | "in" | "out")} data-filtro="direccion">
            <option value="">{t("All", "Todas")}</option>
            <option value="in">{t("Inbound", "Entrantes")}</option>
            <option value="out">{t("Outbound", "Salientes")}</option>
          </select>
        </label>
        <label className="rcc-casilla">
          <input type="checkbox" checked={conGrabacion} onChange={(e) => setConGrabacion(e.target.checked)} data-filtro="grabacion" />
          <span>{t("Only with recording", "Solo con grabación")}</span>
        </label>
      </div>
      {!valido && <div className="hint" style={{ color: "var(--red, #b91c1c)" }}>{t("Check the dates: “From” must be before “To”.", "Revisa las fechas: «Desde» debe ser anterior a «Hasta».")}</div>}
      {error && <div className="hint" style={{ color: "var(--red, #b91c1c)" }}>{error}</div>}
      {sinChoferes && (
        <div className="hint">{t("No drivers marked yet. Mark them in the Drivers tab.", "Aún no hay choferes marcados. Márcalos en la pestaña Choferes.")}</div>
      )}

      {filas === null ? (
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      ) : (
        <>
          <TablaEstandar
            id="ringcentral-llamadas"
            data-tabla="ringcentral-llamadas"
            claseTabla="rcc-tabla"
            filas={filas}
            claveDe={(f) => f.id}
            vacio={t("No calls in this range.", "No hay llamadas en este rango.")}
            ordenInicial={{ clave: "fecha", direccion: "desc" }}
            columnas={columnas}
            /* Las perdidas van en rojo (D-1145, reunión del 23 nov 2026): solo cambia el color, nada más de la fila. */
            claseDeFila={(f) => (esLlamadaPerdida(f.result) ? "rcc-perdida" : undefined)}
          />
          {hayMas && (
            <div className="rcc-mas">
              <button type="button" className="btn btn-ghost btn-sm" disabled={cargandoMas}
                onClick={() => { setCargandoMas(true); cargar(pagina + 1, false); }} data-cargar-mas>
                {cargandoMas ? t("Loading…", "Cargando…") : t("Load more", "Cargar más")}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
