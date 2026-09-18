# Motor de rutas — documento de diseño (Fase 3)

> **Para aprobar antes de escribir una línea de código.** Fecha: 2026-09-18 · sobre `main` = 662611f.
> Esta rama solo trae documentos: no toca `src`, no trae migraciones, no llamó a ninguna API.
>
> Se apoya en tres cosas, y conviene tenerlas a mano:
> - **La investigación** (Fase 1): `docs/research-route-optimization.md`.
> - **El inventario del modelo real** (Fase 2): lo que existe hoy, con `fichero:línea`. Lo que aquí se cita
>   del código sale de ahí y se volvió a comprobar sobre 662611f.
> - **Las respuestas del dueño** a las ocho preguntas cerradas y **lo medido en producción** por el
>   orquestador el 2026-09-18 (solo lectura). Cuando este documento dice «medido», es eso.
>
> Las decisiones se citan por número y por la línea de su **última** aparición en `DECISIONS.md` a 662611f
> (el fichero contiene hoy el documento dos veces; arreglarlo va aparte y moverá las líneas, no los números).

---

## 0. Resumen en una página

**Qué se pide.** Un motor que reparta las órdenes del día entre los choferes y ordene sus paradas: recogida y
entrega emparejadas, recogidas en varias tiendas mezcladas, ventanas, capacidad en pallets con decimales,
cada chofer con su base, su camión y su turno, prioridad a los builders, secuencia P1/D1 con ETA y carga a
bordo, tráfico proyectado, y comparación contra la hoja manual del despachador. El plan nace en **borrador** y
no asigna ni avisa a nadie hasta **«Publicar ruta»**.

**El tamaño real manda.** Medido en los últimos 30 días: **mediana 3 órdenes por día, máximo 14**, 3-4
choferes, 7 tiendas. No son las «decenas de órdenes y 4-8 choferes» que suponía la investigación.

**Recomendación: heurística propia en TypeScript**, dentro del repo, como función pura. No OR-Tools. A este
tamaño el problema se resuelve en milisegundos con inserción de pares más búsqueda local; lo que decide es
lo demás: que sea **determinista**, que **explique cada decisión**, que el despachador pueda **fijar y
ajustar**, que puntúe la hoja manual **con el mismo modelo**, y que lo mantenga quien mantiene la app. §2
dice a partir de qué tamaño dejaría de valer, y el diseño deja la puerta abierta: el motor es una función
con entrada y salida guardadas, y se puede cambiar por otro sin tocar lo demás.

**Coste de API esperado: $0 al mes**, dentro de las franjas gratuitas de Google, con tope calculado en §5.

**Lo que cambia de lo que hay hoy** está en §4, en una lista explícita. El dueño dijo «sustituye al actual»
y también «no cambies comportamiento existente sin avisarme»: **§4 es ese aviso**.

**Los objetivos suaves son una suma ponderada con los pesos en Ajustes**, en el orden que dio el dueño
—builders, ruta corta, ventanas anchas, balance—, y se afinan comparando contra días reales (§2.3). Las
ventanas estrechas y el chofer que ya puso el despachador son restricciones duras, no pesos.

**Lo que falta para empezar** son datos que solo tiene el dueño: base, capacidad y turno de cada chofer, y
cómo quiere decir qué ventana es «estrecha». §9.

---

## 1. De dónde se parte

Ya existe un optimizador, y el motor nuevo lo sustituye. Lo que hace hoy el Gestor de Rutas:

- **Agrupa paradas en camiones en el navegador** con Clarke–Wright + or-opt (`route-batching.ts:121`), por
  capacidad y distancia **en línea recta** (D-025, `DECISIONS.md:18562`).
- **Pide a Google Routes v2 el orden de cada viaje** (`optimizeWaypointOrder`), con tráfico y salida a las
  08:00 (`google-routes.ts:73`), hasta 25 paradas intermedias (`google-routes.ts:22`), con caché en memoria
  de 10 minutos (`optimize-route/route.ts:47`) y OSRM público de respaldo (D-008, `:18100`).
- **Auto-asigna** con un reparto voraz: por inicio de ventana, capacidad × 2 viajes, sin solapar ventanas
  (`dispatch.ts:185`; la constante `maxTripsPerDay: 2` está en `routes/page.tsx:1020`).
- **El modelo es «un depósito por viaje»:** la recogida no es una parada, es el punto de salida. No hay
  pareja recogida→entrega, las ventanas no restringen (solo se avisa después de quien llega tarde), no hay
  base del chofer, ni vehículo, ni jornada (solo un aviso a partir de 8 h).
- **Del plan no se guarda casi nada:** `route_seq`, `load_no` y `load_auto` en cada orden
  (`009_routes.sql:16`, `033`, `045`). Millas, minutos, ETAs y trazado son estado de la pantalla y se pierden
  al cambiar de fecha. **Por eso hoy no se puede comparar nada contra la hoja del despachador.**
- **El chofer asignado es un NOMBRE** (`deliveries.assigned_driver text`, `schema.sql:100`). De ese nombre
  cuelgan lo que el chofer ve (RLS: `083_deliveries_access.sql:61-62`), su capacidad y su color
  (`settings.driver_capacity`, `settings.driver_colors`). Los «route buckets» —choferes ficticios— viven en
  la misma columna.

---

## 2. Qué motor, y dónde corre

### 2.1 Las opciones, para ESTE tamaño

| | Heurística propia en TypeScript | OR-Tools | VROOM | Google Route Optimization API |
|---|---|---|---|---|
| **Dónde corre** | En el repo: función pura en `src/lib`, llamada desde una ruta de Next | No es JavaScript. O una función Python aparte en Vercel (paquete pesado, arranque en frío), o un servicio propio en otra nube. No hay build WASM oficial | Binario C++ tras HTTP: un servicio propio que alojar | Servicio de Google; nada que alojar |
| **Infraestructura nueva** | Ninguna | Un segundo lenguaje y un segundo despliegue, o un servidor que vigilar | Un servidor que vigilar | Una API más y su facturación |
| **Pallets decimales** | Nativos (`numeric`) | Solo enteros: escalar ×100 | Solo enteros | Solo enteros |
| **Determinismo** | **Garantizado por construcción** (§2.4) | Sin garantía documentada; con límite de tiempo, el corte depende de la máquina | No documentado | No documentado |
| **Explicar por qué** | Por construcción: cada inserción conoce su coste y sus alternativas | No explica; hay que reconstruirlo encima | Devuelve no asignadas **sin motivo** | Motivos codificados solo para las descartadas |
| **Puntuar la hoja manual con el mismo modelo** | La misma función `evaluaPlan` | Posible (`ReadAssignmentFromRoutes`), con trabajo | Modo plan con `violations` | `refreshDetailsRoutes` |
| **Fijar paradas y reoptimizar el resto** | Nativo | `ApplyLocks` | `steps` | `injectedSolutionConstraint` |
| **Calidad de la solución** | Óptima o casi a ≤ 20 órdenes; se degrada al crecer | La mejor | Muy buena | Muy buena |
| **Coste de mantenimiento** | El de cualquier módulo del repo: vitest, mismo CI, misma persona | Alto: otro runtime, otra cadena de dependencias, otro sitio donde falla | Medio-alto: operar un servicio | Bajo de operar, alto de depender: caja negra, precio y límites ajenos |
| **Coste mensual** | $0 | $0 + alojamiento | alojamiento | $0 a este volumen (franja gratuita de 1 000 envíos) |
| **Sale información fuera** | No (solo los tiempos de viaje, como hoy) | No | No | Sí: todas las direcciones y ventanas, a diario |

### 2.2 Recomendación, sin rodeos

**Heurística propia en TypeScript.** Tres razones, en orden de peso:

1. **El tamaño no justifica otra cosa.** Con 14 órdenes hay 28 paradas entre 3-4 choferes. Una inserción más
   barata de pares seguida de búsqueda local recorre ese espacio en **milisegundos**. OR-Tools gana calidad
   cuando hay cientos de paradas; aquí no hay calidad que ganar, y sí un segundo lenguaje que mantener.
2. **Lo que el dueño pidió no es «la mejor ruta», es una ruta que se pueda defender:** por qué esta orden va
   con este chofer, cuánto costaría moverla, por qué esta quedó fuera, y en qué se diferencia de la hoja del
   despachador. Eso es **explicabilidad y evaluación con el mismo modelo**, y en un motor propio sale gratis
   porque el algoritmo *es* una sucesión de decisiones con su coste. En uno ajeno hay que reconstruirlo por
   fuera, y nunca coincide del todo.
