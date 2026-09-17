import { createClient } from "@/lib/supabase/server";
import { identidadVisible } from "@/lib/profile-identity";
import { ProfileView } from "@/components/profile/ProfileView";

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
export default async function ProfilePage() {
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
