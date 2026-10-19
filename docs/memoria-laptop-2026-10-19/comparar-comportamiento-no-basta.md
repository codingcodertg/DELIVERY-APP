---
name: comparar-comportamiento-no-basta
description: dos pantallas que se comportan distinto pueden guardar en sitios distintos; sin mirar DÓNDE guarda cada una, «no lo guarda» es una conclusión falsa
metadata:
  type: feedback
---

El 2026-09-23, midiendo la tabla nueva de promos contra la de Órdenes: destildé una columna, recargué y volvió; en Órdenes,
en la MISMA sesión de demo, se quedaba. Concluí «promos no lo guarda en ningún sitio, y no es el límite del demo». **Falso.**
Medido después en el código: `promos/[id]/TablaDeRonda.tsx:80,99` se cortan con `SIN_BASE` antes de leer y de escribir, y su
único almacén es `user_prefs` (clave `promos_columns`, migración 141). Órdenes persiste en demo porque tiene **un segundo
camino**, `localStorage`. En demo promos no puede persistir; lo correcto era **«no verificable en demo»**.

**Why:** el experimento comparado estaba bien montado —misma sesión, misma acción— y aun así la conclusión era falsa, porque
comparaba el EFECTO sin mirar el MECANISMO. Es la misma familia que [[dato-correcto-conclusion-falsa]]: el dato (vuelve al
recargar) era cierto; lo que se construyó encima, no. Y habría llegado al dueño como un fallo inventado.

**How to apply:** antes de escribir «X no guarda» o «X sí guarda», un grep de dónde escribe cada lado —`localStorage`,
`user_prefs`, cookie, servidor— y si hay un `SIN_BASE`/`LOCAL_MODE` que se salte la escritura. Si los caminos no son los
mismos, el experimento no compara lo que parece. Y al revés, lo que sí se puede afirmar de esa diferencia: **una pantalla con
un solo almacén no tiene red** — si la lectura falla o la migración no está aplicada, la elección se pierde en silencio,
mientras que la que guarda también en el navegador la conserva. Eso sí es un hallazgo, y es de diseño, no de demo.

**Al día (2026-09-23, mismo día):** el orquestador aceptó el punto de diseño y le pidió a worker2 que promos guarde también en `localStorage`, como Órdenes. Cuando eso entre, promos tendrá los dos caminos y la elección **sí** se podrá medir en demo; el ejemplo de arriba queda como lo que era ese día, y la lección —mirar el mecanismo— no cambia.
