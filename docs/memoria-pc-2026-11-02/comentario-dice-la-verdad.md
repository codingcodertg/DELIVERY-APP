---
name: comentario-dice-la-verdad
description: En este repo, cuando un comentario y el código discrepan, el comentario suele tener razón — y esa discrepancia es el bug
metadata:
  type: project
---

Patrón encontrado **cuatro veces en tres días** (2026-09-08 a 2026-09-10), siempre igual: **el
comentario decía la verdad y el código no la cumplía.**

- **D-227** — `erp/side-nav.tsx` decía «here the hub is the way back… **so it is never a dead
  end**». Sí lo era: el ERP puede ser el único módulo de alguien, y el enlace lo devolvía a su
  sitio sin un error.
- **D-231 (rol en Identidad)** — `MODULE_ACCESS` decía «**y por eso el rol se sigue enseñando
  aunque la casilla esté apagada**», y el selector estaba dentro del `{granted && …}`. Seis
  perfiles con el rol a la vista y bloqueado.
- **Modo oscuro** — la decisión afirmaba «`session-guard.test.ts` **no se ha tocado**» y sí se
  había tocado (un comentario). Aquí el que mentía era el texto nuevo, no el viejo.
- **`«Phone *»`** — un resto que parecía un precedente vivo («la app ya adorna la etiqueta según
  el sitio») y era el marcador de campo obligatorio.

**Why:** este repo comenta la intención con mucho detalle, así que la intención sobrevive a los
refactors mejor que el código. Cuando los dos discrepan, lo barato es suponer que el comentario
envejeció; aquí lo cierto suele ser lo contrario, y **la discrepancia ES el bug**.

**How to apply:** al tocar una zona, leer el comentario **antes** que el código y comprobar que
el código lo cumple. Si no lo cumple, ese es el hallazgo — y arreglar el código, no el comentario.
Y al revés: si el comentario ya no es cierto tras un cambio propio, corregirlo forma parte del
cambio (un comentario falso dentro de la prueba que guarda una regla es la trampa para el
siguiente). Ojo también con el **resto muerto que parece un ejemplo vivo**: una rama inalcanzable
o un campo declarado y nunca usado se copia como si fuera precedente.

Relacionado: [[auditoria-no-es-medicion]]
