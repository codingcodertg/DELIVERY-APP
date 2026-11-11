"use client";

import { useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { fmtMoney } from "@/lib/utils";
import { crearGrupoDeMerma, type Reporte } from "@/lib/almacen-ops/datos";
import { SLOTS_DE_FIRMA } from "@/lib/almacen-ops/firmas";
import { EMPRESA, filasDeHoja, tiendasDeHoja, totalDeHoja } from "@/lib/almacen-ops/etapas";
import { etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { fmtDia } from "@/lib/almacen-ops/fecha-del-dano";
import { avisoYaEnGrupo, esErrorDeYaEnGrupo } from "@/lib/almacen-ops/grupos";
import { borrarBorradorDeGrupo, depuraBorrador, leerBorradorDeGrupo } from "@/lib/almacen-ops/borradores-de-grupo";
import { crearGrupoDePractica } from "@/lib/practica/grupos-de-practica";
import { ensenanzaDelNavegador } from "@/lib/ensenanza-general";
import type { Contexto } from "./Operaciones";
import "./reportes/hoja-de-aprobacion/hoja.css";

/**
 * La hoja de un grupo EN BORRADOR (dueño, 11 nov): todavía no existe en la base. «💾 Guardar grupo» lo crea (en
 * práctica, el grupo de práctica) y abre la hoja de siempre para firmar; «Descartar» lo borra; cerrar lo deja como
 * borrador. Las firmas salen apagadas: «Guarda el grupo para firmar».
 */
export function HojaBorrador({ borradorId, ctx, reportesDisponibles, onSalir, onGuardado }: {
  borradorId: string; ctx: Contexto; reportesDisponibles: readonly Reporte[];
  onSalir: () => void; onGuardado: (grupoId: string) => void;
}) {
  const { t, lang } = usePrefs();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const borrador = useMemo(() => leerBorradorDeGrupo(ctx.yo.id, borradorId), [ctx.yo.id, borradorId]);
  const { elegibles, quitadas } = useMemo(
    () => (borrador ? depuraBorrador(borrador, reportesDisponibles) : { elegibles: [] as Reporte[], quitadas: 0 }),
    [borrador, reportesDisponibles]);

  if (!borrador) return (
    <div className="ops-merma">
      <div className="hoja-barra no-imprimir"><span className="hoja-barra-acciones"><button type="button" className="btn btn-ghost" onClick={onSalir}>✕ {t("Close", "Cerrar")}</button></span></div>
      <p className="ops-aviso ops-aviso-error">{t("This draft no longer exists.", "Este borrador ya no existe.")}</p>
    </div>
  );

  const nombre = (id: string) => ctx.personas.find((p) => p.id === id)?.full_name ?? "";
  const filas = filasDeHoja(elegibles, nombre, (m) => etiquetaDeOpcion("scrap", "reason", m, lang) || (m ?? ""), (r) => repartoDeReporte(r).damaged);

  const guardar = async () => {
    if (elegibles.length === 0) return;
    setOcupado(true); setError(null);
    try {
      const id = ensenanzaDelNavegador()
        ? crearGrupoDePractica(borrador.nombre, elegibles, ctx.yo.full_name)
        : await crearGrupoDeMerma(createClient(), borrador.nombre, elegibles.map((r) => r.id));
      borrarBorradorDeGrupo(ctx.yo.id, borrador.id);
      onGuardado(id);
    } catch (e) {
      setError(esErrorDeYaEnGrupo(e) ? avisoYaEnGrupo(1, lang) : (e as Error).message);
    } finally { setOcupado(false); }
  };
  const descartar = () => { borrarBorradorDeGrupo(ctx.yo.id, borrador.id); onSalir(); };

  return (
    <div className="ops-merma" data-hoja-borrador={borrador.id}>
      <div className="hoja-barra no-imprimir">
        <span className="ops-etapa-chip" data-grupo-estado="borrador">📝 {t("Draft — not saved yet", "Borrador — aún no se guarda")}</span>
        <span className="hoja-barra-acciones">
          <button type="button" className="btn btn-primary" disabled={ocupado || elegibles.length === 0} onClick={() => void guardar()} data-accion="guardar-grupo">💾 {t("Save group", "Guardar grupo")}</button>
          <button type="button" className="btn" disabled={ocupado} onClick={descartar} data-accion="descartar-borrador">🗑 {t("Discard", "Descartar")}</button>
          <button type="button" className="btn btn-ghost" onClick={onSalir} data-accion="cerrar-borrador">✕ {t("Close", "Cerrar")}</button>
        </span>
      </div>
      {quitadas > 0 && <p className="hint no-imprimir" role="status" data-borrador-quitadas={quitadas}>{t(
        `${quitadas} report(s) were removed from this draft: they are already in a group or no longer waiting for approval.`,
        `Se quitaron ${quitadas} merma(s) de este borrador: ya están en un grupo o ya no esperan aprobación.`)}</p>}
      {error && <p className="ops-aviso ops-aviso-error no-imprimir">{error}</p>}

      <article className="hoja-aprobacion">
        <header className="hoja-cabecera">
          <div>
            <h1>{EMPRESA}</h1>
            <h2>{t("Scrap approval sheet", "Hoja de aprobación de merma")} · {borrador.nombre}</h2>
          </div>
          <dl className="hoja-datos">
            <dt>{t("Store", "Tienda")}</dt><dd>{tiendasDeHoja(filas) || borrador.store}</dd>
            <dt>{t("Reports", "Reportes")}</dt><dd>{filas.length}</dd>
          </dl>
        </header>
        <table className="hoja-tabla" data-hoja-filas={filas.length}>
          <thead>
            <tr>
              <th>#</th><th>{t("Folio", "Folio")}</th><th>{t("Date broken", "Fecha del daño")}</th><th>{t("Product", "Producto")}</th>
              <th className="num">{t("Damaged pcs", "Pzas dañadas")}</th><th className="num">{t("Loss", "Pérdida")}</th>
              <th>{t("Reason", "Motivo")}</th><th>{t("Broken by", "Lo rompió")}</th><th>{t("Reported by", "Lo reportó")}</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, n) => (
              <tr key={f.id}>
                <td>{n + 1}</td><td>{f.folio}</td><td>{fmtDia(f.dia, lang)}</td><td>{f.producto}</td>
                <td className="num">{f.danadas}</td><td className="num">{fmtMoney(f.perdida)}</td>
                <td>{f.motivo}</td><td>{f.rompio}</td><td>{f.reporto}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={9} className="hoja-vacia">{t("No reports left to group in this draft.", "No quedan mermas para agrupar en este borrador.")}</td></tr>}
          </tbody>
          {filas.length > 0 && <tfoot><tr><td colSpan={5} className="num">{t("Total", "Total")}</td><td className="num">{fmtMoney(totalDeHoja(filas))}</td><td colSpan={3} /></tr></tfoot>}
        </table>
        <section className="hoja-firmas hoja-firmas-digital" data-firmas-borrador>
          {SLOTS_DE_FIRMA.map((slot) => (
            <div className="hoja-firma" key={slot}>
              <span className="hoja-linea" />
              <span>{slot === "gerente" ? t("Manager (approval)", "Gerente (autorización)") : t("Warehouse supervisor", "Supervisor de almacén")}</span>
              <button type="button" className="btn btn-sm no-imprimir" disabled title={t("Save the group to sign", "Guarda el grupo para firmar")}>✍ {t("Save the group to sign", "Guarda el grupo para firmar")}</button>
            </div>
          ))}
        </section>
      </article>
    </div>
  );
}
