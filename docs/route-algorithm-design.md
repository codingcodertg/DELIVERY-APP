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

**Lo que falta para empezar** son datos que solo tiene el dueño: base, capacidad y turno de cada chofer, y
qué es exactamente una ventana «estrecha». §9.

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
misma cantidad de pallets, que sube en P y baja en D. Restricciones **duras**:

- **Precedencia y mismo chofer:** P antes que D, en la misma ruta.
- **Capacidad:** la carga a bordo, que sube y baja a lo largo de la ruta, nunca pasa de la del camión. Se
  cuenta con los decimales tal cual. Así desaparece el concepto de «viaje» como algo que se decide aparte:
  **volver a una tienda a cargar es, sin más, otra parada P**. (Para pintarlo se sigue mostrando «viaje 1,
  viaje 2»: un viaje es el tramo entre dos momentos en que el camión va vacío.)
- **Turno:** la ruta empieza en la base del chofer a su hora de entrada y tiene que estar de vuelta antes de
  su hora de salida.
- **Ventana estrecha** (§4.6): no se llega tarde. Si no se puede, la orden queda **sin asignar, con motivo**.
- **Disponibilidad:** un chofer de vacaciones o baja ese día no entra (`driver_availability`, que ya existe).
- **Paradas fijadas o ya ejecutadas** (§2.6) no se mueven.

**Blandas**, con coste: llegar tarde a una ventana ancha (minutos × penalización, más alta si es builder),
esperar (llegar antes de que abra), minutos totales de conducción y servicio, y un término pequeño de
equilibrio entre choferes para deshacer empates.

**Objetivo, en orden estricto** (lexicográfico, no una suma donde todo se compensa con todo):
1. menos órdenes sin asignar, **los builders primero**;
2. menos minutos de retraso ponderados;
3. menos minutos totales de ruta;
4. reparto más parejo.

Que sea en orden estricto es lo que hace que la explicación sea honesta: «esta orden va con Máximo porque
con Julio llegaba 25 minutos tarde» es literalmente la comparación que hizo el algoritmo.

**Construcción — inserción más barata de pares, con arrepentimiento (regret-2).** Para cada orden sin colocar
se calcula su mejor posición (P e i, D en j ≥ i) en cada ruta y cuánto peor es su segunda mejor opción. Se
inserta primero la que **más perdería si espera**: builders y ventanas estrechas suben solas al principio, y
las órdenes fáciles llenan los huecos. Cada inserción guarda **qué alternativas había y cuánto costaban**:
eso es el «por qué» que se enseña después.

**Mejora — búsqueda local, siempre moviendo el par entero:**
- *recolocar par* (a otra posición o a otro chofer),
- *intercambiar pares* entre dos choferes,
- *or-opt* y *2-opt* dentro de una ruta, descartando los movimientos que rompen precedencia o capacidad.

Se aplica el primer movimiento que mejora, en un orden fijo, hasta que ninguno mejora o se agota el tope de
iteraciones. Si el tamaño creciera, el siguiente escalón es «destruir y reparar» (LNS) sobre el mismo
esqueleto; hoy no hace falta.

**Evaluación — una sola función, `evaluaPlan`.** Dada una secuencia, propaga el reloj (salida de la base →
viaje → espera si llega antes → servicio → siguiente), lleva la carga a bordo, y devuelve ETA, salida, espera,
retraso y carga **por parada**, más las violaciones. **Es la misma función** que usa el motor para decidir,
la pantalla cuando el despachador mueve una parada a mano, y la comparación cuando se puntúa la hoja manual.
Una sola fuente: si dos números no coinciden, es un bug y no una diferencia de criterio.

**Tiempos de servicio: los de hoy** (respuesta 7 del dueño; D-024, `DECISIONS.md:18526`). En la entrega, los
minutos de `delivery_duration` (pallets × `settings.delivery_min_per_pallet`), **15 por defecto**
(`trip-timing.ts:11`). En la recogida, los de `pickup_duration` (pallets × `settings.pickup_min_per_pallet`),
que hoy **se calculan y no entran en ningún plan**. Queda una pregunta abierta sobre los 20 minutos de
recarga (§9, pregunta 7).

### 2.4 Determinismo

- **Sin azar:** ni `Math.random`, ni orden de iteración de un `Map` sin fijar.
- **Empates resueltos por una clave estable:** `order_code`, y luego `id`. Choferes, por nombre.
- **Se corta por número de iteraciones, nunca por tiempo de reloj:** un límite de tiempo hace que la
  respuesta dependa de lo rápida que sea la máquina.
- **La matriz de tiempos es parte de la entrada, y se guarda con el plan.** Si Google contesta otra cosa
  mañana, el plan de hoy sigue siendo reproducible byte a byte.
