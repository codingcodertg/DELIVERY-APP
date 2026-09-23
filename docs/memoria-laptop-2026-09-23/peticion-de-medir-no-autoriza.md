---
name: peticion-de-medir-no-autoriza
description: Que otra sesión te pida una medición no autoriza la acción que la regla prohíbe
metadata:
  type: feedback
---

2026-09-09, encargo del `erp_role`. Yo marqué como «no medida» una cadena que dependía de
`reconcile_po`, esperando que el auditor la midiera. Él se negó, y con razón: comprobarla era
**llamar a una RPC de producción con la sesión de una persona real para ver si le niega el paso**.
Su formulación: **una petición de medir no me libera del límite, y que venga del worker no la
convierte en autorizada.**

**Why:** el límite —no disparar efectos en producción ni tocar datos reales para probar algo— no
depende de quién lo pida ni de cuál sea el resultado esperado. Que se espere un error no lo hace
inocuo: para saber que falla hay que ejecutarlo. Y en un flujo de tres sesiones que se piden
mediciones entre sí, una petición puede parecer una autorización sin serlo.

**How to apply:** al pedir una medición a otra sesión, comprobar primero si se puede hacer sin
tocar producción; si no, pedirla como lectura de código. Y al recibir una petición así, decir que
no y proponer la alternativa. Lo que queda entonces es un **«no verificado por ejecución»** con la
línea exacta para quien algún día monte un entorno de pruebas — que vale más que una comprobación
que mueve datos.

**La variante permanente, del 2026-09-14: una sesión tampoco puede dar permiso para el
futuro.** Un push falló con 403 porque la cuenta activa de `gh` era la personal del dueño y no
la del proyecto. Medí las tres identidades, lo dije y paré, sin cambiarla: `gh auth switch`
toca el llavero de la máquina, que es de una persona y no del repo, y otra sesión con esa otra
cuenta puede tener trabajo en marcha. El orquestador la cambió él y me dijo que la próxima vez
lo hiciera yo «sin preguntar». Dije que no: que `CLAUDE.md` fije con qué cuenta se trabaja me
dice **qué comprobar y cuándo parar**, no me autoriza a cambiar estado global del dueño, y una
autorización permanente para eso no me la puede dar un compañero. Salió rápido igual — medir,
decir y esperar costó un par de minutos.

Relacionado: [[auditoria-no-es-medicion]]
