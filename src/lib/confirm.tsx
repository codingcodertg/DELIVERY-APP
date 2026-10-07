"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { usePrefs } from "@/lib/prefs";

interface ConfirmOptions {
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button red for destructive actions (delete, discard, override). */
  danger?: boolean;
  /** Informational only — shows a single button and no way to "decline". */
  alertOnly?: boolean;
}

interface PendingConfirm extends ConfirmOptions {
  message: string;
  resolve: (v: boolean) => void;
}

type ConfirmFn = (message: string, opts?: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** App-styled replacement for window.confirm()/alert() — mount once near the
 * root. Native dialogs are blocking, unstyled, and freeze automation/webviews;
 * this renders in the same overlay/modal shell as the rest of the app. */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const { t } = usePrefs();
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirmAction = useCallback<ConfirmFn>(
    (message, opts) => new Promise((resolve) => setPending({ message, resolve, ...opts })),
    [],
  );

  const settle = (result: boolean) => {
    pending?.resolve(result);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirmAction}>
      {children}
      {pending && (
        // Encima de todo (D-488): el panel de «Switch user» va a z-index 9990 y el aviso naranja a 9999; con el 50 de
        // `.overlay` la pregunta «¿Cambiar a…?» quedaba debajo de la lista y no se podía pulsar. El dueño: «mira no puedo elegir».
        <div className="overlay" style={{ zIndex: 10000 }} onClick={(e) => e.target === e.currentTarget && settle(false)}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{pending.message}</p>
            <div className="modal-actions">
              {!pending.alertOnly && (
                <button className="btn btn-ghost" onClick={() => settle(false)}>
                  {pending.cancelLabel ?? t("Cancel", "Cancelar")}
                </button>
              )}
              <button className={pending.danger ? "btn btn-danger" : "btn btn-primary"} onClick={() => settle(true)} autoFocus>
                {pending.confirmLabel ?? t("OK", "Aceptar")}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Promise-based stand-in for window.confirm(). `await confirmAction(msg)`. */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
