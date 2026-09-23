---
name: ultima-migracion-que-toca-el-objeto
description: "Antes de reescribir una función de la base, buscar la ÚLTIMA migración que la define, no la que la creó."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-10T17:23:21.039Z
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
