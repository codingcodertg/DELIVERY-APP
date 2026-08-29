import Link from "next/link";
import { createClient } from "@/lib/clockin/supabase/server";
import { accessibleModules, HUB_TOOLS } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import type { Lang } from "@/lib/clockin/i18n";

/**
 * La salida de fichaje: a Time Tracker si es la misma app, al hub si no.
 *
 * Clock-in llegó como aplicación entera, así que cada cabecera tiene un 🏠 que significa
 * "la pantalla de fichar" y nada que signifique "lo demás" — no había nada más. Va al
 * lado de ese 🏠 porque quien busca la salida ya está mirando ahí.
 *
 * **Desde la fase 3 de la fusión apunta a Time Tracker** cuando la persona tiene los dos
 * módulos, que desde 084 son las doce. Fichaje ya no es una app aparte a la que se entra
 * desde el hub: es la otra mitad de Time Tracker, y devolver al hub obligaría a pasar por
 * un selector para volver a algo que está al lado. Al hub se sigue yendo si Time Tracker
 * no está otorgado pero sí hay otros módulos.
 *
 * Se esconde si fichaje es lo único que tiene: su hub sería una página de una sola
 * tarjeta que lo devuelve aquí, y eso se lee como enlace roto, no como atajo — la misma
 * prueba que ya aplican /home y landingRoute().
 *
 * Pregunta a `public` y no a clockin.profiles: module_access es identidad del hub, y esa
 * vista (077) solo lleva la mitad de fichaje de una persona.
 */
export default async function HubLink({ lang }: { lang: Lang }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: me } = await supabase
    .schema("public")
    .from("profiles")
    .select("role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  if (!me) return null;

  const access = (me.module_access as string[] | null) ?? [];
  const toTimetracker = access.includes("timetracker");

  if (!toTimetracker) {
    const modules = accessibleModules(access);
    const hasHub = modules.length > 1 || HUB_TOOLS.some((tool) => tool.visible({ role: me.role as UserRole }));
    if (!hasHub) return null;
  }

  const href = toTimetracker ? "/timetracker" : "/home";
  const label = toTimetracker ? "Time Tracker" : "Hub";
  const title = toTimetracker
    ? lang === "es" ? "Volver a Time Tracker" : "Back to Time Tracker"
    : lang === "es" ? "Volver al hub" : "Back to the hub";

  return (
    <Link
      href={href}
      aria-label={title}
      title={title}
      className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-10 px-3 text-sm font-semibold hover:border-brand-400 transition-colors shrink-0"
    >
      <span aria-hidden>◀</span>
      {label}
    </Link>
  );
}
