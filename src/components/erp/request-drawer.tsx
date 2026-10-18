"use client";

import Link from "next/link";
import { RequestForm } from "@/components/erp/request-form";
import { usePrefs } from "@/lib/prefs";
import type { RequestPickers } from "@/lib/erp/request-pickers";

// Fila del catálogo → «Request» (D-553, traspaso del commit 7ec9380 de BH): el formulario de
// /erp/request en un panel lateral, ya apuntando a ese producto. Es el formulario DE VERDAD
// (request-form.tsx con `targetSku`), no una copia: envía por el mismo submitRequest. Misma forma que
// ProductDrawer (capa + panel + onClose). Los desplegables llegan cargados una vez por la página.
//
// D-578: sin `product` es el cajón de «+ Artículo nuevo» (botón de la cabecera del catálogo): el mismo
// formulario, arrancando en «new» y con solo «new» / «copy» (`soloNuevos`). Es el único camino a crear un
// artículo desde la pantalla desde que D-553 quitó «Request» del menú.
export function RequestDrawer({
  product,
  pickers,
  canSeeCost,
  onClose,
}: {
  /** La fila desde la que se abrió; sin ella, el cajón de artículo nuevo. */
  product?: { sku: string; name: string };
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
        aria-label={product ? t(`Request a change to ${product.sku}`, `Solicitar un cambio en ${product.sku}`) : t("New item", "Artículo nuevo")}
        className="relative flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="min-w-0">
            {product ? (
              <>
                <div className="truncate text-sm font-semibold">{product.name}</div>
                <div className="font-mono text-xs text-slate-400">{product.sku}</div>
              </>
            ) : (
              <>
                <div className="truncate text-sm font-semibold">{t("New item", "Artículo nuevo")}</div>
                <div className="text-xs text-slate-400">{t("Lands as a draft for an admin to publish.", "Entra como borrador para que un admin lo publique.")}</div>
              </>
            )}
          </div>
          <button onClick={onClose} aria-label={t("Close", "Cerrar")} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">
            ✕
          </button>
        </div>
        <div className="space-y-3 p-4">
          {/* `key`: abrir otra fila con el cajón ya montado arranca un formulario limpio, no el anterior. */}
          {product ? (
            <RequestForm key={product.sku} {...pickers} canSeeCost={canSeeCost} targetSku={product.sku} />
          ) : (
            <RequestForm {...pickers} canSeeCost={canSeeCost} soloNuevos />
          )}
          <Link href="/erp/request" className="inline-block text-sm text-clay-600 hover:underline">
            {t("Your recent requests →", "Tus solicitudes recientes →")}
          </Link>
        </div>
      </div>
    </div>
  );
}
