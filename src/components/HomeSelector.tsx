"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { noLeidosPorSolicitud, repartoDeNoLeidos } from "@/lib/help-thread";
import { usePrefs } from "@/lib/prefs";
import { VersionFooter } from "@/components/VersionFooter";
import { accessibleModules, HUB_TOOLS, INSTALLABLE_APPS, roleHome } from "@/lib/constants";
import type { Profile } from "@/lib/types";
import { veAppsParaInstalar } from "@/lib/hub-apps";

/** Reached by someone with 2+ modules, OR with a hub tool visible to them
 * (D-056) — see src/app/home/page.tsx for the exact gate. */
export function HomeSelector({ me, suplantando = false }: { me: Profile; suplantando?: boolean }) {
  const { lang, t } = usePrefs();
  const available = accessibleModules(me.module_access);
  // `suplantando` lo decide el servidor (home/page.tsx) y solo lo miran las herramientas del admin real.
  const tools = HUB_TOOLS.filter((tool) => tool.visible({ ...me, suplantando }));
  // The deliveries card's own href is a placeholder ("/") — it's the same
  // ModuleInfo entry used by the app switcher and everywhere else, but where
  // deliveries actually lands depends on the person's role (warehouse -> its
  // own queue, logistics -> routes, not the Orders board everyone else gets).
  const hrefFor = (key: string, fallback: string) => (key === "deliveries" ? roleHome(me.role) : fallback);

  // Mensajes de ayuda sin leer, en la tarjeta que toca (D-NEXT). El hub no tiene campana, así que
  // este número es la única señal que hay aquí. La RLS ya acota lo que se lee: una persona solo
  // recibe los mensajes de sus hilos. Si algo falla —o la 126 aún no está— se queda en cero y el
  // lobby se pinta igual: un contador no decide si se entra.
  const [sinLeer, setSinLeer] = useState({ mias: 0, ajenas: 0 });
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const supabase = createClient();
      const [ms, ls, rs] = await Promise.all([
        supabase.from("help_messages").select("request_id, author_id, created_at").order("created_at", { ascending: false }).limit(2000),
        supabase.from("help_reads").select("request_id, read_at").eq("user_id", me.id),
        supabase.from("help_requests").select("id").eq("user_id", me.id),
      ]);
      if (!vivo || ms.error || ls.error || rs.error) return;
      setSinLeer(repartoDeNoLeidos(noLeidosPorSolicitud(ms.data ?? [], ls.data ?? [], me.id), (rs.data ?? []).map((r) => r.id as string)));
    })();
    return () => { vivo = false; };
  }, [me.id]);
  const sinLeerDe = (key: string) => (key === "my-help" ? sinLeer.mias : key === "help-requests" ? sinLeer.ajenas : 0);

  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ maxWidth: 480 }}>
        <h1>
          {t("Hi, ", "Hola, ")}
          {me.full_name}
        </h1>
        {/* Mi perfil (D-265): una cuenta y una contraseña para todas las apps, así que su sitio
            es el lobby y no ninguna de ellas. Para todos los roles que llegan aquí; el chofer, que
            no llega (D-173), entra desde la «Cuenta» de Entregas. */}
        <Link href="/home/profile" className="hub-profile-link">
          👤 {t("My profile · password", "Mi perfil · contraseña")}
        </Link>
        <p style={{ color: "var(--ink-soft)", marginBottom: 20 }}>
          {t("Which one do you want to open?", "¿Cuál quieres abrir?")}
        </p>
        <div className="module-pick-grid">
          {available.map((m) => (
            <Link key={m.key} href={hrefFor(m.key, m.href)} className="module-pick-card">
              <span className="module-pick-emoji">{m.emoji}</span>
              <span className="module-pick-label">{lang === "es" ? m.label_es : m.label_en}</span>
              <span className="module-pick-desc">{lang === "es" ? m.desc_es : m.desc_en}</span>
            </Link>
          ))}
        </div>

        {/* A tool isn't a module — it doesn't get the same big launch tile. */}
        {tools.length > 0 && (
          <>
            <div className="hub-tools-label">{t("Tools", "Herramientas")}</div>
            {tools.map((tool) => (
              <Link key={tool.key} href={tool.href} className="hub-tool-row">
                <span className="hub-tool-emoji">{tool.emoji}</span>
                <span>
                  <span className="hub-tool-label">
                    {lang === "es" ? tool.label_es : tool.label_en}
                    {sinLeerDe(tool.key) > 0 && <span className="hub-tool-badge">{sinLeerDe(tool.key)}</span>}
                  </span>
                  <span className="hub-tool-desc" style={{ display: "block" }}>{lang === "es" ? tool.desc_es : tool.desc_en}</span>
                </span>
              </Link>
            ))}
          </>
        )}

        {/* Las apps que se instalan (D-167).
            -------------------------------------------------------------------
            Debajo de los módulos y de las herramientas, porque no es a lo que se
            viene: se entra al hub a abrir algo, y esto se busca una vez en la
            vida. Pero tiene que estar EN ALGÚN SITIO — hasta ahora el APK se
            repartía por WhatsApp y la de escritorio había que pedirla, y una app
            que hay que pedir es una app que la mitad de la gente no tiene.

            **Solo para el admin desde D-262** (2026-09-16, decisión del dueño). Lo
            que sigue es lo que decía D-167, y se deja escrito porque explica por qué
            estuvo abierto: ahora las reparte el admin, y el resto no ve ni el título
            ni el contador. Solo se esconde la sección; las descargas no cambian.

            Se enseñan las tres a todo el mundo, con su "para quién" delante.
            Esconderle la de choferes a la oficina obligaría a pedirla de nuevo
            el día que un gerente quiera probarla; decir para quién es basta, y
            además explica el permiso de GPS antes de instalarla, no después.

            **Plegado por defecto** (D-169). Cada app ocupa cuatro líneas —nombre,
            descripción, para quién, y el aviso— y tres apps empujaban el botón de
            salir fuera de la pantalla en un móvil. Se instala una vez y se abre el
            hub todos los días: lo de todos los días manda.

            `<details>` del navegador, como en el resto de la casa: recuerda el
            foco, se busca dentro con Ctrl+F aunque esté cerrado, y no hay nada
            escrito que pueda fallar. El número al lado dice que hay algo dentro,
            que si no un título plegado se lee como un título y nadie lo toca. */}
        {veAppsParaInstalar(me) && (
        <details className="hub-apps">
          <summary className="hub-tools-label hub-apps-summary">
            {t("Installable apps", "Apps para instalar")}
            <span className="hub-apps-count">{INSTALLABLE_APPS.length}</span>
          </summary>
        {INSTALLABLE_APPS.map((a) => {
          const aviso = lang === "es" ? a.warn_es : a.warn_en;
          return (
            <a
              key={a.key}
              href={a.url}
              // En otra pestaña: el hub no se pierde de vista mientras baja un fichero de
              // 78 MB. Dos de las tres pasan por /api/download, que redirige a GitHub — de
              // ahí el `rel`, aunque el href de aquí sea relativo: quien acaba recibiendo
              // el clic es otro dominio.
              target="_blank"
              rel="noopener noreferrer"
              className="hub-tool-row hub-app-row"
            >
              <span className="hub-tool-emoji">{a.emoji}</span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="hub-tool-label">
                  {a.name}
                  <span className="hub-app-meta">
                    {lang === "es" ? a.platform_es : a.platform_en} · {a.size}
                  </span>
                </span>
                <span className="hub-tool-desc" style={{ display: "block" }}>
                  {lang === "es" ? a.desc_es : a.desc_en}
                </span>
                <span className="hub-app-who">
                  {t("For:", "Para:")} {lang === "es" ? a.who_es : a.who_en}
                </span>
                {aviso && <span className="hub-app-warn">⚠ {aviso}</span>}
              </span>
              <span className="hub-app-dl">⬇</span>
            </a>
          );
        })}
        </details>
        )}

        {/* Signing out from the hub. Every module's own topbar has this, but the hub sits
            above all of them — without it, leaving meant entering an app you did not want
            just to reach its Sign out. Same POST to /auth/signout the topbars use. */}
        <form action="/auth/signout" method="post" className="hub-signout">
          <button type="submit" className="hub-signout-btn">
            {t("Sign out", "Salir")}
          </button>
        </form>
      </div>
      <VersionFooter fixed />
    </div>
  );
}
