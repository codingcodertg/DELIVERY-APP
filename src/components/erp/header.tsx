import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { SideNav } from "@/components/erp/side-nav";
import { canReachHub } from "@/lib/constants";

/**
 * App chrome. Kept named `Header` so every page's `<Header />` keeps working, but it now renders
 * the left sidebar (desktop) + a compact top bar (mobile) via SideNav. Returns null when signed
 * out (e.g. /login). The root layout offsets page content by the sidebar width when authed.
 */
export async function Header() {
  const session = await getSessionInfo();
  if (!session) return null;
  return (
    <SideNav
      role={session.role}
      fullName={session.fullName}
      email={session.user.email ?? ""}
      cost={canSeeCost(session.role)}
      // ¿Hay hub al que volver? Se pregunta AQUÍ, una sola vez, con la misma función que usan
      // `/home` y el conmutador de módulos (D-227). La barra recibe un sí o un no y no vuelve a
      // decidirlo: dos sitios preguntando lo mismo por su cuenta es lo que produjo el fallo.
      hubReachable={canReachHub({ role: session.hubRole, module_access: session.moduleAccess })}
    />
  );
}
