import type { Pastilla } from "@/lib/recibir";

/**
 * La cámara dentro de la pastilla de etapa (D-577): «Delivered 📷» cuando el chofer subió fotos y quien mira puede
 * verlas. Lo decide `pastillaDeEtapa` con `iconoDeFotos`; esto solo lo pinta, igual en Órdenes, Almacén, el Gestor, la
 * tarjeta del chofer, la burbuja-selector de D-573 y la ficha. Sin icono no pinta nada: la pastilla dice «Delivered» a secas.
 */
export function IconoDeFotos({ p }: { p: Pastilla }) {
  if (!p.icono) return null;
  return <span className="icono-de-fotos" role="img" title={p.titulo} aria-label={p.titulo}>{p.icono}</span>;
}
