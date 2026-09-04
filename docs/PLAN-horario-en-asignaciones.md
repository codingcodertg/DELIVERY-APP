# Plan — el Horario pasa a vivir dentro de Asignaciones (Time Tracker)

**Fecha:** 2026-09-04 · **Pedido por:** Andrés · **Estado:** aprobado por el dueño,
pendiente de implementar · **Decisión:** se numerará al fusionar (marcador `D-NEXT`)

Plan en papel previo a implementar, según la regla de `CLAUDE.md`. Sigue el patrón
de `docs/PLAN-A-2a-profiles-rls.md`.

---

## 1. Lo que se pidió, y la objeción que se puso por escrito antes de aceptarlo

**Petición literal del dueño:** *"en deliveries app schedule tiene que ir dentro de
assignments, haz un merge inteligente y eficiente para que el feature de las 2 sea
uno solo"*.

Primero, una corrección de hecho: **ninguna de las dos pantallas está en el módulo
de Deliveries.** Las dos son de **Time Tracker** (`/timetracker/assignments` y
`/timetracker/schedule`), vecinas en `MANAGER_TABS`. Deliveries guarda turnos y
disponibilidad de choferes (`public.driver_shifts`, `public.driver_availability`)
pero no tiene pantalla con esos nombres. Se asume Time Tracker porque son las
únicas que existen y porque a este repositorio se le llama "deliveries-app".

**La objeción, dicha antes de implementar y mantenida:** medido, las dos pantallas
**no comparten nada**.

| | Asignaciones | Horario |
|---|---|---|
| Pregunta que contesta | ¿cuánto cobra Fulano en el proyecto X? | ¿a qué hora entra Fulano el martes, y dónde? |
| Cadencia | al entrar alguien o cambiar una tarifa | cada viernes, para toda la cuadrilla |
| Tabla | `timetracker.assignments` (mig. 059) | `clockin.scheduled_shifts` (mig. 072) |
| Dónde se dibuja | **cliente**, supabase-js de navegador + realtime | **servidor**, cinco server actions |
| Puerta | en cliente, monta igual y muestra "Admins only" | en servidor, `redirect()` antes de montar |
| Acotado por tienda | **no** | **sí** (`visibleStores`, `canManageEmployee`, D-127) |
| Idioma | traducida entera (`mgr.asn.*`) | inglés a pelo |
| Componentes compartidos con la otra | **ninguno** | **ninguno** |

Sin FK entre las tablas. Sin una consulta común. Sin un cálculo común. Sin un
enlace: **ninguna pantalla de la aplicación enlaza a ninguna de las dos**, solo
existen como pestañas.

El criterio de fusión que este repo se dio a sí mismo está en **D-165**: se fusiona
cuando dos pantallas **contestan la misma pregunta**, y el síntoma es que alguien
tiene que pasar por dos sitios para acabar una sola tarea. Ahí se fusionaron Partes
y Pago porque las dos eran "pagar este periodo". Aquí no ocurre eso, y por eso la
objeción quedó por escrito.

**El dueño lo confirmó igualmente.** Es su aplicación y sabe cómo la usa. Se
implementa. Lo que cambia por la objeción no es *si* se hace, sino *cómo*: ver §2.

---

## 2. El diseño, y por qué este y no el obvio

**No se sueldan.** Pasan a ser **dos secciones de una misma pantalla**, con un
selector arriba, y **cada sección conserva su propia lista de personas y su propia
mitad de código**.

La razón es concreta, no estética. El único camino que rompe cosas de verdad es
unificar las dos poblaciones de gente:

- Asignaciones lista a todo el que tenga `timetracker_role`, **sin filtro de tienda
  y sin excluir inactivos**.
- Horario lista solo las tiendas visibles del gerente y solo gente activa, que es
  el acotado por tienda que **D-127** introdujo a propósito.

Gane la que gane, el daño es **silencioso**: si gana la del horario, desaparecen
del formulario de tarifas personas de otra tienda o inactivas que hoy sí se pueden
tarifar; si gana la de asignaciones, aparecen en el planificador personas que el
acotado protege. Nadie ve un error: solo falta alguien en un desplegable.

Manteniéndolas como secciones separadas, ese problema **no llega a existir**, y la
fusión cuesta mover ficheros en vez de reescribir una mitad entera —que es el coste
que **D-106** identificó como el real en cada fusión que cruza la línea
cliente/servidor.

**Lo que sí se gana de paso:** la puerta. Hoy Asignaciones comprueba el rol en el
navegador y **monta la página igual**; Horario redirige desde el servidor antes de
montar nada. La pantalla fusionada se queda con la fuerte.

---

## 3. Qué se toca, fichero a fichero

