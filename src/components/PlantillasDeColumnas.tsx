"use client";

import { useState } from "react";
import { MAX_PLANTILLAS, plantillaLlamada } from "@/lib/plantillas-de-columnas";
import { MAX_NOMBRE_DE_PLANTILLA, type PlantillaDeColumnas } from "@/lib/user-prefs";

/**
 * Las plantillas de ⚙ Columnas (D-394), el mismo bloque en Órdenes y en los dos ⚙ del Gestor de Rutas. El dueño:
 * «add template in columns … so if they change it and then want to go back to the old one they can», y «logistic manager
 * needs to have the same template as in order view».
 *
 * - «Default / Por defecto» siempre está, y devuelve lo que trae la app.
 * - Cada plantilla guardada es un botón: un clic la aplica. Su ✕ no borra: pregunta, en la misma línea, y hay que decir
 *   «Sí, borrar». Dentro del menú y no en un diálogo, porque un diálogo fuera de la caja cuenta como «clic fuera» y cierra
 *   el menú (`useCierraAlSalir`).
 * - «Guardar» guarda lo que se ve ahora con el nombre escrito; si el nombre ya existe, el botón dice «Reemplazar».
 *
 * Qué es «lo que se ve ahora», cómo se aplica y dónde se guarda lo decide cada pantalla: aquí solo se pinta y se avisa.
 * `onGuardar` devuelve el texto del problema, o `null` si se guardó.
 */
export function PlantillasDeColumnas({ plantillas, onAplicar, onGuardar, onBorrar, t }: {
  plantillas: readonly PlantillaDeColumnas[];
  /** `null` = «Por defecto». */
  onAplicar: (p: PlantillaDeColumnas | null) => void;
  onGuardar: (nombre: string) => Promise<string | null>;
  onBorrar: (nombre: string) => Promise<string | null>;
  t: (en: string, es: string) => string;
}) {
  const [nombre, setNombre] = useState("");
  const [borrando, setBorrando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ texto: string; mal: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const reemplaza = !!plantillaLlamada(plantillas, nombre);
  const lleno = plantillas.length >= MAX_PLANTILLAS && !reemplaza;

  const guardar = async () => {
    if (ocupado) return;
    setOcupado(true);
    const n = nombre.trim();
    const problema = await onGuardar(n);
    setOcupado(false);
    if (problema) { setAviso({ texto: problema, mal: true }); return; }
    setAviso({ texto: t(`Saved “${n}”.`, `Guardada «${n}».`), mal: false });
    setNombre("");
  };
  const borrar = async (n: string) => {
    setBorrando(null);
    const problema = await onBorrar(n);
    setAviso(problema ? { texto: problema, mal: true } : { texto: t(`Deleted “${n}”.`, `Borrada «${n}».`), mal: false });
  };
  const aplicar = (p: PlantillaDeColumnas | null) => {
    onAplicar(p);
    setAviso({ texto: p ? t(`Applied “${p.n}”.`, `Aplicada «${p.n}».`) : t("Back to the default columns.", "Columnas por defecto."), mal: false });
  };

  return (
    <div className="plantillas-cols" data-plantillas>
      <div className="plantillas-cols-titulo">
        {t("Templates", "Plantillas")} <span className="plantillas-cols-cuenta">{plantillas.length}/{MAX_PLANTILLAS}</span>
      </div>
      <div className="plantillas-cols-lista">
        <button type="button" className="plantilla-col plantilla-col-defecto" onClick={() => aplicar(null)}
          title={t("Back to the columns the app comes with", "Volver a las columnas que trae la app")}>
          {t("Default", "Por defecto")}
        </button>
        {plantillas.map((p) => borrando === p.n ? (
          <span key={p.n} className="plantilla-col-borrar" role="group" aria-label={t(`Delete ${p.n}?`, `¿Borrar ${p.n}?`)}>
            {t(`Delete “${p.n}”?`, `¿Borrar «${p.n}»?`)}
            <button type="button" className="btn btn-danger btn-sm" onClick={() => void borrar(p.n)}>{t("Yes, delete", "Sí, borrar")}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setBorrando(null)}>{t("No", "No")}</button>
          </span>
        ) : (
          <span key={p.n} className="plantilla-col-par">
            <button type="button" className="plantilla-col" onClick={() => aplicar(p)} title={t(`Apply “${p.n}”`, `Aplicar «${p.n}»`)}>{p.n}</button>
            <button type="button" className="plantilla-col-x" aria-label={t(`Delete template ${p.n}`, `Borrar plantilla ${p.n}`)} onClick={() => setBorrando(p.n)}>✕</button>
          </span>
        ))}
      </div>
      <form className="plantillas-cols-guardar" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
        <input
          className="col-menu-search" value={nombre} maxLength={MAX_NOMBRE_DE_PLANTILLA} disabled={ocupado}
          onChange={(e) => { setNombre(e.target.value); setAviso(null); }}
          placeholder={t("Template name", "Nombre de la plantilla")}
          aria-label={t("Template name", "Nombre de la plantilla")}
        />
        <button type="submit" className="btn btn-ghost btn-sm" disabled={ocupado || !nombre.trim() || lleno}>
          {reemplaza ? t("Replace", "Reemplazar") : t("Save", "Guardar")}
        </button>
      </form>
      {lleno && <div className="hint plantillas-cols-aviso">{t(`Up to ${MAX_PLANTILLAS} templates: delete one to save another.`, `Hasta ${MAX_PLANTILLAS} plantillas: borre una para guardar otra.`)}</div>}
      {aviso && <div className={"hint plantillas-cols-aviso" + (aviso.mal ? " plantillas-cols-mal" : "")} role="status">{aviso.texto}</div>}
    </div>
  );
}
