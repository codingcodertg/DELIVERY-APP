import { createClient as clienteReal } from "@/lib/supabase/client";
import { clienteDemoDelHub } from "@/lib/home/cliente-demo";

const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";

/**
 * El cliente del navegador de las pantallas de `/home/**`. Con la bandera apagada ES `createClient()`; en el demo (D-NEXT),
 * el de la semilla. Se importa con ese mismo nombre para que el resto de cada pantalla no cambie ni una línea.
 */
export function clienteDelHub(): ReturnType<typeof clienteReal> {
  if (LOCAL_MODE) return clienteDemoDelHub(new Date()) as unknown as ReturnType<typeof clienteReal>;
  return clienteReal();
}
