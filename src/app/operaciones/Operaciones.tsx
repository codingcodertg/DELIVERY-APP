"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { INFO_DE_TIPO, esDeRrhh } from "@/lib/almacen-ops/tipos";
import { veLosReportes } from "@/lib/almacen-ops/visibilidad";
import { leerNivelEscrito, tiposPermitidos } from "@/lib/almacen-ops/nivel";
import { tiendasPara, vistaPermitida, type Vista } from "@/lib/almacen-ops/puerta";
import { DEMO_PERSONAS, DEMO_TIENDAS, DEMO_YO, faltaLaMigracion, type Persona, type Yo } from "@/lib/almacen-ops/datos";
import { Asistente } from "./Asistente";
import { borrarBorrador, listarBorradores, type Borrador } from "@/lib/almacen-ops/borradores";
import { fmtDateTime } from "@/lib/utils";
import { esDia, fmtDia } from "@/lib/almacen-ops/fecha-del-dano";
import { faltaFoto } from "@/lib/almacen-ops/fotos";
import { ListaDeReportes } from "./ListaDeReportes";
import { Mantenimiento } from "./Mantenimiento";
import { veMantenimiento } from "@/lib/almacen-ops/mantenimiento";
import { Conteos } from "./Conteos";
import { veConteos } from "@/lib/almacen-ops/conteos";

export type { Vista };

export interface Contexto {
  demo: boolean;
  yo: Yo;
  tiendas: string[];
  personas: Persona[];
}

type Carga = { estado: "cargando" } | { estado: "falta-247" } | { estado: "error"; mensaje: string } | { estado: "listo"; ctx: Contexto };

/** Operaciones de almacén (D-883, 247): lee quién es, las tiendas y la gente; si falta la 247, lo dice. */
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
      const [perfil, ajustes, gente, prueba, nivel] = await Promise.all([
        sb.from("profiles").select("id, full_name, role, store, visible_stores, permissions, module_access, recruiting_role").eq("id", user.id).maybeSingle(),
        sb.from("settings").select("stores").eq("id", 1).maybeSingle(),
        sb.from("profiles").select("id, full_name, store, role, module_access, left_at").order("full_name"),
        sb.from("warehouse_reports").select("id", { head: true, count: "exact" }).limit(1),
        // 265: el nivel dentro de la app. Lectura aparte y tolerante: si la columna aún no existe, manda el rol del hub.
        leerNivelEscrito(sb, user.id),
      ]);
      if (!vivo) return;
      if (faltaLaMigracion(prueba.error)) { setCarga({ estado: "falta-247" }); return; }
      const error = perfil.error ?? ajustes.error ?? gente.error ?? prueba.error;
      if (error || !perfil.data) { setCarga({ estado: "error", mensaje: error?.message ?? "profile" }); return; }
      const yo = { ...perfil.data, full_name: perfil.data.full_name ?? "", warehouse_ops_role: nivel } as Yo;
      const todas = ((ajustes.data?.stores ?? []) as { name?: string | null }[]).map((s) => (s.name ?? "").trim()).filter(Boolean);
      const personas = ((gente.data ?? []) as Persona[]).filter((p) => (p.full_name ?? "").trim());
      // 265: el admin de la app «solo en sus tiendas» no elige ni filtra otra tienda (la base se lo rechaza igual).
      setCarga({ estado: "listo", ctx: { demo, yo, tiendas: tiendasPara(yo, todas), personas } });
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
  // La página del servidor ya devolvió al inicio a quien no puede; esto cubre el demo y un nivel que cambió con la
  // pantalla abierta. La base lo rechaza igual (265).
  if (!vistaPermitida(ctx.yo, vista)) return <Inicio ctx={ctx} />;
  if (vista.v === "nuevo") return <Asistente tipo={vista.tipo} ctx={ctx} />;
  if (vista.v === "mios") return <ListaDeReportes modo="mios" ctx={ctx} />;
  if (vista.v === "reportes") return <ListaDeReportes modo="todos" ctx={ctx} />;
  if (vista.v === "mantenimiento") return <Mantenimiento ctx={ctx} />;
  if (vista.v === "conteos") return <Conteos ctx={ctx} />;
  return <Inicio ctx={ctx} />;
}

