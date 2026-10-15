"use client";

import Link from "next/link";
import { RequestForm } from "@/components/erp/request-form";
import { usePrefs } from "@/lib/prefs";
import type { RequestPickers } from "@/lib/erp/request-pickers";

// Fila del catálogo → «Request» (D-553, traspaso del commit 7ec9380 de BH): el formulario de
// /erp/request en un panel lateral, ya apuntando a ese producto. Es el formulario DE VERDAD
// (request-form.tsx con `targetSku`), no una copia: envía por el mismo submitRequest. Misma forma que
// ProductDrawer (capa + panel + onClose). Los desplegables llegan cargados una vez por la página.
export function RequestDrawer({
  product,
  pickers,
  canSeeCost,
  onClose,
}: {
  product: { sku: string; name: string };
  pickers: RequestPickers;
  canSeeCost: boolean;
  onClose: () => void;
}) {
  const { t } = usePrefs();
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div
        role="dialog"
        aria-label={t(`Request a change to ${product.sku}`, `Solicitar un cambio en ${product.sku}`)}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{product.name}</div>
            <div className="font-mono text-xs text-slate-400">{product.sku}</div>
          </div>
          <button onClick={onClose} aria-label={t("Close", "Cerrar")} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          {/* `key`: abrir otra fila con el cajón ya montado arranca un formulario limpio, no el anterior. */}
          <RequestForm key={product.sku} {...pickers} canSeeCost={canSeeCost} targetSku={product.sku} />
          <Link href="/erp/request" className="inline-block text-sm text-clay-600 hover:underline">
            {t("Your recent requests →", "Tus solicitudes recientes →")}
          </Link>
        </div>
      </div>
    </div>
  );
}
