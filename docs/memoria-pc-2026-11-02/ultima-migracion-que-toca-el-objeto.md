---
name: ultima-migracion-que-toca-el-objeto
description: "Antes de reescribir una función, una restricción o cualquier objeto de la base, buscar la ÚLTIMA migración que lo define — y antes de eso, buscar si el objeto existe."
metadata:
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-23T20:37:22.546Z
---

Escribí `104` copiando el cuerpo de `guard_profile_privileged_columns()` de
`099`, donde está su trigger. Pero la última definición era la de `101`
(D-181), que le había sumado `erp_role`. Como `create or replace` sustituye la
función **entera**, aquello habría dejado el trigger en su sitio vigilando una
columna menos. Nada habría fallado: ni una prueba, ni `101`, que ni se toca.

**Por qué:** un objeto de la base no vive en un fichero, vive en la suma de
todas las migraciones que lo tocan. Leer la que lo creó da una foto vieja que
parece completa.

**Cómo aplicarlo:** `grep -rln "function public.<nombre>" supabase/` y partir de
la **última**. La prueba que se escriba después no debe enumerar columnas: leer
todas las definiciones en orden y exigir que la última sea **superconjunto** de
la unión de las anteriores, más un conjunto exacto para la actual. Emparejado
con [[verificar-contra-el-codigo-que-ejecuta]] y [[residuo-no-es-quedo-fuera]].

**2026-09-23 — vale igual para una RESTRICCIÓN, y el fallo peor no es partir de
la definición vieja: es no buscar el objeto.** Escribí la migración 140 de un
módulo nuevo (`promos`) sin preguntarme si algo restringía `module_access`. Lo
restringe: `profiles_module_access_known` prohíbe cualquier palabra que no esté
en su lista, así que **la base no dejaba conceder el módulo que la migración
venía a montar** — habría sido decorativo para todos menos el admin. Su última
definición es la **095**, no la 088, que todavía lleva `'clockin'`: copiar la
088 lo habría devuelto en silencio.

**Cómo aplicarlo, ampliado:** antes de añadir un valor nuevo a una columna —un
módulo, un rol, una etapa, un tipo— `grep -rn "<nombre_de_columna>"
supabase/migrations` buscando `check`, `constraint`, `enum` y `guard_`, no solo
`function`. Y dejar la comprobación en la propia migración de tres formas: que
acepte lo nuevo, que **no haya perdido** ninguno de los valores viejos, y que
**no haya resucitado** uno retirado a propósito — esa tercera es la que caza
haber partido del fichero equivocado.