| # | Fichero | Cambio |
|---|---|---|
| 1 | `src/app/timetracker/(timetracker)/assignments/page.tsx` | Deja de ser cliente. Pasa a **componente de servidor** con la puerta de `schedule/page.tsx` (consulta `timetracker_role`, `redirect("/timetracker")` si no es admin, `redirect("/login?next=…")` si no hay sesión). Renderiza el nuevo contenedor. |
| 2 | `src/components/timetracker/AssignmentsPanel.tsx` | **Nuevo.** El cuerpo actual de la pantalla de asignaciones, movido tal cual, con su `"use client"`, su `useData()` y su `t()`. Se le quita la comprobación de rol en cliente: ya la hace el servidor. |
| 3 | `src/components/timetracker/AssignmentsTabs.tsx` | **Nuevo.** Cliente. El selector de sección (Tarifas / Horario) y el estado de cuál está activa. Renderiza `AssignmentsPanel` o `ScheduleWeek`. Los dos textos, traducidos. |
| 4 | `src/app/timetracker/(timetracker)/schedule/page.tsx` | Se queda como **redirección permanente** a `/timetracker/assignments`, o se borra y la redirección se hace en `next.config.mjs`. Criterio del worker; lo que no vale es que la ruta muera. |
| 5 | `next.config.mjs` | El salto heredado `/timetracker/clock-in/schedule → /timetracker/schedule` (D-121) pasa a apuntar **directo** a `/timetracker/assignments`, para no encadenar dos redirecciones. |
| 6 | `src/lib/timetracker/constants.ts` | Fuera la entrada `{ id: "schedule" }` de `MANAGER_TABS`. La de `assignments` se queda y **su comentario explica que ahora lleva las dos cosas**. Catorce pestañas pasan a trece. |
| 7 | `src/lib/timetracker/i18n.ts` | Etiqueta de la pestaña de asignaciones, que ya no es solo tarifas, y los dos rótulos del selector. En inglés y en español. |
| 8 | `src/lib/landing-route.test.ts` (~línea 167) | La lista exigida cambia `"schedule"` por `"assignments"`, **y el comentario de la prueba dice dónde está ahora la puerta del horario**. Ver §5. |
| 9 | `DECISIONS.md` | Entrada nueva con el título marcado `D-NEXT`. Ver §6. |

**`ScheduleWeek.tsx` no se toca**, salvo que estorbe para montarlo dentro. Sus cinco
server actions (`getScheduleWeek`, `createShifts`, `applySchedule`, `deleteShift`,
`adminClock`) **no se tocan**: las usa también el cron `roll-schedules` (D-182) y la
sección "Mi horario" del empleado (D-129).

---

## 4. Lo que NO se hace, y por qué

- **No se unifican las dos listas de personas.** Es el corazón del diseño (§2).
- **No se tocan los server actions de `clockin`** ni sus reglas de alcance.
- **No se traduce `ScheduleWeek`.** Está en inglés a pelo y al juntarlo con una
  pantalla traducida se va a notar. Es un defecto **anterior** a esta fusión y va en
  su propia rama después, para no mezclar dos cambios en una auditoría.
- **No se fusiona Asignaciones con Proyectos**, que es la fusión que el código sí
  está pidiendo (misma tabla, mismo proveedor, mismo lado de la línea, y Proyectos
  ya enseña quién está asignado y ya usa la tarifa para calcular gasto). Se propuso
  al dueño y eligió esta otra. Queda anotado como candidato futuro.
- **No se toca la base.** Ni migración, ni RLS, ni permisos.

---

## 5. La prueba que protege la puerta

`src/lib/landing-route.test.ts:162-170` exige hoy que estos ids estén en
`MANAGER_TABS`: `payroll`, `schedule`, `audit`, `people`, `live`, `team-requests`.
Su comentario dice por qué: *"si alguien retira una de estas rutas sin poner otra en
su lugar, algo que la gente usa todos los días se queda sin puerta"*.

Quitar la pestaña `schedule` **hace fallar esa prueba, y está bien que falle**: es
exactamente el caso que vigila. Lo correcto no es borrar el id de la lista sin más,
sino **cambiarlo por `assignments` y escribir en el propio comentario de la prueba
que la puerta del horario es ahora esa**, con el número de la decisión. Una prueba
que se relaja sin decir por qué deja de proteger.

---

## 6. La entrada de `DECISIONS.md`

Marcador `D-NEXT` en el título; el número lo pone el orquestador al fusionar. Tiene
que contar, para quien no estuvo:

1. Qué se pidió, con la petición literal.
2. **Que se objetó y por qué**, citando D-165, y que el dueño lo confirmó igual. El
   historial no se maquilla: una decisión tomada contra el criterio propio del repo
   se anota como tal, con su fecha.
3. El diseño de dos secciones y **por qué las listas de gente no se unifican**, con
   D-127 citado y el daño silencioso descrito.
4. Que la puerta pasa de cliente a servidor.
5. Qué se descartó: soldar las dos en una sola vista con una sola lista, y fundir
   Asignaciones con Proyectos.
6. Que la traducción de `ScheduleWeek` queda pendiente en rama aparte.

---

## 7. Riesgos, y qué los cubre

| Riesgo | Cobertura |
|---|---|
| Alguien pierde el acceso al horario | La ruta vieja redirige; la pestaña de asignaciones lo contiene; la prueba de §5 exige que la puerta exista |
| Se cuela la unificación de las dos listas | El auditor tiene instrucción explícita de mirarlo; es hallazgo grave |
| La puerta se queda en cliente | Igual: se comprueba en la auditoría |
| Una redirección encadenada rompe el salto heredado | Punto 5 de §3: se apunta directo |
| Los server actions rompen el cron o "Mi horario" | No se tocan (§3) |
| Regresión invisible en la pantalla | No hay pruebas de componentes en este repo. Se cubre con `verify.mjs` y con revisión a ojo del auditor, y queda **dicho** que la cobertura automática de estas dos pantallas es cero |

---

## 8. Verificación exigida antes de pedir auditoría

- `node scripts/verify.mjs` en verde, reportando **pasados | saltados**.
- La prueba de `landing-route` actualizada y **pasando por la razón correcta**, no
  relajada.
- Comprobado a mano que `/timetracker/schedule` y
  `/timetracker/clock-in/schedule` aterrizan en la pantalla nueva.
- Sin subir versión y sin numerar la decisión: los pone el orquestador al fusionar
  (`recruiting` no; aquí toca **`timetracker`** y `package.json`).
