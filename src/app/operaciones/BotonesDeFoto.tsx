"use client";

import { useEffect, useRef, useState } from "react";
import { usePrefs } from "@/lib/prefs";
import { AVISO_SI_NO_ABRIO_LA_CAMARA, ficheroDeDataUrl, usaCamaraDentroDeLaApp } from "@/lib/almacen-ops/foto-del-telefono";
import { hayCamaraEnVivo, type NavegadorConCamara } from "@/lib/camara-de-varias-fotos";
import { CamaraDeVariasFotos } from "@/components/CamaraDeVariasFotos";

/**
 * D-917: los dos botones para agregar una foto de merma —«📷 Tomar foto» (la cámara, `capture="environment"`) y
 * «🖼 Elegir de la galería» (sin `capture`)— con sus dos `<input type="file">`, los dos al MISMO `onFoto(file, origen)`.
 * Antes había un solo botón con `capture`, y en la app de Android, si la cámara no abría, no quedaba otra salida.
 *
 * Si el input de la cámara se cierra sin foto (`cancel`: cancelaron, o la app no tenía permiso de cámara), sale un aviso
 * suave con cómo dar el permiso; se quita en cuanto llega una foto. La `File` se entrega ANTES de vaciar el input, y quien
 * la recibe lee los bytes en el acto (`leerFotoDelTelefono`).
 *
 * Reunión 12 nov («en Android la cámara no abre»): dentro de la app de Android (APK ≤ 8) el `<input capture>` NUNCA abre
 * la cámara —a la cáscara le falta declarar `<queries>` y Capacitor cae al selector de archivos sin avisar—. Ahí «Tomar
 * foto» abre la cámara DENTRO de la app (`CamaraDeVariasFotos`, la misma de las fotos de entrega, con `getUserMedia`),
 * y la foto se entrega igual, como `File`. Si esa cámara tampoco abre, el siguiente toque usa el `<input>` de siempre.
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
  const [enVivo, setEnVivo] = useState(false);
  const [sinCamaraEnVivo, setSinCamaraEnVivo] = useState(false);
  const abreCamara = () => {
    const dentro = !sinCamaraEnVivo && usaCamaraDentroDeLaApp(navigator.userAgent, hayCamaraEnVivo(navigator as unknown as NavegadorConCamara));
    if (dentro) setEnVivo(true); else camara.current?.click();
  };
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
      <button type="button" className={`ops-opcion ops-camara${primario ? " ops-camara-principal" : ""}`} onClick={abreCamara} disabled={apagado} data-accion="foto">
        📷 {leyendo ? t("Reading photo…", "Leyendo la foto…") : etiquetaCamara}
      </button>
      <button type="button" className="ops-opcion ops-camara" onClick={() => galeria.current?.click()} disabled={apagado} data-accion="foto-galeria">
        🖼 {t("Choose from the gallery", "Elegir de la galería")}
      </button>
      <input ref={camara} type="file" accept="image/*" capture="environment" hidden onChange={entrega("camara")} data-entrada="camara" />
      <input ref={galeria} type="file" accept="image/*" hidden onChange={entrega("galeria")} data-entrada="galeria" />
      {sinFoto && !leyendo && <p className="hint" role="status" data-aviso="camara-sin-foto">{AVISO_SI_NO_ABRIO_LA_CAMARA[lang]}</p>}
      {enVivo && (
        <CamaraDeVariasFotos max={1} t={t}
          onSinCamara={() => { setEnVivo(false); setSinCamaraEnVivo(true); setSinFoto(true); }}
          onTerminar={(fin) => {
            setEnVivo(false);
            const f = fin.tipo === "listo" && fin.fotos[0] ? ficheroDeDataUrl(fin.fotos[0]) : null;
            if (f) { setSinFoto(false); onFoto(f, "camara"); }
          }} />
      )}
    </div>
  );
}
