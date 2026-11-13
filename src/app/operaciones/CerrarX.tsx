"use client";

/**
 * La ✕ de arriba a la derecha de toda tarjeta de Operaciones de almacén (reunión 12 nov: «en el teléfono no hay cómo
 * cerrar la tarjeta»). Va PEGADA arriba (`position: sticky`, operaciones.css): aunque la tarjeta sea larga y el botón
 * «Cerrar» de abajo quede lejos, la ✕ sigue a la vista. No se imprime. El rótulo va en los dos idiomas para no pedir `t`.
 */
export function CerrarX({ onCerrar }: { onCerrar: () => void }) {
  return (
    <div className="ops-cerrar-fila no-imprimir" data-cerrar-arriba>
      <button type="button" className="ops-cerrar-x" onClick={onCerrar} aria-label="Close · Cerrar" title="Close · Cerrar" data-accion="cerrar-x">✕</button>
    </div>
  );
}
