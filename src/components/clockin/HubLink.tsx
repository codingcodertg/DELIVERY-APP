import Link from "next/link";
import { createClient } from "@/lib/clockin/supabase/server";
import { accessibleModules, HUB_TOOLS } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import type { Lang } from "@/lib/clockin/i18n";

/**
 * The way out of clock-in and back to the hub.
 *
 * Clock-in arrived as a whole application, so every one of its headers has a 🏠 that means "the
 * clock screen" and nothing that means "the other apps" — there were no other apps. Sitting next to
 * that 🏠 is the right place for it: someone looking for the way out is already looking there.
 *
 * Hidden for anyone whose only module is clock-in. The hub for them is a page with one card that
 * sends them straight back here, which reads as a broken link rather than a shortcut — the same
 * reason /home's own selector only appears when there is more than one thing to choose between,
 * and why landingRoute() skips the hub for single-module people.
 *
 * It asks `public` directly rather than clockin.profiles: module_access is hub identity, and that
 * view (077) carries only clock-in's half of a person.
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

  const modules = accessibleModules(me.module_access as string[] | null);
  const hasHub = modules.length > 1 || HUB_TOOLS.some((tool) => tool.visible({ role: me.role as UserRole }));
  if (!hasHub) return null;

  return (
    <Link
      href="/home"
      aria-label={lang === "es" ? "Volver al hub" : "Back to the hub"}
      title={lang === "es" ? "Volver al hub" : "Back to the hub"}
      className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-11 px-3 text-sm font-semibold hover:border-emerald-400 transition-colors shrink-0"
    >
      <span aria-hidden>◀</span>
      Hub
    </Link>
  );
}
