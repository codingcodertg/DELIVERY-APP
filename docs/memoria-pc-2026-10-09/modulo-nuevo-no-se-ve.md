---
name: modulo-nuevo-no-se-ve
description: un módulo nuevo del hub no aparece para nadie, ni para el admin, hasta concederlo en module_access; al publicarlo, decirlo o concedérselo al dueño
metadata:
  type: feedback
---

Publiqué RTG PROMOS (D-366…D-369, 2026-09-23) y el dueño escribió «no me aparece en el RTG hub». No era
un fallo: `accessibleModules()` (`constants.ts:432`) enseña **solo los módulos concedidos** en
`module_access`, **sin excepción para el admin**, y nadie tenía `promos`. El dueño tenía
`["recruiting","timetracker","erp","deliveries"]`.

**Why:** yo le había dicho «da acceso a quien deba usarlo» sin decirle que **él también** lo necesitaba.
Que un admin no vea un módulo suyo sin marcarse la casilla no es intuitivo, y el primer contacto con el
módulo nuevo fue una pantalla donde no estaba.

**How to apply:** al publicar un módulo nuevo del hub, en el mismo mensaje decir que **no aparece para
nadie, admin incluido, hasta marcar su casilla**, y ofrecer concedérselo al dueño o hacerlo si ya lo
autorizó. Concederlo es una escritura en su propio perfil: guardar antes su `module_access`, comprobar
que se tocó 1 fila, y releerlo después. Y avisar de que tiene que recargar (Ctrl+F5), porque el hub lee
los módulos al cargar. No cambiar la regla de `accessibleModules` para colarle el admin: es a propósito
(D-299, no ofrecer una pantalla que la base devuelve vacía).