3. **Determinismo.** Misma entrada, misma salida, siempre. Es lo que permite probarlo con vitest, reproducir
   un plan de hace un mes y que el despachador no vea bailar la ruta al pulsar dos veces. Ningún motor externo
   lo garantiza por escrito (§5 de la investigación, punto 7).

**Dónde deja de valer.** El diseño aguanta con holgura hasta **unas 60 órdenes/día o 10 choferes**: ahí la
búsqueda local sigue cabiendo en el presupuesto de cómputo de §2.5, pero la distancia a la solución óptima
empieza a notarse en horas de chofer. Las señales para cambiar de motor, medibles con lo que este diseño
guarda: (a) una corrida que no converge dentro del presupuesto; (b) el despachador mejora a mano el plan del
motor de forma habitual, medido con la misma función de coste. El cambio sería entonces a **Google Route
Optimization** o a **OR-Tools en un servicio**, y costaría poco: el motor es una función
`planifica(entrada, parámetros) → plan`, con la entrada y la salida guardadas; todo lo demás —matriz, plan,
publicar, comparar, explicar— no se entera.

### 2.3 El algoritmo

**Modelo.** Cada orden es un **par**: una parada P (en su tienda de origen) y una D (en su destino), con la
misma cantidad de pallets, que sube en P y baja en D.

**Restricciones duras** — no se negocian con ningún peso:

- **Precedencia y mismo chofer:** P antes que D, en la misma ruta.
- **Capacidad:** la carga a bordo, que sube y baja a lo largo de la ruta, nunca pasa de la del camión. Se
  cuenta con los decimales tal cual. Así desaparece el concepto de «viaje» como algo que se decide aparte:
  **volver a una tienda a cargar es, sin más, otra parada P**. (Para pintarlo se sigue mostrando «viaje 1,
  viaje 2»: un viaje es el tramo entre dos momentos en que el camión va vacío.)
- **Turno:** la ruta empieza en la base del chofer a su hora de entrada y tiene que estar de vuelta antes de
  su hora de salida.
- **Ventana estrecha** (§4.6): no se llega tarde. El dueño: *«esas mandan sobre todo lo demás»*. Si no se
  puede, la orden queda **sin asignar, con motivo**.
- **Chofer ya puesto por el despachador:** se respeta (§2.6). El dueño: *«si el despachador ya asignó, el
  algoritmo respeta; si está vacío, asigna»*. Fija el **chofer**, no la posición.
- **Disponibilidad:** un chofer de vacaciones o baja ese día no entra (`driver_availability`, que ya existe).
- **Paradas fijadas o ya ejecutadas** (§2.6) no se mueven.

**Primero, y estricto: dejar fuera las menos órdenes posibles, y los builders los últimos.** Esto no es un
peso: ningún ahorro de minutos justifica dejar una orden sin ruta. Cuando no cabe todo, se queda fuera antes
una venta al mostrador que un builder — el dueño: un builder *«cuando haya que dejar una orden fuera, es la
última candidata a quedarse»*.

**Debajo, los objetivos suaves: una suma ponderada, con los pesos en Ajustes.** El dueño los pidió
*«ponderados y configurables, no fijos en el código… para poder afinarlos después comparando contra días
reales»*, y dio **el orden con el que trabaja hoy el despachador**:

| # | Objetivo del dueño | Término del coste | Unidad |
|---|---|---|---|
| 1 | **Prioridad a builders** — «es lo que más pesa… un builder queda más temprano en la ruta» | minutos desde que el chofer empieza su turno hasta que **llega a la entrega de cada builder**, sumados | min |
| 2 | **Ruta más corta** — «minimizar tiempo total de manejo y kilometraje» | minutos de manejo + millas | min, mi |
| 3 | **Ventanas amplias** — «llegar dentro de la ventana solicitada cuando no es estrecha» | minutos de retraso sobre ventanas anchas | min |
| 4 | **Balance de carga** entre conductores | diferencia de minutos de ruta entre el chofer más y el menos cargado | min |

`coste = w_builder·(1) + w_manejo·minutos + w_millas·millas + w_tarde·(3) + w_balance·(4)`

- **Dónde viven los pesos:** en Ajustes (`settings.route_weights`), editables por el admin, con su pantalla.
  **Cada plan guarda una copia de los pesos con los que se hizo** (`route_plans.params`), así que cambiar un
  peso mañana no cambia lo que dice un plan de ayer.
- **Valores por defecto: los que reproducen SU orden**, decrecientes en ese mismo orden. Los números
  concretos de arranque se fijan en el incremento 2 con casos de prueba que lo demuestren («con dos órdenes
  iguales, la del builder se entrega antes»; «un desvío de 10 minutos para adelantar a un builder se acepta,
  uno de 90 no»), y **se afinan después con días reales**; no salen de este documento porque hoy no hay
  ningún día real con qué calibrarlos.
- **Un aviso que conviene leer antes de aprobar.** Con el retraso en ventana ancha en **tercer** lugar, por
  debajo de la ruta corta, el motor aceptará llegar algo tarde a una ventana ancha si eso acorta la ruta. Es
  lo que el dueño pidió y es como trabaja el despachador; pero para que «algo tarde» no sea cualquier cosa,
  propongo un **tope duro de retraso en ventana ancha** (un parámetro más, p. ej. 60 minutos): por encima, la
  orden se trata como si no cupiera. Es la pregunta 6 de §9.
- **La que entró primero va primero.** A igualdad de todo lo demás decide `input_date` + `input_time`
  (§2.4): es el criterio de desempate que dio el dueño, y también lo que ordena dos órdenes equivalentes
  dentro de una misma parada.

**Alternativa considerada: orden estricto (lexicográfico) en vez de suma.** Era mi primera propuesta:
comparar primero builders, solo si empatan mirar la ruta, y así sucesivamente. Tiene una virtud —la
explicación es una sola frase— y un defecto que aquí pesa más: **no se puede afinar**. En un orden estricto
un minuto de builder vale más que cualquier cantidad de millas, siempre; con pesos, el dueño decide cuánto
desvío vale adelantar a un builder, y puede corregirlo mirando días reales. Lo que pidió es lo segundo. Queda
anotada por si la suma resultara difícil de gobernar: pasar de una a otra es cambiar la función que compara
dos planes, nada más.

**Construcción — inserción más barata de pares, con arrepentimiento (regret-2).** Para cada orden sin colocar
se calcula su mejor posición (P en i, D en j ≥ i) en cada ruta y cuánto peor es su segunda mejor opción. Se
inserta primero la que **más perdería si espera**: builders y ventanas estrechas suben solas al principio, y
las órdenes fáciles llenan los huecos. Cada inserción guarda **qué alternativas había y cuánto costaban,
término a término**: eso es el «por qué» que se enseña después.

**Mejora — búsqueda local, siempre moviendo el par entero:**
- *recolocar par* (a otra posición o a otro chofer, salvo que el chofer esté fijado),
- *intercambiar pares* entre dos choferes,
- *or-opt* y *2-opt* dentro de una ruta, descartando los movimientos que rompen precedencia o capacidad.

Se aplica el primer movimiento que mejora, en un orden fijo, hasta que ninguno mejora o se agota el tope de
iteraciones. Si el tamaño creciera, el siguiente escalón es «destruir y reparar» (LNS) sobre el mismo
esqueleto; hoy no hace falta.

**Evaluación — una sola función, `evaluaPlan`.** Dada una secuencia, propaga el reloj (salida de la base →
viaje → espera si llega antes → servicio → siguiente), lleva la carga a bordo, y devuelve ETA, salida, espera,
retraso y carga **por parada**, el coste **desglosado por término**, y las violaciones. **Es la misma
función** que usa el motor para decidir, la pantalla cuando el despachador mueve una parada a mano, y la
comparación cuando se puntúa la hoja manual. Una sola fuente: si dos números no coinciden, es un bug y no una
diferencia de criterio.

**Afinar los pesos con días reales.** La comparación contra la hoja (§8.1) **es el banco de pruebas**. Cada
hoja importada deja guardados, para ese día, el plan del despachador y el del motor puntuados con la misma
función, término a término. Con unas semanas de hojas se puede contestar con números: ¿en cuántas órdenes
coinciden chofer y orden de carga?, ¿cuándo «gana» el despachador, y en qué término? Como el motor es
determinista y cada plan guarda su entrada, **se puede volver a planificar cualquier día pasado con otros
pesos** y ver si se acerca o se aleja de lo que hizo el despachador — sin llamar a ninguna API, porque la
matriz de ese día también está guardada. Los pesos **nunca se ajustan solos**: se proponen, el dueño los
cambia en Ajustes, y queda registrado desde qué plan rigen.

