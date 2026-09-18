import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DataProvider } from "@/lib/data-provider";
import { ConfirmProvider } from "@/lib/confirm";
import { landingRoute } from "@/lib/constants";
import { COOKIE_RETORNO, desempaquetar } from "@/lib/impersonation-cookie";
import type { Profile } from "@/lib/types";
import { ProfileReadError } from "@/components/ProfileReadError";
import { estadoDeLectura, puedeVerDetalle } from "@/lib/profile-read";

/**
 * «Cambiar de usuario» como herramienta del hub (D-306). Calcada de la puerta de Usuarios (D-056):
 * la sesión tiene que ser de un admin, decidido en el servidor con el rol leído de la base.
 *
 * Y una condición más que Usuarios no tiene: **si se está dentro de la sesión de otra persona, esta
 * página no se abre**. Un admin suplantando a alguien tiene la sesión de esa persona (D-243); el rol
 * que se leería aquí es el de ella, así que casi siempre la puerta de arriba ya lo manda fuera — pero
 * se comprueba la cookie de retorno aparte, para que no dependa de esa coincidencia. Saltar de una
 * identidad a otra es otro encargo, con su propia ruta; desde aquí, la salida es el banner.
 *
 * El `DataProvider` va aquí y no en el lobby, como en Usuarios: el panel lee la plantilla y las
 * tiendas de él, y el lobby no toca datos de Entregas.
 */
export default async function SwitchUserLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/switch-user");

  const { data: profile, error: errorPerfil } = await supabase
    .from("profiles")
    .select("id, full_name, username, role, store, permissions, avatar_url, recruiting_role, module_access")
    .eq("id", user.id)
    .maybeSingle();
  // Tres desenlaces (D-234): si la consulta falló no se redirige, que el login volvería aquí.
  if (estadoDeLectura({ data: profile, error: errorPerfil }) === "fallo") {
    return <ProfileReadError error={errorPerfil!} verDetalle={puedeVerDetalle(user)} />;
  }
  if (!profile) redirect("/login?next=/home/switch-user");
  const me: Profile = profile;

  if (me.role !== "admin") redirect(landingRoute(me));

  // Dentro de otra identidad no se cambia de usuario desde aquí: al lobby, donde manda el banner.
  const suplantando = desempaquetar((await cookies()).get(COOKIE_RETORNO)?.value ?? null) !== null;
  if (suplantando) redirect("/home");

  return (
    <ConfirmProvider>
      <DataProvider me={me}>
        <div className="wrap">{children}</div>
      </DataProvider>
    </ConfirmProvider>
  );
}
