"use client";

import { usePathname } from "next/navigation";
import { APP_VERSIONS } from "@/lib/app-versions";
import { appForPath } from "@/lib/app-for-path";

/**
 * La versión, arriba a la derecha, en las cinco apps y en el hub.
 *
 * Se monta una sola vez en el layout raíz porque es el único sitio por el que pasan
 * todas: cada módulo tiene su propio layout y su propia barra, y ponerlo en cada uno
 * serían cinco copias que se desincronizan a la primera.
 *
 * **Enseña la versión del módulo en el que estás, no una global.** Desde D-087 cada app
 * lleva su propio contador, así que un "v1.31.1" en la pantalla de fichaje sería
 * mentira: ahí la que importa es la de fichaje. Es también el número que compara el
 * aviso de actualización, así que cuando alguien llame diciendo que algo va raro, este
 * número y ese hablan de lo mismo.
 *
 * `pointer-events: none` a propósito: se dibuja por encima de todo y en la esquina donde
 * varias apps tienen su menú — el de clock-in es un botón de 44px justo ahí. Sin esto
 * robaría clics en un sitio donde nadie espera que haya nada.
 */

export function VersionStamp() {
  const version = APP_VERSIONS[appForPath(usePathname())];
  return (
    <span
      className="no-print"
      aria-hidden
      style={{
        position: "fixed",
        top: 3,
        right: 7,
        zIndex: 40, // por debajo de modales y avisos: informa, no tapa
        pointerEvents: "none",
        fontSize: 10,
        lineHeight: 1.4,
        letterSpacing: ".03em",
        fontVariantNumeric: "tabular-nums",
        // Sin variables de tema: este componente se dibuja también dentro de clock-in y
        // del ERP, que son de Tailwind y no tienen --gray. currentColor heredado del body
        // sirve en claro y en oscuro, y la opacidad lo deja como una marca de agua.
        color: "currentColor",
        opacity: 0.38,
      }}
    >
      v{version}
    </span>
  );
}