**Tiempos de servicio: los de hoy** (respuesta 7 del dueño; D-024, `DECISIONS.md:18526`). En la entrega, los
minutos de `delivery_duration` (pallets × `settings.delivery_min_per_pallet`), **15 por defecto**
(`trip-timing.ts:11`). En la recogida, los de `pickup_duration` (pallets × `settings.pickup_min_per_pallet`),
que hoy **se calculan y no entran en ningún plan**. Queda una pregunta abierta sobre los 20 minutos de
recarga (§9, pregunta 8).

### 2.4 Determinismo

- **Sin azar:** ni `Math.random`, ni orden de iteración de un `Map` sin fijar.
- **Empates resueltos por una clave estable, y la primera es la del dueño:** `input_date` + `input_time`
  («la que entró primero va primero»; columnas `014:25-26`), después `order_code`, y al final `id`. Una orden
  sin fecha de entrada va detrás de las que la tienen. Choferes, por nombre.
- **Se corta por número de iteraciones, nunca por tiempo de reloj:** un límite de tiempo hace que la
  respuesta dependa de lo rápida que sea la máquina.
- **La matriz de tiempos es parte de la entrada, y se guarda con el plan.** Si Google contesta otra cosa
  mañana, el plan de hoy sigue siendo reproducible byte a byte.
- **El plan guarda la versión del algoritmo, sus parámetros y sus pesos.** Cambiar un peso es otra entrada, y
  por tanto otro plan; nunca el mismo plan con otro resultado.
- Prueba: la misma entrada dos veces, y barajando el orden de las órdenes de entrada → el mismo plan.

### 2.5 Límite de cómputo

Tope de **iteraciones** (no de segundos) calibrado para que 60 órdenes y 10 choferes terminen en menos de
**2 segundos** en la máquina de CI; a 14 órdenes son milisegundos. Una prueba de estrés lo fija para que una
regresión de rendimiento rompa el CI. El motor corre en el servidor, en una ruta de Next con runtime `nodejs`
como las demás de mapas; el cuello de botella real no es el cómputo sino la matriz de tiempos (§3), que por
eso va cacheada. Si el tope se agota se devuelve **la mejor solución encontrada, marcada como «no
convergió»**: nunca un error, y nunca en silencio.

### 2.6 Reoptimizar con paradas fijas o ya ejecutadas

Cuatro clases, y el motor solo decide del todo sobre la última:

| Clase | Qué es | Qué hace el motor |
|---|---|---|
| **Ejecutada** | la orden ya está `picked_up` (su P ocurrió) o `delivered` (las dos) | Intocable. Una orden recogida **se queda con ese chofer**: la carga va en su camión (y es lo que ya dice D-017). Su D pendiente se puede reordenar dentro de esa ruta, no cambiar de chofer |
| **Fijada** | el despachador le puso el candado, o la movió a mano en el borrador | Conserva chofer **y** posición relativa. El motor coloca lo demás alrededor |
| **Con chofer puesto a mano** | la orden ya trae `assigned_driver` porque **una persona** la asignó | Conserva el **chofer**; la **posición** la decide el motor. Es la regla literal del dueño |
| **Libre** | el resto | Se planifica |

**Cómo se distingue «la asignó una persona» de «la asignó el motor ayer».** Importa: al re-planificar un día
ya publicado, casi todas las órdenes traen `assigned_driver` — porque lo escribió la publicación anterior. Si
todas contaran como puestas a mano, el segundo plan no podría mover nada. La regla: una orden está **puesta a
mano** si su chofer actual **no coincide** con el que le dio el último plan publicado de esa fecha (o no hay
plan publicado). Si coincide, lo puso el motor y es **libre**. No hace falta columna nueva: sale de comparar
`deliveries.assigned_driver` con `route_plan_stops` del plan publicado. Una orden en un «route bucket» queda
fuera del motor (§4.5).

- **Desde dónde se reoptimiza a mitad del día:** desde la última parada ejecutada de cada chofer y su hora
  real. **No desde el GPS en vivo**: el rastreo solo corre en turno, solo desde el APK y con huecos declarados
  (D-009 `:18125`, D-034 `:18967`, D-036 `:19066`). Planificar sobre una posición que el sistema dice no tener
  sería inventarla.
- **Una orden nueva a mitad del día:** inserción más barata del par sobre el plan vigente, sin mover lo
  demás: el «best fit» de OptimoRoute y Routific. El resultado es un **borrador nuevo**, que se publica o no.
- Nada se reoptimiza solo. **Siempre lo pide una persona** (§4.2).

### 2.7 Explicabilidad

Una suma ponderada se explica peor que un orden estricto **si solo se enseña el total**. Por eso nunca se
enseña solo el total: `evaluaPlan` devuelve el coste **desglosado por término**, y cada alternativa se cuenta
como una diferencia término a término. Cada parada del plan guarda su motivo, en datos y no en prosa (la
pantalla lo traduce a los dos idiomas):

- **Por qué este chofer:** la mejor alternativa con otro, desglosada — «con el otro chofer: +18 min de
  manejo, +6 millas, el builder llega 40 min más tarde, +25 min tarde en una ventana ancha». Se ve **qué
  término decidió**, y el dueño puede discrepar del peso, no solo del resultado.
- **Por qué en esta posición:** qué restricción dura la ata (ventana estrecha, precedencia, capacidad), o qué
  término la empuja (es un builder; entró antes).
- **Cuánto costaría moverla:** el despachador arrastra y ve el delta, desglosado, antes de soltar.
- **Por qué quedó sin asignar**, con un vocabulario cerrado, tomado de los códigos de Google:
  `sin_punto` (la orden no tiene pin) · `supera_capacidad` (más pallets que el camión mayor) ·
  `ventana_imposible` · `retraso_sobre_el_tope` · `fuera_de_turno` · `sin_chofer_disponible` ·
  `chofer_fijado_sin_hueco` · `sin_tienda_de_origen`.

---

## 3. Tiempos de viaje: matriz, caché, tráfico y respaldo

### 3.1 La idea

**No pedir nunca una matriz completa con tráfico.** La investigación la calculó en ~$395/mes para 45 nodos, y
D-025 ya descartó pagar una matriz de Google por lo mismo (`DECISIONS.md:18590`). En su lugar, dos capas:

1. **Matriz base, sin tráfico, cacheada de forma permanente.** Da al motor tiempos consistentes para decidir.
   Tiene poco que pedir: los puntos son **7 tiendas** (que ya tienen lat/lng, y son a la vez bases, orígenes y
   destinos de las Intertiendas) más los destinos del día. Las 49 parejas tienda↔tienda se piden **una vez**.
2. **Tráfico proyectado en cascada, solo sobre las rutas que salen.** Decidido el orden, se pide cada tramo
   con `departureTime` = **la hora a la que ese camión sale de la parada anterior**, no las 08:00 para todos.
   Con los tiempos corregidos se recalculan las ETAs; si alguna parada pasa a llegar tarde, se reoptimiza con
   esos tiempos y se repite. **Dos vueltas como máximo.** Cuesta tantas llamadas como tramos, no una matriz.

### 3.2 La caché

Tabla nueva `travel_time_cache` (§6.4). La clave es la que pidió el orquestador:

`(origen, destino, día de la semana, bloque horario, con/sin tráfico)`

- **Origen y destino:** lat/lng redondeados a 5 decimales (~1 m), la misma precisión que ya usa la caché de
  `optimize-route` (`route.ts:134`).
- **Bloque horario: 30 minutos.** Un martes a las 08:10 y otro a las 08:25 comparten respuesta. Es el grano en
  que el tráfico cambia de verdad.
- **Caducidad:** sin tráfico, 90 días (las carreteras no cambian); con tráfico, 28 días (cuatro semanas del
  mismo día y bloque).
- **Compartida entre corridas y entre personas**, que es justo lo que no hace la caché actual (memoria del
  proceso, 10 minutos). Re-planificar el mismo día cuesta **cero llamadas**.
