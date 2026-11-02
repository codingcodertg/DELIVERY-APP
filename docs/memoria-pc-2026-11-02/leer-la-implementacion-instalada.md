---
name: leer-la-implementacion-instalada
description: Una API que acepta lo que le das puede fallar más adentro; la firma no lo dice y los tipos tampoco.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-12T18:32:14.880Z
---

Tres fallos en un día con la misma forma: **una llamada que acepta los argumentos, compila, se
lee bien, y falla en una comprobación interna que la firma no menciona.** No los caza leer la
documentación ni los tipos — solo abrir `node_modules` y leer la implementación de la versión
instalada.

Casos medidos, en `@supabase/auth-js` 2.112.4:

- `setSession({ access_token: "", refresh_token })` **falla siempre**: `_setSession` empieza con
  `if (!access_token || !refresh_token) throw AuthSessionMissingError`, y esa comprobación va
  **antes** de mirar el refresh token. Lo correcto es `refreshSession({ refresh_token })`.
- `getUser()` devuelve `{ user: null, error }` ante **cualquier** `AuthError`, y un fallo de red
  lo es. O sea que «no hay sesión» y «no pude preguntar» tienen la misma forma; ver
  [[descartar-el-error-no-falla]].
- `admin.generateLink({ type: "magiclink" })` **crea el usuario** si el correo no existe. Un
  dedazo no da error: da una cuenta fantasma en producción.

**Cuándo aplicarlo:** antes de apoyar una promesa dura —restaurar una sesión, decidir un
permiso, no crear nada— en una llamada de biblioteca que no se puede probar de verdad desde la
rama. Ahí la firma no basta.

Y ver [[arreglo-que-parece-hecho]]: los tres compilaban y ninguno hacía lo que decía.