- **El plan guarda la versión del algoritmo y sus parámetros.** Cambiar una penalización es una versión nueva.
- Prueba: la misma entrada dos veces, y barajando el orden de las órdenes de entrada → el mismo plan.

### 2.5 Límite de cómputo

Tope de **iteraciones** (no de segundos) calibrado para que 60 órdenes y 10 choferes terminen en menos de
**2 segundos** en la máquina de CI; a 14 órdenes son milisegundos. Una prueba de estrés lo fija para que una
regresión de rendimiento rompa el CI. El motor corre en el servidor, en una ruta de Next con runtime `nodejs`
como las demás de mapas; el cuello de botella real no es el cómputo sino la matriz de tiempos (§3), que por
eso va cacheada. Si el tope se agota se devuelve **la mejor solución encontrada, marcada como «no
convergió»**: nunca un error, y nunca en silencio.

### 2.6 Reoptimizar con paradas fijas o ya ejecutadas

Tres clases de parada, y el motor solo toca la tercera:

| Clase | Qué es | Qué hace el motor |
|---|---|---|
| **Ejecutada** | la orden ya está `picked_up` (su P ocurrió) o `delivered` (las dos) | Intocable. Una orden recogida **se queda con ese chofer**: la carga va en su camión (y es lo que ya dice D-017). Su D pendiente se puede reordenar dentro de esa ruta, no cambiar de chofer |
| **Fijada** | el despachador le puso el candado, o la movió a mano | Conserva chofer y posición relativa. El motor coloca lo demás alrededor |
| **Libre** | el resto | Se planifica |

- **Desde dónde se reoptimiza a mitad del día:** desde la última parada ejecutada de cada chofer y su hora
  real. **No desde el GPS en vivo**: el rastreo solo corre en turno, solo desde el APK y con huecos declarados
  (D-009 `:18125`, D-034 `:18967`, D-036 `:19066`). Planificar sobre una posición que el sistema dice no tener
  sería inventarla.
- **Una orden nueva a mitad del día:** inserción más barata del par sobre el plan vigente, sin mover lo
  demás: el «best fit» de OptimoRoute y Routific. El resultado es un **borrador nuevo**, que se publica o no.
- Nada se reoptimiza solo. **Siempre lo pide una persona** (§4.2).

### 2.7 Explicabilidad

Cada parada del plan guarda su motivo, en datos y no en prosa (la pantalla lo traduce a los dos idiomas):

- **Por qué este chofer:** el coste con él, y el de la mejor alternativa con otro — «con Julio, +25 min de
  ruta y 10 min tarde».
- **Por qué en esta posición:** qué restricción la ata (ventana, precedencia, capacidad).
- **Cuánto costaría moverla:** el despachador arrastra y ve el delta antes de soltar.
- **Por qué quedó sin asignar**, con un vocabulario cerrado, tomado de los códigos de Google:
  `sin_punto` (la orden no tiene pin) · `supera_capacidad` (más pallets que el camión mayor) ·
  `ventana_imposible` · `fuera_de_turno` · `sin_chofer_disponible` · `sin_tienda_de_origen`.

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

D-296 fija cinco ventanas, obligatorias, y una elegida a mano no se pisa. **El motor no las cambia, no crea
otras y no «ajusta» una ventana para que le cuadre la ruta.** Lo que el dueño llama «ventana estrecha» se
resuelve con una **regla sobre las que ya existen**:

> **Estrecha = dura dos horas o menos.**

Con los cinco slots de hoy, solo `0830-1000` (1 h 30) es estrecha. Medido en 90 días: 20 de 160 órdenes.
Las otras cuatro duran 3 h 30 o más.

| | Estrecha (≤ 2 h) | Ancha |
|---|---|---|
| Llegar tarde | **No se permite.** Si no cabe, sin asignar con `ventana_imposible` | Se permite, con coste alto y aviso en rojo |
| En el reparto | Se colocan primero | Rellenan |

La regla no necesita migración ni formulario nuevo: la ventana ya es un texto `"HHMM-HHMM"`
(`dispatch.ts:25`). El umbral es un parámetro del plan. **Es una propuesta: el número lo pone el dueño** (§9,
pregunta 5). Un detalle que el motor hereda y conviene saber: `parseWindow` solo lee el **primer** rango
aunque `fmtWindows` admita varios separados por coma (`dispatch.ts:27`, `utils.ts:203`).

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
- **La capacidad de hoy** (`settings.driver_capacity`, nombre → pallets; medido: `{"Maximo Garza": 10}`) se
  **copia** a `driver_settings` al crearla, casando por nombre. Mientras existan las dos, el Gestor lee
  primero `driver_settings` y, si falta, la de Ajustes. La de Ajustes se retira en un incremento posterior,
  cuando nada la lea.
