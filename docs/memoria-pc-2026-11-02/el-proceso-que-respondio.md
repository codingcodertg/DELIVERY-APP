---
name: el-proceso-que-respondio
description: antes de medir un servidor que arranqué o de matar un PID, comprobar que es el mío; en esta máquina corren varias sesiones
metadata:
  type: feedback
---

El 2026-09-23 levanté el tracker para probarlo y medí que respondía. **No era el mío**: worker2 ya tenía
el suyo en el mismo puerto (4319), el mío murió con `EADDRINUSE` y yo no leí su salida. Medí el de otra
sesión creyendo que era el mío, y después **lo cerré por PID** sin comprobar de quién era.

**Why:** en esta máquina corren a la vez el orquestador y dos workers, y usan los mismos puertos y
herramientas. «Responde 200» dice que *algo* escucha, no que sea lo que acabo de arrancar. Y matar un
proceso ajeno es tocar el trabajo de otra sesión sin avisar.

**How to apply:** después de arrancar un servidor, leer su propia salida antes de medir —un
`EADDRINUSE` en el registro invalida la medición—. Antes de matar un PID, confirmar que lo lancé yo: si
no lo sé, no se mata, se pregunta. Y mejor usar un puerto propio que el de por defecto. Es la misma
familia que [[comprobar-la-capa-que-manda]]: la respuesta que ves puede venir de otro sitio.
