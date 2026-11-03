import { headers } from "next/headers";
import { CABECERA_DISPOSITIVO, dispositivoDeLaPeticion } from "@/lib/security/reglas";
import { BloqueadoEnDispositivo } from "./BloqueadoEnDispositivo";

export const dynamic = "force-dynamic";

/**
 * Donde aterriza quien SÍ entró pero desde un dispositivo no autorizado (D-811). La cuenta y la contraseña son
 * correctas; lo que no está aprobado es la computadora o el teléfono. Se enseña el código del dispositivo para que el
 * admin lo encuentre en Security y lo apruebe.
 */
export default async function DeviceBlockedPage() {
  const h = await headers();
  const id = dispositivoDeLaPeticion({ cabecera: h.get(CABECERA_DISPOSITIVO), cookie: h.get("cookie") })?.id ?? "";
  return <BloqueadoEnDispositivo codigo={id.slice(0, 8).toUpperCase()} />;
}
