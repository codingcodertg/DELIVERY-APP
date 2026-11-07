"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { AVISO_SI_NO_ABRIO_LA_CAMARA } from "@/lib/almacen-ops/foto-del-telefono";

/**
 * D-NEXT: los dos botones para agregar una foto de merma —«📷 Tomar foto» (la cámara, `capture="environment"`) y
 * «🖼 Elegir de la galería» (sin `capture`)— con sus dos `<input type="file">`, los dos al MISMO `onFoto(file, origen)`.
 * Antes había un solo botón con `capture`, y en la app de Android, si la cámara no abría, no quedaba otra salida.
 *
 * Si el input de la cámara se cierra sin foto (`cancel`: cancelaron, o la app no tenía permiso de cámara), sale un aviso
 * suave con cómo dar el permiso; se quita en cuanto llega una foto. La `File` se entrega ANTES de vaciar el input, y quien
 * la recibe lee los bytes en el acto (`leerFotoDelTelefono`).
 */
export function BotonesDeFoto({ onFoto, leyendo, disabled, etiquetaCamara, primario = true }: {
  onFoto: (f: File, origen: "camara" | "galeria") => void;
  leyendo: boolean;
  disabled?: boolean;
  /** El texto del botón de la cámara cuando no se está leyendo. */
  etiquetaCamara: string;
  /** La cámara como opción principal (borde de acento). */
  primario?: boolean;
}) {
  const { t, lang } = usePrefs();
  const camara = useRef<HTMLInputElement>(null);
  const galeria = useRef<HTMLInputElement>(null);
  const [sinFoto, setSinFoto] = useState(false);
  useEffect(() => {
    const el = camara.current;
    if (!el) return;
    const alCancelar = () => setSinFoto(true);
    el.addEventListener("cancel", alCancelar);
    return () => el.removeEventListener("cancel", alCancelar);
  }, []);
  const entrega = (origen: "camara" | "galeria") => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { setSinFoto(false); onFoto(f, origen); }
    e.target.value = "";
  };
  const apagado = leyendo || !!disabled;
  return (
    <div className="ops-botones-foto" data-botones-foto>
      <button type="button" className={`ops-opcion ops-camara${primario ? " ops-camara-principal" : ""}`} onClick={() => camara.current?.click()} disabled={apagado} data-accion="foto">
        📷 {leyendo ? t("Reading photo…", "Leyendo la foto…") : etiquetaCamara}
      </button>
      <button type="button" className="ops-opcion ops-camara" onClick={() => galeria.current?.click()} disabled={apagado} data-accion="foto-galeria">
        🖼 {t("Choose from the gallery", "Elegir de la galería")}
      </button>
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={entrega("camara")} data-entrada="camara" />
      <input ref={galeria} type="file" accept="image/*" hidden onChange={entrega("galeria")} data-entrada="galeria" />
      {sinFoto && !leyendo && <p className="hint" role="status" data-aviso="camara-sin-foto">{AVISO_SI_NO_ABRIO_LA_CAMARA[lang]}</p>}
    </div>
  );
}
