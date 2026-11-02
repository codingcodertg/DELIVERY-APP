---
name: regla-de-clientes-unica-en-todas-las-apps
description: "Regla permanente del dueño (2026-11-01): quién ve qué cliente lo decide la app de Clientes (217) y las demás apps importan esa regla, nunca la reescriben"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-11-02T02:32:24.905Z
---

Cualquier pantalla que enseñe o deje elegir clientes (Quote Builder, Leads, lo que venga) usa la regla de Clientes: en la base `erp.customers_ve_la_fila` (migración 217) y en TypeScript su gemelo `veLaFila` / `filasQueVe` en `src/lib/customers/visibilidad.ts` (D-793). Nada de versiones propias por app.

**Why:** el dueño (2026-11-01): «el quote builder la regla de customer debe ir totalmente ligada al customer app y así en todas las apps». D-789 había escrito una copia en el Quote Builder y se quedaría atrás al cambiar la 217.

**How to apply:** al tocar la 217, tocar `visibilidad.ts` (su prueba lee la 217). Al añadir clientes a una app, importar `veLaFila` con `{ id, role, store }` del perfil (la base ya filtra con la sesión real; el gemelo cuenta cuando un admin entra «como» otro). Ver [[tabla-de-entregas-es-la-referencia]] para la misma idea con las tablas.
