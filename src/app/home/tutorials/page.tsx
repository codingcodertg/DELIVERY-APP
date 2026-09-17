import { createClient } from "@/lib/supabase/server";
import { puedeGestionarTutoriales } from "@/lib/tutorials-hub";
import { TutorialsHub } from "@/components/tutorials/TutorialsHub";

/**
 * Tutoriales (D-268): los videos de cómo usar cada app, agrupados por app, para todo el que tenga
 * sesión. La sesión la garantiza `layout.tsx`.
 *
 * Aquí solo se decide si esta persona gestiona. Esconder los botones a quien no es admin es comodidad:
 * la barrera de verdad es la base, donde `settings` solo lo actualiza `is_admin()` (100).
 */
export default async function TutorialsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: perfil } = user
    ? await supabase.from("profiles").select("id, role").eq("id", user.id).maybeSingle()
    : { data: null };

  return <TutorialsHub yo={perfil?.id ?? null} puedeGestionar={puedeGestionarTutoriales(perfil?.role)} />;
}