- **Un tramo solo se pide si no está.** Nada periódico, nada en bucle (`CLAUDE.md`, regla de APIs de pago).
- El motor **no geocodifica**: usa el pin que la orden ya tiene, y para las tiendas el de Ajustes. Una orden
  sin pin queda sin asignar con `sin_punto` (D-223, `:28993`: «un pedido con punto no se vuelve a
  geocodificar jamás»; medido: 40 de 43 vivas lo tienen).

### 3.3 Respaldo

Como hoy (D-008): si Google falla o no hay llave, **OSRM público**. Con sus límites dichos: **sin tráfico**,
tiempos de flujo libre que en hora punta salen optimistas, servicio gratuito sin garantía de disponibilidad.
Un plan calculado con el respaldo lo **dice** en pantalla, igual que el distintivo «Google · con tráfico /
Sin datos de tráfico» de hoy (`routes/page.tsx:1440-1452`), y guarda con qué proveedor se hizo. Si fallan los
dos: línea recta × un factor, con el plan marcado «estimado», solo para que el despachador no se quede sin
nada. Nunca se publica un plan estimado sin que quien publica lo vea escrito.

---

## 4. Lo que cambia de lo que hay hoy — el aviso al dueño

> Todo lo de esta sección **cambia comportamiento existente**. Nada se hace sin aprobar este documento, y
> cada punto lleva su decisión: al implementarse, la decisión vieja se marca *Reemplazada* y se escribe la
> nueva (regla 2 de la documentación: el historial no se borra).

### 4.1 Se retira

| Qué | Dónde está | Decisión | Por qué se va |
|---|---|---|---|
| La agrupación por zona (Clarke–Wright + or-opt en el navegador) | `route-batching.ts:121` | **D-025** `:18562` | El motor decide a la vez quién lleva qué y en qué orden; agrupar aparte y ordenar después es lo que impide emparejar recogidas |
| El orden que decide Google (`optimizeWaypointOrder`) en el Gestor | `google-routes.ts:196` | **D-008** `:18100` (esa parte) | Google ordena un viaje sin ventanas, sin parejas y sin capacidad. **Google se queda** para lo que sabe hacer: tiempos con tráfico y el trazado |
| «Auto-asignar» (todo y selección) | `dispatch.ts:185`; `routes/page.tsx:1020,1056`; `map/page.tsx:201` | — (sin decisión propia) | Lo sustituye «Planificar el día» |
| «2 viajes por día» | `routes/page.tsx:1020` | — | Lo sustituye el **turno** del chofer |
| Salida a las 08:00 para todos | `routes/page.tsx:66`; `google-routes.ts:73` | — | Lo sustituye la **entrada** de cada chofer. De paso cierra una discrepancia: las reglas de agenda usan 08:30 (`scheduling.ts:22`) |
| El depósito deducido en caliente (recogida más repetida → tienda → tienda del chofer) | `routes/page.tsx:550-590` | — | Lo sustituye la **base** del chofer, guardada |

### 4.2 Se conserva, y el motor se pliega

- **El chofer ve el plan y no puede cambiarlo** (D-021 `:18420`). «Mi ruta» sigue pidiendo el trazado con
  `optimize:false` (`my-route/page.tsx:172`): dibuja **la secuencia publicada**, nunca otra. Aquella frase
  —reordenar «habría sido mentirle al chofer sobre su propio día»— es la regla de todo este diseño: **el
  motor propone en borrador; el chofer solo ve lo publicado.**
- **Reordenar es una edición de una persona** (D-007 `:18087`, D-016 `:18278`). El motor **nunca reordena
  solo**: ni al abrir la pantalla, ni al entrar una orden, ni por un temporizador. Las flechas ↑/↓ siguen
  ahí, ahora sobre el borrador, y lo que se mueve a mano queda **fijado**.
- **Lo agrupado a mano se respeta** (D-025 `:18594`). Hoy es `load_auto = false`; en el diseño nuevo es una
  parada **fijada** (§2.6). Misma intención, ahora por parada y no por viaje.
- **Quien recoge sin chofer queda como su chofer** (D-017 `:18303`). Intacto, y §2.6 lo refuerza: una orden
  recogida no cambia de camión.
- **El precio no se toca** (D-013 `:18220`; D-219 `:28494`, D-283 `:36059`, D-303 `:37789`: «nada
  retroactivo»). El motor **no escribe `route_miles` ni `delivery_fee`**. Sus millas son de *ruta* y viven en
  las tablas de plan; `route_miles` es de *orden* (recogida→entrega) y sigue alimentando la tarifa como hoy.
- **Coste de APIs** (D-008 `:18115`, D-021 `:18452`, D-222 `:28881`, D-223 `:29144`): §3 y §5. La caché de 10
  minutos de `optimize-route` se queda para el trazado.
- **Tiempos de servicio** (D-024 `:18526`): los mismos números.
- **El GPS es una reconstrucción honesta** (D-009, D-034, D-036): el motor no planifica sobre la posición en
  vivo.

### 4.3 Cambia de forma: los avisos (D-032 `:18868`, D-308 `:38224`)

Hoy, **cada** cambio de `assigned_driver` avisa al chofer con campana y push (`data-provider.tsx:1017`), y
desde D-308 funciona de verdad. Publicar 14 órdenes por ese camino son **14 avisos**. Con el motor:

- **En borrador no se escribe nada en las órdenes y no se avisa a nadie.**
- **Al publicar, UN aviso por chofer:** «Tu ruta del viernes 19: 6 paradas, primera recogida 08:00».
- **Al re-publicar, solo a quien le cambió algo** («Tu ruta cambió: 1 parada nueva»), y a quien se quedó sin
  ninguna. A quien no le cambió nada, silencio.
- **La asignación a mano, fuera de publicar, sigue avisando como hoy.** D-032 no se retira: se le añade un
  camino nuevo. El detalle de cómo, en §7.

### 4.4 Lo que ve cada rol

Almacén ve la ruta del día y las posiciones, en solo lectura (D-287 `:36450`, D-289 `:36669`). **Propuesta:
ve el plan publicado; los borradores no.** Un borrador a la vista de almacén es un plan que alguien empieza a
preparar antes de que exista. Alternativas, puntuaciones y el «por qué» son del despachador.

### 4.5 Los «route buckets»

Son choferes ficticios que viven en `assigned_driver` (`settings.route_buckets`, `034:4`). **El motor no les
asigna nada**: no tienen base, camión ni turno. Siguen existiendo como carriles manuales del Gestor. Lo que
el despachador meta en un bucket queda **fuera del plan del motor ese día**, y la pantalla lo dice.

### 4.6 Las ventanas: los cinco slots no se tocan (D-296 `:37194`)

D-296 fija cinco ventanas, obligatorias, y una elegida a mano no se pisa: `0830-1000`, `0830-1200`,
`1200-1730`, `0830-1730` y, en sábado, `0830-1530` (`constants.ts:666-677`). **El motor no las cambia, no crea
otras y no «ajusta» una ventana para que le cuadre la ruta.**

**Qué es «estrecha», según el dueño.** Su encargo: *«algunas son estrechas (08:30–09:30, 08:30–12:00) y en la
hoja se resaltan a mano. Esas mandan sobre todo lo demás»*. Dos cosas que ese texto dice y que cambian mi
primera propuesta:

1. **08:30–12:00 es estrecha para él, y dura 3 h 30.** Una regla «dura 2 horas o menos» no la captura.
2. **08:30–09:30 no existe en la app.** No es ninguno de los cinco slots: en la hoja hay ventanas que el
   formulario de la orden no ofrece. Es una diferencia entre la hoja y la app que hay que resolver antes de
   importar hojas (§9, pregunta 5).

**Tres formas de decir cuál es estrecha, para que elija el dueño** (pregunta 5):

| | Regla | A favor | En contra |
|---|---|---|---|
| **A** | **Lista explícita en Ajustes** de los slots que son duros — hoy serían `0830-1000` y `0830-1200` | Sin ambigüedad; se cambia sin tocar código; sin migración de la orden | Una ventana ancha que un día concreto importa no se puede marcar |
| **B** | **Por duración:** estrecha = dura 3 h 30 o menos | Una línea | Es un umbral que casa hoy por casualidad con los slots; si mañana hay un slot de 4 h, habrá que discutirlo otra vez |
| **C** | **Una marca en la orden**, «ventana dura» — lo que el despachador hace hoy resaltándola a mano | Lo más fiel a como trabaja | Un campo más en el formulario y una columna más; alguien tiene que acordarse de marcarla |

