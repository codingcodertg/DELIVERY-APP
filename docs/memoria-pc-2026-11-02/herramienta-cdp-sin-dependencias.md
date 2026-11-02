---
name: herramienta-cdp-sin-dependencias
description: dónde está el guion que abre la app en un navegador de verdad, y cómo levantar el modo demo para medir sin tocar producción
metadata:
  type: reference
---

`C:\Users\andre\.claude\herramientas\revision-visual\` — `cdp.mjs` (92 líneas, cero dependencias: Node 24 trae WebSocket) y
su `LEEME.md`. Abre el Chrome instalado en headless y lo maneja por CDP: navegar, evaluar, pulsar, arrastrar y capturar.
**El repo no tiene Playwright ni Puppeteer**, y `chromium-cli` no está en la máquina; esto es lo único que hay.

Se usa contra el modo demo, levantado **desde un worktree**, que no lleva base ni llaves y trae «Ver como» por rol:
`NEXT_PUBLIC_LOCAL_MODE=true NEXT_PUBLIC_SUPABASE_URL=http://localhost:1 NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next dev -p 3917`

**Why:** con él se hizo la primera revisión visual desde D-334 —29 decisiones sin que nadie abriera la app— y salieron D-364,
D-365 y D-367. Vivía en el scratchpad de la sesión, que se borra; por eso está copiado fuera.

**How to apply:** el demo tiene 0 tiendas y 0 órdenes con `route_seq`, así que las etiquetas P/D y la casita **no salen por
falta de datos, no por estar rotas**: se inyectan en `localStorage` (`rtg_deliveries_local_v13`) antes de mirar. Lo que el demo
no puede dar: planes publicados (el aviso de D-341), posiciones de chofer (Rastreo) y `user_prefs`. Y pinta Leaflet, no Google.
Si el puerto queda ocupado, el servidor anterior sobrevivió al cierre del shell: matar el PID que escucha en el 3917.

**Y lo que no se toca:** abre Chrome con un perfil desechable (`mkdtemp`), sin sesión. Cambiarla para reusar el perfil real del dueño «y no tener que iniciar sesión» la convertiría en algo que actúa COMO ÉL contra producción: un clic de una prueba sería una entrega marcada o un aviso enviado de verdad, a su nombre. Medir no lo justifica; se pide una decisión. Igual con un preview de Vercel, que apunta a la misma base y las mismas llaves que producción.
Ver [[clic-por-codigo-no-es-de-persona]].
