"use client";

import { useMemo, useState } from "react";
import { TablaEstandar, type ColumnaEstandar } from "@/components/TablaEstandar";
import { usePrefs } from "@/lib/prefs";
import { agrupaFallas, filtraFallas, type FilaDeFalla, type GrupoDeFallas } from "@/lib/fallas/agrupa";
import { ORIGENES } from "@/lib/fallas/reglas";

/**
 * «Fallas de la app» (2026-11-25): una fila por LUGAR donde falla (la huella), con cuántas veces, en qué app y ruta,
 * con qué versión y a cuántas personas afectó. Clic en una fila → tarjeta con la pila completa, navegadores y
 * versiones, y la primera y la última vez. La tabla es la estándar (TablaEstandar), como todas las del hub.
 */
export function PanelDeFallas({ filas, aviso, demo = false }: {
  filas: FilaDeFalla[];
  aviso: "sin-migracion" | "error" | null;
  demo?: boolean;
}) {
  const { t, lang } = usePrefs();
  const [app, setApp] = useState<string>("");
  const [origen, setOrigen] = useState<string>("");
  const [desde, setDesde] = useState<string>("");
  const [hasta, setHasta] = useState<string>("");
  const [detalle, setDetalle] = useState<GrupoDeFallas | null>(null);

  const apps = useMemo(() => [...new Set(filas.map((f) => f.app))].sort(), [filas]);
  const grupos = useMemo(
    () => agrupaFallas(filtraFallas(filas, { app: app || null, origen: origen || null, desde: desde || null, hasta: hasta || null })),
    [filas, app, origen, desde, hasta],
  );

  const fecha = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-MX" : "en-US", { dateStyle: "short", timeStyle: "short" });

  const columnas: ColumnaEstandar<GrupoDeFallas>[] = [
    { key: "ultima", en: "Last seen", es: "Última vez", valor: (g) => g.ultima, celda: (g) => fecha(g.ultima), ancho: 150 },
    { key: "veces", en: "Count", es: "Veces", valor: (g) => g.veces, numerico: true, ancho: 80 },
    { key: "app", en: "App", es: "App", valor: (g) => g.app, ancho: 110 },
    { key: "ruta", en: "Route", es: "Ruta", valor: (g) => g.ruta, ancho: 220 },
    { key: "mensaje", en: "Message", es: "Mensaje", valor: (g) => g.mensaje, ancho: 360, envuelve: true },
    { key: "origen", en: "Origin", es: "Origen", valor: (g) => g.origen, ancho: 100 },
    { key: "version", en: "Version", es: "Versión", valor: (g) => g.version, ancho: 100 },
    { key: "usuarios", en: "Users affected", es: "Personas afectadas", valor: (g) => g.usuarios, numerico: true, ancho: 130 },
    { key: "primera", en: "First seen", es: "Primera vez", valor: (g) => g.primera, celda: (g) => fecha(g.primera), ancho: 150, oculta: true },
  ];

  const selectStyle = { minWidth: 130 };

  return (
    <div className="fallas-de-la-app">
      <div className="page-head">
        <h2>{t("App errors", "Fallas de la app")}</h2>
        <span className="count-tag">{grupos.length}</span>
      </div>

      {demo && (
        <div className="card" style={{ marginBottom: 12 }}>
          {t("Demo: sample errors. Open /home?probar_falla=1 to throw a test error.",
             "Demo: fallas de muestra. Abre /home?probar_falla=1 para lanzar una falla de prueba.")}
        </div>
      )}
      {aviso === "sin-migracion" && (
        <div className="card" style={{ marginBottom: 12 }}>
          {t("The app error table is not in the database yet (migration 352 is not applied). The app still works; nothing is recorded until it is applied.",
             "Todavía no existe la tabla de fallas en la base (la migración 352 no está aplicada). La app funciona; no se guarda nada hasta aplicarla.")}
        </div>
      )}
      {aviso === "error" && (
        <div className="card" style={{ marginBottom: 12 }}>
          {t("Could not read the app errors right now.", "No se pudieron leer las fallas ahora mismo.")}
        </div>
      )}

      <div className="card" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <label>
          {t("App", "App")}{" "}
          <select value={app} onChange={(e) => setApp(e.target.value)} style={selectStyle}>
            <option value="">{t("All", "Todas")}</option>
            {apps.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>
          {t("Origin", "Origen")}{" "}
          <select value={origen} onChange={(e) => setOrigen(e.target.value)} style={selectStyle}>
            <option value="">{t("All", "Todos")}</option>
            {ORIGENES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>
          {t("From", "Desde")}{" "}
          <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
        </label>
        <label>
          {t("To", "Hasta")}{" "}
          <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
        </label>
      </div>

      <TablaEstandar<GrupoDeFallas>
        id="fallas-de-la-app"
        data-tabla="fallas-de-la-app"
        columnas={columnas}
        filas={grupos}
        claveDe={(g) => g.huella}
        onFila={(g) => setDetalle(g)}
        vacio={t("No app errors recorded.", "No hay fallas registradas.")}
      />

      {detalle && (
        <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) setDetalle(null); }}>
          <div className="modal" role="dialog" aria-modal="true" aria-label={t("Error detail", "Detalle de la falla")} style={{ maxWidth: 780 }}>
            <h3>{detalle.mensaje}</h3>
            <div className="sub">{detalle.app} · {detalle.ruta} · {detalle.origen}</div>
            <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 14px", margin: 0 }}>
              <dt>{t("Count", "Veces")}</dt><dd style={{ margin: 0 }}>{detalle.veces}</dd>
              <dt>{t("Users affected", "Personas afectadas")}</dt><dd style={{ margin: 0 }}>{detalle.usuarios}</dd>
              <dt>{t("First seen", "Primera vez")}</dt><dd style={{ margin: 0 }}>{fecha(detalle.primera)}</dd>
              <dt>{t("Last seen", "Última vez")}</dt><dd style={{ margin: 0 }}>{fecha(detalle.ultima)}</dd>
              <dt>{t("Versions", "Versiones")}</dt><dd style={{ margin: 0 }}>{detalle.versiones.join(", ") || "—"}</dd>
              <dt>{t("Browsers", "Navegadores")}</dt><dd style={{ margin: 0 }}>{detalle.navegadores.join(" · ") || "—"}</dd>
              <dt>{t("Desktop app", "App de escritorio")}</dt><dd style={{ margin: 0 }}>{detalle.escritorio ? t("yes", "sí") : t("no", "no")}</dd>
              <dt>{t("Component", "Componente")}</dt><dd style={{ margin: 0 }}>{detalle.componente ?? "—"}</dd>
            </dl>
            <h4 style={{ margin: "16px 0 6px" }}>{t("Stack", "Pila")}</h4>
            <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", maxHeight: 280, fontSize: 12 }}>{detalle.pila || "—"}</pre>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setDetalle(null)}>{t("Close", "Cerrar")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
