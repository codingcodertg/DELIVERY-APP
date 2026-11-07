import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { ProfileReadError } from "@/components/ProfileReadError";
import { leerNivelEscrito } from "@/lib/almacen-ops/nivel";
import { etiquetaDeOpcion } from "@/lib/almacen-ops/pasos";
import { repartoDeReporte } from "@/lib/almacen-ops/perdida";
import { DEMO_PERSONAS, DEMO_REPORTES, type Reporte } from "@/lib/almacen-ops/datos";
import { EMPRESA, RECORDATORIO_EN, RECORDATORIO_ES, filasDeHoja, idsDeConsulta, puedeImprimirHoja, tiendasDeHoja, totalDeHoja } from "@/lib/almacen-ops/etapas";
import { fmtDia } from "@/lib/almacen-ops/fecha-del-dano";
import { fmtMoney } from "@/lib/utils";
import { BotonImprimir } from "./BotonImprimir";
import "./hoja.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hoja de aprobación de merma" };
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type Lang = "en" | "es";
const T = (lang: Lang) => (en: string, es: string) => (lang === "es" ? es : en);

/**
 * D-NEXT (migración 270): la hoja de aprobación de merma, lista para imprimir (`/operaciones/reportes/hoja-de-aprobacion?ids=a,b,c`).
 * Roberto: «select rows that will be printed for approval. They will sign the sheet, manager will attach it to that report».
 *
 * Se pinta en el SERVIDOR con la misma puerta que la vista de gerentes (`puedeImprimirHoja` = `veLosReportes`); las
 * filas salen por la RLS de la 265 con la sesión de quien imprime, así que una URL con ids ajenos imprime una hoja vacía.
 * Solo merma: otros tipos se descartan aunque vengan en la URL. El texto obligatorio va en español y en inglés.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ ids?: string | string[] }> }) {
  const ids = idsDeConsulta((await searchParams).ids);
  let lang: Lang = "en";
  let reportes: Reporte[] = [];
  let personas: { id: string; full_name: string }[] = [];
  if (SIN_BASE) {
    reportes = DEMO_REPORTES.filter((r) => ids.includes(r.id) || ids.length === 0 && r.kind === "scrap");
    personas = DEMO_PERSONAS;
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/operaciones/reportes");
    const { data: perfil, error: errorPerfil } = await supabase.from("profiles")
      .select("role, store, visible_stores, permissions, module_access, recruiting_role, language").eq("id", user.id).maybeSingle();
    // Una lectura que falló no manda a nadie a otro sitio (la regla de profile-read): se dice, y se para aquí.
    if (estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo") {
      return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
    }
    if (!perfil) redirect("/operaciones");
    const nivel = await leerNivelEscrito(supabase, user.id);
    if (!puedeImprimirHoja({ id: user.id, ...perfil, role: perfil.role ?? "sales", warehouse_ops_role: nivel })) redirect("/operaciones");
    lang = perfil.language === "es" ? "es" : "en";
    if (ids.length > 0) {
      const [{ data: filas }, { data: gente }] = await Promise.all([
        supabase.from("warehouse_reports").select("*").in("id", ids).eq("kind", "scrap"),
        supabase.from("profiles").select("id, full_name"),
      ]);
      reportes = ((filas ?? []) as Reporte[]).map((r) => ({ ...r, total_loss: r.total_loss == null ? null : Number(r.total_loss) }));
      personas = ((gente ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, full_name: p.full_name ?? "" }));
    }
  }
  const t = T(lang);
  const nombre = (id: string) => personas.find((p) => p.id === id)?.full_name ?? "";
  // En el orden en que vinieron los ids (el orden de la lista).
  const ordenadas = ids.length > 0 ? ids.map((id) => reportes.find((r) => r.id === id)).filter((r): r is Reporte => !!r) : reportes;
  const filas = filasDeHoja(ordenadas, nombre, (m) => etiquetaDeOpcion("scrap", "reason", m, lang) || (m ?? ""), (r) => repartoDeReporte(r).damaged);
  const hoy = new Date();

  return (
    <main className="hoja-aprobacion-pagina" data-hoja-de-aprobacion={filas.length}>
      <div className="hoja-barra no-imprimir">
        <Link href="/operaciones/reportes?pestana=merma" className="btn btn-ghost">← {t("Back to scrap", "Volver a la merma")}</Link>
        <BotonImprimir etiqueta={t("Print", "Imprimir")} />
      </div>
      <article className="hoja-aprobacion">
        <header className="hoja-cabecera">
          <div>
            <h1>{EMPRESA}</h1>
            <h2>{t("Scrap approval sheet", "Hoja de aprobación de merma")}</h2>
          </div>
          <dl className="hoja-datos">
            <dt>{t("Store", "Tienda")}</dt><dd data-hoja-tienda>{tiendasDeHoja(filas)}</dd>
            <dt>{t("Date", "Fecha")}</dt><dd data-hoja-fecha>{fmtDia(hoy.toISOString().slice(0, 10), lang)}</dd>
            <dt>{t("Reports", "Reportes")}</dt><dd>{filas.length}</dd>
          </dl>
        </header>

        <p className="hoja-recordatorio" data-recordatorio>
          <strong>{RECORDATORIO_ES}</strong>
          <span lang="en">{RECORDATORIO_EN}</span>
        </p>

        <table className="hoja-tabla" data-hoja-filas={filas.length}>
          <thead>
            <tr>
              <th>#</th>
              <th>{t("Folio", "Folio")}</th>
              <th>{t("Date broken", "Fecha del daño")}</th>
              <th>{t("Product", "Producto")}</th>
              <th className="num">{t("Damaged pcs", "Pzas dañadas")}</th>
              <th className="num">{t("Loss", "Pérdida")}</th>
              <th>{t("Reason", "Motivo")}</th>
              <th>{t("Broken by", "Lo rompió")}</th>
              <th>{t("Reported by", "Lo reportó")}</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={9} className="hoja-vacia">{t("No scrap reports to print. Select rows in the Scrap tab.", "No hay mermas que imprimir. Marca filas en la pestaña de Merma.")}</td></tr>}
            {filas.map((f, n) => (
              <tr key={f.id} data-hoja-reporte={f.id}>
                <td>{n + 1}</td>
                <td className="hoja-folio">{f.folio}</td>
                <td>{fmtDia(f.dia, lang)}</td>
                <td>{f.producto}</td>
                <td className="num">{f.danadas}</td>
                <td className="num">{fmtMoney(f.perdida)}</td>
                <td>{f.motivo}</td>
                <td>{f.rompio}</td>
                <td>{f.reporto}</td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && (
            <tfoot><tr><td colSpan={5} className="num">{t("Total", "Total")}</td><td className="num" data-hoja-total>{fmtMoney(totalDeHoja(filas))}</td><td colSpan={3} /></tr></tfoot>
          )}
        </table>
        {filas.some((f) => f.producto.endsWith(" *")) && <p className="hoja-nota">* {t("Product not in the catalog (name as written).", "Producto fuera del catálogo (nombre tal como se escribió).")}</p>}

        <section className="hoja-firmas">
          <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Warehouse supervisor", "Supervisor de almacén")}</span></div>
          <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Manager (approval)", "Gerente (autorización)")}</span></div>
          <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Date", "Fecha")}</span></div>
        </section>
        <p className="hoja-pie">{t("Once signed, attach a photo or scan of this sheet to each report in the app (Scrap tab → select → Attach signed sheet); the reports turn Approved.",
          "Ya firmada, adjunta una foto o escaneo de esta hoja a cada reporte en la app (pestaña Merma → marcar → Adjuntar hoja firmada); los reportes pasan a Aprobada.")}</p>
      </article>
    </main>
  );
}
