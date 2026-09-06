"use client";

import dynamic from "next/dynamic";
import { usePrefs } from "@/lib/prefs";

/**
 * La ficha del pedido, cargada cuando hace falta (G-20, D-NEXT).
 *
 * `OrderModal.tsx` son 3.122 líneas y arrastra el mapa, la firma, el visor de fotos y el
 * albarán. Entraba en el bundle inicial de las OCHO pantallas que la montan —el tablero (`/`),
 * el chofer, el almacén, el mapa, mi ruta, el resumen, cuentas y rutas— aunque en todas se abre
 * solo al tocar un pedido: `{open && <OrderModal …/>}`. Con `next/dynamic` el trozo se baja la
 * primera vez que alguien abre una ficha, y las páginas pintan antes.
 *
 * UN solo punto de carga, aquí, y las ocho pantallas importan de este fichero: ocho `dynamic()`
 * repartidos serían ocho chunks del mismo componente. El componente de verdad no cambia una
 * línea; solo cambia cómo llega al navegador.
 *
 * Sin `ssr: false`: la ficha nunca se pinta en el servidor (se monta desde estado de cliente,
 * después de un clic), así que el ajuste por defecto no cambia nada y no hay motivo para tocarlo.
 *
 * Mientras baja el trozo se enseña la misma capa (`.overlay` / `.modal` de globals.css) con el
 * "Cargando…" que ya usa el resto de Entregas: nada nuevo que dibujar. El pedido que se abrió
 * vive en el estado del padre (`open`), así que ni el primer clic ni el primer pedido se pierden:
 * el elemento sigue montado con las mismas props y el componente real lo recibe al llegar.
 */
function Cargando() {
  const { t } = usePrefs();
  return (
    <div className="overlay">
      <div className="modal" role="dialog" aria-busy="true">
        <div className="hint">{t("Loading…", "Cargando…")}</div>
      </div>
    </div>
  );
}

export const OrderModal = dynamic(() => import("./OrderModal").then((m) => m.OrderModal), {
  loading: Cargando,
});
