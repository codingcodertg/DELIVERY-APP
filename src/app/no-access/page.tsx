import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { accessibleModules, landingRoute } from "@/lib/constants";
import type { UserRole } from "@/lib/types";
import SignOut from "./SignOut";

export const dynamic = "force-dynamic";

/**
 * La cuenta existe y la contraseña es correcta, pero no tiene ningún módulo (D-100).
 *
 * Antes esto no podía pasar: Entregas era implícita para todo el mundo, así que
 * cualquiera que entrase caía en el tablero de pedidos. Desde 083 se otorga, y sin
 * ningún módulo lo que había era una pantalla vacía — que se lee como una app rota y
 * acaba en una llamada. Mejor decirlo.
 *
 * Si le otorgan algo mientras está aquí, un recargado le manda a su sitio: esta página
 * comprueba de nuevo y redirige sola en vez de quedarse enseñando el aviso.
 */
export default async function NoAccessPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await supabase
    .from("profiles")
    .select("full_name, role, module_access")
    .eq("id", user.id)
    .maybeSingle();

  if (me && accessibleModules(me.module_access).length > 0) {
    redirect(landingRoute({ role: me.role as UserRole, module_access: me.module_access }));
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={{ fontSize: 34, marginBottom: 10 }} aria-hidden>🔒</div>
        <h2 style={{ margin: "0 0 8px" }}>Todavía no tienes acceso a ninguna app</h2>
        <p className="hint" style={{ marginBottom: 6 }}>
          Tu cuenta existe y entraste bien{me?.full_name ? `, ${me.full_name}` : ""} — pero nadie te ha dado acceso
          a un módulo aún. Habla con un administrador y dile qué necesitas usar.
        </p>
        <p className="hint" style={{ marginBottom: 16 }}>
          Your account works, but no app has been granted to it yet. Ask an administrator.
        </p>
        <SignOut />
      </div>
    </main>
  );
}