**Recomiendo A, y C más adelante si se echa de menos.** Medido en 90 días: `0830-1000` = 20 órdenes y
`0830-1200` = 10, o sea **30 de 160** con ventana dura.

| | Estrecha | Ancha |
|---|---|---|
| Llegar tarde | **No se permite.** Si no cabe, sin asignar con `ventana_imposible` | Se permite, con su peso (el tercero, §2.3), aviso en rojo y un tope |
| En el reparto | Se colocan primero | Rellenan |

Ninguna de las tres opciones toca el formato: la ventana ya es un texto `"HHMM-HHMM"` (`dispatch.ts:25`). Un
detalle que el motor hereda y conviene saber: `parseWindow` solo lee el **primer** rango aunque `fmtWindows`
admita varios separados por coma (`dispatch.ts:27`, `utils.ts:203`).

---

## 5. Coste de API

Precios de la investigación (consultados 2026-09-18): Routes **Essentials** $5 por 1 000 con **10 000
gratis** al mes; **Pro** (tráfico) $10 por 1 000 con **5 000 gratis**. La matriz se factura **por elemento**
y las rutas **por petición**.

**Cuenta con el tamaño medido.** Un día tiene tantos puntos como tiendas implicadas más destinos distintos:

| | Día mediano (3 órdenes) | Día máximo medido (14 órdenes) |
|---|---|---|
| Puntos distintos | ~6 | ~17 |
| **Matriz base** (Essentials), elementos nuevos | ≤ 36 | ≤ 289 |
| **Tramos con tráfico** (Pro): paradas + vueltas a base, × 2 vueltas | ~16 | ~64 |

**Al mes** (22 días hábiles), sin contar lo que ahorra la caché:

| | Esperado | Peor caso: todos los días como el máximo, 3 corridas al día | Franja gratuita |
|---|---|---|---|
| Matriz base (Essentials) | ~1 400 elementos | ~6 400 (la 2.ª y 3.ª corrida salen de la caché) | 10 000 |
| Tramos con tráfico (Pro) | ~450 peticiones | ~4 200 | 5 000 |
| **Coste** | **$0** | **$0** | |

- Con la caché compartida el uso real es **menor** que el esperado: los tramos tienda↔tienda se repiten a
  diario y los destinos de clientes habituales también.
- **Si algún día se pasara la franja**, el exceso se paga a $5-10 por 1 000: duplicar el peor caso serían unos
  **$35-40 al mes**. No hay escalón donde el coste se dispare.
- **Un freno en el código, no solo en el papel:** un tope de llamadas nuevas por corrida y por día. Al
  alcanzarlo, el motor sigue con la matriz base y lo dice. Es la regla de `CLAUDE.md` —«nunca en bucle»—
  hecha cumplir por el programa.
- **No medido:** el uso real de Google que ya hace la app (geocodificación, autocompletar, el trazado de
  «Mi ruta») comparte llave y franja con esto. Conviene mirar la consola de Google de un mes antes de
  activar el tráfico en cascada.

---

## 6. Modelo de datos: qué se añade

> Solo el enunciado y las columnas; el SQL se escribe al implementar cada incremento. Cada migración irá
> **sin `begin`/`commit`**, con autocomprobación, matriz de ensayo por rol con `ROLLBACK`, reversión y
> registro en el ledger; las que toquen RLS, con su plan en papel antes. **Las ensaya y las aplica el
> orquestador**, con el OK del dueño.

### 6.1 `driver_settings` — base, capacidad y turno del chofer

Una fila por chofer, **por `profiles.id`**:

| Columna | Tipo | Nota |
|---|---|---|
| `profile_id` | `uuid` PK → `profiles(id)` on delete cascade | |
| `base_store` | `text` | el **nombre** de una tienda de `settings.stores`. No una dirección suelta: el dueño dijo «cada chofer su tienda», y las 7 tiendas ya tienen lat/lng (medido) |
| `capacity_pallets` | `numeric` | con decimales, como los pallets |
| `shift_start`, `shift_end` | `time` | hora local del negocio |
| `returns_to_base` | `boolean` default `true` | |
| `routable` | `boolean` default `true` | para un chofer al que el motor no debe asignar (§9, pregunta 3) |
| `updated_at`, `updated_by` | | |

**Cómo convive con que `assigned_driver` sea un nombre, sin romper nada:**

- **No se cambia `assigned_driver`.** Sigue siendo el nombre, y al publicar se escribe el `full_name` del
  chofer, como hoy. La RLS del chofer, su color y los buckets siguen funcionando **sin tocarlos**.
- **El motor trabaja por `id`** (estable); el nombre es solo lo que escribe al final. Las tablas de plan
  guardan **los dos**: `driver_id` y `driver_name`, este último como foto del momento.
- **La capacidad de hoy** (`settings.driver_capacity`, nombre → pallets; medido: una sola entrada, de 10 pallets) se
  **copia** a `driver_settings` al crearla, casando por nombre. Mientras existan las dos, el Gestor lee
  primero `driver_settings` y, si falta, la de Ajustes. La de Ajustes se retira en un incremento posterior,
  cuando nada la lea.
- **Lo que NO se arregla aquí, a propósito:** renombrar a una persona sigue rompiendo su visibilidad, porque
  la RLS compara por nombre. Pasar `assigned_driver` a `uuid` es la migración más delicada de la app (toca la
  política de lectura de `deliveries`) y **no hace falta para este motor**. Queda anotada como deuda, con su
  propio plan en papel el día que se haga.

RLS: leen admin, gerente, office, logística y almacén; escriben admin y logística.

### 6.2 `deliveries.customer_type` — builder o mostrador, por orden

- Columna `customer_type text`, `check in ('builder','counter_sale')`, **admite null** (una Intertienda o un
  Transfer no son ni lo uno ni lo otro).
- El dueño: «se marca en cada orden», con la cuenta como valor por defecto. El valor por defecto de cada
  cuenta vive en `AccountRecord.customer_type`, dentro del JSON de `settings.accounts` — **sin migración
  SQL**, como `intertienda` y `requires_approval`.
- **En el formulario, solo en los tipos que van a un cliente**, un selector Builder / Mostrador que **nunca
  nace vacío**:
  - la cuenta elegida está guardada como builder → **Builder**;
  - **no hay cuenta**, o la cuenta no dice nada → **Mostrador**.

  Así nadie tiene que acordarse de marcarlo para que una orden sin cuenta sea de mostrador, y quien vende a
  un builder sin cuenta guardada lo cambia con un toque. Casa con lo medido: **48 de las 82** órdenes a
  cliente de 90 días no tienen cuenta y solo hay 4 cuentas guardadas — y «VENTA AL MOSTRADOR», que en la hoja
  es el valor de la columna Account, **no existe como cuenta en la app**. Lo más probable es que esas 48
  *sean* las ventas al mostrador; es una inferencia, no una medición, y por eso es una pregunta (§9, 7).
- Las órdenes **anteriores** a este campo quedan en `null`. El motor trata `null` en un tipo de cliente como
  mostrador —prioridad normal—: subirle la prioridad a quien nadie marcó como builder es justo lo contrario
  de priorizar.

### 6.3 Las tablas de plan — el hueco que condiciona todo lo demás

**`route_plans`** — una fila por corrida o por hoja importada.

| Columna | Nota |
|---|---|
| `id`, `plan_date date` | |
| `status` | `draft` · `published` · `superseded` · `discarded`. **Un solo `published` por fecha**: publicar otro pasa el anterior a `superseded` |
| `version int` | 1, 2, 3… dentro de la fecha |
| `source` | `engine` · `manual_edit` (un borrador tocado a mano) · `manual_import` (la hoja del despachador) |
| `algorithm_version text` | |
| `params jsonb` | **los pesos con los que se hizo** (copia de `settings.route_weights`), la regla de ventana estrecha, el tope de retraso, los topes de cómputo |
| `input jsonb` | **la foto de la entrada**: órdenes (id, puntos, pallets, ventana, tipo, `updated_at`), choferes (base, capacidad, turno) y la matriz usada. Es lo que lo hace reproducible |
| `provider text`, `traffic boolean`, `converged boolean` | con qué tiempos se hizo, y si terminó |
| `total_minutes`, `total_miles`, `late_minutes`, `late_count`, `unassigned_count` | lo que se compara lado a lado |
| `parent_plan_id` | de qué borrador salió |
| `created_by/at`, `published_by/at` | |

**`route_plan_stops`** — una fila por parada.

