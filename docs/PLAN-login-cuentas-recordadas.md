# Plan — Login: lista de cuentas recordadas por aparato

**Fecha:** 2026-09-05 · **Pedido por:** Andrés · **Estado:** aprobado por el dueño
(opción "lista + contraseña", 2026-09-05) · **Decisión:** `D-NEXT` al fusionar

**Petición literal:** *"en el login quiero que se guarde siempre si ingresaste con
otro usuario y sea quick login… y puede quedar hasta la lista de varios…
obviamente al menos que se cambie la contraseña"*.

## 1. Lo medido

- El login **ya tiene "Remember me"** y guarda **un solo** email en
  `localStorage` (`rtg_remembered_email`, `login/page.tsx:9,35,83-84`), que se pisa
  cada vez que entra otra persona. Eso es exactamente el fallo que el dueño describe.
- El login **no está traducido** (todo en inglés, sin `usePrefs`), y es la pantalla
  que ve todo el mundo.
- Quien no cerró sesión **ya entra sin escribir nada**: el middleware saca del login
  a quien tiene sesión válida (`middleware.ts:152-160`). `signOut` revoca la sesión
  en el servidor, así que tras salir hay que escribir la contraseña. Con esto, el
  requisito "si cambió la contraseña, deja de entrar" **se cumple solo**: siempre
  se pide, y la nueva es la que vale.
- Dos bugs de paso: **"Forgot password?" apunta a `/auth/callback`, que no
  existe** (`login/page.tsx:57-59`; solo hay `auth/signout`); y el mensaje
  *"signed out because this account signed in on another device"*
  (`page.tsx:40-42`) promete un candado retirado a propósito
  (`data-provider.tsx:583-587`).
- Descartado el cambio sin contraseña (varias sesiones vivas): Supabase no lo trae,
  exige `storageKey` por cuenta en los cinco clientes + servidor + middleware,
  guarda refresh tokens al alcance de cualquier script, y choca con la rotación de
  tokens de D-119. Va contra D-172/D-179. Se dijo antes y el dueño eligió la lista.

## 2. Diseño

- `rtg_remembered_email` → **`rtg_accounts`**: lista de `{ identifier, displayName,
  lastUsedAt }`, ordenada por uso reciente, con migración del valor viejo.
- Tras un login con éxito se guarda/actualiza la entrada leyendo `full_name` de
  `profiles` (el login no conoce el nombre antes de entrar).
- La pantalla: si hay cuentas, se muestran como tarjetas (nombre + identificador);
  tocar una **prerrellena el identificador y pide solo la contraseña**; cada una
  con ✕ para quitarla; y un enlace "Otra cuenta" para el formulario vacío.
  "Remember me" pasa a significar "guardar esta cuenta en la lista".
- **Se traduce el login entero** con `usePrefs().t(en, es)`, que es el patrón del
  módulo base (no el diccionario por claves de Time Tracker).
- Bug 1: se implementa `src/app/auth/callback/route.ts` (intercambio del código
  por sesión y redirección a `?next=`), que es lo que el enlace de reset ya
  promete; `isPublicPath` ya lo contempla.
- Bug 2: se elimina el mensaje muerto de `?reason=session`.

## 3. Lo que NO se hace

- Nada de sesiones múltiples ni tokens en localStorage.
- No se limpia el estado local de otros usuarios al salir (`rtg_outbox_v1`,
  borradores): la cola offline del chofer guarda pedidos **sin enviar**; borrarla
  al salir puede perder trabajo. Es decisión aparte, anotada.
- No se tocan middleware, clientes de Supabase ni `username.ts`.

## 4. Verificación

`verify.mjs`. Prueba unitaria de la lista (migración del valor viejo, orden por
reciente, quitar, tope de entradas) extrayendo la lógica a `src/lib/remembered-
accounts.ts` para que sea testeable sin dibujar. Nadie puede abrir el login con
sesión real: lo firma el dueño.
