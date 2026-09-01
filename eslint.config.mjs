import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import tsPlugin from "@typescript-eslint/eslint-plugin";

/**
 * ESLint, por fin (D-154).
 *
 * El proyecto llevaba un `"lint": "next lint"` en package.json que **no hacía nada**: sin
 * configuración, `next lint` abre un asistente interactivo y se queda esperando. En una
 * sesión sin terminal —CI, o un asistente— eso es un comando que ni pasa ni falla.
 *
 * Se monta con la configuración plana y `eslint-config-next`, que es lo que Next 15 espera.
 *
 * ---------------------------------------------------------------------------
 * Por qué NO está en "estricto"
 * ---------------------------------------------------------------------------
 * Añadir un linter a treinta mil líneas escritas sin él da miles de avisos el primer día.
 * Un informe que nadie puede leer entero no se lee ninguna vez, y acaba en `--no-verify`.
 *
 * Así que esto empieza por lo que **encuentra errores de verdad**, no por estilo:
 * las reglas de React y de los hooks. El formato lo decide quien escribe; una dependencia
 * que falta en un `useEffect` es un bug esperando su turno.
 */
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

export default [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/**",
      "supabase/**",
      "scripts/**",
      "next-env.d.ts",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
  {
    // El plugin se REGISTRA pero no se activa su lista de reglas: sin esto, un
    // `eslint-disable-next-line @typescript-eslint/no-explicit-any` que ya existe en el
    // código es un error ("regla no encontrada"), y activar el conjunto entero traería
    // otro montón de avisos que nadie ha pedido todavía.
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      // Un `useEffect` al que le falta una dependencia lee un valor viejo y nadie se
      // entera: es exactamente la clase de fallo que costó las listas vacías.
      //
      // Y aun así, AVISO y no error. La primera pasada del linter sobre código escrito
      // sin él encontró 18 de estos, todos anteriores a hoy. Ponerlo en error convierte
      // el primer día del linter en un build roto, y lo que pasa entonces no es que
      // alguien arregle 18 hooks: es que alguien apaga el linter. El aviso sale en cada
      // build, a la vista, y se van limpiando.
      //
      // Cuando los 18 estén resueltos, esto sube a "error" — es el único modo de que
      // el siguiente no vuelva a colarse.
      "react-hooks/exhaustive-deps": "warn",

      // Las comillas y apóstrofos en el texto: la app es bilingüe y el español está lleno
      // de ellos. Escaparlos no arregla nada y ensucia cada cadena. Apagado.
      "react/no-unescaped-entities": "off",

      // <img> en vez de <Image>: aviso, no error. Las fotos de material y las firmas se
      // pintan desde blobs y data-urls, donde <Image> no aporta.
      "@next/next/no-img-element": "warn",
    },
  },
];
