# Una tanda de mutantes que se lee por el nombre de la prueba

`mutantes.mjs` rompe el código a propósito, un cambio cada vez, y apunta **qué prueba cae con cada mutante**. Node a secas,
sin dependencias, como `revision-visual/` de al lado. No va en el repo: convertirlo en herramienta del proyecto es decisión
aparte.

## Cómo se lanza

**Desde la raíz del árbol que se va a medir** — un worktree, normalmente:

```bash
node ~/.claude/herramientas/mutantes/mutantes.mjs mi-tanda.json
```

La tanda es un JSON. `tanda-ejemplo.json`, al lado, es la real con la que se midió
`visibilidad-almacen-y-ventana` el 2026-09-23 (12 de 12):

```json
{ "mutantes": [
  { "nombre": "esParaRecibir deja de exigir «y no sale»",
    "fichero": "src/lib/almacen.ts",
    "viejo":   "  return !sale;",
    "nuevo":   "  return true;",
    "pruebas": ["src/lib/almacen.test.ts"] }
]}
```

- **`nombre`** dice qué REGLA se rompe, no qué línea se toca. Es lo que se lee después, y lo que se pega en la entrada de
  `DECISIONS.md`.
- **`pruebas`** son solo los ficheros que pueden cazarlo. Correr la suite entera doce veces es tiempo sin información.
- `nuevo: ""` borra la línea, que suele ser el mutante más limpio.

Sale con 0 si caen todos; con 1 si alguno sobrevive o no se pudo aplicar; con 2 si no se pudo medir nada.

## Las cuatro cosas que comprueba antes de creerse un resultado

1. **El ancla tiene que aparecer EXACTAMENTE una vez.** Si aparece dos veces, aborta ese mutante y dice cuántas. Es el fallo
   que se pagó el 2026-09-23: un mutante con el ancla `  warehouse: [` editó la **línea 50** de `constants.ts` —una lista de
   etapas— en vez de los permisos de la 850, y la suite salió verde entera. Un ancla que casa en dos sitios muta el que no es
   y el verde parece decir «las pruebas no cazan esto».
2. **El control, antes de la tanda.** Corre los ficheros de prueba sin mutar nada y **para si hay algo en rojo**. Sobre una
   suite ya rota, toda prueba «cae» con todos los mutantes y la tanda entera no mide nada.
3. **Un mutante que no cambia el fichero no es un mutante**, y lo dice en vez de contarlo como superviviente. Pasó el
   2026-09-20: uno que decía mover la apertura de una ronda la reescribía en su sitio.
4. **Un mutante que deja el fichero sin compilar tampoco.** Vitest lo marca como suite fallida sin ninguna prueba dentro: eso
   no mide nada, y aquí sale como ABORTA, no como «cae».

## Se lee por el NOMBRE de la prueba, nunca por el código de salida

El resultado sale del **informe JSON** de vitest (`--reporter=json`, por la salida estándar: no escribe ningún fichero), de
donde se saca el `fullName` de cada prueba fallida. Nunca del código de salida ni de «falló algo».

Esto no es preferencia de formato, son dos informes falsos ya pagados:

- **2026-09-15:** la tanda usaba `--reporter=basic`, que en vitest 4 no existe. Los siete mutantes salieron con código 1 sin
  haber corrido una sola prueba. Siete unos idénticos que parecían una medida.
- **2026-09-23:** un arnés que leía la pantalla buscando `describe > it` dio **12 supervivientes de 12**. Ese formato solo
  aparece en los renglones `FAIL`; el resumen de arriba lleva el `it` suelto, así que el filtro no casaba nunca y la lista de
  caídas salía vacía siempre.

De ahí la regla que da nombre a todo esto:

> **Un verde total se sospecha primero del mutante, no de las pruebas.** Doce mutantes distintos, sobre cuatro ficheros,
> rompiendo reglas que sí tienen prueba: eso no pasa. Antes de escribir «sobrevive», correr un mutante cuya prueba se sepa
> que cae y ver que el arnés lo dice.

Y al revés, cuando sobrevive **uno**: mirarlo dos veces. La primera, para ver si de verdad hace lo que dice su nombre; la
segunda, para preguntarse «¿quién notaría esto si lo borro?» — a veces la respuesta es que el código sobra, no que la prueba
sea floja.

## Qué toca y qué no

- Escribe **solo los ficheros que la tanda nombra**, y los deja como estaban: restaura en `finally`, y también con Ctrl-C o
  con una excepción.
- Un `fichero` que caiga fuera del árbol donde se lanza **aborta la tanda entera antes de tocar nada**.
- No lee ni escribe nada más: ni base, ni red, ni el repo de al lado.

Aun así, **el árbol se mide con el trabajo ya commiteado**. Si la tanda se corta a lo bruto entre la escritura y la
restauración, `git status` lo enseña en un renglón.

## Lo que NO cubre

- **Mide lo que las pruebas dicen, no lo que el usuario ve.** Un mutante que caiga no dice que la pantalla esté bien; para eso
  está `revision-visual/`.
- **No propone mutantes**: la tanda se escribe a mano, y ahí está casi todo el valor. Un mutante que nadie habría escrito es el
  que encuentra el agujero.
- **No sabe de gemelos.** La regla escrita de otra forma —que tiene que quedarse en VERDE, para saber que la prueba fija la
  regla y no tu manera de escribirla— se corre como una tanda aparte y se lee al revés.