| Columna | Nota |
|---|---|
| `plan_id`, `driver_id uuid`, `driver_name text` | id estable y nombre de ese momento |
| `seq int` | posición en la ruta de ese chofer |
| `kind` | `start` · `P` · `D` · `end` |
| `delivery_id`, `label text` | «P1», «D1»: el número lo comparte el par |
| `place_name`, `lat`, `lng` | foto del punto |
| `window_start`, `window_end`, `is_narrow` | |
| `eta`, `etd`, `wait_min`, `service_min`, `late_min` | |
| `load_after numeric` | carga a bordo al salir, con decimales |
| `leg_minutes`, `leg_miles` | el tramo que llega a esta parada |
| `pinned boolean`, `executed boolean` | §2.6 |
| `reason jsonb` | el «por qué» de §2.7 |
| `actual_arrival_at`, `actual_departure_at` | **vacías al planificar**; las llena la calibración (§8) |

**`route_plan_unassigned`** — `plan_id`, `delivery_id`, `reason_code`, `detail jsonb`.

RLS: leen admin, gerente, office y logística; almacén, **solo los publicados**; escriben admin y logística. El
chofer **no** lee estas tablas en los primeros incrementos: sigue viendo su día por `deliveries`, como hoy.
Cuando «Mi ruta» enseñe la secuencia P/D con ETA (incremento 5) se le abrirá la lectura de **sus** paradas
del plan **publicado**, y de nada más.

### 6.4 `travel_time_cache`

`origin_key`, `dest_key`, `weekday smallint`, `block smallint` (0-47), `traffic boolean`, `seconds`, `meters`,
`provider`, `fetched_at`; clave primaria compuesta por los cinco primeros. La escribe solo el servidor; la
leen los roles de oficina. No guarda nada de nadie: dos coordenadas y una duración.

### 6.5 Dos cosas menores

- **Índice** `(delivery_date, assigned_driver)` en `deliveries`: hoy no hay ninguno sobre el chofer.
- **Preferencias por usuario** (§8, incremento 10): tabla `user_prefs (user_id, prefs jsonb)`.
- **`settings.route_weights jsonb`**: los pesos de §2.3 y la lista de ventanas duras de §4.6, editables por el
  admin. Con su columna declarada en una migración: hoy hay seis campos de `settings` que la app usa y que
  ninguna migración del repo crea (lo encontró el inventario), y no conviene sumar un séptimo.

---

## 7. Borrador y «Publicar ruta»

**Borrador.** «Planificar el día» crea un `route_plans` en `draft`. **No toca `deliveries`.** El despachador
lo mira, mueve paradas (cada movimiento recalcula con `evaluaPlan` desde la matriz guardada, **sin llamar a
ninguna API**), fija, vuelve a planificar. Puede haber varios borradores; ninguno existe para nadie más.

**Publicar.** Una ruta de servidor nueva, con la sesión de quien publica, que hace tres cosas en orden:

1. **Comprueba que el plan no está viejo.** Compara el `updated_at` de cada orden con el de la foto de
   entrada. Si una orden cambió de ventana, de pallets, de etapa, o se anuló, **no publica**: enseña qué
   cambió y pide re-planificar. Publicar un plan hecho con datos que ya no son ciertos es el error más fácil
   de cometer y el más caro de descubrir.
2. **Escribe en `deliveries`**, y solo esto:
   - `assigned_driver` = el **nombre** del chofer,
   - `route_seq` = la posición de su entrega en la ruta del chofer,
   - `load_no` = el número de viaje derivado (§2.3), `load_auto = true`.

   Es exactamente lo que el Gestor escribe hoy, así que todo lo que lee esas columnas —«Mi ruta», el mapa, la
   ruta del día de almacén, el manifiesto impreso— **sigue funcionando sin cambios**. Se escribe con la sesión
   de quien publica: `guard_delivery_stage` deja a logística editar en `pending…ready` (`125:160`), que son
   justo las etapas ruteables (`routes/page.tsx:59`). Una orden que ya está `picked_up` no se toca — y el
   guard tampoco lo dejaría.
3. **Avisa: una fila de `notifications` por chofer**, `kind` nuevo `route_published`, con el id generado por
   quien llama y **sin pedir la fila de vuelta** (la lección de D-308: un `INSERT … RETURNING` aplica la
   política de lectura a una fila que es de otra persona), y su push.

**Por qué no sale un aviso por orden.** El aviso por asignación vive **dentro de `updateDelivery`**
(`data-provider.tsx:1017`). Publicar **no pasa por ahí**: escribe por su propia ruta. El aviso por orden
sigue existiendo para la asignación a mano; publicar tiene el suyo. Hay que dejarlo cubierto con una prueba:
que publicar 14 órdenes a 3 choferes deja **3** filas de aviso, no 14 ni 17.

**Re-publicar.** Se compara la lista de paradas de cada chofer con la del plan anterior: avisa a quien le
cambió algo y a quien se quedó sin nada; a los demás, nada.

**Si el plan deja órdenes sin asignar,** publicar **no las toca**: conservan lo que tuvieran. Se dice antes
de confirmar: «3 órdenes quedan fuera de este plan».

---

## 8. Plan de entrega — incrementos pequeños, cada uno un PR revisable

Cada uno con sus pruebas, su entrada en `DECISIONS.md`, y nada visible para el chofer hasta el 4.

| # | Incremento | Migración | Qué se ve |
|---|---|---|---|
| **1** | **Datos del chofer y tipo de cliente.** `driver_settings`, su pantalla en Ajustes; `customer_type` en la orden y en la cuenta; `settings.route_weights` con su pantalla (pesos y ventanas duras) | sí (3) | Ajustes y el formulario de orden. El Gestor, igual |
| **2** | **El núcleo puro.** `planifica` y `evaluaPlan` en `src/lib/routing/`, sin red, sin base, sin pantalla. Pruebas: precedencia; capacidad excedida; pallets decimales; ventana imposible; sin chofer disponible; bases distintas; día sin órdenes; una sola orden; builder antes que mostrador, y el último en quedarse fuera; **el orden de los pesos por defecto** (un desvío corto para adelantar a un builder se acepta, uno largo no); ventana estrecha dura y ancha con tope; chofer puesto a mano respetado, posición libre; empate por fecha y hora de entrada; paradas fijadas y ejecutadas; **determinismo** (misma entrada dos veces, y entrada barajada); **estrés** (60 órdenes, 10 choferes, bajo el tope); y **mutantes leídos por nombre** | no | Nada |
| **3** | **Tiempos.** `travel_time_cache`, matriz base, cascada con `departureTime` futuro, respaldo OSRM, tope de llamadas. Pruebas con el proveedor **simulado**: ni una llamada real | sí (1) | Nada |
| **4** | **Tablas de plan, borrador y publicar.** «Planificar el día» junto a lo de hoy, que **sigue ahí**. Un aviso por chofer | sí (3) + plan en papel | El despachador puede planificar y publicar |
| **5** | **La ruta P/D.** Secuencia P1/D1 con ETA, espera, carga a bordo y retrasos en rojo; línea de tiempo por chofer. «Mi ruta» enseña la secuencia publicada | RLS del chofer sobre sus paradas | Gestor y «Mi ruta» |
| **6** | **Ajuste manual.** Flechas sobre el borrador, fijar, «mejor hueco» al soltar sobre un chofer, el delta antes de soltar, advertencias | no | Gestor |
| **7** | **No asignadas con motivo**, y el «por qué» de cada parada | no | Gestor |
| **8** | **Importar la hoja y comparar** (§8.1) | no | Gestor |
| **9** | **Calibración y reporte de precisión** (§8.2) | según lo que decida el dueño | Reportes |
| **10** | **Columnas de la tabla de órdenes por usuario** (§8.3) | sí (1) | Órdenes |
| **11** | **Retirada de lo viejo:** agrupación por zona, «Auto-asignar», el depósito deducido, `settings.driver_capacity`. **Solo cuando el dueño lleve un tiempo publicando con el motor y lo diga** | no | El Gestor pierde los botones viejos |

**Hasta el 11 conviven los dos.** El motor nuevo está disponible desde el 4 y el optimizador de hoy sigue
ahí: «sustituye» se cumple al final, no el primer día. Si el motor se equivoca una mañana, el despachador no
se queda sin herramienta.

### 8.1 Importar la hoja del despachador y comparar lado a lado

**Las columnas, tal como las dio el dueño**, y a qué corresponden en la app:

