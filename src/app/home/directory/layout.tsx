import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * El directorio es para TODA la plantilla, así que esta puerta solo pregunta una cosa:
 * si hay sesión (D-256).
 *
 * No hay comprobación de rol ni de módulo, y no es un olvido: es lo que se pidió. Lo que
 * decide qué datos se ven no está aquí de todas formas — está en `public.phone_book()`,
 * que expone ocho columnas y solo de las personas activas. Una guarda de pantalla que
 * dijera que no, sin una barrera detrás, sería teatro; y aquí la barrera es la función.
 *
 * Sin `DataProvider`: esta pantalla no toca nada de Entregas. Montarlo aquí abriría sus
 * canales de tiempo real para alguien que a lo mejor ni tiene ese módulo.
 */
export default async function DirectoryLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/home/directory");

  return <div className="wrap">{children}</div>;
}
