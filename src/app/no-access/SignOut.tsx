"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { olvidarExencion } from "@/lib/use-cutoff-exempt";

/** Sin esto la única salida sería borrar la cookie a mano: no hay barra ni menú aquí. */
export default function SignOut() {
  const router = useRouter();
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        // Solo este equipo (`local`): sin alcance, auth-js cierra la cuenta en todos.
        await createClient().auth.signOut({ scope: "local" });
        // La respuesta de «¿estás exento del cierre de las 18:30?» va con la persona, y esta
        // navegación no recarga la página (D-248). Sin esto, quien entre después en el mismo
        // equipo hereda la del anterior.
        olvidarExencion();
        router.replace("/login");
      }}
    >
      Cerrar sesión / Sign out
    </button>
  );
}
