"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { createClient } from "@/lib/supabase/client";
import { DataProvider, useData } from "@/lib/data-provider";
import { LocalDataProvider } from "@/lib/local-data-provider";
import { OrderModal } from "@/components/OrderModalLazy";
import { comoAbrirTrato, ordenDeLaTarjeta, queHaceEsc } from "@/lib/customers/abrir-trato";
import type { Trato } from "@/lib/customers/tratos";
import { almacenDeLaBase, type CotizacionGuardada } from "@/lib/estimator/almacen";
import { almacenDemo } from "@/lib/estimator/demo";
import { hojaDelCliente } from "@/lib/estimator/hoja";
import { HojaCliente } from "@/app/estimator/HojaCliente";
import { stageLabel } from "@/lib/constants";
import type { Delivery, Profile } from "@/lib/types";

const DEMO = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
/** La persona del demo de Entregas (la misma clave que `LocalApp`). */
const ME_DEL_DEMO = "rtg_deliveries_local_me";
/** Las mismas columnas del perfil que lee el layout de Entregas: `me` es contra lo que corre cada permiso de la ficha. */
const COLUMNAS_DEL_PERFIL = "id, full_name, username, role, store, permissions, avatar_url, recruiting_role, module_access, title, title_color";

/**
 * D-879: la tarjeta de una fila del historial del cliente (D-874). La orden abre la FICHA DE VERDAD de Entregas
 * (`OrderModal`, igual de aspecto, permisos y acciones) encima de Clientes; la cotización, la hoja del cliente del Quote
 * Builder, de solo lectura. El enlace a la app es secundario, dentro de la tarjeta. Quien no tiene Entregas ve un
 * resumen de solo lectura con la explicación, nunca la ficha.
 *
 * La orden se carga con el proveedor de Entregas ACOTADO a ella (`DataProvider soloOrden`): esa fila y sus eventos, más
 * ajustes y perfiles, con la sesión de quien mira. Las escrituras son las de siempre, con la misma RLS.
 */
export function TarjetaDeTrato({ trato, onCerrar }: { trato: Trato; onCerrar: () => void }) {
  const { t } = usePrefs();
  const [me, setMe] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Esc cierra SOLO la tarjeta (D-879). En captura, antes que la ficha del cliente, que ignora un Esc con
  // `defaultPrevented`. La orden se cierra por su propio ✕ (`requestClose`: pregunta si hay cambios sin guardar).
  const cerrarRef = useRef(onCerrar);
  cerrarRef.current = onCerrar;
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      const capas = document.querySelectorAll(".overlay");
      const arriba = capas[capas.length - 1];
      const tarjetaArriba = !!arriba?.querySelector("[data-tarjeta-de-trato], [data-enlace-aparte]");
      const que = queHaceEsc(e.key, tarjetaArriba);
      if (que === "nada") return;
      e.preventDefault();
      if (que !== "cerrar") return;
      // La ✕ de la ficha de la orden (la que llama a su `requestClose`); la ficha no se toca (D-855).
      const x = arriba?.querySelector("[data-enlace-aparte]")
        ? [...arriba.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "✕")
        : undefined;
      if (x) x.click(); else cerrarRef.current();
    };
    window.addEventListener("keydown", alPulsar, true);
    return () => window.removeEventListener("keydown", alPulsar, true);
  }, []);

  useEffect(() => {
    let vivo = true;
    if (DEMO) {
      let yo: Profile = { id: "u-admin", full_name: "You (Admin)", role: "admin" };
      try { const raw = localStorage.getItem(ME_DEL_DEMO); if (raw) yo = JSON.parse(raw) as Profile; } catch { /* el admin del demo */ }
      setMe(yo);
      return;
    }
    const supabase = createClient();
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!vivo) return;
      if (!user) { setError(t("Your session has ended. Sign in again.", "Tu sesión terminó. Vuelve a entrar.")); return; }
      const { data, error: e } = await supabase.from("profiles").select(COLUMNAS_DEL_PERFIL).eq("id", user.id).maybeSingle();
      if (!vivo) return;
      if (e || !data) setError(e?.message ?? t("Could not read your profile.", "No se pudo leer tu perfil."));
      else setMe(data as unknown as Profile);
    })();
    return () => { vivo = false; };
  }, [t]);

  if (error) return <Marco titulo={trato.numero} onCerrar={onCerrar}><p className="hint" role="status">{error}</p></Marco>;
  if (!me) return <Marco titulo={trato.numero} onCerrar={onCerrar}><p className="hint">{t("Loading…", "Cargando…")}</p></Marco>;

  const como = comoAbrirTrato(trato, me);
  if (como.modo === "cotizacion") return <TarjetaDeCotizacion trato={trato} me={me} enlace={como.enlace} onCerrar={onCerrar} />;
  if (como.modo === "orden-solo-lectura") {
    return (
      <Marco titulo={`${t("Order", "Orden")} #${trato.numero}`} onCerrar={onCerrar}>
        <p className="hint" data-orden-solo-lectura>
          {t("You don't have access to Deliveries, so the full order can't open here. This is what the customer's history shows:",
            "No tienes acceso a Entregas, así que la orden completa no se puede abrir aquí. Esto es lo que muestra el historial del cliente:")}
        </p>
        <Resumen trato={trato} />
      </Marco>
    );
  }
  const enlace = como.enlace ? <a href={como.enlace} className="text-clay-600 hover:underline" data-abrir-en-entregas>{t("Open in Deliveries ↗", "Abrir en Entregas ↗")}</a> : null;
  const ficha = <FichaDeLaOrden id={trato.id} numero={trato.numero} me={me} enlace={enlace} onCerrar={onCerrar} />;
  return DEMO
    ? <LocalDataProvider me={me}>{ficha}</LocalDataProvider>
    : <DataProvider me={me} soloOrden={trato.id}>{ficha}</DataProvider>;
}

