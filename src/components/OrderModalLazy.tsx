"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, type ComponentProps } from "react";
import { usePrefs } from "@/lib/prefs";
import { useData } from "@/lib/data-provider";
import { AVISO_SOLO_TUS_ORDENES, puedeAbrirLaOrden } from "@/lib/abrir-la-orden";

/**
 * La ficha del pedido, cargada cuando hace falta (G-20, D-209).
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

const FichaDiferida = dynamic(() => import("./OrderModal").then((m) => m.OrderModal), {
  loading: Cargando,
});

/**
 * La PUERTA de la ficha (D-544). El dueño, 2026-10-13: «if you are a sales person you cant open others peoples orders just
 * their owns». Todas las pantallas que abren una orden montan ESTE componente, así que la regla (`puedeAbrirLaOrden`) va
 * aquí una vez y vale para todas —la tabla de Órdenes, el `/?order=` de una notificación, «Ruta de hoy», Cuentas…—, también
 * para la que se escriba mañana. Una orden que no puede abrir no monta la ficha: se cierra y sale el aviso.
 */
export function OrderModal(props: ComponentProps<typeof FichaDiferida>) {
  const { teaching, notify } = useData();
  const { t } = usePrefs();
  // Se decide al ABRIR (por id), no en cada pintado: un borrador ajeno que el vendedor abrió y envió deja de ser borrador
  // mientras lo tiene delante, y la ficha no se le debe cerrar en la cara por eso.
  const cerrada = useMemo(
    () => props.existing != null && !puedeAbrirLaOrden(props.me, props.existing, { teaching }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.existing?.id, props.me?.id, props.me?.role, teaching],
  );
  const { onClose } = props;
  useEffect(() => {
    if (!cerrada) return;
    notify(t(AVISO_SOLO_TUS_ORDENES.en, AVISO_SOLO_TUS_ORDENES.es));
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cerrada, props.existing?.id]);
  if (cerrada) return null;
  return <FichaDiferida {...props} />;
}
