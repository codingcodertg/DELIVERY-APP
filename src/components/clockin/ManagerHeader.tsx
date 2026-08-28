import Link from "next/link";
import { t, type Lang } from "@/lib/clockin/i18n";
import HubLink from "./HubLink";

// Shared header for every manager screen: title + subtitle, a "my clock" escape
// hatch, and one consistent horizontal nav bar so managers can jump between
// screens from anywhere (instead of bouncing back to the dashboard).

type NavKey = "dashboard" | "reports" | "schedule" | "team" | "sites" | "runs" | "timeoff" | "exceptions" | "settings";

export default function ManagerHeader({
  lang,
  active,
  title,
  subtitle,
  isOwner = false,
}: {
  lang: Lang;
  active: NavKey;
  title: string;
  subtitle?: string;
  isOwner?: boolean;
}) {
  const tr = t(lang).mgr;
  const base = t(lang);
  const items: { key: NavKey; href: string; label: string }[] = [
    { key: "dashboard", href: "/timetracker/clock-in/dashboard", label: tr.dashboard },
    { key: "reports", href: "/timetracker/clock-in/reports", label: tr.payroll },
    { key: "schedule", href: "/timetracker/clock-in/schedule", label: tr.schedule },
    // Runs folded into Today's Crew — no separate page anymore.
    { key: "timeoff", href: "/timetracker/clock-in/time-off", label: tr.timeOff },
    { key: "exceptions", href: "/timetracker/clock-in/exceptions", label: tr.exceptions },
    // Las fotos NO van aquí. Existen —revisar un día entero de una sentada— pero viven en
    // Auditoría de Time Tracker (D-109): esta barra se retira con el módulo, y colgarle una
    // pantalla nueva habría sido construir encima de algo que se está desmontando.
    // Users, Sites & Account live under Settings, which is in the hamburger menu.
  ];

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <HubLink lang={lang} />
          <Link
            href="/timetracker/clock-in/clock"
            aria-label={base.home}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-200 dark:border-zinc-800 h-11 px-3 text-sm font-semibold hover:border-emerald-400 transition-colors shrink-0"
          >
            <span aria-hidden>🏠</span>
            {base.home}
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold truncate">{title}</h1>
            {subtitle && <p className="text-sm text-zinc-500 truncate">{subtitle}</p>}
          </div>
        </div>
      </div>
      <nav className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((it) => (
          <Link
            key={it.key}
            href={it.href}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
              active === it.key
                ? "bg-emerald-600 text-white shadow-sm"
                : "border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:border-emerald-400 hover:text-emerald-600 dark:hover:text-emerald-400"
            }`}
          >
            {it.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