| Columna de la hoja | En la app | Nota |
|---|---|---|
| Order Type (Cliente / Intertienda / Transfer) | `order_type` | «Cliente» es `Customer` en la app (`028`) |
| Store (Sold From) | `store` | |
| PO # · SO # · Invoice # | `po2` · `so_num` · `invoice_num` | **con estas tres se casa la fila con su orden** |
| Input Date · Input Military Time | `input_date` · `input_time` | el desempate: la que entró primero va primero |
| Delivery Date | `delivery_date` | |
| Pickup Name (MCA, MIS, EDG, PHR, BRO) | tienda de origen | los códigos son los de `STORE_TAGS` (`utils.ts:37-45`), leídos al revés: código → tienda |
| **Pickup Address** | **no es una dirección: es el número de carga** | ver abajo |
| Est. Pallets | `est_pallets` | decimal en los dos sitios |
| Assigned Driver (optional) | `assigned_driver` | vacío = el despachador no asignó |
| Delivery Address | `delivery_address` | |
| Delivery Military Time Windows | `delivery_windows` | militar en los dos sitios; las estrechas, **resaltadas a mano** — un resaltado no viaja en un CSV, y por eso «estrecha» tiene que ser una regla (§4.6) |
| Account | `account` | «VENTA AL MOSTRADOR» = mostrador; cualquier otra = builder o empresa |

**La columna «Pickup Address».** El dueño: *«no contiene una dirección: contiene el número de orden de las
cargas. Es la secuencia en que el conductor hace sus recogidas, únicamente. Empieza en 0 y se reinicia con
cada conductor. Hoy las entregas no se numeran… Un mismo número se repite en varias filas del mismo conductor
cuando esas órdenes se agrupan en una sola parada física»*. De ahí:

- La hoja da **el chofer de cada orden** y **el orden de sus RECOGIDAS**. **No da el orden de las entregas.**
- **Números repetidos = una sola parada física** con varias órdenes. El motor ya lo modela así: varias P en la
  misma tienda, seguidas, son una visita con un solo tiempo fijo.
- **En la app las etiquetas empiezan en 1** (P1, P2…), como pidió el dueño; la hoja empieza en 0. La carga
  `0` de la hoja es **P1** en pantalla. La comparación lo enseña así, con el número de la hoja al lado, para
  que nadie tenga que sumar uno de cabeza.

**Cómo entra.** El CSV o XLSX de la hoja, **subido o pegado**, leído **en el navegador** (`exceljs` ya está en
el repo, `package.json:24`). Las columnas se reconocen **por su cabecera**, con el mapa de arriba por
defecto; si una hoja trae otra cabecera, el importador enseña las que encontró y deja elegir, y recuerda la
elección. **No se guarda el fichero, ni en el repo ni en Storage**: de la hoja solo queda el plan resultante,
que referencia órdenes que ya están en la base. Ningún dato del dueño entra en el repo ni en las pruebas, que
usan hojas inventadas.

**Casar filas con órdenes:** por Invoice #, PO # o SO #, dentro de la fecha de entrega de la hoja. Lo que no
casa se enseña **sin casar**; no se adivina. La hoja puede llevar órdenes que no están en la app (el
orquestador ya avisó): se listan aparte y **no se puntúan**, porque no tienen punto ni pallets en la base.

**Qué se puede comparar, y qué no.** Como la hoja solo ordena recogidas, **el orden de entregas no tiene
contraparte manual**, y conviene decirlo en la propia pantalla en vez de inventar una. Se compara:

1. **A qué chofer va cada orden** — coincide o no, orden por orden.
2. **El orden de las cargas** de cada chofer — coincide o no.
3. **El coste total de la ruta manual**, completada de la única forma honesta: **respetando sus choferes y su
   orden de cargas**, y dejando que el motor ponga las entregas en **la mejor secuencia que ese orden de
   cargas permite**. Es la mejor versión posible del plan del despachador: si aun así el motor sale mejor, la
   diferencia es suya de verdad; si sale peor, el despachador sabe algo que el modelo no.

Ese plan se guarda como `route_plans` con `source = manual_import`, y se marca qué parte es de la hoja
(choferes, cargas) y qué parte completó el motor (entregas), para que nadie lea las entregas como si fueran
del despachador. Se puntúa con `evaluaPlan`: misma matriz, mismos tiempos de servicio, mismas ventanas y
capacidades, **mismos pesos**. La ruta manual también enseña **sus** violaciones: si carga 11 pallets en un
camión de 10, se ve.

Las filas con **Assigned Driver vacío** no tienen chofer manual que comparar: entran en el total, asignadas
por el motor, y se cuentan aparte.

**Lado a lado:** por chofer y en total, **término a término** (builders, manejo y millas, retraso, balance),
más paradas tarde y órdenes fuera.

**Explicar cada diferencia.** Para cada orden que el motor puso con otro chofer o en otro orden de carga,
**cuánto cuesta ponerla como en la hoja**, desglosado (§2.7). Tres respuestas posibles, y las tres sirven:
- *«como en la hoja: +18 min de manejo»* — el motor gana, y dice en qué;
- *«como en la hoja: −6 min»* — **el despachador gana**: es un fallo del motor, un peso mal puesto, o algo
  que él sabe y el modelo no (una calle, un cliente que nunca está por la mañana). Es la señal de §2.2 y la
  materia prima para afinar los pesos (§2.3);
- *«como en la hoja rompe una ventana estrecha»* — la diferencia es una restricción, no un gusto.

### 8.2 Calibración: ETA estimada contra real

**Hoy no hay muestra.** Medido en las 109 entregadas de 90 días: `departed_at` 14, `pickup_gps_at` 36,
`arrived_at` **0**, `pod_delivered_at` 22; **con los cuatro sellos, ninguna**.

**Por qué `arrived_at` es cero:** solo lo escribe un botón de la ficha de la orden (`OrderModal.tsx:753`). El
flujo de un toque con el que el chofer trabaja de verdad (`one-tap-stop.ts`, «Mi ruta») **no lo sella nunca**.
No es que los choferes no lo pulsen: es que en su pantalla no existe.

**Qué empezar a registrar, sin cambiar lo que ve el chofer:**

1. **La llegada, deducida del GPS que ya se guarda.** La primera posición del chofer a menos de X metros del
   punto de la parada es su llegada; la última, su salida. `driver_locations` ya tiene esas posiciones (cada 2
   minutos en turno, D-037; 90 días de historia). Se calcula después, en el servidor, y se escribe en
   `route_plan_stops.actual_arrival_at / actual_departure_at`. **El chofer no ve ni pulsa nada nuevo.** La
   precisión es la del GPS: ±2 minutos y con los huecos que D-034 ya declara; el reporte los enseña como
   «sin dato», no los rellena.
2. **Los dos sellos del toque que ya existen** (`pickup_gps_at`, `pod_delivered_at`): solo 36 y 22 de 109.
   Antes de construir sobre ellos hay que saber **por qué faltan** — si es almacén quien marca la etapa en
   vez del chofer, o el toque falla sin red. Es una medición pendiente, no un supuesto.

**El reporte, cuando haya datos:** por parada, ETA planificada contra llegada real; por tramo, minutos
estimados contra reales, por día de la semana y bloque horario; por parada, servicio estimado contra real,
por pallets. De ahí salen dos factores de corrección (viaje y servicio) **que se proponen y no se aplican
solos**: cambiarlos es una versión nueva de los parámetros. Hasta tener unas semanas de planes publicados, el
motor usa los tiempos de Google y los de D-024 **sin corregir, y lo dice**.

### 8.3 Columnas de la tabla de órdenes

Lo que hay (medido en el inventario): el selector **existe**, guarda **por rol y por navegador**
(`localStorage["rtg_order_columns_<rol>"]`, `page.tsx:28`), no viaja entre equipos; ventas no elige (lista
fija del admin en `settings.sales_columns`) y ni ventas ni chofer ven el botón. **La factura ya es una columna
conmutable** (`OrdersTable.tsx:62`) y **además** la columna `#`, siempre visible, ya la enseña a todos
(`byInvoice = true`, `OrdersTable.tsx:371`): quien activa la columna la ve **dos veces**.

**Propuesta:**
- **Por usuario:** `user_prefs (user_id, prefs jsonb)`, cada uno lee y escribe su fila. El `localStorage` se
  queda como arranque rápido y como respaldo sin red. La primera vez, las columnas del usuario se **siembran**
  con lo que tenga guardado su navegador, para que nadie pierda su elección.
