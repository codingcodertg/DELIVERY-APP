---
name: tabla-de-entregas-es-la-referencia
description: "Regla permanente del dueño (2026-10-28): toda tabla, lista, filtro u orden de cualquier app usa el formato, estilo y comportamiento exactos de la tabla de Entregas"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 83590ac0-88d3-4d5e-b9d3-888a2b15db49
  modified: 2026-10-28T14:31:23.294Z
---

El dueño, 2026-10-28, literal: «Every app I build that has a table, list, filters or sort must use the exact same format, style and behavior as the Deliveries App table. The Deliveries App is the reference standard for all tables across all my apps.»

**Why:** su jefe pidió la tabla de Empleados igual a la de Órdenes (cabeceras con ▾, chips de filtro con cuenta, buscador, botones Excel/PDF/CSV/Columnas, ancho fluido a toda la pantalla porque lleva muchas columnas). Quiere una sola forma de tabla en todo el hub.

**How to apply:** antes de pintar o retocar cualquier tabla (RR. HH., Clientes, Inventario, Time Tracker, Encuestas…), mirar `src/components/OrdersTable`/la lista de Entregas y reutilizar sus clases (`table.orders`, chips, cabeceras ordenables) y su comportamiento; nunca inventar otra. Ancho fluido, no contenedor estrecho. También está en CLAUDE.md del repo (D-NEXT del 2026-10-28). Ver [[workers-acotados]].
