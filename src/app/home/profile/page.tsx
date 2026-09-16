import { createClient } from "@/lib/supabase/server";
import { identidadVisible } from "@/lib/profile-identity";
import { ProfileView } from "@/components/profile/ProfileView";

/**
 * Mi perfil (D-265): una cuenta y una contraseña para todas las apps del hub, y un solo sitio
 * donde verla y cambiarla.
 *
 * La sesión la garantiza `layout.tsx`. Aquí se lee lo que se enseña: el nombre de `profiles` y con
 * qué entra la persona, correo o usuario. Todo de solo lectura, como se pidió: el correo y el
 * usuario los cambia un admin en Usuarios, porque de ellos cuelga el inicio de sesión, y el nombre
 * se sigue editando donde ya se editaba (la cuenta de cada app), que este cambio no toca.
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

  return <ProfileView nombre={perfil?.full_name ?? null} correo={correo} usuario={usuario} />;
}