- **Ventas sigue con la lista fija del admin**, salvo que el dueño diga otra cosa: es una decisión suya, no un
  límite técnico.
- **La factura dos veces:** lo menos invasivo es **no tocar `#`** —D-298 definió esa celda como cabecera de
  la tarjeta del teléfono, y desde D-310 lleva la pastilla de documento pendiente— y **sacar `invoice` de las
  columnas por defecto** de ventas, chofer y almacén (`constants.ts:684-690`), dejándola conmutable. Cambia lo
  que tres roles ven al entrar, así que va a §9 (pregunta 11).

---

## 9. Preguntas abiertas para el dueño

> Los nombres de choferes y de cuentas no se escriben en este documento, que vive en el repo: se los pasa el
> orquestador con la pregunta.

1. **Base de cada chofer.** Para cada uno de los cuatro con rol de chofer: ¿de qué tienda sale y a cuál vuelve?
   (Medido: hoy solo uno tiene tienda puesta en su perfil.) ¿Vuelven siempre a su base al terminar?
2. **Capacidad de cada camión**, en pallets. (Medido: en Ajustes solo consta la de uno, 10; los demás usan 12
   por defecto.)
3. **¿Rutean los cuatro?** Uno de ellos no tiene ninguna orden asignada en 90 días. ¿El motor puede darle
   trabajo o queda fuera?
4. **Turno de cada chofer:** hora de entrada y de salida. ¿Hay comida o descanso que el plan deba respetar?
5. **Ventana «estrecha».** Usted puso de ejemplo 08:30–09:30 y 08:30–12:00. (a) ¿Cómo prefiere decir cuáles
   son duras: **una lista en Ajustes** (hoy: 08:30–10:00 y 08:30–12:00 — es lo que recomiendo), **por
   duración** (3 h 30 o menos), o **una marca en cada orden**, como el resaltado que hace hoy a mano?
   (b) **08:30–09:30 no es una ventana que la app ofrezca** (son cinco fijas). ¿La añadimos, o en la app esa
   orden lleva 08:30–10:00?
6. **Tope de retraso en ventana ancha.** Con la ruta corta por delante de las ventanas anchas, el motor
   aceptará llegar algo tarde a una ancha si eso acorta la ruta. ¿Cuánto es «algo»? Propuesta: nunca más de 60
   minutos; por encima, la orden se trata como si no cupiera.
7. **Builder o mostrador.** Propuesta: el formulario lo pide solo en órdenes a cliente, con **Mostrador**
   cuando no hay cuenta y **Builder** cuando la cuenta guardada lo es. 48 de las 82 órdenes a cliente de 90
   días no tienen cuenta: ¿son, como parece, las ventas al mostrador?
8. **Los 20 minutos de recarga** (D-024). Con recogidas como paradas, propuesta: en cada visita a una tienda,
   **lo mayor** entre 20 minutos y la suma de los minutos de carga de lo que se recoge ahí. ¿O 20 fijos más
   los minutos por pallet?
9. **Una orden más grande que el camión.** Usted dijo que se parte en viajes. ¿La parte **el motor** (dos
   cargas a/b del mismo chofer, como las cargas partidas que ya existen) o **almacén antes**, a mano?
10. **Una hoja de un día real**, para probar el importador contra ella. No se guarda en el repo.
11. **La factura dos veces en la tabla** (§8.3): ¿quitamos la columna «Factura #» de las que ventas, chofer y
    almacén ven por defecto, ya que `#` la enseña siempre?
12. **¿Almacén ve los borradores, o solo la ruta publicada?** Propuesta: solo la publicada.
13. **Publicar, ¿quién?** Propuesta: admin y logística. ¿También gerente y office?

---

## 10. Lo no verificado

- **Nada de esto se ha ejecutado.** Es un diseño: los milisegundos de §2.2 y los 2 segundos de §2.5 son
  estimaciones sobre el tamaño del problema, que el incremento 2 convierte en una prueba.
- **Los precios y límites de Google** son los de la investigación (2026-09-18), que avisa de que no contrastó
  ninguna cita byte a byte. Las cuentas de §5 son cálculo propio sobre esos precios.
- **El uso de Google que ya hace la app**, que comparte franja gratuita con el motor.
- **Si el tráfico en cascada mejora las ETAs** lo bastante como para justificarse: no hay tiempos reales con
  qué compararlo (§8.2). Por eso el incremento 3 lo deja como una capa que se puede apagar.
- **La hoja del despachador:** las columnas son las que dio el dueño por escrito; **no he visto una hoja
  real**, así que cabeceras exactas, celdas combinadas o filas de totales están sin ver. Por eso el importador
  reconoce por cabecera y deja corregir, y por eso la pregunta 10.
- **Los valores por defecto de los pesos:** el documento fija su orden, no sus números (§2.3).
- **El plan de Vercel** y, con él, el tiempo máximo de una función. No condiciona el diseño —el cómputo son
  milisegundos y la cascada se puede trocear—, pero está sin mirar.
- **Por qué `pickup_gps_at` y `pod_delivered_at` están en 36 y 22 de 109.**
- **Las líneas de `DECISIONS.md`** son las de 662611f y se moverán cuando se arregle el duplicado. Los números
  de decisión, no.

---

## 11. Aprobación y decisiones delegadas

**Aprobado el 2026-09-18.** El dueño recibió este diseño (commit 5a66e7c) y sus 13 preguntas, y contestó,
literal: **«tu toma la decisiones y termina todo»**. Las decisiones que siguen las tomó el orquestador por esa
delegación, con lo medido en producción ese mismo día (solo lectura). **Todas son valores por defecto
editables en Ajustes, no reglas en el código:** el dueño las cambia cuando quiera sin tocar el repo.

Respuestas a §9, por su número:

1. **Base de cada chofer:** la tienda donde más recoge, medido sobre sus órdenes asignadas de 120 días; para
   el que tiene tienda en su perfil, coincide con ella. Vuelven a su base al terminar. **Los nombres no van
   al repo:** esos datos los siembra el orquestador en producción, a mano; no una migración.
2. **Capacidad:** 10 pallets para quien ya la tiene puesta; **12** para los demás, que es el defecto de hoy.
   Medido: hay días con 25,5 / 14 / 6,55 pallets por chofer, así que **hoy ya se hacen varios viajes**.
3. **¿Rutean los cuatro?** El que no tiene órdenes en 90 días queda con **`rutea = false`** hasta que alguien
   le ponga base en Ajustes. No se borra ni se esconde: no recibe trabajo automático.
4. **Turno:** **08:00–17:30** para todos, sin descanso modelado.
5. **Ventana estrecha:** opción **A, lista en Ajustes**, sembrada con `0830-1000` y `0830-1200`. **No se añade
   08:30–09:30:** los cinco slots de D-296 no se tocan; en la app esa orden lleva 08:30–10:00.
6. **Tope de retraso en ventana ancha:** **60 minutos**, como parámetro.
7. **Builder o mostrador:** como propone §6.2. Una orden a cliente sin cuenta es **mostrador**.
8. **Recarga:** en cada visita a una tienda, **lo mayor** entre 20 minutos y la suma de los minutos de carga
   de lo que se recoge ahí.
9. **Orden mayor que el camión:** la parte **el motor**, en cargas a/b del mismo chofer, como las cargas
   partidas que ya existen.
10. **Hoja de un día real:** sigue pendiente del dueño. El importador reconoce cabeceras y deja corregir; se
    prueba con una hoja **sintética** con las 15 columnas que él describió.
11. **La factura dos veces:** «Factura #» sale de las columnas **por defecto** de ventas, chofer y almacén, y
    sigue siendo conmutable.
12. **Almacén** ve solo la ruta publicada.
13. **Publican** admin y logística.

**Pesos.** El orden es el del dueño: builder temprano > ruta corta > ventana ancha > balance. Los valores de
arranque se fijan en el incremento 2, con casos de prueba que los demuestren (§2.3); no salen de este documento.

**Convivencia.** «Sustituye al actual», pero lo viejo no se retira hasta el incremento 11. Hasta entonces
conviven los dos.

**Qué significa «aprobado», para que nadie lo lea de más:** se aprueba **construir** según este diseño, por
incrementos, cada uno con su PR. **No** aprueba aplicar ninguna migración: cada una se ensaya con `ROLLBACK` y
se aplica aparte, con su respaldo, como dice `CLAUDE.md`.
