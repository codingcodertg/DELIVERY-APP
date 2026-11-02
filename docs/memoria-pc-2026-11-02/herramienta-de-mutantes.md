---
name: herramienta-de-mutantes
description: arnés de mutantes fuera del repo que aborta si el ancla no es única y lee el resultado por el nombre de la prueba
metadata:
  type: reference
---

**Dónde:** `C:\Users\andre\.claude\herramientas\mutantes\` — `mutantes.mjs` (Node, sin dependencias),
`LEEME.md` y `tanda-ejemplo.json`. Lo escribió worker2 el 2026-09-23, junto a
[[revision-visual-en-navegador]]. No está en el repo a propósito. Se lanza desde la raíz del árbol que se
mide: `node ~/.claude/herramientas/mutantes/mutantes.mjs tanda.json`. La tanda es un JSON con `nombre`,
`fichero`, `viejo`, `nuevo` y `pruebas`.

**Por qué existe:** dos informes falsos el mismo día. El arnés de worker2 daba 12 supervivientes de 12
porque leía mal el resumen, y mi mutante editó la primera coincidencia de un ancla que aparecía 4 veces
(la línea 50 de `constants.ts` en vez de la 850). Los dos dan verde y se leen como «ninguna prueba vigila
esto». Ver [[tanda-de-mutantes-se-lee-por-nombre]].

**Qué comprueba antes de creerse un resultado:** el ancla aparece **exactamente una vez**, si no aborta
ese mutante sin tocar nada; un **control** sin mutar antes de la tanda, que para si algo ya está en rojo;
un mutante que **no cambia el fichero** o que **no compila** sale como ABORTA, no como superviviente. El
resultado sale del JSON de vitest (`--reporter=json` por la salida estándar), por el `fullName` de cada
prueba fallida, **nunca del código de salida**.

**Es segura:** revisada el 2026-09-23. No se conecta a nada, solo lanza `vitest`, rechaza rutas con `..` o
absolutas, y restaura cada fichero en `finally`, con Ctrl-C y con excepción.

**Lo que no hace:** no propone mutantes —la tanda se escribe a mano, y ahí está casi todo el valor— y no
sabe de **gemelos**: el mutante que es la misma regla escrita de otra forma, y debe quedarse en verde, se
corre en tanda aparte y se lee al revés.
