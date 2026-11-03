import { BloqueadoEnWeb } from "./BloqueadoEnWeb";

export const dynamic = "force-dynamic";

/**
 * Donde aterriza quien entró por la web (navegador de computadora) con un rol que ya solo entra por la app de
 * escritorio RTG Hub (D-816: manager, sales, logistics). La cuenta está bien; lo que ya no vale es el navegador.
 * Se le da el instalador ahí mismo: la ruta de descarga acepta la sesión.
 */
export default function WebBlockedPage() {
  return <BloqueadoEnWeb />;
}
