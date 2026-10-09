# Conducir la app en un navegador de verdad, sin dependencias

`cdp.mjs` abre el Chrome instalado en modo headless y lo maneja por CDP (Node 24 ya trae WebSocket, así que no hace falta
Playwright ni Puppeteer, que NO están en el repo). Con esto se hizo la primera revisión visual desde D-334 (D-364, D-365, D-367).

## Cómo se usa

1. Levantar la app en modo demo **desde un worktree**, nunca desde el checkout principal:
   `NEXT_PUBLIC_LOCAL_MODE=true NEXT_PUBLIC_SUPABASE_URL=http://localhost:1 NEXT_PUBLIC_SUPABASE_ANON_KEY=x npx next dev -p 3917`
   (el demo no lleva base ni llaves: no toca producción, y trae selector «Ver como» por rol y ~86 órdenes).
2. Un guion al lado de este fichero:
   ```js
   import { abreChrome } from "./cdp.mjs";
   const nav = await abreChrome();                 // { ancho, alto } si hace falta otra ventana
   const p = await nav.pagina("http://127.0.0.1:3917/routes");
   await p.espera(6000);
   console.log(await p.evalua("document.querySelectorAll('.leaflet-marker-icon').length"));
   await p.tiro("lo-que-sea");                     // PNG en $SCRATCH/tiros
   nav.cierra();
   ```
   `SCRATCH=<carpeta> node guion.mjs` decide dónde caen las capturas.

## Tres trampas que ya costaron un informe falso

- **Nada de barras invertidas en el código que se inyecta.** Un `\n` dentro de la plantilla se convierte en salto real y
  rompe la regex: `String.fromCharCode(10)` y `new RegExp("...", "g")`. Si no, el fallo de sintaxis vuelve como `undefined`
  y parece «la pantalla no tiene eso» (por eso `evalua` lanza al ver `exceptionDetails`).
- **Pulsar por código no es pulsar como una persona.** Un `.click()` sobre una cabecera fuera de pantalla abrió un menú donde
  nadie podría abrirlo, y se reportó un fallo que no existía. Traer el elemento a la vista primero (`scrollIntoView`).
- **Contar sobre el DOM entero cuenta ancestros.** «9 casitas» eran los 9 padres de UN icono. Contar sobre los elementos que
  son la marca (`.leaflet-marker-icon`), no sobre `*`.

## El perfil de Chrome es desechable, y NO se cambia

`abreChrome` arranca con `--user-data-dir` sobre una carpeta nueva de `mkdtemp`: un Chrome vacío, sin sesión, sin cookies y sin
extensiones, que se tira al acabar. **Eso es lo que hace que esta herramienta no pueda actuar como el dueño.**

**Si alguien la cambia para «reusar el perfil y no tener que iniciar sesión», eso sería un problema serio.** Con el perfil real
del dueño, un guion de medición entra a la app con su sesión ya iniciada y contra la base de PRODUCCIÓN: cualquier clic de una
prueba —marcar entregada, publicar una ruta, mandar un aviso— lo estaría haciendo él de verdad, y el historial diría su nombre.
Medir nunca justifica eso. Si hace falta ver algo que solo se ve con sesión, se pide una decisión, no se reusa el perfil.

Lo mismo vale para el servidor: se mide contra el modo demo en `127.0.0.1`, que no lleva base ni llaves. Un preview de Vercel
**no** sirve de sustituto: apunta a la misma base y a las mismas llaves que producción.

## Lo que NO cubre

El modo demo no tiene servidor: sin planes publicados (el aviso de D-341 no se puede ver), sin posiciones de chofer (la
pantalla de Rastreo no monta mapa) y sin `user_prefs` (lo «por persona» solo se prueba contra el navegador). Y el mapa de
Google no corre ahí: sin llave, el demo pinta Leaflet.
