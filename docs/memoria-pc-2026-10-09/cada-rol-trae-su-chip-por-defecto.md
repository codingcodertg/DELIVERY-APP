---
name: cada-rol-trae-su-chip-por-defecto
description: "En Órdenes, cada rol arranca con un chip de etapa distinto: contar filas sin abrir los DOS chips mide el chip, no la visibilidad."
metadata:
  node_type: memory
  type: project
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-24T03:14:05.889Z
---

La pantalla de Órdenes tiene **dos filtros que arrancan puestos**, y los dos recortan la tabla:

- el de **fecha** (`All · Recent · Today`, clases `button.vt`), que arranca en **Recent**;
- el de **etapa**, que arranca en **el preajuste del rol**: gerente en *Pending Approval*, almacén en
  *Programmed*, chofer en *Ready*, admin en *All*.

Medido el 2026-09-23: sin tocar nada, gerente veía 10 filas, almacén 9 y chofer 20, de 89. Con los
dos chips en **All**: 85, 14 y 85. Los primeros números no dicen nada sobre quién ve qué — dicen
cuántas órdenes hay en la etapa favorita de ese rol.

**Why:** el conteo por rol se usa para decidir si una regla de visibilidad está bien, y el preajuste
lo falsea en la dirección que más engaña: hacia abajo, que es la que parece «lo está escondiendo».
Con el chip de etapa por defecto, buscar una orden entregada vieja por su factura da **cero** aunque
el buscador funcione, porque la orden no es de la etapa filtrada.

**How to apply:**
- Antes de contar por rol: pulsar el chip de fecha **All** y luego el de etapa **All N**, **en ese
  orden y en cada rol** — el de fecha se queda pegado al cambiar de «Ver como», el de etapa no.
- Comprobar en cada medición el rol de verdad (`rtg_deliveries_local_me`), no el que pediste.
- Un cero al buscar es sospechoso antes que una respuesta. Ver
  [[grep-de-una-linea-no-ve-la-estructura]] y [[comprobar-la-capa-que-manda]].