- **Lo que NO se arregla aquí, a propósito:** renombrar a una persona sigue rompiendo su visibilidad, porque
  la RLS compara por nombre. Pasar `assigned_driver` a `uuid` es la migración más delicada de la app (toca la
  política de lectura de `deliveries`) y **no hace falta para este motor**. Queda anotada como deuda, con su
  propio plan en papel el día que se haga.

RLS: leen admin, gerente, office, logística y almacén; escriben admin y logística.

### 6.2 `deliveries.customer_type` — builder o mostrador, por orden

- Columna `customer_type text`, `check in ('builder','counter_sale')`, **admite null**.
- El dueño: «se marca en cada orden», con la cuenta como valor por defecto. El valor por defecto vive en
  `AccountRecord.customer_type`, dentro del JSON de `settings.accounts` — **sin migración SQL**, como
  `intertienda` y `requires_approval`.
- En el formulario, un selector Builder / Mostrador, solo en los tipos que van a un cliente. Una Intertienda
  no es ni lo uno ni lo otro.
- **El hueco, medido:** 48 de 82 órdenes Customer de los últimos 90 días **no tienen cuenta**, y solo hay 4
  cuentas guardadas. El valor por defecto no va a cubrir casi nada: esas órdenes nacen con `null`. Qué hace
  el motor con un `null` es la pregunta 6 de §9. **Propuesta: tratarlo como mostrador** —prioridad normal—,
  porque subirle la prioridad a quien nadie marcó como builder es justo lo contrario de priorizar.

### 6.3 Las tablas de plan — el hueco que condiciona todo lo demás

**`route_plans`** — una fila por corrida o por hoja importada.

| Columna | Nota |
|---|---|
| `id`, `plan_date date` | |
| `status` | `draft` · `published` · `superseded` · `discarded`. **Un solo `published` por fecha**: publicar otro pasa el anterior a `superseded` |
| `version int` | 1, 2, 3… dentro de la fecha |
| `source` | `engine` · `manual_edit` (un borrador tocado a mano) · `manual_import` (la hoja del despachador) |
| `algorithm_version text` | |
| `params jsonb` | penalizaciones, umbral de ventana estrecha, topes |
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
| **1** | **Datos del chofer y tipo de cliente.** `driver_settings`, su pantalla en Ajustes; `customer_type` en la orden y en la cuenta | sí (2) | Ajustes y el formulario de orden. El Gestor, igual |
| **2** | **El núcleo puro.** `planifica` y `evaluaPlan` en `src/lib/routing/`, sin red, sin base, sin pantalla. Pruebas: precedencia; capacidad excedida; pallets decimales; ventana imposible; sin chofer disponible; bases distintas; día sin órdenes; una sola orden; builder antes que mostrador; paradas fijadas y ejecutadas; **determinismo** (misma entrada dos veces, y entrada barajada); **estrés** (60 órdenes, 10 choferes, bajo el tope); y **mutantes leídos por nombre** | no | Nada |
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

- **Entrada:** el CSV o XLSX de la hoja, **subido o pegado** en la pantalla. Se lee **en el navegador**
  (`exceljs` ya está en el repo, `package.json:24`). **No se guarda el fichero, ni en el repo ni en Storage**;
  de la hoja solo queda el plan resultante, que referencia órdenes que ya están en la base. Ningún dato del
  dueño entra en el repo ni en las pruebas, que usan hojas inventadas.
- **Lo que sé del formato**, por lo que transmitió el orquestador: la columna rotulada **«Pickup Address» es
  en realidad el número de carga**: empieza en 0, **se reinicia por chofer**, y **números repetidos son la
  misma parada física**. **No he visto la hoja ni la lista completa de columnas**, así que el mapa de columnas
  no se diseña aquí a ciegas: el importador enseñará las cabeceras que encuentra y dejará elegir cuál es el
  chofer, cuál la carga, cuál identifica la orden; y se recordará la elección. Hace falta una hoja de ejemplo
  (§9, pregunta 9).
- **Casar filas con órdenes:** por factura, PO, SO o código de orden, los que traiga la fila. Lo que no casa
  se enseña **sin casar**; no se adivina. La hoja puede llevar órdenes que no están en la app (el orquestador
  ya avisó de que puede traer más): esas se listan aparte y **no se puntúan**, porque no tienen puntos ni
  pallets.
- **La secuencia manual:** por chofer, por número de carga ascendente y, dentro, por orden de fila. Filas con
  el mismo número = una sola parada física con varias órdenes.
- **Puntuar con el MISMO modelo:** esa secuencia pasa por `evaluaPlan` —sin optimizar nada— con la misma
  matriz, los mismos tiempos de servicio, las mismas ventanas y capacidades. Se guarda como un `route_plans`
  con `source = manual_import`. Así los dos planes son comparables número a número, y la ruta manual también
  enseña **sus** violaciones: si el despachador carga 11 pallets en un camión de 10, se ve.
