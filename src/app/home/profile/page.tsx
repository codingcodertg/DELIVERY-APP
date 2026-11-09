import { createClient } from "@/lib/supabase/server";
import { identidadVisible } from "@/lib/profile-identity";
import { ProfileView } from "@/components/profile/ProfileView";
import { CUENTA_DEMO, PERFIL_DEMO } from "@/lib/home/demo-data";

/**
 * Mi perfil (D-265): una cuenta y una contraseña para todas las apps del hub, y un solo sitio
 * donde verla y cambiarla.
 *
 * La sesión la garantiza `layout.tsx`. Aquí se lee lo que se enseña: el nombre de `profiles` y con
 * qué entra la persona, correo o usuario. El correo y el usuario son de solo lectura: los cambia un
 * admin en Usuarios, porque de ellos cuelga el inicio de sesión. El nombre se edita aquí desde que la
 * pantalla de Cuenta de Entregas redirige a esta (D-274); por eso se pasa el id de la sesión, que
 * es la fila que la política deja escribir.
 */
/** El demo (`NEXT_PUBLIC_LOCAL_MODE`, D-NEXT): sin base ni sesión. */
const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

export default async function ProfilePage() {
  if (LOCAL_MODE) return <ProfileView id={PERFIL_DEMO.id} nombre={PERFIL_DEMO.full_name} correo={CUENTA_DEMO.correo} usuario={CUENTA_DEMO.usuario} />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: perfil } = user
    ? await supabase.from("profiles").select("full_name, username").eq("id", user.id).maybeSingle()
    : { data: null };

  const { correo, usuario } = identidadVisible({ email: user?.email, username: perfil?.username });

  return <ProfileView id={user?.id ?? null} nombre={perfil?.full_name ?? null} correo={correo} usuario={usuario} />;
}