function FichaDeLaOrden({ id, numero, me, enlace, onCerrar }: { id: string; numero: string; me: Profile; enlace: React.ReactNode; onCerrar: () => void }) {
  const { t } = usePrefs();
  const { ready, deliveries } = useData();
  // La foto con la que se abre; la ficha luego lee la orden VIVA de la lista (D-364), así que cada acción la refresca.
  const [abierta, setAbierta] = useState<Delivery | null>(null);
  useEffect(() => { if (ready && !abierta) setAbierta(ordenDeLaTarjeta(deliveries, id, DEMO)); }, [ready, deliveries, id, abierta]);
  const titulo = `${t("Order", "Orden")} #${numero}`;
  if (!ready) return <Marco titulo={titulo} onCerrar={onCerrar}><p className="hint">{t("Loading…", "Cargando…")}</p></Marco>;
  if (!abierta) {
    return (
      <Marco titulo={titulo} onCerrar={onCerrar}>
        <p className="hint" role="status" data-orden-no-visible>{t("This order is not visible to you.", "Esta orden no está visible para ti.")}</p>
      </Marco>
    );
  }
  return <>{abierta && <OrderModal me={me} existing={abierta} startEditing={false} onClose={onCerrar} enlaceAparte={enlace} />}</>;
}

function TarjetaDeCotizacion({ trato, me, enlace, onCerrar }: { trato: Trato; me: Profile; enlace: string | null; onCerrar: () => void }) {
  const { t, lang } = usePrefs();
  const [q, setQ] = useState<CotizacionGuardada | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    const almacen = DEMO
      ? almacenDemo(() => ({ id: me.id, name: me.full_name, admin: me.role === "admin", store: me.store ?? null }), false)
      : almacenDeLaBase(createClient());
    void (async () => {
      let r = await almacen.cargar(trato.id);
      // Demo: las filas del historial son de muestra (`demo-q-<cliente>`); se enseña la cotización impresa del demo.
      if (DEMO && !r.ok) r = await almacen.cargar("demo-q-0");
      if (!vivo) return;
      if (r.ok) setQ(r.valor);
      else setError(r.error === "not visible" ? t("This quote is not visible to you.", "Esta cotización no está visible para ti.") : r.error);
    })();
    return () => { vivo = false; };
  }, [trato.id, me, t]);
  const hoja = useMemo(() => (q ? hojaDelCliente(q.draft, q.store, lang === "es" ? "es" : "en") : null), [q, lang]);
  const pie = enlace ? <a href={enlace} className="text-clay-600 hover:underline" data-abrir-en-cotizador>{t("Open in Quote Builder ↗", "Abrir en Cotizador ↗")}</a> : null;
  return (
    <Marco titulo={`${t("Quote", "Cotización")} #${trato.numero}`} onCerrar={onCerrar} ancho pie={pie}>
      <p className="hint">{t("Read-only: the customer sheet as it prints.", "Solo lectura: la hoja del cliente tal como se imprime.")}</p>
      {error && <p className="hint" role="status">{error}</p>}
      {!error && !hoja && <p className="hint">{t("Loading…", "Cargando…")}</p>}
      {hoja && <div className="tarjeta-cotizacion"><HojaCliente hoja={hoja} /></div>}
    </Marco>
  );
}

function Resumen({ trato }: { trato: Trato }) {
  const { t } = usePrefs();
  const filas: [string, string][] = [
    [t("Invoice", "Factura"), trato.factura ?? "—"],
    [t("Status", "Estado"), trato.estado ? t(stageLabel(trato.estado, "en"), stageLabel(trato.estado, "es")) : "—"],
    [t("Store", "Tienda"), trato.tienda ?? "—"],
    [t("Driver", "Chofer"), trato.chofer ?? "—"],
    [t("Pallets", "Tarimas"), trato.tarimas == null ? "—" : String(trato.tarimas)],
  ];
  return (
    <dl className="mt-2 text-sm">
      {filas.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
          <dt className="text-slate-500">{k}</dt>
          <dd className="font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** El marco de siempre (`.overlay` / `.modal` de globals.css): nada nuevo que dibujar. */
function Marco({ titulo, onCerrar, children, pie, ancho = false }: { titulo: string; onCerrar: () => void; children: React.ReactNode; pie?: React.ReactNode; ancho?: boolean }) {
  const { t } = usePrefs();
  return (
    <div className="overlay" onClick={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className={ancho ? "modal tarjeta-de-trato ancha" : "modal tarjeta-de-trato"} role="dialog" aria-modal="true" aria-label={titulo} data-tarjeta-de-trato>
        <div className="flex items-start justify-between gap-3">
          <h3>{titulo}</h3>
          <button type="button" className="btn btn-ghost" onClick={onCerrar} aria-label={t("Close", "Cerrar")}>✕</button>
        </div>
        {children}
        {pie && <div className="hint" style={{ marginTop: 12 }}>{pie}</div>}
      </div>
    </div>
  );
}
