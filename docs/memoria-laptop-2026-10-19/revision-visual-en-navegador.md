---
name: revision-visual-en-navegador
description: hay una herramienta para mirar la app en un Chrome de verdad, fuera del repo; sus tres trampas ya costaron informes falsos
metadata:
  type: reference
---

**Dónde:** `C:\Users\andre\.claude\herramientas\revision-visual\` — `cdp.mjs` (conduce Chrome por CDP, sin
dependencias: Node 24 trae WebSocket y fetch) y `LEEME.md` con el uso. La escribió un worker el 2026-09-23 y la
sacó del scratchpad porque se borra. **No está en el repo a propósito**: meterla en `scripts/` es una decisión
pendiente del dueño.

**Por qué importa:** fue la primera vez en 29 decisiones que alguien abrió la app. Encontró cuatro defectos
reales que ninguna prueba veía (D-364, D-365, D-367): la ficha que no se refrescaba, la pastilla cortada, el
menú de filtro, las marcas del mapa que se pisaban. El repo corre vitest en `node`, sin jsdom: sin esto, lo
visual solo se afirma.

**Es segura, y conviene saber por qué:** abre Chrome headless con un **perfil desechable** (`mkdtemp`) y el
puerto de depuración solo en 127.0.0.1; escribe únicamente capturas. **Nunca usa el Chrome del dueño con
sesión**, así que no puede actuar como él en producción. Se usa contra el **modo demo local** levantado en un
worktree (`NEXT_PUBLIC_LOCAL_MODE=true`), nunca contra producción ni en el checkout principal.

**Las tres trampas, las tres pagadas:**
1. **Barras invertidas en el código que se inyecta:** un `\n` se vuelve salto real y rompe la regex; vuelve
   `undefined` y parece «la pantalla no tiene eso». Dio un falso «no salen los botones» ([[escape-en-plantilla-prueba-inerte]]).
2. **Pulsar por código no es pulsar como una persona:** clicar una cabecera fuera de pantalla dio un falso «el
   menú abre 226 px por debajo del borde».
3. **Contar sobre el DOM entero cuenta ancestros:** «9 casitas» eran los antepasados de un solo icono de leyenda.

**Lo que el demo no puede dar:** planes publicados (el aviso de D-341 sigue sin verse), posiciones GPS de
chofer, `user_prefs` por persona y el mapa de Google (sin llave). Eso solo se ve en la app real, y se dice
como «no verificado», nunca como que funciona. Ver [[comprobar-la-capa-que-manda]].
