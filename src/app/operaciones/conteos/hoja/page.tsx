import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";
import { ProfileReadError } from "@/components/ProfileReadError";
import { leerNivelEscrito } from "@/lib/almacen-ops/nivel";
import { EMPRESA } from "@/lib/almacen-ops/etapas";
import { fmtDia } from "@/lib/almacen-ops/fecha-del-dano";
import { fmtMoney } from "@/lib/utils";
import { filasDeHojaDeConteo, idDeHoja, nombreDeEtapaDeConteo, puedeGestionarConteo, resumenDelConteo, type Conteo, type Linea } from "@/lib/almacen-ops/conteos";
import { DEMO_CONTEOS, conteoDeLaFila, lineaDeLaFila } from "@/lib/almacen-ops/conteos-datos";
import { BotonImprimir } from "../../reportes/hoja-de-aprobacion/BotonImprimir";
import "../../reportes/hoja-de-aprobacion/hoja.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Hoja de conteo de inventario" };
const SIN_BASE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

type Lang = "en" | "es";
const T = (lang: Lang) => (en: string, es: string) => (lang === "es" ? es : en);

/**
 * 274: la hoja de un conteo de inventario, lista para imprimir y firmar (`/operaciones/conteos/hoja?id=<uuid>`). Paso 4
 * de Roberto: «review and sign off». Se pinta en el SERVIDOR con la puerta del gestor (`puedeGestionarConteo`); las
 * filas salen por la RLS de la 274 con la sesión de quien imprime. Reutiliza el CSS de la hoja de aprobación de merma.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string | string[] }> }) {
  const id = idDeHoja((await searchParams).id);
  let lang: Lang = "en";
  let conteo: Conteo | null = null;
  let lineas: Linea[] = [];
  let personas: { id: string; full_name: string }[] = [];
  if (SIN_BASE) {
    conteo = DEMO_CONTEOS.conteos.find((c) => c.id === id) ?? DEMO_CONTEOS.conteos[1];
    const elegido = conteo;
    lineas = DEMO_CONTEOS.lineas.filter((l) => l.count_id === elegido.id);
  } else {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect("/login?next=/operaciones/conteos");
    const { data: perfil, error: errorPerfil } = await supabase.from("profiles")
      .select("role, store, visible_stores, permissions, module_access, recruiting_role, language").eq("id", user.id).maybeSingle();
    if (estadoDeLectura({ data: perfil, error: errorPerfil }) === "fallo") {
      return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
    }
    if (!perfil) redirect("/operaciones");
    lang = perfil.language === "es" ? "es" : "en";
    if (id) {
      const { data: fila } = await supabase.from("warehouse_counts").select("*").eq("id", id).maybeSingle();
      if (fila) {
        conteo = conteoDeLaFila(fila as Record<string, unknown>);
        const nivel = await leerNivelEscrito(supabase, user.id);
        if (!puedeGestionarConteo({ id: user.id, ...perfil, role: perfil.role ?? "sales", warehouse_ops_role: nivel }, conteo.store)) redirect("/operaciones/conteos");
        const [{ data: ls }, { data: gente }] = await Promise.all([
          supabase.from("warehouse_count_lines").select("*").eq("count_id", id).order("position"),
          supabase.from("profiles").select("id, full_name"),
        ]);
        lineas = ((ls ?? []) as Record<string, unknown>[]).map(lineaDeLaFila);
        personas = ((gente ?? []) as { id: string; full_name: string | null }[]).map((p) => ({ id: p.id, full_name: p.full_name ?? "" }));
      }
    }
  }
  const t = T(lang);
  const filas = filasDeHojaDeConteo(lineas);
  const resumen = resumenDelConteo(lineas);
  const hoy = new Date().toISOString().slice(0, 10);
  const nombre = (x: string | null) => (x ? personas.find((p) => p.id === x)?.full_name ?? "" : "");

  return (
    <main className="hoja-aprobacion-pagina" data-hoja-de-conteo={conteo?.id ?? ""}>
      <div className="hoja-barra no-imprimir">
        <Link href="/operaciones/conteos" className="btn btn-ghost">← {t("Back to counts", "Volver a los conteos")}</Link>
        <BotonImprimir etiqueta={t("Print", "Imprimir")} />
      </div>
      <article className="hoja-aprobacion">
        <header className="hoja-cabecera">
          <div>
            <h1>{EMPRESA}</h1>
            <h2>{t("Inventory count sheet", "Hoja de conteo de inventario")}</h2>
          </div>
          <dl className="hoja-datos">
            <dt>{t("Store", "Tienda")}</dt><dd data-hoja-tienda>{conteo?.store ?? "—"}</dd>
            <dt>{t("Scope", "Alcance")}</dt><dd>{conteo?.title ?? "—"}</dd>
            <dt>{t("Stage", "Etapa")}</dt><dd>{conteo ? nombreDeEtapaDeConteo(conteo.stage, lang) : "—"}</dd>
            <dt>{t("Opened", "Abierto")}</dt><dd>{conteo ? `${fmtDia(conteo.created_at.slice(0, 10), lang)} · ${conteo.created_by_name ?? nombre(conteo.created_by)}` : "—"}</dd>
            <dt>{t("Printed", "Impreso")}</dt><dd data-hoja-fecha>{fmtDia(hoy, lang)}</dd>
          </dl>
        </header>
        <table className="hoja-tabla" data-hoja-filas={filas.length}>
          <thead>
            <tr>
              <th>#</th><th>SKU</th><th>{t("Product", "Producto")}</th><th>{t("Size", "Medida")}</th>
              <th className="num">{t("System", "Sistema")}</th><th className="num">{t("Counted", "Contado")}</th><th className="num">{t("Diff", "Dif")}</th><th className="num">{t("$ diff", "Dif $")}</th>
              <th>{t("Counted by", "Contó")}</th>
            </tr>
          </thead>
          <tbody>
            {filas.length === 0 && <tr><td colSpan={9} className="hoja-vacia">{t("No count to print.", "No hay conteo que imprimir.")}</td></tr>}
            {filas.map((f, n) => (
              <tr key={f.sku + n} data-hoja-linea={f.sku}>
                <td>{n + 1}</td><td className="hoja-folio">{f.sku}</td><td>{f.nombre}</td><td>{f.medida}</td>
                <td className="num">{f.sistema}</td><td className="num">{f.contado}</td><td className="num">{f.diferencia}</td><td className="num">{f.valor == null ? "—" : fmtMoney(f.valor)}</td>
                <td>{f.conto}</td>
              </tr>
            ))}
          </tbody>
          {filas.length > 0 && (
            <tfoot><tr>
              <td colSpan={4} className="num">{t("Accuracy", "Exactitud")} {resumen.exactitudPct === null ? "—" : `${resumen.exactitudPct}%`} · {resumen.exactas} {t("exact", "exactas")} / {resumen.conDiferencia} {t("with difference", "con diferencia")}</td>
              <td colSpan={3} className="num">{t("Variance (abs)", "Variación (abs)")}</td><td className="num" data-hoja-total>{fmtMoney(resumen.valorAbsoluto)}</td><td />
            </tr></tfoot>
          )}
        </table>
        <section className="hoja-firmas">
          <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Counted by", "Contó")}</span></div>
          <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Manager (sign-off)", "Gerente (firma)")}</span></div>
          <div className="hoja-firma"><span className="hoja-linea" /><span>{t("Date", "Fecha")}</span></div>
        </section>
        <p className="hoja-pie">{t("Once signed, press Sign off in the app (count card → Sign off) and optionally attach a photo of this sheet; then adjust in the ERP and upload the screenshot.",
          "Ya firmada, pulsa Firmar en la app (tarjeta del conteo → Firmar) y, si quieres, adjunta una foto de esta hoja; después ajusta en el ERP y sube la captura.")}</p>
      </article>
    </main>
  );
}