- **Lado a lado:** por chofer y en total — minutos, millas, minutos tarde, paradas tarde, órdenes fuera. Y
  por orden: **mismo chofer o no, misma posición o no.**
- **Explicar cada diferencia:** para cada orden que el motor puso distinto, **cuánto cuesta ponerla como en
  la hoja** (el mismo «cuánto costaría moverla» de §2.7). Tres respuestas posibles, y las tres son útiles:
  - *«como en la hoja, +18 min»* — el motor gana, y dice cuánto;
  - *«como en la hoja, −6 min»* — **el despachador gana**: es un fallo del motor, o algo que el despachador
    sabe y el modelo no (una calle, un cliente que nunca está por la mañana). Es la señal de §2.2;
  - *«como en la hoja rompe una ventana»* — la diferencia es una restricción, no un gusto.

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
  que tres roles ven al entrar, así que va a §9 (pregunta 10).

---

## 9. Preguntas abiertas para el dueño

1. **Base de cada chofer.** ¿De qué tienda sale y a cuál vuelve Ernesto Castillo, Julio Jijon, Maximo Garza y
   Steven? (Medido: Maximo figura hoy en RDZ Brownsville.) ¿Vuelven siempre a su base al terminar?
2. **Capacidad de cada camión**, en pallets. (Hoy solo consta Maximo Garza = 10; el resto, 12 por defecto.)
3. **¿Steven rutea?** En 90 días no tiene ninguna orden asignada. ¿El motor puede darle trabajo o queda fuera?
4. **Turno de cada chofer:** hora de entrada y de salida. ¿Hay comida o descanso que el plan deba respetar?
5. **Ventana «estrecha».** Propuesta: **la que dura 2 horas o menos** — hoy, solo 08:30-10:00. A esas no se
   llega tarde nunca; a las demás se puede, con aviso en rojo. ¿Es eso, o piensa en otra cosa (una hora exacta
   prometida al cliente)?
6. **Órdenes sin cuenta.** 48 de las 82 órdenes a cliente de 90 días no tienen cuenta, así que nacerán sin
   marcar como builder ni mostrador. Propuesta: tratarlas como **mostrador** (prioridad normal). ¿De acuerdo,
   o prefiere que el formulario **obligue** a marcarlo?
7. **Los 20 minutos de recarga** (D-024). Con recogidas como paradas, propuesta: en cada visita a una tienda,
   **lo mayor** entre 20 minutos y la suma de los minutos de carga de lo que se recoge ahí. ¿O 20 fijos más
   los minutos por pallet?
8. **Una orden más grande que el camión.** Usted dijo que se parte en viajes. ¿La parte **el motor** (dos
   cargas a/b del mismo chofer, como las cargas partidas que ya existen) o **almacén antes**, a mano?
9. **Una hoja de ejemplo** del despachador, de un día real, para fijar el mapa de columnas del importador. No
   se guarda en el repo.
10. **La factura dos veces en la tabla** (§8.3): ¿quitamos la columna «Factura #» de las que ventas, chofer y
    almacén ven por defecto, ya que `#` la enseña siempre?
11. **¿Almacén ve los borradores, o solo la ruta publicada?** Propuesta: solo la publicada.
12. **Publicar, ¿quién?** Propuesta: admin y logística. ¿También gerente y office?

---

## 10. Lo no verificado

- **Nada de esto se ha ejecutado.** Es un diseño: los milisegundos de §2.2 y los 2 segundos de §2.5 son
  estimaciones sobre el tamaño del problema, que el incremento 2 convierte en una prueba.
- **Los precios y límites de Google** son los de la investigación (2026-09-18), que avisa de que no contrastó
  ninguna cita byte a byte. Las cuentas de §5 son cálculo propio sobre esos precios.
- **El uso de Google que ya hace la app**, que comparte franja gratuita con el motor.
- **Si el tráfico en cascada mejora las ETAs** lo bastante como para justificarse: no hay tiempos reales con
  qué compararlo (§8.2). Por eso el incremento 3 lo deja como una capa que se puede apagar.
- **El formato de la hoja del despachador:** solo conozco lo que dijo el orquestador de una columna.
- **El plan de Vercel** y, con él, el tiempo máximo de una función. No condiciona el diseño —el cómputo son
  milisegundos y la cascada se puede trocear—, pero está sin mirar.
- **Por qué `pickup_gps_at` y `pod_delivered_at` están en 36 y 22 de 109.**
- **Las líneas de `DECISIONS.md`** son las de 662611f y se moverán cuando se arregle el duplicado. Los números
  de decisión, no.
