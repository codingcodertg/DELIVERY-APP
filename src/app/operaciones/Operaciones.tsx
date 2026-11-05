"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { INFO_DE_TIPO, TIPOS, esDeRrhh, type TipoDeReporte } from "@/lib/almacen-ops/tipos";
import { tieneElModulo, veLosReportes } from "@/lib/almacen-ops/visibilidad";
import { DEMO_PERSONAS, DEMO_TIENDAS, DEMO_YO, faltaLaMigracion, type Persona, type Yo } from "@/lib/almacen-ops/datos";
import { Asistente } from "./Asistente";
import { ListaDeReportes } from "./ListaDeReportes";

export type Vista = { v: "inicio" } | { v: "nuevo"; tipo: TipoDeReporte } | { v: "mios" } | { v: "reportes" };

export interface Contexto {
  demo: boolean;
  yo: Yo;
  tiendas: string[];
  personas: Persona[];
}

type Carga = { estado: "cargando" } | { estado: "falta-247" } | { estado: "error"; mensaje: string } | { estado: "listo"; ctx: Contexto };

/** Operaciones de almacén (D-NEXT, 247): lee quién es, las tiendas y la gente; si falta la 247, lo dice. */
export function Operaciones({ vista, demo }: { vista: Vista; demo: boolean }) {
  const { t } = usePrefs();
  const [carga, setCarga] = useState<Carga>(demo
    ? { estado: "listo", ctx: { demo, yo: DEMO_YO, tiendas: DEMO_TIENDAS, personas: DEMO_PERSONAS } }
    : { estado: "cargando" });

  useEffect(() => {
    if (demo) return;
    let vivo = true;
    (async () => {
      const sb = createClient();
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;
      const [perfil, ajustes, gente, prueba] = await Promise.all([
        sb.from("profiles").select("id, full_name, role, store, visible_stores, permissions, module_access, recruiting_role").eq("id", user.id).maybeSingle(),
        sb.from("settings").select("stores").eq("id", 1).maybeSingle(),
        sb.from("profiles").select("id, full_name, store").order("full_name"),
        sb.from("warehouse_reports").select("id", { head: true, count: "exact" }).limit(1),
      ]);
      if (!vivo) return;
      if (faltaLaMigracion(prueba.error)) { setCarga({ estado: "falta-247" }); return; }
      const error = perfil.error ?? ajustes.error ?? gente.error ?? prueba.error;
      if (error || !perfil.data) { setCarga({ estado: "error", mensaje: error?.message ?? "profile" }); return; }
      const tiendas = ((ajustes.data?.stores ?? []) as { name?: string | null }[]).map((s) => (s.name ?? "").trim()).filter(Boolean);
      const personas = ((gente.data ?? []) as Persona[]).filter((p) => (p.full_name ?? "").trim());
      setCarga({ estado: "listo", ctx: { demo, yo: { ...perfil.data, full_name: perfil.data.full_name ?? "" } as Yo, tiendas, personas } });
    })();
    return () => { vivo = false; };
  }, [demo]);

  return (
    <main className="ops" data-operaciones={vista.v}>
      {carga.estado === "cargando" && <p className="hint">{t("Loading…", "Cargando…")}</p>}
      {carga.estado === "error" && <p className="ops-aviso ops-aviso-error">{t("Could not load: ", "No se pudo cargar: ")}{carga.mensaje}</p>}
      {carga.estado === "falta-247" && (
        <div className="ops-aviso" data-aviso="247">
          <h2>{t("Coming soon", "Muy pronto")}</h2>
          <p>{t("Warehouse Ops needs one setup step before it can save reports (database migration 247). Ask the admin to finish the setup.",
            "Operaciones de almacén necesita un paso de instalación antes de guardar reportes (la migración 247 de la base). Pide al admin que termine la instalación.")}</p>
        </div>
      )}
      {carga.estado === "listo" && <Pantalla vista={vista} ctx={carga.ctx} />}
    </main>
  );
}

function Pantalla({ vista, ctx }: { vista: Vista; ctx: Contexto }) {
  if (vista.v === "nuevo") return <Asistente tipo={vista.tipo} ctx={ctx} />;
  if (vista.v === "mios") return <ListaDeReportes modo="mios" ctx={ctx} />;
  if (vista.v === "reportes") return <ListaDeReportes modo="todos" ctx={ctx} />;
  return <Inicio ctx={ctx} />;
}

function Inicio({ ctx }: { ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const llena = tieneElModulo(ctx.yo);
  const gerente = veLosReportes(ctx.yo);
  const nombre = useMemo(() => (ctx.yo.full_name || "").split(/\s+/)[0], [ctx.yo.full_name]);
  return (
    <>
      <header className="ops-saludo">
        <h2>{nombre ? t(`Hi, ${nombre}`, `Hola, ${nombre}`) : t("Warehouse Ops", "Operaciones de almacén")}</h2>
        <p>{t("What do you need to report?", "¿Qué necesitas reportar?")}</p>
      </header>
      {llena && (
        <nav className="ops-tablero" aria-label={t("Reports", "Reportes")}>
          {TIPOS.map((k) => {
            const i = INFO_DE_TIPO[k];
            return (
              <Link key={k} href={`/operaciones/nuevo/${k}`} className={`ops-tarjeta ops-t-${k}`} data-tipo={k}>
                <span className="ops-tarjeta-icono" aria-hidden>{i.emoji}</span>
                <span className="ops-tarjeta-nombre">{lang === "es" ? i.es : i.en}</span>
                <span className="ops-tarjeta-desc">{lang === "es" ? i.desc_es : i.desc_en}</span>
                {esDeRrhh(k) && <span className="ops-tarjeta-rrhh">{t("Goes to the HR file", "Va al expediente")}</span>}
              </Link>
            );
          })}
        </nav>
      )}
      <div className="ops-pie">
        {llena && <Link href="/operaciones/mis-reportes" className="ops-boton-ancho" data-ir="mios">📄 {t("My reports", "Mis reportes")}</Link>}
        {gerente && <Link href="/operaciones/reportes" className="ops-boton-ancho ops-boton-gerente" data-ir="reportes">🗂️ {t("Reports (managers)", "Reportes (gerentes)")}</Link>}
      </div>
    </>
  );
}
