---
name: auditoria-no-es-medicion
description: Un dato que viene de una auditoría o de otra sesión sigue sin estar medido hasta que lo mides tú
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 39114734-431c-4e44-a77a-198be3f67540
  modified: 2026-09-08T18:51:36.826Z
---

En el flujo paralelo del RTG Hub repetí en una decisión un dato que me había llegado del auditor
(que había "reportes que contaban mal" por `delivery_pin_source`) sin comprobarlo. No existían esos
reportes. Lo corregí con ambos pares y la lección quedó dicha así: **que un dato venga de una
auditoría no lo convierte en medición.**

**La forma más difícil de cazar (2026-09-09): un dato que gana interpretación en cada salto.** El
auditor dio un número correcto sin la categoría pegada («11»); el orquestador lo leyó como once
*formas* distintas cuando eran una forma en once sitios y construyó encima un argumento; yo estuve a
punto de escribirlo en `DECISIONS.md`. **Ninguno de los tres pasos fue negligente por separado y el
resultado era falso.** Y lo que lo cortó no fue que alguien dudara —el dato era correcto y la
conclusión sonaba bien— sino que el auditor **fue a medirlo por su cuenta**.

Regla: **un dato que va a quedar escrito se mide en el paso donde se escribe, no se hereda del que
lo pasó.** Aunque venga de dos sesiones y aunque las dos estén de acuerdo.

**Why:** en este flujo las tres sesiones se citan entre sí, y `DECISIONS.md` es append-only. Un dato
sin medir que entra en una decisión se cita después como si fuera hecho, y corregirlo ya solo se
puede hacer con una nota, no reescribiendo.

**How to apply:** antes de escribir en `DECISIONS.md` o en Notion un número, un nombre de constraint
o una afirmación sobre el comportamiento de producción, medirlo yo (grep, consulta, prueba) aunque
me lo haya dado el auditor o el orquestador. Si no puedo medirlo, va en "Lo no verificado", no en la
prosa. Lo mismo al revés: informar el HEAD **y la hora** cuando pido firma, porque el auditor firma
un commit concreto y yo puedo haber avanzado.

**La otra mitad, del auditor (2026-09-08):** cuando se publica un número medido, se publican
también los intentos que salieron mal. Su comparador de colores dio «0 de 39 bien» y luego «36 de
39» antes del resultado correcto, y contó las tres versiones. Su razón es práctica, no de modestia:
un dato que llega medido llega con autoridad y el que lo recibe no lo vuelve a medir — así que
callarse los fallos deja el **siguiente** número sin sospecha. Publicar el error es lo que mantiene
la próxima cifra bajo revisión.

Y la lección técnica que salió de ahí: **un comparador que empareja «el hex que sale» con «el `var`
que entra» solo es correcto si se ha probado contra una línea que YA tenía un `var` antes.** Con una
línea de un solo color, la versión mala pasa.

**Y la regla hermana, del mismo auditor (2026-09-09):** *un resultado vacío hay que comprobarlo
contra un caso positivo conocido antes de reportarlo.* Su `git grep "/home" <rama> -- src` devolvió
cero y cero era falso (el patrón con `/` al principio y la rama por delante no funciona ahí). Lo que
lo salvó no fue revisar el comando, fue **saber que cero era imposible** porque existe
`src/app/home`.

Las dos juntas dicen lo mismo: **una herramienta de medición no se estrena sobre el caso que
quieres medir.** Ten a mano un caso que TIENE que aparecer; si no aparece, el que falla es el
comando.

**Y el paso siguiente, 2026-09-09:** antes de contrastar un vacío con un caso positivo, preguntarse
si el fenómeno **dejaría rastro alguno** en lo que estás mirando. El orquestador buscó la carrera de
refrescos contando pares de tokens creados con <10 s de diferencia y encontró cero — y se paró antes
de reportarlo, porque **el cliente que pierde la carrera no emite ningún token**: la carrera deja un
token, igual que un refresco normal, y `revoked` tampoco distingue. La consulta era **incapaz por
diseño**.

Un cero de una herramienta que no puede encontrar lo que busca **no es evidencia débil: es cero
evidencia**, y presentarlo como «no encontramos rastro» es peor que no medir. Lo honesto entonces es
«no está medido, ni a favor ni en contra», diciendo qué sí está medido (el mecanismo) y dónde
estaría la huella que falta.

**La regla no protege solo cifras (2026-09-09).** Le expliqué al auditor de dónde salía un número
suyo mal medido —«tu patrón exigía la palabra teléfono»— y **me lo inventé**: su patrón sí incluía
el término que yo decía que le faltaba. Lo escribí porque encajaba con la lección del día, no
porque hubiera leído su comando.

Un «tu número salió de X» es una **afirmación sobre el trabajo de otro** y se comprueba igual que
una cifra: **leyendo su comando, no imaginándolo**. Y es más peligrosa que un número malo — un dato
mal medido chirría; una explicación elegante se acepta sin resistencia.

**La generalización que une todo lo de arriba (del auditor, 2026-09-09), y la que hay que recordar
si se olvidan las demás:** *cuando lo que veo es una parte, la conclusión tiene que ser sobre esa
parte, o tengo que ir a ver el resto.* Ese día cometió el mismo error tres veces con tres caras: leyó
el primer token de una línea larga y clasificó la línea entera; vio una sintaxis de etiqueta y
concluyó sobre todas las etiquetas del repo; leyó el título de una entrada de `DECISIONS.md` y
concluyó sobre la rama entera —que traía además una regla de flujo, y `git show --stat` lo habría
dicho en un comando.

**Y la forma más corta y más aplicable de todo esto (del auditor, 2026-09-10):**

> **Un «no está» solo vale si digo dónde busqué.**

Dijo «`guard_role_change` no está definido en el repo» habiendo buscado solo en
`supabase/migrations/`. Estaba en `supabase/roles.sql:21`. Si hubiera escrito «no está en
`migrations/`» —que era cierto— nadie habría ido a producción a leer una función que estaba a un
`grep` de distancia. **El fallo no fue el método, fue el alcance sin declarar.**

**La consecuencia práctica, que el auditor adoptó el 2026-09-10 y pidió que se le exija:** toda
afirmación **negativa** de un veredicto o de una decisión —«no hay», «no está», «ninguno», «0
coincidencias»— va **con el comando exacto pegado y su alcance visible**. `grep -rn "x"
supabase/migrations → solo comentarios` enseña el alcance solo; «no está en el repo» lo esconde.

La razón es una asimetría real del flujo: **las afirmaciones del worker las contrasta `vitest`; las
del auditor no las contrasta nadie.** Un veredicto es prosa firmada, así que una frase falsa se
propaga con su firma detrás —y hoy hizo que el orquestador consultara producción sin necesidad—.
Pegar el comando es lo que vuelve una negación tan re-corrible como una prueba en rojo.

Corolario: **una herramienta responde la pregunta que le hiciste, no la parecida.** `git log -S`
dice dónde nació una línea; un título no dice qué más traía el commit.

Dos comprobaciones baratas que salieron de ahí:
- **Antes de creerte un `grep` de estructura, comprueba que el repo escribe esa estructura de una
  sola forma.** Las etiquetas se escriben `label={t(...)}` y `<label>{t(...)}</label>`; contar con
  una sola daba 3 en vez de 9.
- **Clasificar por el primer token de una línea es adivinar.** `grep -o` recorta y engaña; con
  líneas de 200 caracteres, lo que no engaña es abrir el fichero por esa línea.

Relacionado: [[regla-prueba-espejo]]