function Inicio({ ctx }: { ctx: Contexto }) {
  const { t, lang } = usePrefs();
  // 265: las tarjetas son las que su nivel abre. Con una sola (el personal de almacén: merma) no hay tablero ni
  // pregunta: una tarjeta ancha que abre el formulario, sus borradores y sus reportes.
  const tipos = useMemo(() => tiposPermitidos(ctx.yo), [ctx.yo]);
  const llena = tipos.length > 0;
  const unico = tipos.length === 1 ? tipos[0] : null;
  const gerente = veLosReportes(ctx.yo);
  // 273: la sección de mantenimiento (equipo, lista diaria, refacciones, uso) es de cualquiera con nivel en la app.
  const mantenimiento = veMantenimiento(ctx.yo);
  // 274: los conteos de inventario (cinco pasos); el personal cuenta, el gerente crea, firma y ajusta.
  const conteos = veConteos(ctx.yo);
  const nombre = useMemo(() => (ctx.yo.full_name || "").split(/\s+/)[0], [ctx.yo.full_name]);
  return (
    <>
      <header className="ops-saludo">
        <h2>{nombre ? t(`Hi, ${nombre}`, `Hola, ${nombre}`) : t("Warehouse Ops", "Operaciones de almacén")}</h2>
        {llena && !unico && <p>{t("What do you need to report?", "¿Qué necesitas reportar?")}</p>}
        {unico && <p>{lang === "es" ? INFO_DE_TIPO[unico].desc_es : INFO_DE_TIPO[unico].desc_en}</p>}
      </header>
      {unico && (
        <Link href={`/operaciones/nuevo/${unico}`} className={`ops-tarjeta ops-tarjeta-unica ops-t-${unico}`} data-tipo={unico} data-unica="1">
          <span className="ops-tarjeta-icono" aria-hidden>{INFO_DE_TIPO[unico].emoji}</span>
          <span className="ops-tarjeta-nombre">
            {unico === "scrap" ? t("Report scrap / damage", "Reportar merma / daños") : (lang === "es" ? INFO_DE_TIPO[unico].es : INFO_DE_TIPO[unico].en)}
          </span>
          <span className="ops-tarjeta-desc">{t("Tap to start a new report", "Toca para empezar un reporte nuevo")}</span>
        </Link>
      )}
      {llena && !unico && (
        <nav className="ops-tablero" aria-label={t("Reports", "Reportes")}>
          {tipos.map((k) => {
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
      {llena && <Borradores ctx={ctx} />}
      <div className={"ops-pie" + ([llena, gerente, mantenimiento, conteos].filter(Boolean).length > 1 ? "" : " ops-pie-uno")}>
        {conteos && <Link href="/operaciones/conteos" className="ops-boton-ancho ops-boton-conteos" data-ir="conteos">🔢 {t("Inventory counts", "Conteos de inventario")}</Link>}
        {mantenimiento && <Link href="/operaciones/mantenimiento" className="ops-boton-ancho ops-boton-mantenimiento" data-ir="mantenimiento">🔧 {t("Maintenance", "Mantenimiento")}</Link>}
        {llena && (
          <Link href="/operaciones/mis-reportes" className="ops-boton-ancho" data-ir="mios">
            📄 {unico === "scrap" ? t("My scrap reports", "Mis reportes de merma") : t("My reports", "Mis reportes")}
          </Link>
        )}
        {gerente && <Link href="/operaciones/reportes" className="ops-boton-ancho ops-boton-gerente" data-ir="reportes">🗂️ {t("Reports (managers)", "Reportes (gerentes)")}</Link>}
      </div>
    </>
  );
}

/** Los borradores de quien mira (pedido 4a1123bb): se guardan en este aparato y se reabren aquí. */
function Borradores({ ctx }: { ctx: Contexto }) {
  const { t, lang } = usePrefs();
  const [lista, setLista] = useState<Borrador[]>([]);
  // Solo los de un tipo que su nivel abre: un borrador viejo de otro formulario no deja una fila que no abre (265).
  const leer = () => { const abre = tiposPermitidos(ctx.yo); return listarBorradores(ctx.yo.id).filter((b) => abre.includes(b.tipo)); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLista(leer()); }, [ctx.yo]);
  if (lista.length === 0) return null;
  return (
    <section className="ops-borradores" data-borradores={lista.length}>
      <h3>{t("Drafts", "Borradores")}</h3>
      <ul>
        {lista.map((b) => {
          const i = INFO_DE_TIPO[b.tipo];
          return (
            <li key={b.id} data-borrador={b.id}>
              <Link href={`/operaciones/nuevo/${b.tipo}?borrador=${encodeURIComponent(b.id)}`} className="ops-borrador-abrir">
                <span aria-hidden>{i.emoji}</span> {lang === "es" ? i.es : i.en}
                <span className="ops-persona-tienda">
                  {b.tienda}
                  {b.tipo === "scrap" && esDia(b.r.broken_on) && <> · <span data-borrador-fecha={b.r.broken_on}>{t("broken", "se rompió")} {fmtDia(b.r.broken_on, lang)}</span></>}
                  {/* 268: un borrador de merma sin foto lo dice; sin ella no se envía. */}
                  {faltaFoto(b.tipo, b.r) && <> · <span className="ops-insignia ops-insignia-sin-foto" data-borrador-sin-foto>📷 {t("Missing photo", "Falta la foto")}</span></>}
                  {" · "}{t("saved", "guardado")} {fmtDateTime(b.guardado)}
                </span>
              </Link>
              <button type="button" className="ops-boton ops-boton-chico" onClick={() => { borrarBorrador(ctx.yo.id, b.id); setLista(leer()); }}
                data-accion="borrar-borrador">{t("Delete", "Borrar")}</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
