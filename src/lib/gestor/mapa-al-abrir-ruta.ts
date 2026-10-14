import { PANEL_DE_TODAS, PANEL_SIN_ASIGNAR } from "@/lib/vista-del-gestor";

/**
 * Al abrir las rutas de un chofer, el mapa se esconde solo (D-544).
 *
 * El dueño, 2026-10-13 (literal): «when you open the routes for a driver in the trutes manager you open up ad river routes it
 * should hide the map automatically but they can still show it on the top if the user wantss it».
 *
 * «Abrir las rutas de un chofer» es lo que despliega su tabla de paradas:
 *   - en «▦ Cuadrícula» (el defecto, D-526), pulsar su nombre: su tabla sale desplegada abajo (`desplegada`, D-481 e);
 *   - en «▭ Ancho», el ▸ de su tarjeta (`alternadas`: las tarjetas de chofer nacen plegadas, D-393).
 * Pulsar el nombre en «Ancho» NO cuenta: ahí el nombre resalta la ruta EN EL MAPA, y esconderlo sería deshacer lo pedido.
 *
 * Las reglas, en orden:
 *   1. Se abre una ruta que no estaba abierta → el mapa se esconde, salvo que la persona lo haya vuelto a abrir a mano con
 *      alguna ruta abierta (`respetar`): no se le pelea. Abrir OTRA ruta en esa misma vista tampoco se lo vuelve a esconder.
 *   2. Se cierran todas → si lo escondió esta regla, el mapa vuelve; y se olvida lo de «respetar»: la próxima vez que abra
 *      una ruta, se vuelve a esconder.
 *   3. El botón de arriba («🗺 Ocultar/Mostrar mapa y choferes») manda siempre: alterna, y si deja el mapa A LA VISTA con
 *      alguna ruta abierta, eso queda como la elección de la persona (`respetar`).
 *
 * Es estado de la pantalla: no se guarda en ningún sitio, igual que lo era `showTop`.
 */
export interface EstadoDelMapa {
  /** Se ve el mapa y el panel de choferes (lo que antes era `showTop`). */
  visible: boolean;
  /** Lo escondió esta regla (no la persona): al cerrar todas las rutas, vuelve. */
  autoOculto: boolean;
  /** La persona lo abrió a mano con una ruta abierta: no se le vuelve a esconder hasta que cierre todas. */
  respetar: boolean;
}

export const MAPA_INICIAL: EstadoDelMapa = { visible: true, autoOculto: false, respetar: false };

/** Las rutas abiertas ahora: la desplegada en «Cuadrícula», o las tarjetas abiertas en «Ancho». */
export function rutasAbiertas(args: { ancho: boolean; desplegada: string | null; alternadas: ReadonlySet<string> }): string[] {
  if (!args.ancho) return args.desplegada ? [args.desplegada] : [];
  // En «Ancho» una tarjeta de chofer pulsada está ABIERTA (nacen plegadas); «Sin asignar» y «Todas» nacen abiertas y no son
  // rutas de un chofer.
  return [...args.alternadas].filter((k) => k !== PANEL_SIN_ASIGNAR && k !== PANEL_DE_TODAS).sort();
}

/** Cambiaron las rutas abiertas (de `antes` a `ahora`). */
export function alAbrirRutas(e: EstadoDelMapa, antes: readonly string[], ahora: readonly string[]): EstadoDelMapa {
  if (ahora.length === 0) {
    if (antes.length === 0) return e;
    return { visible: e.autoOculto ? true : e.visible, autoOculto: false, respetar: false };
  }
  const nueva = ahora.some((k) => !antes.includes(k));
  if (!nueva || e.respetar || !e.visible) return e;
  return { visible: false, autoOculto: true, respetar: false };
}

/** El botón de arriba: alterna, y si deja el mapa a la vista con una ruta abierta, se respeta. */
export function alPulsarElMapa(e: EstadoDelMapa, hayRutaAbierta: boolean): EstadoDelMapa {
  const visible = !e.visible;
  return { visible, autoOculto: false, respetar: visible && hayRutaAbierta };
}
