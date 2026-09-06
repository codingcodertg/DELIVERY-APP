"use client";

import { usePrefs } from "@/lib/prefs";

/**
 * Un texto en dos idiomas, para los server components del ERP (G-10, D-204).
 *
 * El idioma vive en el navegador (usePrefs, localStorage) y el servidor no lo ve. En 5a (D-203) el
 * detalle de producto movió su árbol entero a un hijo de cliente; para las otras 24 páginas
 * servidor eso sería mover 24 árboles y tipar 24 juegos de props para cambiar solo el texto. Esta
 * hoja es la forma mínima de la misma idea: el árbol y los datos se quedan en el servidor, y solo
 * el nodo de texto es de cliente. Sin cookie, sin parpadeo entre servidor y navegador distinto
 * del que ya tienen los otros módulos (inglés hasta que usePrefs lee localStorage).
 *
 *   <h1><Tx en="Catalog" es="Catálogo" /></h1>
 *
 * Un componente de cliente vale ~0 kB por página: el chunk es uno y compartido. Lo que NO cubre:
 * atributos (title, placeholder) de un server component; esos, si los hay, se mueven al hijo de
 * cliente más cercano o se quedan escritos como excepción en la decisión.
 */
export function Tx({ en, es }: { en: string; es: string }) {
  const { t } = usePrefs();
  return <>{t(en, es)}</>;
}
