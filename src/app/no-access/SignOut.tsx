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
        await createClient().auth.signOut();
        // La respuesta de «¿estás exento del cierre de las 18:30?» va con la persona, y esta
        // navegación no recarga la página (D-NEXT). Sin esto, quien entre después en el mismo
        // equipo hereda la del anterior.
        olvidarExencion();
        router.replace("/login");
      }}
    >
      Cerrar sesión / Sign out
    </button>
  );
}
