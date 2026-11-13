"use client";

import { useState, useTransition } from "react";
import { medirDeNuevo, reiniciarEstadisticas } from "./actions";

/** Los dos botones de «Salud del sistema» (D-1012). Reiniciar pide confirmar en la misma pantalla. */
export function BotonesDeSalud() {
  const [pendiente, empieza] = useTransition();
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const corre = (f: () => Promise<{ ok: true } | { ok: false; message: string }>, ok: string) => empieza(async () => {
    const r = await f();
    setAviso(r.ok ? ok : r.message);
    setConfirmando(false);
  });

  return (
    <div className="salud-botones">
      <button type="button" className="btn" disabled={pendiente} onClick={() => corre(medirDeNuevo, "Listo: datos nuevos.")} data-accion="medir-de-nuevo">
        🔄 Medir de nuevo
      </button>
      {!confirmando
        ? <button type="button" className="btn btn-ghost" disabled={pendiente} onClick={() => setConfirmando(true)} data-accion="reiniciar-estadisticas">
            ⟲ Reiniciar estadísticas de escrituras
          </button>
        : <span className="salud-confirma">
            <span className="hint">Se borran los acumulados y se empieza a medir desde ahora. ¿Seguro?</span>
            <button type="button" className="btn btn-danger btn-sm" disabled={pendiente} onClick={() => corre(reiniciarEstadisticas, "Reiniciadas: vuelve en una o dos horas para ver el ritmo actual.")} data-accion="confirmar-reinicio">Sí, reiniciar</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={pendiente} onClick={() => setConfirmando(false)}>Cancelar</button>
          </span>}
      {aviso && <span className="hint" role="status">{aviso}</span>}
    </div>
  );
}
