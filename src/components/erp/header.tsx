import { getSessionInfo, canSeeCost } from "@/lib/erp/auth";
import { SideNav } from "@/components/erp/side-nav";

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
      // ¿Hay hub al que volver? Lo decide la casa de la barra, `HubHomeLink`, con `canReachHub` —la misma función
      // que usan `/home` y todas las barras— y con el rol del HUB, no el del ERP (D-227). Hasta D-643 se preguntaba
      // aquí y la barra pintaba su propia casa; ahora la casa es una sola para todas las apps y se le pasan los datos.
      deliveriesRole={session.hubRole}
      moduleAccess={session.moduleAccess}
    />
  );
}
