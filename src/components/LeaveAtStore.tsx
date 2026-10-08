"use client";

import { useState } from "react";
import { useData } from "@/lib/data-provider";
import { usePrefs } from "@/lib/prefs";
import { canDeliver } from "@/lib/constants";
import { EVENTO_DEJADO, escrituraDejarEnTienda, puedeDejarEnTienda } from "@/lib/leave-at-store";
import { nombreNormalizado } from "@/lib/store-pins";
import type { Delivery, Profile } from "@/lib/types";

// ============================================================
// «Dejar en tienda» (D-224): el control, una sola vez para las dos pantallas.
//
// Lo ofrecen la ficha del pedido y la tarjeta de «Siguiente parada» en Mi ruta. Vive en un
// componente compartido y no copiado en cada sitio porque **escribe en la base**: dos copias que
// se separen darían dos gestos con el mismo nombre y distinto efecto. La regla de qué se escribe
// está un piso más abajo, en `lib/leave-at-store.ts`, y aquí solo va la pantalla.
//
// Se pide la tienda ANTES de mover nada: el pedido está físicamente en algún sitio, y un
// «dejado» sin decir dónde es justo el pedido perdido que esto viene a evitar.
// ============================================================

export function LeaveAtStore({
  pedido,
  me,
  disabled,
  onDone,
  className = "btn btn-amber",
  style,
  abierto: abiertoDeFuera,
  onAbierto,
}: {
  pedido: Delivery;
  me: Profile;
  disabled?: boolean;
  /** Se llama tras dejarlo, para que la pantalla que lo use cierre o refresque. */
  onDone?: () => void;
  className?: string;
  style?: React.CSSProperties;
  /**
   * Abierto desde fuera (D-NEXT). La ficha lleva «🏬 Dejar en tienda» en su menú «Acciones ▾»: el botón vive
   * allí y aquí solo queda el formulario (la tienda, Atrás y Confirmar). Con `abierto` puesto, cerrado no pinta
   * nada; «Atrás» y dejarlo avisan con `onAbierto(false)`. Sin él (Mi ruta), funciona como siempre.
   */
  abierto?: boolean;
  onAbierto?: (abierto: boolean) => void;
}) {
  const { settings, setStage, notify } = useData();
  const { t } = usePrefs();
  const [abiertoPropio, setAbiertoPropio] = useState(false);
  const deFuera = abiertoDeFuera !== undefined;
  const abierto = deFuera ? abiertoDeFuera : abiertoPropio;
  const setAbierto = (v: boolean) => { if (deFuera) onAbierto?.(v); else setAbiertoPropio(v); };
  const [tienda, setTienda] = useState("");
  const [guardando, setGuardando] = useState(false);

  if (!puedeDejarEnTienda(pedido, me, canDeliver(me))) return null;

  const confirmar = async () => {
    // Se busca por nombre normalizado, la misma comparación que el mapa de tiendas (D-222): el
    // valor sale del propio desplegable, así que hoy casa exacto, pero comparar de dos formas
    // distintas en la misma app es lo que hace que un día deje de casar sin que nadie lo vea.
    const buscada = nombreNormalizado(tienda);
    const elegida = settings.stores.find((s) => nombreNormalizado(s.name) === buscada);
    if (!elegida) return;
    setGuardando(true);
    const { patch, note } = escrituraDejarEnTienda({ pedido, tienda: elegida, me, t });
    // `setStage` es quien comprueba la transición (`picked_up → ready` ya era legal) y quien deja
    // el evento. El `kind` propio hace que esto se distinga de una edición cualquiera en el
    // historial: un pedido que cambia de sitio tiene que poder buscarse.
    const ok = await setStage(pedido.id, "ready", note, patch, EVENTO_DEJADO);
    setGuardando(false);
    if (!ok) return;
    notify(t(`Left at ${elegida.name} — back on the board`, `Dejado en ${elegida.name} — vuelve a la lista`));
    setAbierto(false);
    setTienda("");
    onDone?.();
  };

  if (!abierto) {
    if (deFuera) return null;
    return (
      <button
        className={className}
        style={style}
        disabled={disabled || guardando}
        onClick={() => setAbierto(true)}
        title={t("Drop it at one of our stores so another driver can take it", "Déjelo en una de nuestras tiendas para que otro chofer lo lleve")}
      >
        🏬 {t("Leave at store", "Dejar en tienda")}
      </button>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", ...style }}>
      <select
        value={tienda}
        onChange={(e) => setTienda(e.target.value)}
        disabled={guardando}
        style={{ minWidth: 180 }}
        aria-label={t("Store where it is left", "Tienda donde se deja")}
      >
        <option value="">{t("Which store?", "¿En qué tienda?")}</option>
        {settings.stores.map((s) => (
          <option key={s.name} value={s.name}>{s.name}</option>
        ))}
      </select>
      <button className="btn btn-ghost btn-sm" disabled={guardando} onClick={() => { setAbierto(false); setTienda(""); }}>
        {t("Back", "Atrás")}
      </button>
      <button className="btn btn-amber btn-sm" disabled={guardando || !tienda} onClick={() => void confirmar()}>
        {guardando ? t("Saving…", "Guardando…") : t("Confirm drop-off", "Confirmar entrega en tienda")}
      </button>
    </div>
  );
}
