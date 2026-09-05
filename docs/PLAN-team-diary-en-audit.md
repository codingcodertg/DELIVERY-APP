# Plan — "Team Diary" pasa a vivir dentro de "Audit" (Time Tracker)

**Fecha:** 2026-09-05 · **Pedido por:** Andrés · **Estado:** plan en papel,
pendiente de aprobación · **Decisión:** `D-NEXT` al fusionar

**Petición literal:** *"team diary va dentro de audit"*.

## 1. Qué es cada una (medido)

| | Team Diary (`/timetracker/team-diary`) | Audit (`/timetracker/audit`) |
|---|---|---|
| Qué muestra | capturas de pantalla **de la app de escritorio**, por persona y día, con barra de actividad | tres vistas con un selector interno (D-109): 📜 Log, 📷 Fotos de **fichaje**, ⚠️ Excepciones |
| Datos | `timetracker.screenshots` + bucket `timetracker-screenshots`, cliente | log: `timetracker.audit`, cliente · fotos y excepciones: `clockin.*`, server actions |
| Escribe | **sí, y es destructivo**: borra capturas, y al borrar una **resta ~10 min de tiempo pagado** a la sesión (`team-diary/page.tsx:72-78`); purga global de >14 días | **no**: las tres vistas son de solo lectura, a propósito |
| Acotado por tienda | no | log: no · fotos y excepciones: **sí** (D-127) |
| Puerta | `if (me.role !== "admin")` en cliente, tras montar y consultar | idéntica, igual de débil |
| Idioma | traducida entera por claves | log sí; **el selector y las vistas de fichaje en inglés** (deuda de D-122) |
| Componentes comunes | ninguno | ninguno |
| Hoy | **estructuralmente vacía**: las capturas solo llegan desde la app de escritorio, que aún no captura (`WorkDiary.tsx:12-14`) | en uso |

## 2. El criterio del repo, aplicado

- **A favor:** D-109 declaró Audit como contenedor de *"qué pasó, quién y cuándo,
  con la prueba delante"*, y las capturas de escritorio son exactamente eso. Audit
  ya es un contenedor de vistas heterogéneas; una cuarta continúa el patrón. Nadie
  enlaza a `/timetracker/team-diary` salvo la pestaña, y la prueba de
  `landing-route.test.ts:172` **no** exige `team-diary`. Es más natural que D-186.
- **En contra, y hay que decirlo antes:** Audit es *el registro de lo que pasó* y
  sus tres vistas son de solo lectura a propósito. Team Diary es *una herramienta
  de sanción*: se entra a borrar una captura y con ella se le quita a alguien
  tiempo pagado. Meter eso dentro de Audit cambia el significado de la pantalla,
  no solo el sitio. Se acepta como decisión consciente y queda escrito.

## 3. Diseño: cuarta vista del selector que ya existe

No sección plegable ni cabecera: el selector interno de Audit ya monta cada vista
solo al abrirse (`audit/page.tsx:49-50`), que es lo que D-165 y D-186 pidieron.

- El cuerpo de `team-diary/page.tsx` se extrae a
  `src/components/timetracker/TeamDiary.tsx` (patrón `AssignmentsPanel`, D-186).
- `audit/page.tsx`: `view` gana el valor `"desktop"` y el selector un cuarto botón.
- **Etiqueta: "🖥 Capturas de escritorio" / "Desktop captures"**, no "Diary": dentro
  de Audit, "Fotos" (fichaje) y "Diario" (escritorio) son ambas "fotos de gente
  trabajando" y se confunden. El nombre dice de dónde vienen.
- **Cada vista conserva su propio selector de persona.** Hay tres listas distintas
  (quien tiene capturas · todos los `timetracker_role` · fotos acotadas por
  tienda) y ninguna debe ganar. Es la regla de D-186, y el daño de saltársela es
  silencioso.
- **La puerta pasa a servidor**: `audit/page.tsx` se vuelve componente de servidor
  con `redirect` por `timetracker_role`, como D-186. Con una acción que descuenta
  horas dentro, el `if` del navegador no basta (RLS es quien protege de verdad; el
  `if` nunca lo fue).
- `team-diary` sale de `MANAGER_TABS`; `/timetracker/team-diary` queda como
  redirección a `/timetracker/audit` en `next.config.mjs`, junto a la de
  `/timetracker/clock-in/photos`.
- Se traduce **el selector** de Audit (cuatro rótulos), que se toca de todas
  formas. `DayPhotos` y `ExceptionHistory` siguen en inglés: deuda anterior, rama
  aparte.
- Prueba: un caso en `landing-route.test.ts` que exija que Audit ofrezca la vista
  de capturas, siguiendo su propio comentario (:162-169): hoy nadie se enteraría
  si la vista se perdiera por el camino.

## 4. Lo que NO se hace

- No se cambia lo que hace el borrado (resta de minutos, purga): mismo código,
  mismo sitio. Solo se mueve.
- No se unifican listas de personas. No se tocan `DayPhotos`, `ExceptionHistory`,
  `WorkDiary` ni `/timetracker/diary` (la del empleado, que reutiliza `WorkDiary`).
- Ninguna migración, ninguna escritura nueva.

## 5. Verificación

`verify.mjs`; el auditor comprueba que `TeamDiary.tsx` es el cuerpo movido, no
reescrito (línea a línea), que el borrado sigue restando minutos igual, que la
ruta vieja redirige, que `audit` sigue en `MANAGER_TABS`, y que la puerta es de
servidor. Nadie puede abrir la pantalla con sesión real y hoy la vista está
vacía por diseño: la prueba real es el dueño, y solo será útil cuando el
escritorio capture.

## 6. Decisión (`D-NEXT`)

Qué se pidió, el argumento en contra (Audit deja de ser solo lectura) aceptado a
conciencia, D-109 como razón a favor, las tres listas de personas separadas, la
puerta a servidor, el nombre elegido y por qué, y las deudas que quedan
(traducción de las vistas de fichaje).
