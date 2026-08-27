"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Sin esto la única salida sería borrar la cookie a mano: no hay barra ni menú aquí. */
export default function SignOut() {
  const router = useRouter();
  return (
    <button
      className="btn btn-ghost btn-sm"
      onClick={async () => {
        await createClient().auth.signOut();
        router.replace("/login");
      }}
    >
      Cerrar sesión / Sign out
    </button>
  );
}
