# Bitácora de decisiones — RDZ · Deliveries

> **Qué es esto.** Cada cambio de comportamiento del sistema, con **el porqué**.
> No es un changelog de código (para eso está `git log`): es el registro de las
> decisiones de negocio y del razonamiento detrás de ellas.

## Cómo usarlo

**Para el equipo:** antes de pedir un cambio, busca aquí si el tema ya se
decidió. Si vas a revertir algo, escribe por qué cambió la situación — eso es
lo que evita dar vueltas en círculo.

**Para Claude (el asistente):** lee este archivo antes de cambiar comportamiento.
Si una petición contradice una decisión registrada, **dilo antes de
implementarla** y cita la entrada: *"esto revierte D-012, que se decidió porque
X — ¿cambió esa razón?"*. No la bloquees; el negocio cambia y las decisiones
caducan. Pero que sea una decisión consciente, no un olvido.

## Formato

Cada entrada lleva un id (`D-001`), la fecha, la versión donde entró, quién lo
pidió, **el porqué**, y las consecuencias que se aceptaron a cambio.

El campo **Razón** debe venir de quien pidió el cambio. Donde diga
`⚠️ RAZÓN PENDIENTE`, hay que llenarlo — una decisión sin porqué es la que
alguien revierte por accidente seis meses después.

---

## D-001 · Los choferes no pueden crear órdenes
**Fecha:** 2026-08-11 · **Versión:** v0.9.64 · **Pedido por:** Andrés

**Cambio:** Se quitó la capacidad de crear órdenes al rol Chofer.

**Razón (textual):** *"¿Pueden los choferes agregar entregas si nadie las
programó? No, el gerente de logística se encargará de que todos hagan bien su
trabajo."*

**Consecuencia aceptada:** si un cliente pide algo en ruta, el chofer tiene que
llamar a oficina en vez de registrarlo él. Se prefiere eso a que entren órdenes
sin pasar por planeación.

---

## D-002 · El recargo por entrega el mismo día queda en $0
**Fecha:** 2026-08-11 · **Versión:** v0.9.63 · **Pedido por:** Andrés

**Cambio:** La función existe y es configurable en Ajustes, pero el monto queda
en 0 (apagada). Se probó con $35 y se revirtió.

**Razón (textual):** *"no no, eso del mismo día bórralo o déjalo en 0 para
configurarlo más adelante."*

**Nota:** el código está completo y probado. Activarla es cambiar un número en
Ajustes, no volver a programar.

---

## D-003 · Registro de incidentes de choferes
**Fecha:** 2026-08-11 · **Versión:** v0.9.65 · **Pedido por:** Andrés

**Cambio:** El gerente de logística puede registrar incidentes con costo
estimado, ligados opcionalmente a una orden.

**Razón (textual):** *"el gerente de logística debería poder registrar si un
chofer hace algo que le cuesta dinero a la empresa… hoy el chofer tuvo mala
actitud y en vez de organizar su ruta salió a una entrega y tuvo que regresar
al mismo lugar para la siguiente, en vez de hacerlas juntas."*

**Alcance:** hoy solo lo ven logística y admin.

---

## D-004 · Cualquier orden se puede programar, aunque no esté lista
**Fecha:** 2026-08-12 · **Versión:** v0.9.68 · **Pedido por:** Andrés

**Cambio:** El Gestor de Rutas muestra órdenes pendientes y sin preparar, no
solo las aprobadas. Quedan fuera las entregadas, recogidas, canceladas y
rechazadas.

> **CORREGIDO (2026-08-17, v1.8.3).** Esto originalmente incluía los
> **borradores**, y estaba mal leído de mi parte. El dueño lo aclaró: *"sí los
> pedí, pero no los que están como draft, porque no están creados"*. Un
> borrador no se ha enviado — no es una orden todavía, y planear un camión
> alrededor de algo con lo que nadie se ha comprometido no es planear. Lo que
> sí se pedía era no tener que esperar al almacén: una orden pendiente o sin
> preparar sigue siendo programable.

**Razón (textual):** *"quiero que todas las órdenes se puedan asignar aunque no
estén listas, que se puedan programar en Routes Manager."*

**Consecuencia aceptada:** se puede planear una ruta con órdenes que el almacén
todavía no prepara. La columna Estado en el pool muestra en qué etapa va cada
una, para que el despachador sepa lo que está planeando.

**Efecto secundario que hubo que resolver:** la base de datos rechazaba que
logística editara órdenes no aprobadas (migración 042). Sin eso, reordenar una
parada se revertía sola.

---

## D-005 · Marcar entregadas en lote (solo admin)
**Fecha:** 2026-08-12 · **Versión:** v0.9.70 · **Pedido por:** Andrés

**Cambio:** El admin puede seleccionar varias órdenes y pasarlas todas a
Entregada, saltándose el flujo normal.

**Razón (textual):** *"porque apenas se está empezando a implementar el
sistema"* — hay órdenes que ya se entregaron en la vida real antes de que
existiera el sistema.

**Salvaguarda:** cada orden registra en su historial *"El administrador [nombre]
la marcó como entregada (cierre durante la implementación)"*. El cierre manual
nunca es silencioso.

**Revisar cuando:** termine la implementación inicial. Es una herramienta de
arranque, no de operación diaria.

---

## D-006 · "Pallets" en ambos idiomas
**Fecha:** 2026-08-12 · **Versión:** v0.9.72 · **Pedido por:** Andrés

**Cambio:** La interfaz en español dice "Pallets", no "Tarimas".

**Razón (textual):** *"cambia las palabras tarimas por pallets independiente del
idioma."*

---

## D-007 · Sin arrastrar en el Gestor de Rutas: solo flechas
**Fecha:** 2026-08-12 · **Versión:** v0.9.77 · **Pedido por:** Andrés

**Cambio:** Se eliminó arrastrar y soltar filas en la pestaña Rutas. Las paradas
se reordenan solo con las flechas ↑/↓.

**Razón (textual):** *"no ocupo arrastrar, elimina eso, solo con las flechas."*

**Contexto:** el arrastre además causaba un bug — al presionar una flecha, el
navegador iniciaba el arrastre de la fila en vez de registrar el clic.

---

## D-008 · Migración completa a Google Maps
**Fecha:** 2026-08-12 · **Versiones:** v0.9.84 – v0.9.91 · **Pedido por:** Andrés

**Cambio:** Rutas, distancias, tiempos, geocodificación y el mapa visual pasaron
de OpenStreetMap/OSRM a Google (Routes API + Maps JavaScript API).

**Razón (textual):** *"para que en el logistic manager view se calculen las
rutas correctamente, con tiempo y distancia reales en tiempo real, y también si
hay que hacer un desvío o un regreso por una highway que todo eso se tome en
cuenta tal cual como en Google Maps."*

**Resultado medido:** en un ciclo de 4 paradas del Valle, Google trazó
123.9 mi / 2h16m donde OSRM decía 122.3 mi / 2h31m — ruta más larga pero 15 min
más rápida, porque usa velocidades reales de autopista.

**Costo aceptado:** Routes API y Maps JS cobran por uso. Se mitigó con caché de
10 minutos para peticiones idénticas.

**Decisión técnica derivada:** se usan **dos llaves** de Google — una de
servidor (rutas, geocodificación) y otra de navegador restringida por dominio.
Reusar la de servidor en el navegador permitiría que alguien la robara y gastara
el presupuesto de rutas.

---

## D-009 · App Android para choferes con GPS en segundo plano
**Fecha:** 2026-08-12 · **Versiones:** v0.9.86 – v0.9.89 · **Pedido por:** Andrés

**Cambio:** APK (Capacitor) que carga el sitio en vivo y agrega rastreo GPS
mientras el chofer está en turno.

**Razón (textual):** *"quiero que hagamos una APK para que pueda llevarle el GPS
a los conductores… así puedo ver en tiempo real dónde están."*

**Alcance decidido:** rastreo **atado al turno** — arranca al marcar entrada,
para al marcar salida. Nunca fuera del horario laboral.

**Condiciones confirmadas por el negocio:** teléfonos propiedad de la empresa;
los choferes fueron informados y lo aceptaron.

**Consecuencia aceptada:** ningún blindaje es 100% (batería, señal, gestores
agresivos de Samsung/Xiaomi). Por eso el Gestor de Rutas avisa *"X chofer(es) no
están reportando"* — un camión se marca como no-reporta en vez de desaparecer
callado.

---

## D-010 · La app del chofer no menciona el rastreo
**Fecha:** 2026-08-12 · **Versión:** v0.9.93 · **Pedido por:** Andrés

**Cambio:** Se quitó el aviso *"Compartiendo tu ubicación"* de la tarjeta de
turno. Ahora solo muestra el reloj (En turno / Marcar salida).

**Razón (textual):** *"no quiero que los conductores sepan del tracking como
tal, ahora solo que aparezca como on the clock y clock out y ya."*

**Base:** ver D-009 — los choferes ya fueron informados y lo aceptaron por
escrito. Lo que se quitó es el recordatorio en pantalla, no el consentimiento.

**Límite técnico (no removible):** Android **obliga** a mostrar una notificación
permanente mientras corre el GPS en segundo plano, y dibuja su propio indicador
de ubicación en la barra de estado. Ninguna app puede suprimir eso. El chofer
seguirá viendo *"RDZ Deliveries — Turno en curso"* todo el turno.

---

## D-011 · Tarjetas colapsadas en celular
**Fecha:** 2026-08-12 · **Versiones:** v0.9.94 – v0.9.95 · **Pedido por:** Andrés

**Cambio:** En celular cada orden se pliega a una sola línea: ID · etapa · tipo ·
sigla de la tienda de origen. Se abre con el chevron.

**Razón (textual):** *"quiero que el tag Ready esté pegadito al ID en esa misma
fila, y todas las cargas colapsadas, y también el tipo y una etiqueta pequeña
con las siglas de la tienda de donde sale."*

**Consecuencia:** en computadora no cambia nada — ahí ya hay columnas de Etapa,
Tipo y Tienda.

**Refinamiento (2026-08-13, v1.0.4):** *"quiero que se pueda ver la fecha de
entrega ahí también, sin hacer más grande esa tarjeta; Customer lo puedes poner
solo como CUS y que esté al lado del ID."*

La fila quedó con cuatro datos en una sola línea:

```
ID  #FQ115 CUS        [Recogido]  Ago 13  [BRO]  ▸
```

El **tipo** se abrevia a tres letras (CUS / INT / TRA) y se mueve **junto al
ID**, porque dice lo que la orden **es** — a diferencia de la etapa y la fecha,
que dicen dónde **está**. La **fecha** se muestra sin año (la lista solo tiene
días alrededor de hoy) y **se pone roja si ya pasó**, que es lo único de esa
línea que un chofer no puede pasar por alto.

**Refinamiento (2026-08-13, v1.0.0):** *"que siempre al lado del tag de Listo
también esté el tag del tipo de orden que es."* El tipo se mostraba como texto
plano mientras la etapa y la tienda sí eran etiquetas — tres datos en una línea
solo se leen si los tres parecen etiquetas. Ahora es una píldora con contorno
(secundaria frente a la etapa, que va rellena) y se muestra **siempre**: si la
orden no tiene tipo, aparece "—" en vez de desaparecer, porque un tipo faltante
es algo que alguien tiene que llenar.

---

## D-012 · El checkbox solo para quien tiene acciones en lote
**Fecha:** 2026-08-12 · **Versión:** v0.9.95 · **Pedido por:** Andrés

**Cambio:** La columna de selección múltiple solo aparece para admin, gerente,
logística, contabilidad y ventas. Los choferes ya no la ven.

**Razón (textual):** *"el checkbox arriba del driver no lo ocupa, nadie lo
ocupa, eso es solo para admin para seleccionar varios al mismo tiempo."*

**Criterio aplicado:** un rol ve el checkbox solo si tiene al menos una acción en
la barra de lote. Un chofer podía seleccionar filas que ningún botón podía
procesar.

---

## D-013 · El costo de entrega queda en blanco hasta que alguien lo elija
**Fecha:** 2026-08-12 · **Versión:** v0.9.80 · **Pedido por:** Andrés

**Cambio:** El formulario ya no rellena solo el precio de Lista cuando se
calculan las millas. Queda vacío hasta que el vendedor elija Lista, Descuento, o
escriba un monto.

**Razón (textual):** *"que se quede en blanco el fee a menos que lo seleccione
el usuario."*

**Por qué importa:** el auto-llenado comprometía en silencio un precio que nadie
había acordado con el cliente.

---

## D-014 · Fechas en zona horaria fija del negocio
**Fecha:** 2026-08-12 · **Versión:** v0.9.75 · **Origen:** bug encontrado

**Cambio:** `todayISO`, `isOverdue`, `isToday` y `nowHHMM` calculan en
America/Chicago vía `Intl`, no con el reloj local del dispositivo.

**Razón:** el servidor (Vercel, UTC) y el navegador (Valle, Central) calculaban
"hoy" distinto por las tardes, lo que rompía la hidratación de React (errores
#418/#423/#425 en consola) y hacía que "hoy" dependiera del reloj del aparato.

**Regla derivada:** nunca usar `new Date().getDate()` ni `Date.now()` para
lógica de "hoy"/atrasado que se renderice. Usar los helpers de `lib/utils.ts`.

---

## D-015 · Auto-cancelar órdenes muy atrasadas: apagado
**Fecha:** anterior a esta bitácora · **Estado:** `AUTO_CANCEL_LATE_ENABLED = false`
**Razón registrada:** 2026-08-12 por Andrés

**Situación:** existe la automatización que cancela órdenes con más de 2 días de
atraso sin reprogramar, pero está desactivada.

**Razón (textual):** *"Se apagó porque está en producción la app iniciando y
esas órdenes no se cancelaron, sí se entregaron, solo que no se siguieron los
pasos en la app."*

**En claro:** durante el arranque hay órdenes que **sí se entregaron en la vida
real** pero quedaron atoradas en una etapa vieja porque nadie las movió en el
sistema. Para la automatización se ven idénticas a una orden abandonada. Si se
prendiera hoy, cancelaría entregas que de hecho se hicieron — y dejaría el
historial mintiendo.

**Relación:** misma causa raíz que D-005 (marcar entregadas en lote). Las dos
existen porque el trabajo real ocurrió antes de que el sistema lo registrara.

**Revisar cuando:** (1) se cierre el rezago con la herramienta de D-005, y
(2) el equipo lleve un tiempo siguiendo el flujo completo en la app. A partir de
ahí, una orden vieja y atorada sí significa abandonada, y la automatización
haría lo correcto. Antes de prenderla, revisar que no quede ninguna entrega real
en una etapa vieja.

---

## D-016 · Tres niveles de detalle en la tabla de paradas
**Fecha:** 2026-08-12 · **Versión:** v0.9.98 · **Pedido por:** Andrés

**Cambio:** En la tabla de paradas del Gestor de Rutas, el destino del toque
cambia según dónde caiga:

| Tocas | Pasa |
|---|---|
| El **ID** | Se abre la orden completa |
| La **fila** | El mapa aísla esa parada y dibuja su ruta recolección→entrega |
| **Fuera** (la tarjeta) | Vuelve a mostrar todas las paradas de ese chofer |

**Razón (textual):** *"haz que si toco el ID en la tabla ahí en viajes se abra
la orden para verla, y si toco el row me va a llevar en el mapa a ver esa orden
y la ruta, y si aprieto fuera me aparecen todas las de ese conductor."*

**Consecuencia aceptada:** las flechas ↑/↓ y el selector de viaje detienen el
clic — reordenar es una edición, no un "muéstrame", y no debe secuestrar el
mapa hacia esa parada.

**Relación:** se apoya en D-007 (sin arrastrar, solo flechas). Ahora que la fila
ya no se arrastra, el clic quedó libre para significar "enfocar en el mapa".

---

## D-017 · Quien recoge una orden sin chofer, queda como su chofer
**Fecha:** 2026-08-13 · **Versión:** v1.0.1 · **Origen:** bug reportado

**Cambio:** Si un chofer marca "Recogido" en una orden que no tiene chofer
asignado, la orden queda a su nombre automáticamente.

**Razón:** Andrés reportó que marcó una orden como recogida y *"en la web sí me
sale pero en la APK no me sale en Out for delivery"*. No era un fallo de la
APK: la orden (FQ115) estaba en `picked_up` con `assigned_driver` en nulo. La
vista del chofer solo muestra lo asignado a él, así que la orden **desapareció
de la cola de todos los choferes** justo cuando ya iba en el camión.

**Por qué así:** si alguien tiene físicamente la carga, es su entrega. Dejarla
sin dueño en reparto es el peor estado posible — nadie la ve y nadie responde
por ella.

**Consecuencia aceptada:** un chofer puede quedar asignado a una orden que
logística no le puso. Se prefiere eso a una orden en tránsito sin responsable.

**Pendiente relacionado:** la página de Órdenes (`/`) **no filtra por chofer** —
ahí un chofer ve todas las órdenes de la empresa, a diferencia de su propia
vista. Así fue como recogió una orden que no era suya. Falta decidir si eso se
restringe.

---

## D-018 · La vista del chofer: sin comprobante y un solo botón para recoger
**Fecha:** 2026-08-13 · **Versión:** v1.0.1 · **Pedido por:** Andrés

**Cambio:** Al abrir una orden como chofer se quitó el botón "Comprobante", y
recoger pasó de dos toques (Recoger → Confirmar carga) a **uno solo**.

**Razón (textual):** *"cuando abro la orden en el view de conductor, bórrame el
slip, y el pickup miro que son 2 botones, entonces solo deja 1 y que de un solo
se cambie a recogido."*

**Consecuencia aceptada:** el chofer ya no puede registrar una **carga parcial**
desde ese botón (llevarse 3 de 5 pallets y dividir el resto). Toma la carga
completa tal como está contada. La oficina conserva el flujo de dos pasos, que
es donde dividir una carga tiene sentido.

**Detalle:** si la orden no trae conteo de pallets, se marca recogida sin
escribir un 0 encima — un número que la oficina no llenó no debe convertirse en
un número equivocado desde el camión.

**Añadidos (v1.0.2 / v1.0.3):**
- El comprobante también se quitó de la pantalla posterior a la entrega, que la
  primera pasada dejó fuera. "Listo" quedó como botón principal.
- *"Si dice sin teléfono de cliente, hazlo como los demás, como un bubble para
  que no se mire así de feo."* Era texto gris suelto entre botones; ahora es una
  píldora de la misma forma pero con borde punteado y sin cursor de clic —
  mantiene la fila pareja sin fingir que se puede presionar.
- **Bloqueo de entrega visible:** `require_pod` está activo, así que entregar
  exige firma o foto. El botón solo revisaba el nombre de quien recibió, así que
  se podía presionar y ser rechazado con un aviso fácil de perder — se sentía
  como un botón muerto (reportado con FQ105). Ahora la condición se calcula una
  vez y controla tanto el aviso en pantalla como el botón deshabilitado.

---

## D-019 · El chofer ve la factura, no el código de orden
**Fecha:** 2026-08-13 · **Versión:** v1.0.5 · **Pedido por:** Andrés

**Cambio:** En las listas que ve un **chofer**, la primera columna muestra el
**número de factura** en lugar del código de orden (`#FQ115`). El encabezado
también cambia a "Factura #".

**Razón (textual):** *"en driver view, el ID sustitúyelo por el invoice
number."*

**Por qué tiene sentido:** el chofer trae papeles en la mano y los coteja por
factura; el código de orden es del sistema, no de la calle.

**Va por rol, no por pantalla:** sigue al *usuario*, así que aplica igual en su
vista de Chofer y en el tablero de Órdenes. Los demás roles no cambian.

**Casos cubiertos:**
- **Sin factura:** cae al código de orden. Hoy ninguna orden en ruta llega sin
  factura (verificado: 0 de las que están listas o recogidas), pero 8 de 41 en
  total no la traen — mejor eso que una fila en blanco.
- **Varias facturas:** hay órdenes con `177987, 177986`. El texto se recorta con
  puntos suspensivos en vez de empujar las etiquetas fuera de la pantalla; el
  valor completo sigue disponible al mantener presionado.

---

## D-020 · Ventas, almacén y chofer ven 2 días atrás hasta mañana
**Fecha:** 2026-08-13 · **Versión:** v1.0.6 · **Pedido por:** Andrés

**Cambio:** Las tres vistas operativas (Ventas, Almacén, Chofer) muestran una
ventana de cuatro días: **dos días atrás hasta mañana**. Los roles de oficina
(admin, gerente, logística, contabilidad) no tienen filtro y ven todo.

**Razón (textual):** *"recuerda, sales, warehouse y driver solo pueden ver
órdenes de 2 días atrás y el día siguiente."*

**Qué cambió respecto a antes:**
- **Hacia adelante:** antes veían **cualquier** fecha futura; ahora se corta en
  mañana. Este es el cambio de fondo.
- **Hacia atrás:** antes eran 2 días para órdenes abiertas pero solo 1 para
  entregadas/canceladas. Ahora son 2 parejo — la ventana habla de *cuándo*, no
  del estado.

**Escapes deliberados:**
- Las órdenes **sin fecha** siempre se ven — están en proceso de programarse, y
  esconder una que nadie ha fechado la dejaría varada.
- **Buscar por factura** atraviesa la ventana en las tres pantallas.
- **Reprogramar** una orden atrasada hacia dentro de la ventana la regresa.

**⚠️ Riesgo que conviene vigilar:** un vendedor que cree una orden para dentro
de una semana **dejará de verla en su lista** hasta que falte un día. Si no
tiene factura todavía, tampoco podrá encontrarla buscando. Si eso estorba en la
práctica, la salida más simple es ampliar solo el futuro para Ventas
(`RETENTION_DAYS_AHEAD`) sin tocar almacén ni choferes.

---

## D-021 · "Mi ruta": el chofer ve el plan, sin poder cambiarlo
**Fecha:** 2026-08-13 · **Versión:** v1.1.1 · **Pedido por:** Andrés

**Cambio:** Pestaña nueva **🧭 Mi ruta** para el chofer, con el orden y los
viajes que planeó logística. Puede ver y completar parada por parada; **no**
puede reordenar, reasignar ni optimizar.

**Razón (textual):** *"haz una separate view para el driver, así como el
logistic manager pone los viajes y las órdenes, así quiero que se le aparezca al
driver para que él sepa el orden y la ruta, pero obviamente solo es para ver, no
puede hacer lo mismo que el logistic manager, pero ahí él puede completar orden
por orden."*

**Cómo se diseñó, y por qué así:** no es la pantalla del despachador con los
botones quitados. Un despachador acomoda una flota entera sentado en un
escritorio; un chofer está en la cabina con **una pregunta a la vez**. Por eso
el orden de la pantalla es:

1. **Progreso** — "3 de 7 entregadas". Es lo que un chofer se pregunta todo el día.
2. **La siguiente parada**, en su propia tarjeta con Navegar y Recoger/Entregar.
   Todo lo demás es contexto; esto es lo único que hay que hacer ahora.
3. **El mapa** con pines numerados: verde lo hecho, naranja el siguiente, gris
   lo que falta — más su propia posición, para ubicarse contra el plan.
4. **El día completo** agrupado en los mismos viajes que armó logística, para
   poder planear con anticipación.

**Consistencia:** usa el mismo agrupamiento de viajes que el despachador, así
que "Viaje 2" significa lo mismo para los dos. Y el orden ya venía respetando
la secuencia optimizada (`routeOrder` usa `route_seq`), así que las dos
pantallas nunca se contradicen.

**Lo que a propósito NO hacía:** dibujar la ruta trazada por carretera, por el
costo de una llamada a Google por chofer cada vez que abriera la pantalla.

**Revisado (2026-08-13, v1.2.1):** *"cuando él presione por ejemplo Truckload 1,
automáticamente le salga la ruta en el mapa, y tiempo y distancia, y hacer eso
por truckload."* Se agregó, **bajo demanda**: nada se consulta hasta que el
chofer toca un viaje, y el resultado se guarda para el resto de la sesión. Así
se conserva la razón original (no gastar en llamadas que nadie pidió) y se
obtiene lo que se necesitaba.

**Un detalle que casi rompe el propósito de esta pantalla:** el endpoint de
rutas **reordena** las paradas — para eso existe. Usarlo tal cual le habría
dibujado al chofer **una secuencia distinta a la que está siguiendo**. Se
agregó `optimize: false` para trazar el camino **respetando el orden asignado**.
Medido en una ruta real del Valle: la secuencia optimizada da 123.9 mi / 2h16m,
mientras que la asignada da 161.1 mi / 2h50m — dibujar la primera habría sido
mentirle al chofer sobre su propio día.

---

## D-022 · La firma del cliente se puede apagar
**Fecha:** 2026-08-13 · **Versión:** v1.1.2 · **Pedido por:** Andrés

**Cambio:** Ajustes → Comprobante de entrega tiene un interruptor nuevo:
**"Pedir la firma del cliente"**. Encendido por omisión.

**Razón (textual):** *"have customer signature enable and disable in setting."*

**Cómo se relaciona con lo que ya existía:** el comprobante de entrega tiene dos
mitades — la firma y las fotos del material. `require_pod` dice si se exige
**algún** comprobante; este ajuste dice si la firma **se ofrece siquiera**.

**Interacción que se hizo explícita:** con la firma apagada **y** el comprobante
requerido, la única forma de entregar es con **foto del material**. Los Ajustes
lo advierten en pantalla, y el mensaje que ve el chofer cambia a "Se requiere
una foto del material" en vez de ofrecerle una opción que ya no tiene.

**Lo que se sigue registrando con la firma apagada:** quién recibió, la hora, y
la ubicación GPS de la entrega.

**Detalle técnico:** la validación vivía duplicada (una para deshabilitar el
botón, otra al guardar). Se unificó en una sola, porque dos copias de la misma
regla terminan divergiendo y dejan un botón que se presiona y no hace nada.

---

## D-023 · Las entregas sobreviven a las zonas sin señal
**Fecha:** 2026-08-13 · **Versión:** v1.2.0 · **Origen:** riesgo detectado

**Cambio:** Si un chofer marca **Recogido** o **Entregado** y no hay señal, la
acción se guarda **en el teléfono** y se envía sola cuando vuelve la conexión.
Mientras tanto la orden se ve como completada, para que no la haga dos veces.

**Razón:** hasta ahora, una entrega marcada en una zona muerta **se perdía**: la
escritura fallaba, salía un aviso rojo, y si el chofer ya había arrancado el
trabajo desaparecía. En el Valle con entregas rurales eso no es hipotético.

**Alcance deliberadamente angosto:** solo se encolan los hitos del chofer
(recogido / entregado). Todo lo demás sigue fallando de frente — un vendedor
editando una orden o un admin cambiando ajustes ve el error y reintenta; un
chofer parado en la puerta de un cliente no puede.

**Distinción clave:** solo se encola una falla de **red**. Un rechazo del
servidor (sin permiso, transición ilegal) **no** se encola, porque reintentarlo
jamás funcionaría y escondería un problema real detrás de un envío eterno.

**Cuándo se reenvía:** al recuperar conexión, al volver a la app, y cada minuto
como respaldo para señal intermitente que nunca dispara un evento limpio.

**Lo que ve el chofer:** una barra que dice cuántas entregas están guardadas y
que se enviarán solas. El aviso viejo de "sin conexión" ya **prometía** que los
cambios se guardaban localmente — no era cierto hasta ahora.

---

## D-024 · Cada viaje muestra su costo real, descarga incluida

**Fecha:** 2026-08-13 · **Versión:** v1.2.2 · **Pedido por:** Andrés

**Cambio:** en Routes Manager, cada viaje muestra sus propias millas y su tiempo,
desglosado en manejo + descarga, con hora de salida y de regreso al punto de
carga. La fila se pinta verde claro conforme cada parada se va entregando, y el
encabezado del viaje lleva un contador (3/5 entregadas → ✓ viaje entregado).

**Razón:** *"quiero que se mire por viaje distance y time tomando en cuenta que
cada viaje tiene stops y el tiempo de descarga ya programado, también quiero que
vaya apareciendo como con un light green la row a medida este se vaya
entregando."*

**Lo que destapó:** el total por chofer contaba **solo tiempo al volante**, y la
alerta de "más de 8 h" se medía contra ese número. Pero la descarga ya estaba
programada en cada orden (`delivery_duration`) y no se estaba sumando en ningún
lado. Un día de 6 h de manejo con ocho paradas de 30 min son casi 10 h reales y
el sistema lo daba por bueno. La alerta ahora se mide contra la **jornada
completa** — manejo + descarga + recarga entre viajes — así que empezará a
marcar rutas que antes pasaban calladas. Eso no es un falso positivo: es lo que
llevaba tiempo sin verse.

**Consecuencia aceptada:** una parada sin duración escrita cuenta 15 min por
omisión, y un "0" también, porque una parada nunca es instantánea; si la oficina
quiere el número exacto tiene que capturarlo. La recarga entre viajes (20 min)
sale solo en el total del día, no dentro de ningún viaje, porque no pertenece a
ninguno. Los números por viaje se borran al reordenar o mover cargas, en vez de
quedarse pegados al viaje equivocado.

**Revisar cuando:** si la jornada estimada se aleja seguido de la real, el
problema está en `delivery_duration`, no en el cálculo — ahí conviene medir
descargas reales y ajustar el default de 15 min.

---

## D-025 · Las paradas cercanas viajan juntas (agrupación por zona)

**Fecha:** 2026-08-13 · **Versión:** v1.3.0 · **Pedido por:** Andrés

**Cambio:** "Optimizar ruta" ahora decide **qué paradas comparten camión**, no
solo el orden dentro de cada viaje. La agrupación usa Clarke–Wright (el
heurístico estándar de ruteo con capacidad desde un depósito) más un pase
or-opt que reubica paradas sueltas mientras eso acorte el plan.

**Razón:** *"hay una ruta que hay 2 entregas bien cerca y que pueden ir en el
mismo viaje y el sistema de optimizar no lo mandó ahí."*

**La causa:** el repartidor viejo (`splitIntoTrips`) recorría la lista **en el
orden que traía** y cortaba un viaje nuevo cada vez que la suma de pallets
llegaba a la capacidad. La geografía **nunca entraba en la decisión**. Dos
entregas de la misma cuadra caían en camiones distintos solo porque el corte de
capacidad quedó entre ellas — y optimizar después no lo puede arreglar, porque
el ruteador solo reordena paradas **dentro** del viaje que se le entregó.

**Medido en el tablero real** (Maximo Garza, 2026-08-12, 7 paradas, 12 pallets
de capacidad): 321 mi → 218 mi en línea recta, **32% menos**. La agrupación
vieja mandaba una parada de McAllen colgada de un viaje a Brownsville, en dos
viajes distintos.

**División del trabajo:** aquí se decide *quién viaja con quién* (Google no
puede: no conoce la capacidad del camión); Google decide *el orden dentro de
cada camión* con tráfico real. Las distancias de la agrupación son en línea
recta a propósito — esta etapa solo necesita saber qué paradas están **cerca**,
y pedirle a Google una matriz completa costaría una llamada por cada par.

**Consecuencia aceptada:** una agrupación hecha **por una persona** se respeta y
no se reagrupa (columna nueva `load_auto`, migración 045). Sin esa distinción el
optimizador tenía que elegir entre pisar las divisiones deliberadas del
despachador o no reagrupar nunca, y ninguna de las dos sirve. Los viajes que ya
existían quedan marcados como deliberados, que es lo conservador; para soltarlos
está el botón **"Reagrupar por zona"**, que aparece solo cuando hay viajes
fijados.

**Revisar cuando:** si aparecen restricciones de ventana horaria duras (un
cliente que solo recibe de 8 a 10), la agrupación tendrá que considerarlas —
hoy solo considera capacidad y distancia, y las ventanas se revisan después,
cuando el tablero marca las paradas que llegan tarde.

---

## D-026 · La firma nace apagada, y entregar es un toque

**Fecha:** 2026-08-13 · **Versión:** v1.3.1 · **Pedido por:** Andrés

**Cambio:** (a) la satisfacción del cliente ya no aparece en la vista del
chofer; (b) la firma del cliente queda **apagada por omisión** (migración 046);
(c) cuando no hay nada que capturar, "Entregar" marca la entrega **de un solo
toque** y muestra la pantalla de entregado, sin formulario de por medio.

**Razón:** *"en la vista de conductor elimina ese customer satisfaction"* y
*"por default que quede inactivo la firma, entonces al darle delivered de un
solo el popup de delivered."*

**Por qué la calificación no es del chofer:** puntuar la felicidad del cliente
es una lectura de la oficina, no algo que se le pide a un chofer parado en la
puerta. Ventas tampoco la ve; eso ya era así.

**Cuándo NO es un toque:** si la firma está encendida, o si la oficina exige
comprobante (`require_pod`) y la orden todavía no trae foto, el formulario se
abre igual y dice qué falta. Un toque nunca vale saltarse la evidencia que la
oficina pidió. Con `require_pod` encendido —como está hoy— el toque único
aplica a las órdenes que ya traen foto; para que aplique siempre hay que apagar
"requerir comprobante" en Ajustes, y esa es una decisión de negocio, no mía.

**Consecuencia aceptada:** en una entrega de un toque **no se captura quién
recibió**. Se guarda como nulo (no como texto vacío) y la bitácora dice
"Entregado" en vez de inventar un nombre. La hora, el GPS y el chofer siguen
quedando registrados. Si un cliente reclama "yo no recibí eso", ese nombre es
justamente lo que haría falta — por eso la firma sigue siendo un interruptor en
Ajustes y no se eliminó.

**Revisar cuando:** si aparecen disputas de entrega, lo primero que hay que
volver a encender es la firma.

---

## D-027 · Un latido, para poder distinguir "estacionado" de "muerto"

**Fecha:** 2026-08-14 · **Versión:** v1.3.2 · **Pedido por:** Andrés (diagnóstico)

**Cambio:** (a) el teléfono reporta su posición **al menos cada 5 minutos**
aunque el camión no se mueva; (b) cada reporte incluye el **nivel de batería**;
(c) la app detecta y ofrece apagar la **hibernación de Android** ("Pausar la
actividad de la app si no se usa"), que es un ajuste distinto al de batería.

**Razón:** *"en la app del conductor autorizo el permiso y lo de la batería
pero aun así se le pausó la app, puedes ver qué pasó."*

**Lo que los datos sí mostraban:** el rastreo solo corre en turno, por diseño.
El hueco de 32 horas cae fuera de todo turno, así que ese no es el problema. En
el turno abierto hubo 5 posiciones en 67 minutos, con velocidades de 0 a 1.3
m/s — el teléfono estuvo prácticamente quieto, y con el filtro de 40 m un
teléfono quieto **no debe** reportar. Es decir: **los datos no alcanzan para
probar que se pausó, ni para descartarlo.**

**Ese es el verdadero hallazgo.** Un camión estacionado y una app muerta se ven
**idénticos**: los dos son silencio. Por eso no se podía responder la pregunta,
y por eso la bandera de "no reporta" del despachador (15 min) se disparaba con
choferes que solo estaban descargando.

> **CORRECCIÓN (2026-08-14, v1.3.7).** Aquí decía que "si falta el latido, la
> app no estaba corriendo, y eso ya es evidencia". **Eso resultó falso.** El
> latido es un temporizador de JavaScript, y Android **suspende** los
> temporizadores del WebView cuando la app pasa a segundo plano. Se midió en
> producción: posiciones capturadas por el código nativo llegaron a guardarse
> **78 minutos tarde**, encoladas hasta que la app despertó.
>
> Lo correcto: un latido **presente** prueba que la app está viva y en primer
> plano. Un latido **ausente** NO prueba que esté muerta — puede ser
> simplemente la pantalla apagada. Un latido confiable en segundo plano
> necesita trabajo nativo que el plugin de GPS no ofrece. Ver D-031.

**El hueco real en el código:** la app pedía exención de optimización de batería
y abría la pantalla del fabricante, pero **nunca revisaba la hibernación** —
Android 11+, ajuste aparte, y su propia pantalla usa la palabra "pausar". Mide
si la app se **abre**, no si trabaja; un teléfono en el soporte del camión
trabaja todo el día y no se abre nunca. Un chofer puede conceder todo y aun así
quedar pausado por esto.

**Consecuencia aceptada:** un latido cada 5 minutos son ~100 filas por chofer
por jornada en vez de ~15. Es barato y compra la única señal que hacía falta.
El latido se estampa con la hora actual porque eso es lo que significa: *ahora
mismo el chofer sigue aquí y la app sigue viva*.

**Pendiente del usuario:** el aviso de hibernación es código **nativo** — no
llega hasta que se recompile el APK. El latido y la batería sí llegan de
inmediato, porque el shell carga el sitio en vivo.

---

## D-028 · El chofer no entra hasta que el teléfono pueda reportar

**Fecha:** 2026-08-14 · **Versión:** v1.3.3 · **Pedido por:** Andrés

**Cambio:** dentro del APK, la vista del chofer queda **bloqueada** hasta que el
teléfono tenga todo lo que hace falta para reportar: ubicación, "permitir
siempre", notificaciones, exención de batería y **no pausar la app**. Se piden
**de uno en uno**, en orden, con una alerta que pulsa.

**Razón:** *"haz que la app pida todos esos permisos para que no pase eso, pero
si él no aprueba los permisos no lo deja pasar, solo para blindar, y ten un
attention getter para eso."*

**De uno en uno, no todos juntos:** Android **no permite** pedir "permitir
siempre" antes de que ya esté concedida la ubicación en primer plano — pedirlo
antes es una negación automática. Cinco botones a la vez le habrían enseñado al
chofer que cuatro de ellos no hacen nada.

**Los dos límites que evitan que el blindaje sea el problema más grande:**

1. **Solo bloquea lo que puede LEER como denegado.** Lo que el teléfono no
   tiene (Android 9 no tiene permiso de ubicación en segundo plano; antes de
   Android 13 no hay permiso de notificaciones) o lo que un APK viejo no sabe
   contestar, regresa indefinido y **nunca** cuenta en contra. Un chofer
   bloqueado por un ajuste que no podemos verificar no puede entregar, y eso es
   peor que un camión sin rastrear. Hay 8 pruebas que fijan exactamente esa
   regla.
2. **Solo corre dentro del APK y solo para el rol chofer.** En un navegador
   ninguno de estos ajustes existe; bloquear ahí dejaría a la oficina fuera de
   su propio sistema.

**Consecuencia aceptada:** un chofer que se niegue **no puede trabajar** en la
app. Eso es exactamente lo pedido, y es defendible porque el trabajo del
despachador depende de ver el camión — pero significa que una negación se
convierte en una llamada a la oficina, no en un turno sin rastreo. Tras dos
negativas Android deja de mostrar el diálogo; la pantalla lo detecta y manda a
los ajustes de la app en vez de dejar al chofer tocando un botón muerto.

**Pendiente del usuario:** es código **nativo** — no llega hasta recompilar el
APK. El Java ya compila (`compileDebugJavaWithJavac`, BUILD SUCCESSFUL).

---

## D-029 · La foto se pide donde se puede tomar, y la app se actualiza sola

**Fecha:** 2026-08-14 · **Versión:** v1.3.4 · **Pedido por:** Andrés

**Cambio:** (a) la hoja de entrega ahora lleva la **cámara adentro**; (b) se
apagó "requerir comprobante" (migración 047); (c) una página que quedó vieja lo
**detecta y se refresca sola**, y avisa cuando hay un APK nuevo.

**Razón:** *"el conductor me reporta que no le pregunta quién recibió y que él
lo pone y no puede avanzar para marcar como delivered… ¿podemos hacer una
versión que él sepa cuándo se lanzó una nueva versión y él solo se actualice o
refresque? y también en web igual."*

**El atasco, exactamente:** con la firma apagada (046), `require_pod` solo se
podía cumplir con una foto. La hoja de entrega **decía** "se requiere una foto
del material" y **no tenía cámara adentro** — la única estaba más arriba en la
orden, fuera del popup. El chofer escribía el nombre, presionaba Confirmar, y
no pasaba nada, sin salida desde donde estaba parado. Eso no era una regla mal
puesta: era una exigencia hecha en un lugar donde no se podía cumplir.

**Se arregló primero la hoja, después se apagó la regla.** En ese orden a
propósito: apagar la regla sin arreglar la hoja habría escondido el defecto
hasta que alguien volviera a encender "requerir comprobante" y el chofer
quedara atrapado otra vez.

**Dos clases de "versión vieja", que se confunden todo el tiempo:**

- **Web** — la página corre JavaScript de un deploy anterior. Es la común y
  nadie la nota: el APK carga el sitio en vivo, así que un deploy **es** la
  actualización, pero solo para páginas cargadas después. Un teléfono abierto
  en el soporte desde las 6 a.m. sigue corriendo el código de esa mañana. Se
  cura con un refresco, y ahora la app lo hace sola.
- **APK** — el shell nativo es viejo (permisos, plugin de GPS, blindaje de
  batería). Ningún refresco arregla eso; hay que instalar un APK nuevo. Es
  raro y es el único que requiere que el chofer haga algo.

**Cuándo se refresca solo:** al volver a la app **y** si no hay nada a medias
en pantalla. Refrescar con una firma o un formulario a medio llenar tiraría
justo el trabajo más molesto de rehacer, en la puerta de un cliente. Un solo
intento automático: una página que se recarga y sigue viéndose vieja se
recargaría para siempre.

**Consecuencia aceptada:** cada página pregunta al servidor cada 5 minutos. Es
una respuesta de dos campos, sin caché a propósito — una respuesta cacheada
aquí anularía todo el punto.

---

## D-030 · El chofer puede estampar DÓNDE estuvo, aunque la parada ya esté cerrada

**Fecha:** 2026-08-14 · **Versión:** v1.3.6 · **Pedido por:** Andrés (falla reportada)

**Cambio:** un chofer puede hacer una edición sobre su propia parada ya cerrada
(`picked_up` / `delivered`) **solo** si lo único que cambia son las coordenadas
GPS (migración 048). Y un parche de fondo ya no muestra error al chofer.

**Razón:** *"cuando le doy delivered me sale error: no puedes editar órdenes que
están siendo delivered."*

**Lo que realmente pasaba:** la entrega **sí se guardaba**. Lo que fallaba era el
parche de GPS que llega un segundo después. El teléfono muchas veces no tiene
posición en el instante exacto en que el chofer toca Entregar, así que la app
marca la parada de inmediato y adjunta las coordenadas cuando llegan
(`attachLateFix`). Para entonces la fila ya está en `delivered`, y el guard no
tenía ninguna regla de misma-etapa para un chofer sobre una parada cerrada — así
que rechazaba la escritura y le decía al chofer, de forma alarmante, que algo
había salido mal con una entrega que ya estaba guardada.

**Lo mismo llevaba pasando con las recogidas, en silencio.**

**Por qué la regla quedó angosta:** habría sido una línea más corta decir
"los choferes pueden editar órdenes entregadas", y eso habría reabierto todo lo
que el guard existe para proteger. En vez de eso se comparan **todas** las demás
columnas: si algo más cambió, se rechaza igual. Verificado contra la base: pasa
el GPS tardío de entrega y de recogida; siguen rechazados cambiar pallets,
dirección, precio, borrar la firma, **y GPS+pallets en la misma escritura**.

**Segunda capa, en el cliente:** el parche de fondo ahora es de verdad
silencioso (`quiet`). Aunque falle por otra razón —sin señal, por ejemplo— el
chofer no debe ver un error por algo que nunca pidió y que no puede resolver;
un error ahí se lee como "tu entrega falló" cuando la entrega está guardada
desde hace rato.

**Consecuencia aceptada:** si el parche falla, la entrega queda **sin
coordenadas** y nadie se entera en el momento. Es lo correcto para el chofer,
pero significa que la ausencia de GPS en una entrega no prueba nada por sí
sola.

---

## D-031 · Al despertar la app, pide posición de inmediato

**Fecha:** 2026-08-14 · **Versión:** v1.3.7 · **Pedido por:** Andrés (falla reportada)

**Cambio:** cada vez que la app despierta —al abrirla y al volver a ella— pide
una posición **de inmediato**, en vez de esperar a que el camión se mueva.

**Razón:** *"cerré el app, luego la abrí 30 min después, y la app se tardó 45
minutos en decirme live de nuevo."*

**La causa, medida:** el vigilante nativo solo avisa después de **40 m de
movimiento**, y a propósito rechaza la posición cacheada del teléfono (D-?: una
posición vieja pondría al chofer en la bodega de hace horas). El latido tampoco
podía rescatarlo: **reenvía la última posición conocida, y tras reiniciar no hay
ninguna**. Camión parado + app recién abierta = silencio indefinido.

**La excepción es acotada:** al despertar se acepta una posición de hasta **2
minutos** de antigüedad. Suficientemente reciente para ser donde el chofer está
de verdad, y muchísimo mejor que nada. El vigilante sigue rechazando posiciones
cacheadas — esto es una excepción con límite, no un cambio de la regla.

**Lo que esto NO arregla, y hay que decirlo:** en el mismo análisis se
descubrió que **el latido no funciona en segundo plano**. Es un temporizador de
JavaScript y Android lo suspende cuando la app no está al frente; se midieron
posiciones nativas guardadas **78 minutos tarde**, encoladas hasta que la app
despertó. Eso invalida lo que D-027 afirmaba —que un latido faltante probaba
que la app estaba muerta— y esa entrada quedó corregida.

**Efecto práctico:** ahora cada vez que el chofer mira el teléfono se registra
una posición. Eso cubre el caso que dolía (volver y aparecer en el mapa), pero
**un hueco largo con la pantalla apagada sigue siendo ambiguo**.

**Revisar cuando:** si hace falta rastreo confiable con la pantalla apagada y el
camión parado, hay que escribir un servicio nativo que reporte por tiempo, no
por distancia. El plugin actual no lo ofrece.

---

## D-032 · Al chofer le avisan cuando le asignan trabajo

**Fecha:** 2026-08-14 · **Versión:** v1.3.8 · **Pedido por:** Andrés

**Cambio:** cuando se le asigna una parada a un chofer, le llega una
notificación: en la campanita de la app y —si la app está corriendo— como
notificación real del teléfono.

**Razón:** *"quiero que al conductor le caiga una notificación cada vez que se
le asigne una ruta."*

**El hueco que tapa:** las notificaciones existentes se disparaban por **cambio
de etapa** (aprobada, lista, entregada). Que te **entreguen el trabajo** es otro
evento distinto, y era justo el que nadie avisaba: el despachador podía armar el
día completo de un chofer y el chofer solo se enteraba abriendo la app a mirar.

**Un solo punto de enganche:** todas las formas de asignar —el modal, Routes
Manager, el mapa, la asignación masiva— pasan por `updateDelivery`. Poner el
aviso ahí significa que no se puede evadir por ningún camino. Verificado también
que las políticas RLS permiten al despachador escribir una notificación dirigida
al chofer; si no, la función habría quedado muerta en silencio.

**Dos cosas que a propósito NO hace:**

1. **No repite el historial.** Lo que ya estaba en pantalla al abrir se marca
   como visto; un chofer que reabre a mediodía no recibe otra vez la ruta de la
   mañana.
2. **No suena una vez por parada.** El despachador asigna el día entero de un
   golpe; ocho zumbidos en ocho segundos es exactamente como un chofer aprende a
   ignorar la app. Lo que llega junto se junta en un solo aviso ("Se te
   asignaron 3 paradas").

También se omite cuando no hay a quién avisar: al **quitar** la asignación, en
un carril temporal que no corresponde a un usuario real, y cuando el propio
chofer se auto-asigna una orden al recogerla.

**Límite honesto — y es mayor de lo que suena:** la notificación del teléfono
solo sale con la app **en primer plano**. Android congela el JavaScript del
WebView en cuanto el chofer cambia a otra app; se midió en producción que
posiciones capturadas por el código nativo quedaron encoladas **78 minutos**
hasta que la app se reabrió. Es decir: **cambiar de app es casi lo mismo que
cerrarla**, y el zumbido llegaría al volver a la app — justo cuando ya no hace
falta.

Llegarle a un teléfono que nadie está mirando exige **push (FCM)** o un
servicio nativo que consulte por su cuenta; en ambos casos es trabajo nativo y
APK nuevo. La campanita es la mitad confiable y siempre guarda el aviso.

**Revisar cuando:** esto es lo primero que hay que atender si el aviso importa
de verdad — no es un caso raro, es el caso normal.

---

## D-033 · Push real (FCM), para llegarle a un teléfono que nadie está mirando

**Fecha:** 2026-08-14 · **Versión:** v1.4.0 · **Pedido por:** Andrés

**Cambio:** las asignaciones se envían por Firebase Cloud Messaging, así que el
aviso llega con la app en segundo plano, cerrada o el teléfono bloqueado.

**Razón:** *"pero si la app no se cierra, solo cambio de app, ¿me aparecen las
notificaciones?"* — no aparecían. D-032 entregó el aviso por la campanita y una
notificación del navegador, y esa segunda mitad **solo funciona en primer
plano**: Android congela el JavaScript del WebView en cuanto el chofer cambia de
app. Eso no es el caso raro; es el caso normal.

**Por qué FCM y no un servicio que consulte solo:** un consultor nativo
gastaría batería todo el día preguntando "¿hay algo nuevo?" y aun así llegaría
tarde. FCM lo entrega el sistema operativo: cero batería mientras no hay nada,
y llega de inmediato cuando lo hay.

**Sin firebase-admin, a propósito:** la autenticación es firmar un JWT con la
llave de la cuenta de servicio y cambiarlo por un token. Son ~40 líneas contra
arrastrar un árbol enorme de dependencias a una función serverless para una
sola llamada HTTP.

**El envío no acepta destinatario ni mensaje.** `/api/push` recibe **solo el id**
de una notificación que ya existe; el mensaje y a quién va se releen de la base
con el rol de servicio. Así nadie puede usarlo para zumbarle a toda la empresa,
ni para reenviar un aviso viejo (se ignora cualquiera de más de 5 minutos).

**Todo degrada en silencio.** Sin `FIREBASE_SERVICE_ACCOUNT` no hay push, no hay
error, y la campanita —que es el registro— sigue igual. Sin
`google-services.json` el APK **compila igual** y solo avisa en el log; aplicar
el plugin de Google sin ese archivo rompe la compilación de raíz, y una
computadora sin la config de Firebase tiene que poder compilar.

**Consecuencia aceptada:** un token muerto (app desinstalada) se borra, pero
**solo** ante `UNREGISTERED`/`NOT_FOUND`. Un límite de cuota o una caída de
Google **no** borra nada: tratar un fallo temporal como definitivo
desuscribiría a todos los choferes en silencio y nadie se enteraría hasta que
alguien se perdiera una ruta.

**Pendiente del usuario:** crear el proyecto de Firebase con su cuenta,
colocar `google-services.json`, poner `FIREBASE_SERVICE_ACCOUNT` en Vercel y
recompilar el APK. Pasos exactos en `mobile/README.md`.

---

## D-034 · Recorrido del chofer: reconstruido, y honesto sobre lo que no sabe

**Fecha:** 2026-08-14 · **Versión:** v1.4.4 · **Pedido por:** Andrés

**Cambio:** pestaña **Recorrido** (admin / gerente / logística): por chofer y
día, el trazo en el mapa, millas, tiempo manejando, tiempo detenido, las
paradas con su duración, y las órdenes entregadas ese día.

**Razón:** *"hazme el back route del chofer: si se ha movido, qué rutas hizo,
millas recorridas, tiempo en movimiento, tiempo en las tiendas."*

**Es una reconstrucción, no una grabación,** y la pantalla lo dice antes de
mostrar los números. El teléfono reporta cuando el camión **se mueve**, no por
reloj, así que la distancia se mide en línea recta entre puntos sueltos y sale
**menor** que la carretera.

**Lo que se niega a hacer, que es lo importante:**

1. **No adivina en los huecos.** Un tramo sin posiciones puede ser el camión
   parado o la app dormida mientras manejaba (D-031); los datos no distinguen.
   Meter esos minutos en "tiempo en tiendas" inventaría tiempo que el chofer
   nunca pasó parado; meterlos en manejo inventaría millas. Se muestran como
   **"sin determinar"**, con su propio recuadro. El trazo del mapa también se
   **corta** en esos tramos: una línea recta cruzando una hora inexplicada
   sería una carretera que el camión nunca tomó.
2. **No acepta saltos imposibles.** Más de 100 mph entre dos puntos se excluye
   de la distancia y se cuenta aparte, con una bandera roja.
3. **No le pone nombre a una parada** si no hay una dirección conocida a menos
   de 400 m. Una parada sin nombre es honesta; una etiquetada con un cliente
   que está a media milla, no.

**Lo que destapó al primer intento:** correrlo sobre el día real dio **4,936
millas**. Diez posiciones de la cuenta del chofer estaban a ~1,300 millas del
Valle (Honduras), con precisión de 3.6 a 20 m. Sin la regla del salto
imposible, eso se habría promediado dentro de un KPI de kilometraje y nadie lo
habría visto.

> **Resuelto (2026-08-14):** eran **pruebas del propio dueño**, no una segunda
> sesión de un chofer. Las 10 filas se borraron a petición suya; el día real
> quedó en **17.9 millas**. La regla se queda: no dependía de que hubiera algo
> turbio, sino de que un solo punto imposible arruina todos los números que
> vienen después.

**Un falso positivo que salió al limpiar:** con los datos ya buenos seguía
marcando un salto. Eran dos posiciones separadas por **0.30 segundos y 21.7
metros** — temblor de GPS. Dividir entre un tiempo casi cero hace que cualquier
tembleque parezca supersónico. Ahora la prueba de velocidad **solo aplica a
partir de una milla**: un salto que de verdad significa otro dispositivo es de
cientos de millas, nunca de metros.

**Consecuencia aceptada:** con la densidad de datos de hoy, la mayoría de los
días van a salir marcados como bosquejo, y el bloque "sin determinar" será
grande. Es incómodo a propósito: mide qué tan poco sabemos, y es el mejor
argumento para el reporte por tiempo (servicio nativo) que D-031 dejó
pendiente.

---

## D-035 · El rastreo vive sobre las pantallas, no dentro de una

**Fecha:** 2026-08-16 · **Versión:** v1.5.0 · **Pedido por:** Andrés (auditoría)

**Cambio:** el rastreo de posición se movió al layout de la app. Antes corría
dentro de `ShiftClock`, que solo se renderiza en la pantalla de Órdenes.

**Razón:** *"revisa bien la configuración del driver app… con el GPS y así."*

**El defecto, exactamente:** en cuanto el chofer tocaba **"Mi ruta"**, Next
desmontaba la pantalla de Órdenes, se ejecutaba la limpieza del hook,
`removeWatcher()` disparaba y **Android derribaba el servicio en primer
plano** — con el chofer todavía en turno. El camión desaparecía del despacho
hasta que volviera. Y al volver el vigilante arranca de cero: rechaza la
posición cacheada y espera 40 m de movimiento, así que un camión parado se
quedaba invisible mientras siguiera parado.

**Eso explica el reporte de "tardó 45 minutos en decir LIVE otra vez"** mejor
que lo que le atribuimos en D-031. El sueño del JavaScript en segundo plano es
real y está medido, pero **esta causa es nuestra y es mayor**: no hacía falta
ni cambiar de app, bastaba con tocar una pestaña.

**Ahora** solo detienen el rastreo las dos cosas que deben: marcar salida, o
cerrar la app.

**Un chofer previsualizado por un admin no se rastrea:** el layout usa el rol
real del servidor, no el rol que el admin está viendo. Nadie queda geolocalizado
por curiosear una vista.

**Lo demás que se revisó y está bien:** los tres números de versión coinciden
(APK 2), el APK publicado responde, el manifiesto trae los permisos de
ubicación en segundo plano y el servicio declara `foregroundServiceType`, y
Capacitor sí concede geolocalización al WebView cuando la app ya tiene el
permiso — que es de lo que depende el arranque inmediato de D-031.

**Pendiente conocido:** sin `google-services.json` el APK va sin push y hay 0
teléfonos registrados; `versionName` en Gradle quedó en 1.3.5 y conviene
alinearlo en la próxima compilación.

---

## D-036 · Solo el teléfono que marcó entrada reporta

**Fecha:** 2026-08-16 · **Versión:** v1.5.1 · **Pedido por:** Andrés

**Cambio:** el turno guarda **qué teléfono** marcó entrada, y solo ese reporta
posición (migración 050). Además, **un navegador nunca rastrea**: solo el APK.

**Razón:** *"yo me meto en la cuenta de Maximo el conductor, pero si él le dio
clock in, ¿la app va a ser inteligente y solo va a reconocer esa sesión de él?"*
— **No lo era.** La única condición era "rol chofer + turno abierto", así que
**cualquier** dispositivo con esa sesión abierta reportaba.

**Ya había pasado.** Cuando el dueño entró a la cuenta del chofer a probar, su
dispositivo empezó a mandar posiciones: por eso un día salió en **4,936 millas**
con puntos a 1,300 millas de distancia. En su momento lo tratamos como dato
sucio y se borró; la causa de raíz es esta.

**Dos capas, a propósito:**

1. **Vinculación al dispositivo.** Al marcar entrada se guarda un id opaco de la
   instalación (aleatorio, en el almacenamiento local — no es huella digital ni
   identidad). Solo ese teléfono reporta durante ese turno.
2. **Solo el APK.** Un navegador es alguien **revisando**, no alguien
   manejando; además solo el APK puede reportar con la pantalla apagada. Esto
   deja fuera para siempre a la laptop de la oficina.

**Desconocido = permisivo, y es deliberado:** un turno abierto antes de que
existiera la columna, o un teléfono que no puede guardar almacenamiento local,
siguen rastreando igual. Dejar a oscuras a un chofer real a media ruta sería
peor que la mezcla que esto evita.

**Consecuencia aceptada:** si el chofer reinstala la app a media jornada, su id
cambia y deja de reportar hasta que vuelva a marcar entrada. Es el precio de que
el rastro corresponda a **un** camión.

---

## D-037 · El GPS reporta por reloj, no solo por movimiento

**Fecha:** 2026-08-16 · **Versión:** v1.5.3 · APK 3 · **Pedido por:** Andrés

**Cambio:** el código nativo entrega una posición **cada 2 minutos**, se mueva o
no el camión, además del reporte por distancia que ya existía.

**Razón:** *"haz lo del GPS por tiempo."* Cada día salía con ~390 minutos "sin
determinar" en el Recorrido, porque un camión parado no reportaba nada y un
hueco podía ser tanto una parada como la app muerta.

**El hallazgo que lo hace obvio:** leyendo el plugin, en Android hace esto:

```java
locationRequest.setInterval(1000);                       // pide GPS CADA SEGUNDO
locationRequest.setPriority(PRIORITY_HIGH_ACCURACY);     // a máxima precisión
locationRequest.setSmallestDisplacement(distanceFilter); // pero solo ENTREGA a 40 m
```

**El GPS ya venía corriendo a tope cada segundo.** El filtro de 40 m no ahorraba
batería: solo **tiraba** posiciones ya calculadas. Los 390 minutos no eran
desconocidos, eran descartados. Esto no gasta más batería — deja de tirar lo
que ya se paga.

**Por qué nativo y no un temporizador de JavaScript:** el latido anterior era un
`setInterval`, y Android **suspende** esos temporizadores en cuanto la app pasa
a segundo plano — justo cuando más falta hacía. Ahora el pulso viene de código
nativo que sigue corriendo; los eventos se encolan y se vacían al despertar
**con su hora de captura intacta**, así que el rastro queda bien aunque la
subida llegue a ráfagas.

**Se ofrece cada 2 min, se guarda cada 5:** cada posición pasa igual por el
filtro de envío, así que un camión parado escribe una fila cada 5 minutos
(~100 filas por jornada). Ofrecer más seguido de lo que se guarda sirve para
otra cosa: un camión que arranca se nota a los 2 minutos, no a los 5.

**Consecuencia aceptada:** más filas y una subida en ráfagas cuando el teléfono
estuvo dormido. A cambio, un hueco largo por fin **significa algo** — sin señal,
o app caída — en vez de ser indistinguible de una parada normal.

**Pendiente del usuario:** es nativo. Requiere compilar y subir el **APK 3**.

---

## D-038 · Entrar con usuario, para quien no tiene correo

**Fecha:** 2026-08-16 · **Versión:** v1.6.0 · **Pedido por:** Andrés

**Cambio:** un usuario se puede crear con **nombre de usuario en vez de correo**,
y el admin puede editar usuario y correo de cualquiera desde Usuarios. La
pantalla de acceso acepta las dos formas.

**Razón:** *"déjame editar username, emails y así en user; si quiero, en vez de
un email crear un username."*

**El problema real:** Supabase identifica a las personas por correo y eso no se
negocia. Almacén y choferes rara vez tienen dirección de empresa, así que la
oficina terminaba **inventándoles correos** que después nadie recuerda.

**La solución:** quien no tiene correo recibe uno **sintético derivado** de su
usuario — `maximo` entra como `maximo@users.rdztilegroup.net`.

**Derivado, no consultado, y eso es lo importante:** la pantalla de acceso
construye la dirección sola. Así **no existe ningún endpoint que conteste "¿este
usuario existe?"**, y por lo tanto no hay nada que sondear para sacar la lista
de quién trabaja aquí.

**El costo, y es real:** una persona sin correo **no puede restablecer su propia
contraseña**. Ningún enlace puede llegarle; un admin tiene que ponerle una
nueva. La app lo dice **al crear la cuenta**, no el día que se le olvide.

**Dos reglas que evitan un bloqueo silencioso:**

1. **Renombrar el usuario mueve también la dirección de acceso**, pero **solo si
   era derivada**. Reescribir un correo real porque alguien editó un campo de
   usuario sería robarle la cuenta a esa persona.
2. **Un correo real siempre gana** sobre el usuario: dar una dirección de verdad
   es también devolverle a esa persona la capacidad de recuperar su contraseña.

**Consecuencia aceptada:** el usuario se valida angosto (3–30, letras, dígitos,
punto, guion, guion bajo). Se vuelve la parte local de una dirección, y algo
exótico ahí produce una cuenta que se ve bien y **no puede entrar**.

---

## D-039 · Registro de cambios de acceso

**Fecha:** 2026-08-16 · **Versión:** v1.7.0 · **Pedido por:** Andrés

**Cambio:** Un registro aparte anota quién cambió roles, permisos, usuario y correo, y quién restableció contraseñas. Se ve en Auditoría, solo para admins.

**Razón:** registro de seguridad: quién cambió el acceso de alguien y cuándo

**Consecuencia aceptada:** Un admin podía restablecer contraseñas, cambiar correos y roles, y NADA quedaba escrito. La Auditoría solo cubría órdenes, así que la pregunta “¿quién le cambió el rol a esta persona?” no tenía respuesta. Es angosto a propósito: solo lo que cambia qué puede alcanzar alguien o cómo entra — un registro que anota todo no lo lee nadie. Nunca guarda una contraseña: el registro es que HUBO un restablecimiento, no lo que produjo. Es de solo lectura por construcción, y se verificó en vez de suponerse: se sembró una fila y, actuando como admin, se corrió DELETE y UPDATE sobre toda la tabla — ambos devolvieron sin error (RLS afecta cero filas en silencio) y la fila sobrevivió intacta. Un admin tampoco puede firmar una entrada a nombre de otro. El nombre de quien fue eliminado se guarda en la fila y no se busca después: su perfil se va con la cuenta, y esa entrada es la que más vale poder leer meses después.

---

## D-040 · Las fotos dicen quién las tomó

**Fecha:** 2026-08-16 · **Versión:** v1.7.2 · **Pedido por:** Andrés

**Cambio:** Cada foto muestra el nombre y el puesto de quien la subió, sobre la miniatura y en el visor.

**Razón:** *"cuando alguien suba foto que aparezca quien la subio y el puesto"*

**Consecuencia aceptada:** El campo de fotos era una lista de URLs y nada más, así que ninguna imagen tenía autor. El registro de actividad anota que “photos” cambió y por quién, pero no CUÁL foto — FQ114 tiene seis de esas entradas del mismo chofer en diez minutos, y no había forma de ligar un nombre a ninguna. Se estampa en el proveedor y no en cada pantalla: la tarjeta del chofer, la hoja de entrega y la vista de oficina escriben por el mismo punto, y una atribución que depende de acordarse de agregarla es una que se pierde. El nombre y el puesto se resuelven AL MOSTRARLOS, no se congelan en la fila: el pie debe decir lo que la persona ES, no lo que decía su puesto el día que apretó el botón. Las fotos anteriores quedan sin pie, no con uno inventado.

---

## D-041 · Las fotos se abren y se pueden acercar

**Fecha:** 2026-08-16 · **Versión:** v1.7.3 · **Pedido por:** Andrés

**Cambio:** Tocar una foto abre un visor a pantalla completa con zoom (pellizco, doble toque, rueda o botones), desplazamiento y flechas entre fotos. La firma de una entrega también.

**Razón:** *"le doy click a la foto y no me abre, quiero que me abra como pop up y hasta me deje darle zoom"*

**Consecuencia aceptada:** Tocar la foto llamaba a window.open, que dentro del WebView de Android no hace absolutamente nada: sin manejador de popups, sin pestaña nueva y sin error. La foto simplemente no era clicable justo en el dispositivo donde una foto de entrega importa. El zoom se implementó en vez de dejárselo al navegador porque un WebView con viewport fijo no hace pinch sobre un elemento de la página, y la foto es exactamente lo que alguien necesita agrandar: un número de lote, una esquina golpeada, un remito. El zoom se reinicia al pasar de foto — arrastrarlo deja al lector en medio de una imagen que todavía no ha visto. La firma se mostraba a 90px de alto y sin clic, que no es un tamaño al que nadie pueda verificar una firma.

---

## D-042 · La selección múltiple es para quien despacha

**Fecha:** 2026-08-16 · **Versión:** v1.7.6 · **Pedido por:** Andrés

**Cambio:** Se quitó la columna de casillas a vendedor y contabilidad. La conservan admin, gerente y logística.

**Razón:** *"quitale a ellos, a vendedor y accounting"*

**Consecuencia aceptada:** Vendedor la tenía para UNA sola acción (enviar a aprobación) — toda una columna de pantalla para un botón. Contabilidad la tenía para aprobar, cancelar y fijar fecha, que son decisiones que conviene tomar orden por orden y no de ocho en ocho. Ninguno pierde capacidades: las siguen teniendo desde la orden misma. También se quitó a contabilidad de esos tres botones de la barra, porque sin casilla ya no puede seleccionar nada y las ramas quedaban inalcanzables — le habrían dicho al siguiente que lea el código que contabilidad aprueba en lote. Chofer y almacén nunca la tuvieron: todos los controles de la barra están reservados a roles de oficina, así que la columna seleccionaría filas sobre las que no podrían actuar.

---

## D-043 · Fuera la satisfacción del cliente

**Fecha:** 2026-08-16 · **Versión:** v1.7.7 · **Pedido por:** Andrés

**Cambio:** Se quitaron las estrellas y el comentario de la orden, y los cinco indicadores que los mostraban.

**Razón:** *"en el view de ordenes se sigue viendo lo de satisfaccion del cliente"*

**Consecuencia aceptada:** Se verificó antes de borrarlo: 0 de 53 órdenes han tenido alguna vez calificación o comentario. Nunca se usó. Sin forma de capturarla, los indicadores solo podían mostrar un guion para siempre, así que se fueron con ella: el recuadro de flota, la línea de tendencia, la columna por chofer, la celda de promedio y “% Calif.” en la tabla de calidad, más sus tres columnas del CSV. Las columnas csat_rating y csat_comment se quedan en la base, así que no se pierde nada si vuelve. Quitar celdas de tablas es donde este tipo de cambio se rompe, así que se contaron después en vez de confiar en la compilación — aparecieron dos huérfanos que TypeScript y el build aceptaron sin quejarse: un encabezado sin celda debajo, y la estrella del promedio de flota escondida en la fila de totales.

---

## D-044 · Contabilidad revisa y aprueba; no crea

**Fecha:** 2026-08-16 · **Versión:** v1.8.0 · **Pedido por:** Andrés

**Cambio:** Contabilidad ya no ve el enlace de seguimiento del cliente, ni el botón Duplicar, ni puede crear órdenes.

**Razón:** *"el de contabilidad no tiene que ver eso de copiar enlace / y de hecho ellos tampoco pueden duplicar ordenes ni crear"*

**Consecuencia aceptada:** El enlace de seguimiento es herramienta de ventas y despacho: contabilidad factura la entrega, no le dice al cliente dónde va el camión. Crear y Duplicar salían de la misma capacidad, así que quitar “create” del rol eliminó ambos, más el “+ Nueva orden” y el envío masivo a aprobación. Eso resultó ser un desajuste entre interfaz y base de datos, no un cambio de política: se simuló un alta como contabilidad contra la base real y SIEMPRE estuvo prohibida — “Only sales, managers or drivers can create orders”. La app ofrecía dos botones que la base reventaba, y la descripción del rol decía “Como Oficina” y listaba “Crear órdenes” entre sus permisos. Ninguna de las dos cosas era cierta.

---

## D-045 · El PO es obligatorio en Intertienda

**Fecha:** 2026-08-17 · **Versión:** v1.8.6 · **Pedido por:** Andrés

**Cambio:** una orden Intertienda no se puede enviar sin **PO #**. Con eso, se
auto-aprueba como cualquier otra.

**Razón:** *"todas las tiendas están de auto approved pero no pasó hoy con unas
órdenes que agregaron."*

**Lo que estaba pasando:** existía una regla —**sin registrar en esta
bitácora**— que decía que una Intertienda sin PO no se auto-aprueba y se va a
Pendiente. Pero la validación de campos pedía otra cosa: *"cualquiera de PO # /
SO # / Factura #"*. Así que una Intertienda con solo factura **pasaba la
validación** y luego fallaba la otra regla, cayendo en Pendiente **sin ninguna
explicación**. Dos reglas discutiendo sobre la misma orden.

**Cuánto costaba:** las 7 órdenes Intertienda del 17 de agosto (FQ501, FQ503 a
FQ508) quedaron pendientes y alguien las aprobó a mano, una por una. En el
histórico, de 24 Intertienda solo 10 traían PO — 14 pasaron por ese trámite.
Y desde afuera se veía como si el auto-aprobado estuviera roto, que es
exactamente lo que se reportó.

**Por qué obligatorio y no quitar la regla:** el dueño lo eligió así. Si el PO
importa para contabilidad en las transferencias entre tiendas, pedirlo al
crear es más barato que perseguirlo después — y elimina la categoría entera de
"quedó pendiente y nadie sabe por qué".

**Cómo se implementó:** una regla de documento nueva, `docRef: "po"`,
configurable desde la página de Datos como las demás. No quedó escondida en el
código: un admin puede cambiarla si mañana la política cambia.

**Consecuencia aceptada:** si el PO todavía no existe cuando se captura la
orden, no se puede enviar — hay que guardarla como borrador y volver. Es el
precio de que ninguna quede detenida en silencio.

---

## D-046 · La documentación viva se mantiene en Notion
**Fecha:** 2026-08-18 · **Versión:** v1.9.2 · **Pedido por:** Andrés

**Cambio:** el estado del proyecto se documenta en Notion, y actualizarlo pasa a
ser parte de cada cambio de código, no una tarea aparte. Seis secciones:
Arquitectura, Estado actual, Setup, Decisiones (ADR), Changelog y Próximos
pasos. La regla quedó escrita en `CLAUDE.md` para que una sesión nueva del
asistente la recoja sin que nadie se la repita.

**Razón (textual):** *"tan completa que si pierdo el historial del chat,
cualquier persona (o tú mismo en una sesión nueva) pueda entender el estado
completo de la app y continuar el trabajo solo leyendo Notion"*.

El problema real: casi todo el porqué de este sistema vivía en un historial de
chat. El repositorio dice qué hace el código, nunca qué se descartó ni por qué.
Perder ese hilo significaba volver a discutir decisiones ya tomadas.

**Por qué Notion y no solo archivos en el repo:** la gente de operaciones no
abre GitHub. `DECISIONS.md` sigue siendo el original de los ADR — Notion es su
espejo consultable, filtrable y compartible.

**Por qué bases de datos para ADR y Changelog:** son las dos cosas que solo
crecen. Como base se filtran por fecha, versión y área; como página serían un
muro de texto imposible de recorrer a los seis meses.

**Consecuencia aceptada:** hay dos lugares que mantener sincronizados, y una
documentación a medio actualizar miente peor que no tener ninguna. Por eso la
regla es "en la misma sesión", no "cuando se pueda".

**Revisar cuando:** si el mantenimiento se empieza a saltar, la salida es
generar el Changelog desde `git log` automáticamente en vez de a mano.

---

## D-047 · Push notifications activadas
**Fecha:** 2026-08-18 · **Versión:** v1.9.3 · **Pedido por:** Andrés

**Cambio:** las notificaciones push (FCM) dejan de estar inertes. Se creó el
proyecto de Firebase `rdz-deliveries`, se agregó `google-services.json` al
módulo Android y `FIREBASE_SERVICE_ACCOUNT` a Vercel (producción, preview y
desarrollo). Se compiló y publicó el APK 4 con el plugin de Google Services
aplicado.

**Razón:** el código de push llevaba semanas escrito y probado, solo inerte
por falta de las credenciales de Firebase. Sin push, un chofer con la app
cerrada no se enteraba de una asignación nueva hasta volver a abrirla — el
hueco funcional más grande que quedaba en producción.

**Consecuencia aceptada:** hay **0 teléfonos con token registrado** todavía.
El registro pasa solo cuando alguien abre la app instalada desde el APK 4 —
hasta que Maximo actualice, el comportamiento sigue siendo el de antes.

**Revisar cuando:** una vez que haya teléfonos registrados, confirmar en la
consola de Firebase que los envíos llegan y no solo se aceptan.

---

## D-048 · Sentry conectado (errores + tracing)
**Fecha:** 2026-08-18 · **Versión:** v1.9.4 · **Pedido por:** Andrés

**Cambio:** se instaló `@sentry/nextjs`, con `instrumentation.ts` /
`instrumentation-client.ts` / `sentry.server.config.ts` / `sentry.edge.config.ts`,
`src/app/global-error.tsx`, y `next.config.mjs` envuelto en `withSentryConfig`.
El `ErrorBoundary` de la app ya no solo loguea a consola: manda la excepción a
Sentry con el rol del usuario y el build de APK como tags. Alcance deliberado:
solo errores + tracing (10% de las requests, 100% en desarrollo) — nada de
Session Replay, Logging ni Profiling todavía, para no instrumentar de más en
una instalación nueva.

**Razón:** hasta hoy, un error en la app del chofer se quedaba en la consola
de su teléfono — nadie se enteraba salvo que el chofer describiera lo que vio.
Motivado directamente por el crash de Maximo ("RDZ Deliveries keeps
stopping") del mismo día: sin Sentry, no había forma de saber qué lo causaba
sin acceso físico al teléfono.

**Consecuencia aceptada:** `SENTRY_ORG`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_DSN`
y `SENTRY_AUTH_TOKEN` ya están en Vercel; falta `SENTRY_PROJECT` (el slug del
proyecto en Sentry) para que el build suba source maps — sin eso, la
compilación avisa y sigue sin romperse, pero los stack traces de producción
llegan minificados hasta que se agregue. Se agregó `@sentry/nextjs` como
dependencia de producción, la primera excepción a la regla de las siete
dependencias — se aceptó porque no hay alternativa razonable de ~40 líneas
como con FCM.

**Revisar cuando:** llegue `SENTRY_PROJECT` — agregarlo a Vercel activa las
dos advertencias que hoy imprime el build.

**Nota (2026-08-18, mismo día):** `SENTRY_PROJECT=javascript-nextjs` ya está en
Vercel. El build confirmado subiendo source maps sin advertencias, y un error
de prueba disparado a través de la app real (no un script aparte) llegó al
dashboard. Cerrado.

---

## D-049 · Pallets y documento bloquean de verdad al enviar a aprobación
**Fecha:** 2026-08-18 · **Versión:** v1.9.5 · **Pedido por:** Andrés

**Cambio:** una orden ya no puede pasar de `draft` a `pending` (ni de
`rejected` a `pending`, el mismo botón de reenviar) si le falta el número de
pallets (`est_pallets`, debe ser > 0) o el documento que le corresponda según
su tipo (PO/SO/Factura — la regla de D-045, sin tocar). Nuevo:
`submitBlockers()` en `src/lib/required.ts`, un subconjunto de
`missingFields()` que en vez de listar-y-dejar-continuar, **rechaza** con un
mensaje que dice exactamente qué falta. Guardar como borrador sigue sin pedir
nada — eso no cambió.

**Razón:** reportado en modo de entrenamiento: una orden se envió a
aprobación sin pallets. Investigando se encontró que la causa no era el modo
de entrenamiento — es que había **dos caminos distintos** para llegar a
Pending, y solo uno de los dos validaba, y ese validaba con un diálogo
"¿Continuar de todos modos?" que cualquiera podía aceptar sin corregir nada:

1. Crear una orden nueva y enviarla directo → pasaba por `passesChecks()`,
   que ya calculaba `missingFields()` (pallets estaba ahí desde antes) pero
   solo como advertencia descartable.
2. Abrir un borrador ya guardado y tocar "Enviar a aprobación" → llamaba a
   `move("pending")`, que iba derecho a `setStage()` **sin pasar por
   ninguna validación**, ni siquiera la advertencia descartable.

El segundo camino es casi seguro por dónde pasó esta orden: se guarda como
borrador (sin pedir nada, correcto), se reabre después, y "Enviar a
aprobación" no revisaba nada en absoluto.

**Por qué bloquea al enviar y no al guardar borrador:** un borrador existe
para guardar algo incompleto y volver (D-004, D-045); exigir todo desde el
guardado inicial volvería a atorar órdenes que alguien está armando a medias.
El bloqueo se agregó en el único lugar por el que pasan los dos caminos hacia
Pending (`passesChecks()` para crear/editar, y directamente en `move()` para
el botón de reenviar), reutilizando `missingFields()` en vez de duplicar la
lógica del documento por tipo.

**Por qué NO se hizo la factura obligatoria por sí sola:** no era lo pedido,
y forzarla revertiría D-045 (8 de 41 órdenes históricas no traen factura al
crearse) — seguiría aceptando PO o SO en su lugar, sin cambios en esa regla.

**Consecuencia aceptada:** el resto de los campos requeridos (contacto,
teléfono, direcciones, fecha, ventana, costo de entrega) **siguen siendo
advertencia descartable**, no bloqueo — fuera del alcance de este reporte. Es
un solo punto de aplicación en la interfaz (`OrderModal.tsx`), no en cada
proveedor de datos: los dos proveedores (`data-provider.tsx` y
`local-data-provider.tsx`) nunca validaron campos en `setStage`, solo la
legalidad del cambio de etapa — la validación de campos siempre vivió en la
interfaz, así que arreglarla ahí cubre ambos modos (y el modo de
entrenamiento) sin duplicar nada.

**Tests:** `src/lib/required.test.ts` — nueve casos nuevos para
`submitBlockers()`: vacío en una orden completa, pallets null, pallets = 0,
factura vacía, Intertienda sin ningún documento, costo de entrega NO bloquea,
contacto/teléfono/dirección NO bloquean, ambos a la vez se reportan juntos, y
Transfer (sin papeleo) bloquea solo por pallets. No hay test a nivel de
componente para "guardar borrador no pide nada" — esa garantía es el guard
`stage !== "draft"` ya existente en `OrderModal.tsx`, y el proyecto no tiene
un patrón establecido de pruebas de componente para `OrderModal.tsx` (las 445
pruebas anteriores son todas de `src/lib`, sin React).

---

## D-050 · Recruiting deja de ser una app aparte: es un módulo dentro de deliveries
**Fecha:** 2026-08-19 · **Versión:** v1.9.6 · **Pedido por:** Andrés

**Cambio:** los datos de RECRUIT·HN (recruiting-app, proyecto Supabase
`cfawfwzndxumeufhcwga`) se movieron al proyecto de deliveries
(`iwhcsvgujydebdyllcqu`), en un schema propio `recruiting.*` (11 tablas:
candidates, contacts, jobs, stages, stage_history, attachments, questions,
question_sets, templates, custom_fields, settings). `public.profiles` —ya
compartida por deliveries— gana dos columnas: `recruiting_role`
(admin|manager|recruiter, null = ninguno) y `module_access` (lista de
módulos externos a los que la identidad puede entrar; hoy solo puede
contener `'recruiting'`). Las dos nacen vacías/null para **todo** usuario
existente — nadie ganó acceso por el solo hecho de correr la migración.

**Razón (textual):** *"Una SOLA app, no dos... recruiting pasa a ser un
módulo dentro de deliveries."* El objetivo final (home screen con selector
de módulo por permiso) no se implementó todavía — esta entrada cubre solo la
unificación de identidad y datos, que se decidió resolver primero por ser lo
más riesgoso.

**El RLS se endureció como parte del corte, no después:** las tablas de
recruiting tenían "cualquier usuario autenticado lee y escribe cualquier
fila" — un modelo que funcionaba mientras recruiting vivía en su propio
proyecto con sus propios usuarios, pero que con `profiles` ya compartida
habría dejado a un chofer o vendedor de deliveries a una llamada de API de
los candidatos. Se reemplazó por `has_recruiting_access()` (repite el patrón
`current_user_role()` que ya existía) en las 11 tablas y en
`storage.objects` del bucket `resumes`. Un nuevo trigger,
`guard_recruiting_access_change`, exige ser admin de **deliveries** (no de
recruiting) para tocar `recruiting_role`/`module_access` de cualquiera —
deliberadamente separado de `guard_role_change` (que sigue intacto,
gobernando solo `role`) para no arriesgar ese trigger ya probado.

**Exención de modo local (recruiting nunca tuvo uno):** la regla de este
proyecto es que toda operación nueva existe en los dos proveedores de datos.
Recruiting nunca tuvo modo local — es Supabase-only desde que existe como
app Next.js. Se documenta como excepción explícita: el módulo de recruiting
queda fuera de esa regla; no se le construyó un proveedor local.

**Remapeo de identidad:** el proyecto viejo de recruiting tenía 4 cuentas,
pero las 4 eran la misma persona (confirmado por el dueño) y solo una de
ellas —`andresugarte000@gmail.com`— aparecía referenciada en algún dato real
(51 candidatos, 93 contactos, 64 entradas de historial, 1 adjunto). Las 4 se
remapearon a una sola identidad en deliveries (`careers@rdztilegroup.net`,
admin), que quedó con `recruiting_role='admin'`,
`module_access={'recruiting'}`. Auditoría de huérfanos antes del remapeo:
cero ids referenciados fuera de esas 4 cuentas.

**Verificado en producción antes de dar el corte por bueno:** conteo de
filas por tabla igual al proyecto viejo (7/167/2/0/0/51/93/64/1/7/1); cero
huérfanos de FK; una cuenta de deliveries sin `recruiting_role` recibe 0
filas de `recruiting.candidates` (RLS probado con `set role authenticated` +
`request.jwt.claim.sub`, no con el superusuario); el dueño ve sus 51
candidatos; un resume real (PDF, bucket `resumes` recreado + 49 archivos
copiados) abre por URL firmada; `npx tsc --noEmit` y `npx vitest run` (454)
pasan sin tocar código de aplicación — el único cambio de esquema fue
aditivo sobre `profiles`.

**Consecuencia aceptada:** el proyecto viejo de recruiting
(`cfawfwzndxumeufhcwga`) queda vivo, sin escrituras, como respaldo de solo
lectura — no se apaga ni se borra hasta validar 1–2 semanas en producción.
El código de recruiting-app (Next.js) todavía no se movió dentro de
deliveries-app ni existe el home screen con selector de módulo — eso queda
para una siguiente etapa.

**Revisar cuando:** al portar el código de recruiting-app como módulo de
deliveries-app (próxima etapa), y antes de apagar el proyecto Supabase
viejo.

---

## D-051 · Cimientos del selector de módulo: landingRoute() y /home
**Fecha:** 2026-08-19 · **Versión:** v1.9.7 · **Pedido por:** Andrés

**Cambio:** dos piezas, sin portar todavía nada de la interfaz de recruiting
(eso es la siguiente etapa):

1. `landingRoute(me)` en `constants.ts`, apoyada en el `roleHome()` que ya
   existía: si `role === 'driver'` → `/driver` siempre, sin mirar
   `module_access`. Si no, y la persona tiene acceso a 2+ módulos
   (`{'deliveries'} ∪ module_access`) → `/home`. Si no, exactamente lo mismo
   que hace `roleHome()` hoy.
2. `/home` — la pantalla del selector. Server Component: si no hay sesión,
   a `/login`; si trae cualquier query param (un deep-link), lo reenvía a
   `/?<params>` sin mostrar nada; si `landingRoute(me)` no es `/home`, redirige
   ahí (esto es lo que garantiza que un chofer, o cualquiera con un solo
   módulo, nunca vea el selector aunque entre a `/home` a mano por la URL);
   solo si de verdad califica, renderiza las tarjetas de módulos disponibles.

`(app)/layout.tsx` — el único archivo compartido que se tocó — ahora también
pide `recruiting_role` y `module_access` en el `select()` del perfil; sin eso
`landingRoute()` no tiene con qué decidir nada.

**Razón:** siguiente paso de D-050 — antes de portar ninguna pantalla de
recruiting, tiene que existir la puerta que decide a quién se le muestra
elegir y a quién no. Pedido explícito de que el chofer nunca vea el selector
"ni por navegación ni por URL directa a /home".

**Por qué NO se tocó `/` ni `middleware.ts`:** la alternativa más simple
—redirigir automáticamente desde `/` hacia `/home` cuando alguien tiene 2+
módulos— habría significado decidir esa lógica en `middleware.ts` (el punto
más sensible y compartido de toda la app, corre en cada request) o en
`(app)/page.tsx` (que ya es la tabla de Órdenes). Cualquiera de las dos tenía
un efecto secundario real: si la regla general se aplicaba a TODOS los roles
por igual, un chofer visitando `/` habría empezado a redirigir a `/driver`
también — un cambio de comportamiento que nadie pidió y que además choca con
D-017 (la página de Órdenes hoy no filtra por chofer, a propósito, como
asunto pendiente aparte). `/home` resuelve el caso pedido (nadie cae ahí sin
querer) sin tocar cómo se comporta `/` hoy. Cómo se llega a `/home` en el uso
diario —un enlace en el TopBar, o si se decide más adelante que sí conviene
un redirect automático— queda para cuando exista un segundo módulo real al
que cambiarse.

**El campanario de notificaciones del dueño sigue intacto:** su enlace sigue
siendo `/?order=<id>` (no se tocó), y como `/home` nunca intercepta `/`, ese
flujo no pasó cerca del código nuevo en absoluto — se verificó leyendo el
código, no hubo nada que romper.

**Consecuencia aceptada:** hoy no hay ningún botón que lleve a `/home` — solo
existe como ruta alcanzable. Es intencional: construir el punto de entrada
real (enlace en el TopBar, o un redirect automático post-login) sin tener
todavía un segundo módulo real al que apuntar habría sido trabajo especulativo.

**Tests:** `src/lib/landing-route.test.ts` — chofer siempre a `/driver` aunque
tenga `module_access` con recruiting; alguien con 2+ módulos a `/home`;
todos los demás roles igual que `roleHome()` hoy, con y sin `module_access`
vacío.

**Revisar cuando:** al portar las páginas de recruiting (próxima etapa) —
ahí es cuando `/home` necesita un punto de entrada real desde la navegación.

---

## D-052 · Recruiting portado como módulo — Etapa 2 completa
**Fecha:** 2026-08-19 · **Versión:** v1.9.9 · **Pedido por:** Andrés

**Cambio:** las 8 pantallas de recruiting (candidates, board, calendar,
metrics, outcomes, questions, settings, users) viven ahora dentro de
deliveries-app, bajo `/recruiting/*`, en un despliegue único — cierra la
Etapa 2 (D-050 unificó los datos; D-051 puso los cimientos del selector;
esta entrada es el resto de las páginas + el selector real funcionando).

**Route group hermano, no anidado — y por qué importa concretamente.**
`src/app/recruiting/(recruiting)/` es hermano de `(app)`, con su propio
`layout.tsx`: su propio fetch de perfil, su propio `DataProvider`, su propio
`TopBar`. No hereda nada de `(app)/layout.tsx`. La razón no es estética: si
recruiting colgara de `(app)`, cada una de sus 8 pantallas montaría también
`DriverGate` y `LocationTracker` — el rastreo GPS del chofer — sin que
tuviera nada que ver con recruiting. El layout de recruiting sí replica el
mismo patrón de auth+perfil que `(app)/layout.tsx` ya usa (duplicado a
propósito, no reinventado), y agrega su propia guarda: si `recruiting_role`
es null, redirige por `landingRoute()` — la misma función que ya manda a un
chofer a `/driver` sin mirar nada más (D-051). Confirmado con el chofer real
(Maximo Garza): `module_access={}` y `recruiting_role=null` — no llega ni a
`/home` ni a `/recruiting/*`, por dos candados independientes.

**CSS — opción (a), scope por prefijo, confirmado sin fuga en el bundle
real.** `recruiting.css` reescribe cada selector de `.recruiting-module`, y
las páginas de recruiting quedan envueltas en `<div className="recruiting-module">`
en el layout. Esto importaba especialmente para los selectores de elemento
sueltos del CSS original de recruiting (`body`, `button`, `input`, `a`,
`label`) y sus variables `:root` — sin el scope, habrían pisado el `body` y
los controles de **toda** deliveries, no solo de recruiting, porque Next
empaqueta el CSS importado para todo el sitio sin importar la ruta activa.
Verificado grep-eando el bundle compilado (`.next/static/css/*.css`): cero
selectores de recruiting sin el prefijo `.recruiting-module`.

**`usePrefs()` de deliveries, reusado — no se portó `I18nProvider`.** Ya
envuelve toda la app desde `app/layout.tsx` (tema + idioma), así que cada
componente portado (`useI18n()` → `usePrefs()`, misma firma `t(en, es)`) lo
recibe gratis. Menos código, y el tema oscuro/claro cubre recruiting sin que
nadie tuviera que pedirlo.

**Selector cerrado.** `/home` (D-051) ya tenía la tarjeta de Recruiting
apuntando a `/recruiting` desde que se construyó — no hizo falta tocar nada
ahí, solo que `/recruiting` existiera de verdad. El dueño (2+ módulos) llega
a `/home` y elige; todos los demás (hoy, todos) siguen entrando directo,
sin ver el selector.

**Tres bugs reales del mismo patrón, encontrados portando el resto del
código — no solo los dos que ya se sabían:**
1. `updateUserRole` escribía `role` en vez de `recruiting_role` (encontrado y
   corregido en el commit anterior, 6487374).
2. **Nuevo, en lectura:** `reloadAll()` traía `profiles.role` (el rol de
   deliveries) para la lista de "recruiters" del Users page, sin filtrar por
   `recruiting_role`. Con `profiles` compartida, eso metía a **cualquier**
   usuario de deliveries —choferes, vendedores— en la lista de reclutadores,
   y `ROLE_INFO[u.role]` (que solo tiene entradas para admin/manager/
   recruiter) habría reventado en tiempo de ejecución al toparse con un rol
   como `"driver"`. Se corrigió: la consulta ahora filtra
   `recruiting_role is not null` y mapea `recruiting_role → role` en memoria,
   para que el resto del código (que siempre leyó `Profile.role` como "rol
   dentro de recruiting") siga funcionando sin tocar nada más. Verificado
   contra producción: la lista queda con una sola persona (el dueño); el
   chofer real no aparece.
3. **`/api/delete-user` de recruiting borraba la cuenta de Auth completa.**
   Antes del merge eso era correcto — recruiting era la única cuenta de esa
   persona. Ahora esa misma cuenta es la identidad compartida con deliveries;
   borrarla desde el botón "Eliminar" de recruiting se habría llevado también
   el acceso a deliveries de esa persona. Se cambió el comportamiento —no
   solo el schema— a **revocar acceso a recruiting** (`recruiting_role=null`,
   se quita `'recruiting'` de `module_access`) en vez de borrar el usuario.
   Ambos endpoints nuevos viven en `/api/recruiting/*` (namespace propio; los
   `/api/invite` y `/api/delete-user` de deliveries no se tocaron). El texto
   del botón y del confirm en `users/page.tsx` se reescribió para que diga lo
   que de verdad hace ahora — ya no promete borrar el login de nadie.

**Verificado contra producción real (no solo build):** cada tabla de
`recruiting.*` responde con la config exacta que usa el código (51
candidatos, 167 preguntas, 7 etapas, 93 contactos, etc. — conteos iguales a
los del merge original); las 8 rutas nuevas + `/`, `/driver`, `/home`,
`/warehouse` devuelven `307 → /login` sin sesión; `tsc`/`vitest`
(458)/`next build` limpios.

**Consecuencia aceptada:** invitar a alguien que YA tiene cuenta de
deliveries (o de recruiting) desde el Users page de recruiting sigue
fallando ("that email already has an account") — `inviteUserByEmail` no
soporta "agregar acceso a un usuario existente". Construir ese flujo
("dame acceso a recruiting" para alguien que ya inició sesión en deliveries)
queda pendiente, fuera del alcance de un port directo.

**Revisar cuando:** si se necesita invitar/otorgar acceso a alguien que ya
tiene cuenta en el otro lado del sistema — hoy no hay flujo para eso.

---

## D-053 · Tab de Usuarios unificado — un solo lugar para role y recruiting_role
**Fecha:** 2026-08-19 · **Versión:** v1.10.0 · **Pedido por:** Andrés

**Cambio:** `/users` (deliveries) gana una sección "Acceso a otros módulos" en
`UserDialog.tsx`: una casilla por módulo (hoy solo Recruiting) que, marcada,
despliega el selector de `recruiting_role` (Admin/Office Manager/Recruiter).
Función nueva y separada en `data-provider.tsx`,
`updateUserRecruitingAccess(userId, { granted, recruiting_role })` — escribe
`recruiting_role`/`module_access`, nunca `role`. `/recruiting/users` pasa a
ser un `redirect("/users")` de una línea, igual que ya hace `/home` con
`landingRoute()`.

**Razón:** dos pantallas separadas para gestionar la misma fila de
`profiles` era exactamente el patrón que ya había producido los tres bugs de
D-052 — alguien edita pensando en una columna y toca la otra. Unificar en un
solo lugar, con una función que nunca puede confundirse con `updateUserRole`
porque tiene otro nombre y otra firma, cierra esa clase de error en vez de
tener más cuidado con ella.

**La grieta de autorización que cierra, no solo cierra un bug de UI.**
`/api/recruiting/invite` y `/api/recruiting/delete-user` (ahora retirados)
autorizaban por `recruiting_role === 'admin'` — admin **de recruiting**. El
trigger `guard_recruiting_access_change` (D-050) exige admin **de
deliveries** (`current_user_role() = 'admin'`) para cualquier escritura de un
usuario autenticado. Eran dos criterios de autoridad distintos conviviendo:
el endpoint de borrado solo funcionaba porque usaba el cliente de
service-role, que el trigger trata como confiable (`auth.uid()` nulo) — un
admin de recruiting que **no** fuera admin de deliveries podía revocarle el
acceso a alguien sin que el trigger lo viera venir. Con `/users` unificado,
el único punto de entrada YA es deliveries-admin-only (`me.role !== 'admin'`
en `users/page.tsx`, sin cambios), así que el trigger deja de ser una segunda
opinión que un endpoint podía esquivar — es la única autoridad, y coincide
con quien puede llegar a la pantalla.

**Por qué `UPDATE` directo del cliente y no un endpoint con service-role:**
esa era justo la grieta de arriba. El trigger ya decide correctamente quién
puede tocar `recruiting_role`/`module_access` — envolver esto en una ruta de
API con `SUPABASE_SERVICE_ROLE_KEY` habría sido reintroducir el mecanismo que
salta esa autoridad, solo que esta vez a propósito. `updateUserRecruitingAccess`
es un `supabase.from("profiles").update(...)` desde el navegador, autenticado
como el admin que ya está en `/users` — mismo patrón exacto que
`updateUserRole`/`updateUserStore`/`updateUserPermissions` ya usan hoy.

**Resuelve el pendiente de D-052** ("no hay flujo para dar acceso de
recruiting a alguien que ya tiene cuenta"): como el modal ya opera sobre un
usuario existente, otorgar acceso nunca necesita invitar a nadie por correo
— es el mismo `UPDATE`. Sigue sin resolverse el caso distinto de "invitar a
alguien que no tiene cuenta en absoluto" — eso no era lo pedido.

**Retirado por quedar sin llamador tras el redirect:**
`recruiting-data-provider.tsx` pierde `updateUserRole`, `updateUserAvatar` y
`deleteUser` (todas solo las llamaba la pantalla que ahora redirige;
`updateUserName` se queda — no era parte de este cambio, y nada más la
reemplaza). `/api/recruiting/invite/route.ts` y
`/api/recruiting/delete-user/route.ts` se borraron, y con ellos
`src/lib/recruiting/supabase/admin.ts` (el cliente de service-role de
recruiting), que ya no tenía ningún importador — confirmado con grep antes de
borrar cada uno, no por suposición. El array `recruiters` (solo lectura,
usado para asignar candidatos en `board`/`candidates`) no se tocó — eso no es
gestión de usuarios.

**`data-provider.tsx` gana `recruiting_role`/`module_access` en el `select()`
de `reloadAll()`** — antes solo `role`/`store`/`permissions`/etc., así que la
lista `users` no tenía con qué mostrar el estado de recruiting de nadie más
que uno mismo. `local-data-provider.tsx` implementa
`updateUserRecruitingAccess` como stub ("Not available in demo mode"), mismo
patrón que ya usa `resetUserPassword` — la sección entera del modal está
gateada por `!LOCAL_MODE`, así que nunca se llama ahí, pero el contrato
compartido `DataState` exige que exista.

**`SecurityKind` nuevo:** `recruiting_access_changed`, marcado sensible
(`isSensitive`) — otorgar acceso a otro módulo es, como mínimo, tan
significativo como un cambio de permisos.

**`MODULES` se extrajo** de `HomeSelector.tsx` (privado ahí) a `constants.ts`
(exportado), para que el modal y el selector lean el mismo emoji/label — un
tercer módulo algún día solo necesita una entrada ahí. `HomeSelector` sin
cambio de comportamiento: "Deliveries" sigue siendo la primera tarjeta,
implícita, nunca parte de `module_access`.

**Verificado contra producción real (transacciones con `rollback`, nunca se
escribió nada de verdad):**
1. Angel Cabrera (accounting, no-admin) intenta darse acceso a recruiting →
   rechazado: *"Only an admin can change recruiting access or role"*.
2. Roberto Rodriguez (admin de **deliveries**, `recruiting_role` null — NO es
   admin de recruiting) le otorga acceso a Kevin Gonzalez → permitido. Prueba
   a la vez que el `UPDATE` directo resuelve el pendiente de D-052.
3. El mismo Roberto intenta poner en null el `recruiting_role` del único
   admin de recruiting (Andrés) → rechazado por `protect_last_recruiting_admin`:
   *"There must always be at least one recruiting admin"*.
4. `tsc`/`vitest` (458)/`next build` limpios. Nada de esto tocó una
   migración — las columnas y los tres triggers ya existían desde D-050.

**Consecuencia aceptada:** el gap de "invitar a alguien sin cuenta en
absoluto a recruiting" sigue sin resolverse — nunca fue el problema que este
cambio atacaba.

---

## D-054 · App switcher genérico en la barra superior
**Fecha:** 2026-08-19 · **Versión:** v1.10.1 · **Pedido por:** Andrés

**Cambio:** `ModuleSwitcher.tsx` (nuevo), un componente compartido que ambos
`TopBar` montan — el de deliveries y el de recruiting. Muestra un botón
"Cambiar" con un menú de los módulos accesibles distintos al actual; elegir
uno navega directo a la entrada natural de ese módulo, sin pasar por `/home`.
`constants.ts` gana `DELIVERIES_CARD` exportado y `accessibleModules()`, una
sola función que arma la lista de módulos accesibles — la usan `HomeSelector`
y `ModuleSwitcher` por igual. Agregar un tercer módulo en el futuro es una
entrada nueva en `MODULES`; ni el switcher ni el hub necesitan tocarse.

**Razón:** con `/home` (D-051) ya existía cómo *entrar* eligiendo módulo,
pero no cómo *saltar* sin cerrar sesión y volver a pasar por el selector.
Pedido explícito de que fuera genérico para N módulos — vienen más merges,
y un switcher que solo supiera de "deliveries" y "recruiting" a mano habría
significado reescribirlo en el próximo.

**Por qué un componente compartido no rompe el aislamiento de D-052.** Ese
aislamiento nunca fue sobre imports — los route groups de Next no
sandboxean módulos, solo organizan rutas. Era sobre qué se **monta**: que
recruiting no herede `DriverGate`/`LocationTracker` (GPS) ni el
`DataProvider` de deliveries (sus canales de realtime), porque esos son
providers con efectos secundarios reales. `ModuleSwitcher` es presentación
pura — recibe `{ current, deliveriesRole, moduleAccess }` como props
primitivos, usa solo `usePrefs()` (ya compartido desde D-052) y no llama a
ningún `useData()` de ninguno de los dos módulos. Un componente sin datos
propios no puede filtrar nada hacia el otro lado; ya había precedente
(`usePrefs()` mismo) de que compartir un archivo de `src/components/` entre
los dos route groups no es, por sí solo, el problema que D-052 evitaba.

**`deliveriesRole`, no `role`, a propósito.** Dentro del `TopBar` de
recruiting, `me.role` significa `recruiting_role` (admin|manager|recruiter)
— la misma colisión de nombre que causó dos de los tres bugs de D-052
(`updateUserRole` escribiendo en la columna equivocada; `reloadAll()`
trayendo el rol equivocado). El switcher solo necesita el rol de
**deliveries**, porque es lo único que decide la excepción del chofer y a
dónde vuelve "Deliveries" — nombrar el prop distinto es la defensa barata
contra reintroducir esa clase de bug en el próximo lugar que lo toque.
`recruiting/(recruiting)/layout.tsx` ya traía `profile.role` y
`profile.module_access` en su `select()` desde D-051/D-052, pero los
descartaba al construir `RecruitingProfile` — ahora se pasan por separado al
`TopBar`, **sin** meterlos dentro de ese tipo (que es de recruiting y no
debe cargar columnas de deliveries, mismo principio de D-050).

**Destino por módulo:** deliveries usa `roleHome(deliveriesRole)`, nunca
`landingRoute()` — esa función devolvería `/home` de nuevo si la persona
sigue teniendo 2+ módulos, convirtiendo "saltar a deliveries" en un rebote
al selector. Recruiting (y cualquier módulo futuro) usa su propio
`MODULES[i].href`, que ya existía.

**El chofer nunca lo ve — regla dura, no un efecto secundario de datos
vacíos.** `ModuleSwitcher` no renderiza nada (ni oculto) si
`deliveriesRole === 'driver'`, exactamente la misma excepción explícita que
`landingRoute()` (D-051) ya le aplica a `/home`. No depende de que
`module_access` esté vacío — si mañana alguien le pusiera `recruiting_role`
a un chofer por error, el switcher seguiría sin aparecerle.

**Fix de paso, en el mismo commit: `HomeSelector`'s `href` de deliveries
estaba hardcodeado a `"/"`.** Inofensivo hasta ahora porque el único usuario
con 2+ módulos es admin (`roleHome('admin') === '/'`), pero
`roleHome('warehouse')` es `/warehouse` y `roleHome('logistics')` es
`/routes` — un almacén o logística con dos módulos habría aterrizado en la
tabla de Órdenes, a la que ni siquiera tienen tab. Con más merges esto deja
de ser teórico. `HomeSelector` ahora usa `roleHome(me.role)` igual que el
switcher — el hub y el switcher se comportan idéntico.

**Verificado:**
- `accessibleModules()`: vacío → solo deliveries; `["recruiting"]` →
  deliveries + recruiting en ese orden; una entrada que no existe en
  `MODULES` se ignora en vez de reventar. Tres tests nuevos en
  `landing-route.test.ts` (mismo archivo que ya cubre `landingRoute`, mismo
  tema).
- Trazado contra los perfiles reales de producción: Maximo Garza
  (`role='driver'`) — el switcher no monta nada, independiente de su
  `module_access` (vacío hoy). El dueño (`role='admin'`,
  `module_access=['recruiting']`) — aparece en ambas barras; desde
  deliveries, "Recruiting" lleva a `/recruiting`; desde recruiting,
  "Deliveries" lleva a `roleHome('admin')` = `/`, no a `/home`.
- `tsc`/`vitest` (461)/`next build` limpios.

**Consecuencia aceptada:** ninguna — es aditivo puro. No se tocó
`landingRoute()`, `/home/page.tsx`, RLS ni ninguna migración.

**Addendum (2026-08-19, mismo día) — la barra tenía una trampa de flex
preexistente que este cambio destapó.** Reportado: con el switcher presente,
la barra se desbordaba horizontalmente y los tabs de la derecha (p. ej.
"🧭 Gestor de Rutas") quedaban cortados fuera de pantalla, en escritorio
angosto y en móvil.

Causa real, en dos partes:
1. **Estructural, ya existía antes de D-054.** El contenedor derecho de la
   barra (`TopBar.tsx`, el `<div style={{display:"flex", flexWrap:"wrap"}}>`
   que envuelve `.tabs` + los controles de cuenta) nunca tuvo
   `min-width: 0`. Por default, un hijo flex se niega a encogerse por debajo
   del ancho de su descendiente más ancho que no puede partirse — acá, el
   nombre completo en el link de cuenta (p. ej. "Patricia Hernández"). Sin
   ese override, el contenedor no cedía espacio a `.tabs` cuando hacía
   falta, y `.tabs` terminaba empujado fuera del viewport en vez de
   envolver a una línea más.
2. **De contenido.** El único usuario con 2+ módulos hoy es admin, que ve
   **todos** los tabs (incluido "Gestor de Rutas", normalmente solo de
   logística) — su fila ya estaba cerca del límite. El botón del switcher
   fue lo que la hizo desbordar, pero no la causó: era la trampa de arriba
   esperando a que algo la destapara.

**Arreglado (solo CSS/layout, cero cambio de lógica de D-054 — quién ve el
switcher, la excepción del chofer y `accessibleModules()` intactos):**
1. `ModuleSwitcher` pasó de botón de texto ("🔀 Cambiar ▾") a solo ícono
   (🔀, con `aria-label`/`title` bilingües vía `usePrefs()`); el menú
   desplegado sigue mostrando emoji + nombre completo de cada módulo.
2. `min-width: 0` explícito en el contenedor derecho de **ambos** `TopBar`
   (deliveries y recruiting — mismo patrón inline exacto en los dos).
3. `min-width: 0` explícito también en `.tabs` (`globals.css`) — no se
   asumió que el default del navegador ya resolvía a 0 en un contenedor
   flex anidado con `flex-wrap`; sin poder confirmarlo en un navegador real
   para este proyecto, se dejó explícito en vez de suponerlo.

**Por qué esto ya no puede volver a pasar, no solo "mejoró":** con
`min-width: 0` explícito en cada nivel de la cadena (el contenedor derecho
y `.tabs`, ambos ya con `flex-wrap: wrap`), no queda ningún mecanismo de
CSS por el que el contenido pueda forzar un desborde — el navegador siempre
puede encoger y envolver en vez de desbordar. Verificación: el
descendiente-sin-partir más ancho de toda la barra es el tab principal más
largo en español ("🧭 Gestor de Rutas", ~165px con su padding) o un nombre
completo real de producción (~150-190px con avatar) — ninguno de los dos se
acerca a 360px, el viewport angosto más chico contemplado. Es una prueba
estructural del modelo de caja, no una captura de pantalla — este proyecto
no usa navegador para verificar (`no_chrome_extension`), así que no se
puede "mirar" el resultado; se puede demostrar que ya no es posible que
ocurra.

**Tests:** sin test nuevo — es CSS puro, sin lógica que fijar (el test de
`accessibleModules()` de D-054 ya cubre lo único con lógica real acá).
`tsc`/`vitest` (461)/`next build` limpios.

**Segunda nota (2026-08-19, mismo día, v1.10.3) — el ícono en sí no se veía.**
Screenshot real: el botón del switcher aparecía como un cuadrado en blanco
en vez del ícono. Causa: `🔀` (flechas cruzadas) no tiene glifo en la pila
de fuentes de la app (`'Inter', system-ui, sans-serif`) en ese navegador —
el navegador dibuja el rectángulo vacío ("tofu") que se ve en la captura en
vez del carácter. Se cambió por `⇄` (U+21C4, símbolo de flechas del bloque
Unicode estándar, no un emoji a color) — mismo significado, sin depender de
que el sistema tenga una fuente de emoji con ese carácter específico. `🔀`
sigue en uso en otros dos lugares del código (botón "Unir" de
`routes/page.tsx`, ícono de etapa en `ModalHost.tsx` de recruiting) — no se
tocaron, no fueron reportados como rotos y está fuera del alcance de este
cambio; si algún día se ven igual de vacíos, es la misma causa.

---

## D-055 · Botón "volver al hub", junto al switcher
**Fecha:** 2026-08-19 · **Versión:** v1.11.0 · **Pedido por:** Andrés

**Cambio:** `ModuleSwitcher.tsx` gana un segundo control, `⌂` (enlace directo
a `/home`), junto al botón de salto directo `⇄` que ya existía. Mismo
`<ModuleSwitcher/>` compartido, mismo gate — ningún `TopBar` cambió, porque
la firma de props no cambió, solo lo que el componente renderiza adentro.

**Modelo confirmado con el dueño, ahora con dos formas de moverse para
quien tiene 2+ módulos:**
- **1 módulo** → entra directo, sin hub ni switcher — sin cambios.
- **2+ módulos** → **(a)** el switcher (`⇄`) salta directo al otro módulo, y
  **(b)** el botón nuevo (`⌂`) vuelve a `/home` a elegir ahí. Dos caminos al
  mismo lugar, no uno reemplazando al otro.

**Razón:** saltar directo es rápido cuando ya sabés a dónde vas; volver al
hub sirve cuando alguien quiere ver las tarjetas de nuevo (por ejemplo, con
un tercer módulo algún día, para comparar opciones en vez de saltar a
ciegas al primero de la lista).

**Por qué el botón no existe para quien tiene 1 módulo — no es un
recorte, es lo único correcto.** Para esa persona, `/home` no muestra nada:
`landingRoute()` (D-051) la redirige de inmediato de vuelta a su única
pantalla, porque tiene menos de 2 módulos. Un botón que solo rebota no es
un botón, así que comparte el mismo `if (deliveriesRole === 'driver' ||
modules.length < 2) return null;` que ya gobernaba el switcher — **no se
duplicó la condición, se reutilizó la misma**, exactamente para no crear
un segundo lugar donde esa regla pudiera divergir.

**Verificado que no reintroduce el desborde de la barra (mismo patrón de
verificación de D-054):** con `⌂` + `⇄` juntos, el clúster completo del
switcher mide ~90px (dos botones de un solo carácter, ~44px cada uno con
su padding, más 2px de separación) — **menos** de lo que ocupaba el botón
de texto original ("🔀 Cambiar ▾", ~90-110px) que ya se había medido como
seguro. El `min-width: 0` que ya cubre cada nivel de la cadena (D-054
addendum) sigue siendo la garantía real — un segundo botón pequeño no
cambia esa conclusión, solo se agregó `min-width: 0` también al nuevo
contenedor que envuelve los dos botones, por la misma disciplina.

**Consecuencia aceptada:** ninguna — aditivo puro, mismo componente, mismo
gate, sin tocar `landingRoute()`, `/home/page.tsx` ni ninguna lógica de
D-054.

**Verificado:** `tsc`/`vitest` (461)/`next build` limpios. No hizo falta
test nuevo — el gate es el mismo `if` de D-054, ya cubierto por
`accessibleModules()`.

**Addendum (2026-08-19, mismo día, v1.11.1) — el problema real no era el
ancho, era la posición del menú.** Reportado de nuevo: "el botón de cambiar
de módulo aún está oculto, se sale del window y no se mira." Esta vez se
verificó con evidencia real, no solo lectura de CSS: se reconstruyó la
barra completa (mismas clases de `globals.css`, mismos tabs de admin, mismo
markup) en un archivo HTML estático y se capturó con Chrome en modo
headless (`chrome.exe --headless --screenshot`, distinto del navegador MCP
que este proyecto no usa) en 1280/768/375/320px.

El botón en sí **siempre estuvo visible** en las cuatro capturas — el
desborde de D-054 sí quedó resuelto. El bug real apareció al abrir el
**menú**: `.col-menu` estaba anclado con `right: 0, left: "auto"` sin
condición, el mismo patrón que el menú "General ▾" de `TopBar.tsx` — pero
sin la lógica de "flip" que ese menú **sí tiene** (comentario textual en
`TopBar.tsx`: *"corre fuera de la ventana quien el botón está cerca del
borde izquierdo — y en una fila de tabs que envuelve, siempre pasa"*). El
switcher, al vivir en la fila derecha que envuelve constantemente (es lo
último que consigue espacio), termina seguido cerca del borde izquierdo —
y ahí, `right: 0` empuja un menú de 200px hacia la izquierda, fuera de la
pantalla. Capturado en 768px y 375px: la tarjeta blanca aparecía cortada
contra el borde izquierdo, con el texto "Reclutamiento" invisible o
recortado a "...nto".

**Arreglado:** se portó el mismo mecanismo de `TopBar.tsx` al
`ModuleSwitcher` — `useRef` en el menú, `useEffect` que mide
`getBoundingClientRect().left < 8` al abrir y flipea a `left: 0, right:
"auto"` cuando no hay espacio. Reverificado con la misma técnica (HTML
estático + JS que replica exactamente la medición del efecto) en
1280/768/375/320px: el menú ahora entra completo en la pantalla en los
cuatro anchos, y sigue anclado a la derecha sin cambio en escritorio ancho
(sin flip innecesario donde no hace falta).

**Por qué esto no se atrapó en D-054/D-055:** ambos verificaron el
**botón** (visible, con el ancho correcto) pero nunca el **menú abierto**
en un ancho donde el switcher ya hubiera envuelto a una fila propia — el
comentario que ya advertía exactamente este riesgo estaba a la vista, en
el mismo archivo, y no se aplicó al componente nuevo.

**Tests:** sin test nuevo — es un efecto de medición del DOM, no lógica de
`src/lib`. Verificación fue visual (headless), documentada arriba con el
método exacto. `tsc`/`vitest` (461)/`next build` limpios.

---

## D-056 · Usuarios se muda al hub — primera herramienta compartida
**Fecha:** 2026-08-19 · **Versión:** v1.12.0 · **Pedido por:** Andrés

**Cambio:** la pantalla de Usuarios deja de vivir dentro de deliveries y pasa
a `/home/users`, colgada del hub (`/home`, D-051) en vez de dentro de un
módulo específico. `(app)/users/page.tsx` y
`recruiting/(recruiting)/users/page.tsx` quedan como redirects de una línea
hacia el nuevo domicilio — ningún enlace viejo muere. Mismo `UserDialog.tsx`,
mismas funciones de `data-provider.tsx` (incluida
`updateUserRecruitingAccess` de D-053): cambia el domicilio, no el
comportamiento.

**Razón:** Usuarios nunca fue realmente "de deliveries" — desde D-053 ya
gestiona el acceso a Recruiting también. Tenerla adentro de un módulo
específico era el vestigio de cuando de verdad lo era. El hub es el nivel
neutral correcto para algo que ninguno de los dos módulos es dueño.

**El patrón genérico — `HUB_TOOLS`, hermano de `MODULES` pero por rol, no
por otorgamiento.** Un módulo se concede (`module_access`, D-050); una
herramienta del hub viene con el rol — nadie "otorga" Usuarios, se tiene por
ser admin de deliveries. Por eso `HubTool` lleva un predicado
`visible(me)` en vez de una lista de membresía. `HomeSelector` (qué
tarjetas dibujar) y `ModuleSwitcher` (si el botón `⌂` tiene a dónde ir)
leen de la misma lista — una segunda herramienta compartida el día de
mañana es una entrada nueva en `HUB_TOOLS`, cero cambios en esos dos
archivos.

**La separación aterrizaje/permanencia — el punto más delicado del
cambio.** `landingRoute()` **no se tocó**: un admin de un solo módulo sigue
aterrizando directo en `/` después de iniciar sesión, exactamente como
antes. Lo que cambió es una pregunta distinta, que antes no existía por
separado: "¿hay algo para esta persona si navega a `/home` a propósito?"
— antes esa pregunta usaba la misma función que decide el aterrizaje
automático, lo cual habría rebotado a un admin de un solo módulo que
llegara ahí a buscar Usuarios. `home/page.tsx` ahora tiene
`hasReasonToBeHere = accessibleModules(...).length > 1 ||
HUB_TOOLS.some(t => t.visible(me))`, una expresión separada, no un parche
dentro de `landingRoute()` — mezclar esas dos preguntas en una sola función
es exactamente el tipo de confusión que ya produjo los bugs de D-052.

**`ModuleSwitcher` gana dos condiciones donde antes tenía una.** `⇄`
(saltar directo) sigue exigiendo 2+ módulos — sin cambio. `⌂` (volver al
hub) ahora se muestra si hay 2+ módulos **o** si `HUB_TOOLS` tiene algo
visible para esa persona — así que un admin de deliveries-solo ve `⌂` sin
`⇄`, porque no hay a dónde saltar pero sí a dónde ir. El chofer sigue
cortado antes que cualquiera de las dos condiciones: `role` es un valor
único por persona (nunca `admin` y `driver` a la vez), así que la
excepción no necesitó ningún caso especial nuevo.

**Retirado en el mismo cambio: la capacidad extra `"users"`.** Existía en
`CAPABILITIES`/`ROLE_CAPS`/el tipo `Capability`, otorgable a un no-admin
desde el diálogo de usuario — pero nunca dio acceso real: la pantalla
siempre exigió `role==='admin'` a secas, capacidad extra o no (línea 48 de
la vieja `users/page.tsx`: *"Admins only"*). Era un checkbox que mentía.
Confirmado antes de borrar: cero perfiles en producción la tienen otorgada
(`select ... where permissions @> array['users']` → 0 filas), así que
retirarla no deja datos huérfanos visibles en ningún diálogo.

**Endurecimiento gratis, no el objetivo del cambio.** La vieja
`(app)/users/page.tsx` era un Client Component: montaba el
`DataProvider`, cargaba `users`, y solo *después* bloqueaba con un mensaje
a quien no fuera admin. `home/users/layout.tsx` es un Server Component que
hace `redirect(landingRoute(me))` **antes** de montar nada — mismo patrón
que ya usa el layout de recruiting (D-052) para su propio gate. La
autoridad real no se movió ni un milímetro: `guard_recruiting_access_change`
(D-050) sigue exigiendo admin de deliveries para cualquier escritura a
`recruiting_role`/`module_access`, sin que le importe desde qué URL salió
el request — mover la pantalla no puede aflojar un trigger que vive en la
base.

**Localidad, mismo principio que D-052 aplicó a recruiting.** El
`DataProvider` de deliveries vive en `home/users/layout.tsx`, no en el
`home/layout.tsx` padre — el selector (`/home` a secas) no toca ni un dato
de deliveries, así que montarle los canales de realtime ahí habría sido
pagar un costo que esa pantalla no usa.

**`/home/users` lleva solo un enlace de vuelta al hub, no el switcher
completo** — decisión explícita del dueño: es una pantalla de trabajo
puntual, no otro lugar desde el que saltar de módulo en módulo.

**Consecuencia aceptada — modo local (`NEXT_PUBLIC_LOCAL_MODE`) pierde
Usuarios.** `/home` nunca soportó el modo demo local (ya era así desde
D-051 — su `page.tsx` siempre exigió una sesión real de Supabase, nunca
tuvo una rama para `LocalApp`). Al redirigir `(app)/users` incondicionalmente
a `/home/users`, alguien en modo local que navegue a `/users` termina en un
layout que exige sesión real y no la tiene — mismo hueco que el hub ya
tenía, extendido de forma consistente, no uno nuevo. No se resolvió acá
porque el modo local nunca fue parte de este cambio; queda anotado por si
alguna vez importa.

**Verificado:**
- `tsc`/`vitest` (462, uno nuevo para `HUB_TOOLS.users.visible`)/`next build`
  limpios. `/home/users` compila a 8.12 kB, casi idéntico a los 8.05 kB que
  pesaba `/users` antes de moverse — mismo componente, confirmado también
  por tamaño.
- `grep '"users"'` en todo `src`: cero referencias rotas a la capacidad
  retirada — solo la clave nueva de `HUB_TOOLS` (namespace distinto) y la
  pestaña de recruiting hacia `/recruiting/users`, que sigue funcionando
  vía el redirect en cadena.
- Reconstrucción visual (Chrome headless, mismo método de D-054/D-055): un
  admin de 1 módulo ve solo `⌂` en la barra, nunca `⇄`; el hub le muestra
  la tarjeta de Deliveries más la fila "Herramientas → Usuarios", visualmente
  distinta de las tarjetas de módulo a propósito (`.hub-tool-row`, no
  `.module-pick-card`).
- Confirmado por SQL contra producción real que ningún perfil tenía la
  capacidad `"users"` otorgada antes de retirarla.

---

## D-057 · Diálogo de usuario rediseñado — un bloque por módulo
**Fecha:** 2026-08-19 · **Versión:** v1.13.0 · **Pedido por:** Andrés

**Cambio:** `UserDialog.tsx` deja de tener "Rol y alcance" + "Permisos extra"
(deliveries) y "Acceso a otros módulos" (recruiting) como tres secciones
separadas y asimétricas. Ahora es un solo loop sobre `MODULE_ACCESS`
(`constants.ts`, nuevo): un bloque por módulo, cada uno con su propio
selector de rol y, si el descriptor lo trae, su propio catálogo de permisos
finos. Identidad (nombre/usuario/correo) y Acceso (contraseña/último
ingreso) no se tocaron — son de la persona, no de ningún módulo.

**El descriptor, genérico para N módulos:** `ModuleAccessConfig` declara,
por módulo, `roleColumn` (`"role"` o `"recruiting_role"` — a qué columna
escribe su selector de rol), `roleKeys`/`roleLabel` (apuntan a
`ROLE_ORDER`/`roleLabel()` y `RECRUITING_ROLE_LABELS` existentes, no los
copian), `alwaysOn`, y `capabilities`/`capabilitiesFromRole` **opcionales**
— presentes en deliveries (apuntan a `CAPABILITIES`/`ROLE_CAPS`
existentes), ausentes en recruiting (no tiene permisos finos, solo el
tier). Un módulo futuro con permisos finos los trae; uno sin ellos los
omite, y esa parte del bloque simplemente no se dibuja — ningún `if`
especial en `UserDialog.tsx` para decidirlo.

**Por qué `store`/`customer_scope` no entraron al descriptor:** son
específicos de deliveries y de valores de rol concretos (warehouse/driver/
sales para tienda; manager/logistics para visibilidad de clientes) — nada
en recruiting los necesita hoy. Se quedaron como campos propios del bloque
de Deliveries, marcados en el código como no-genéricos a propósito, en vez
de inventarles un lugar en el contrato compartido para un caso que no
existe.

**Deliveries queda `alwaysOn` — sin casilla, no desmarcable. No se puede
dejar a nadie sin ningún módulo, y eso no es nuevo.** No es preferencia de
diseño: `profiles.role` es `NOT NULL`, sin un estado "ninguno" en ningún
lugar del sistema (`roleHome()`, cada RLS que usa `current_user_role()`,
el filtrado de `TABS`). Ofrecer una casilla para "quitar Deliveries" o no
haría nada real, o exigiría inventar un estado que no existe en el
esquema — eso ya no habría sido un rediseño de diálogo. Recruiting sigue
siendo el único módulo genuinamente opcional (D-050 ya previó `null`
en `recruiting_role`).

**La defensa estructural contra la clase de bug de D-052/D-053 — dos
capas, no una.** Primero: `MODULE_ACCESS` es **puro dato**, nunca decide
qué función llamar. `UserDialog.tsx` tiene dos funciones de despacho
(`setModuleRole`, `setModuleAccess`) con un `switch` **exhaustivo** sobre
`ModuleAccessKey` — un tipo unión **cerrado** (`"deliveries" |
"recruiting"`), deliberadamente menos genérico que `MODULES`/`HUB_TOOLS`.
Un módulo agregado a `MODULE_ACCESS` sin agregar su caso al switch falla
`tsc` (el patrón `const _exhaustive: never = key`), no escribe en la
columna equivocada en producción. Segundo: un test nuevo,
`MODULE_ACCESS.map(m => m.roleColumn)` sin valores repetidos — si algún
día dos módulos apuntaran a la misma columna, la prueba se rompe sola.
`updateUserRole`/`updateUserPermissions`/`updateUserRecruitingAccess` (las
tres de `data-provider.tsx`) **no se tocaron ni se fusionaron** — la
genericidad vive en qué se dibuja, nunca en qué se escribe.

**Verificado por columna contra producción real (transacciones con
`rollback`, nunca se escribió nada de verdad):** simulando exactamente lo
que dispara cada bloque, sobre el perfil real de Gloria Santoscoy
(contabilidad) —
1. El bloque de Deliveries cambia `role` → `recruiting_role`,
   `module_access` y `permissions` quedan exactamente igual que antes.
2. El bloque de Recruiting otorga acceso → `recruiting_role` y
   `module_access` cambian, `role` y `permissions` quedan exactamente
   igual que después del paso 1 (no revierte, no interfiere).
3. Un no-admin (Angel Cabrera) intentando cualquiera de los dos —
   rechazado por su trigger correspondiente, con su mensaje propio:
   *"Only an admin can change user roles"* para el intento sobre `role`,
   *"Only an admin can change recruiting access or role"* para el intento
   sobre `recruiting_role`/`module_access`. Dos triggers independientes,
   ninguno tocado, cada uno sigue siendo la autoridad real de su columna —
   el rediseño es de interfaz, no aflojó nada.

**Consecuencia aceptada:** ninguna real — la gente existente no cambia de
comportamiento, solo se ve distinto (el mismo dato, en un bloque en vez de
tres secciones sueltas). Se quitó el contador visual "🔑 +N" que vivía en
el encabezado de "Permisos extra" (ese variable `extra` quedó sin uso al
mover las capacidades dentro del bloque) — el mismo indicador sigue
existiendo en la fila de la lista de usuarios (`home/users/page.tsx`), así
que la información no se pierde, solo deja de repetirse dentro del propio
diálogo.

**Verificado:** `tsc`/`vitest` (465, tres nuevos)/`next build` limpios.

**Nota (2026-08-19, mismo día, v1.13.1) — consistencia visual, cero cambio
de comportamiento.** Pedido: que el bloque de Deliveries también mostrara
una casilla, para que los dos bloques se lean como el mismo patrón en vez
de "algunos módulos tienen casilla y otros no." Ahora la tiene —
marcada, deshabilitada, con una etiqueta "todos" — pero **sigue sin
poderse desmarcar**: la razón de `alwaysOn` (línea arriba, `profiles.role`
`NOT NULL`) no cambió, solo cómo se ve. Verificado con la misma
reconstrucción estática por Chrome headless que ya viene usando esta
serie de cambios.

---

## D-058 · "Mi ruta" deja de ser un tab automático de admin
**Fecha:** 2026-08-20 · **Versión:** v1.13.2 · **Pedido por:** Andrés

**Cambio:** la pestaña "🧭 Mi ruta" (`myroute`, `constants.ts`) pierde
`"admin"` de su lista `roles`. Queda `roles: ["driver"], cap: "deliver"` —
solo un chofer la ve por default; cualquier otra persona (incluido un
admin) la ve solo si tiene "deliver" otorgado como permiso extra
individual (`UserDialog`, el bloque de Deliveries), no por el solo hecho
de ser admin.

**Razón (textual):** *"yo no soy conductor entonces almenos que seas
conductor o te lo actives en tu forma de usuario no necesitar ver esa
view de mi ruta"*.

**Por qué esto no era ya así — la regla existía, pero esta pestaña era la
excepción.** El propio comentario que gobierna `visibleTabs` en
`TopBar.tsx` ya dice, textual, que un rol que carga la capacidad
`"deliver"` de fábrica (warehouse: `["fulfill","deliver"]`) no debería por
eso ver la pestaña de Driver — la visibilidad por `cap` es para un permiso
otorgado a esa persona en particular, no para lo que el rol ya trae. "Mi
ruta" no seguía esa regla: tenía `"admin"` metido directo en `roles`, así
que cualquier admin la veía sin importar si de verdad reparte. Se corrigió
para que siga el mismo principio que el resto de las pestañas con `cap`.

**Por qué la página en sí no se tocó.** `/my-route/page.tsx` sigue
gateada por `canDeliver(me)`, que sí cuenta la capacidad de rol (a
diferencia del filtro de `TABS`, que solo cuenta lo otorgado extra) — un
admin que entre a la URL directamente sigue pudiendo abrirla. Lo que
cambió es si aparece sola en la barra, no si existe.

**Consecuencia aceptada:** ninguna real — nadie perdió acceso, solo
visibilidad por default. Si algún día un admin específico sí reparte,
`UserDialog` → bloque de Deliveries → "Permisos extra" → "Deliver orders"
se la devuelve.

**Verificado:** `tsc`/`vitest` (465)/`next build` limpios.

---

## D-059 · La pestaña "Hoy" de recruiting era un enlace muerto — quitada
**Fecha:** 2026-08-20 · **Versión:** v1.13.3 · **Pedido por:** Andrés

**Cambio:** se quita la pestaña "🏠 Hoy"/"Today" de `TABS` en
`src/lib/recruiting/constants.ts` (apuntaba a `/recruiting/today`) y su
entrada correspondiente en `TAB_ES` (`TopBar.tsx` de recruiting).

**Razón (textual):** *"view de hoy en cruiter me da erorr 404"*.

**Por qué era un 404 y no un bug nuevo.** La página nunca existió. El
comentario que quedaba arriba del array lo decía explícito desde el
mid-port de D-052: *"Only 'candidates' ... resolves to a real page today;
the rest 404 until they're ported in a later turn"* — pero cuando el
resto de las pantallas se portaron en el commit siguiente (D-052, Etapa 2
completa), "Hoy" se quedó deliberadamente afuera: `ARCHITECTURE.md` §11 ya
documenta que *"recruiting's original '/' was a 'Today' dashboard that was
never ported — the candidates list took the module's root instead"*. La
pestaña sencillamente nunca se borró de `TABS` cuando esa decisión se
tomó — quedó apuntando a una página que ya no iba a construirse nunca,
esperando a que alguien le diera clic para descubrirlo.

**Por qué se borró en vez de construirse.** No portar "Hoy" no fue un
pendiente, fue la decisión — candidatos ya ocupa la raíz del módulo
(`/recruiting`) con ese mismo propósito de "qué tengo enfrente hoy".
Construir la página habría sido revertir una decisión ya tomada y
documentada sin que nadie lo pidiera.

**Consecuencia aceptada:** ninguna — nadie perdía nada real al no poder
entrar a una página que no existe; ahora tampoco pueden intentarlo.

**Verificado:** `tsc`/`vitest` (465)/`next build` limpios.

**Nota (2026-08-20, v1.14.0) — la pestaña volvió, esta vez con página
detrás.** *"pero la view de hoy no me sale en recuiter"* — el borrado fue
correcto para lo que había (un enlace muerto a una página que jamás
existió), pero la lectura de que no portar "Hoy" seguía siendo lo que el
dueño quería resultó equivocada: sí la quiere. Ver **D-061**: se construyó
una pantalla "Hoy" nueva desde cero contra el modelo de datos actual —no
una resurrección de la del `recruiting-app` viejo, cuyo código fuente no
vive en este repo. La raíz del módulo (`/recruiting` → Candidatos) no
cambió; D-052 sigue en pie en eso.

---

## D-060 · La pestaña del navegador decía "RDZ Deliveries" en recruiting
**Fecha:** 2026-08-20 · **Versión:** v1.13.4 · **Pedido por:** Andrés

**Cambio:** `recruiting/(recruiting)/layout.tsx` gana su propio
`export const metadata` (`title: "RECRUIT·HN | Candidates & Interviews"`).

**Razón (textual):** *"en el tab de recuiting sale rdz deliveries y no es
asi"*.

**Por qué pasaba.** `app/layout.tsx` (la raíz, compartida por toda la app)
fija el `<title>` de la pestaña del navegador a *"RDZ Deliveries | Order &
Dispatch"* — correcto para deliveries. Next.js hereda el `metadata` del
layout padre en cualquier segmento que no defina el suyo propio, y
`recruiting/(recruiting)/layout.tsx` nunca lo hizo desde que existe (D-052)
— el `<h1>` dentro de la página sí dice "RECRUIT·HN" (viene del `TopBar`
de recruiting), pero la pestaña del navegador —lo que ve alguien con
varias pestañas abiertas, antes de entrar siquiera— seguía diciendo
Deliveries. Mismo patrón de huérfano de D-059: algo que nunca se completó
al portar el módulo.

**Consecuencia aceptada:** ninguna — es metadata de una sola línea, sin
tocar RLS, datos, ni ninguna otra pantalla. `description`/`manifest`/
`icons` siguen heredando de la raíz (no reportado, fuera de este cambio).

**Verificado:** `tsc`/`vitest` (465)/`next build` limpios.

**Nota (2026-08-20, mismo día, v1.13.5) — el texto pedido, no el mío.**
*"quiero que te diga RDZ Recruitment"* — el título cambió a exactamente
eso, `"RDZ Recruitment"`, sin el `"| Candidates & Interviews"` que yo le
había puesto. Al investigar apareció algo que vale anotar: el `<h1>`
dentro de la página **ya no dice** "RECRUIT·HN" — el dueño ya lo había
personalizado a *"RTG RECRUITER"* en Ajustes (`recruiting.settings.
app_name`), desde antes de este hilo. La pestaña del navegador y el
nombre en pantalla son dos cosas independientes a propósito (leer
`app_name` para el título habría exigido un `generateMetadata()`
asíncrono consultando la base en cada request, por un texto estático) —
así que hoy dicen dos cosas distintas: "RDZ Recruitment" en la pestaña,
"RTG RECRUITER" en pantalla. Ninguna de las dos se tocó por la otra.

---

## D-061 · "Hoy" se construyó — dashboard diario de recruiting
**Fecha:** 2026-08-20 · **Versión:** v1.14.0 · **Pedido por:** Andrés

**Cambio:** nueva página `/recruiting/today`, pestaña "🏠 Today"/"🏠 Hoy" de
vuelta en `TABS` (primera de la lista). Cuatro secciones, todas derivadas
de `candidates` — nada se guarda aparte:
- **Entrevistas hoy** — `phone_date`/`inperson_date` cae en la fecha de
  hoy; acceso directo a Iniciar entrevista / Registrar resultado.
- **Resultados atrasados** — misma lógica que la pestaña Outcomes
  (`outcomeDue`, ventana de gracia de 3h), duplicada aquí a propósito para
  que no haga falta ir a otra pestaña a verlo.
- **Seguimientos pendientes** — `follow_up` vencido o de hoy, candidatos
  no archivados y fuera de etapas terminales (contratado/descartado).
- **Esperando primera llamada** — `status = "registered"` sin
  `phone_date` todavía, ordenado por fecha de registro (el más viejo
  primero = el más urgente de llamar).

**Razón (textual):** *"pero la view de hoy no me sale en recuiter"* — ver
la nota en D-059. El dueño confirmó explícitamente, al preguntársele,
que quiere una pantalla nueva construida (no un redirect a Candidatos).

**Por qué se construyó nueva en vez de portar la vieja.** El
`recruiting-app` original tenía una pantalla "Hoy" en su raíz, pero su
código fuente no está en este repo — vivía en un repo/deploy separado
que quedó fuera del alcance de D-050 (solo los datos se migraron, nunca
el código del front). No hay nada que portar; hubo que diseñarla desde
cero. Se decidió construirla contra los campos que YA existen en
`Candidate` (`phone_date`, `inperson_date`, `follow_up`, `status`,
`reg_date`) en vez de agregar columnas nuevas — así cada sección es una
vista distinta de datos que Calendar/Outcomes/Candidates ya leen, nunca
una fuente de verdad nueva que se pueda desincronizar.

**Por qué la raíz del módulo no cambió.** `/recruiting` (Candidatos)
sigue siendo la raíz — D-052 decidió eso a propósito y esta pantalla no
lo reabre. "Hoy" es una pestaña más, la primera de la lista, no una
reclamación de la raíz.

**Consecuencia aceptada:** el bloque de "Resultados atrasados" duplica la
lógica de cálculo de Outcomes (mismo `outcomeDue`/`outcomeDueAt`,
importados de `utils.ts`, no reimplementados) — dos pestañas muestran el
mismo dato con distinta presentación. Aceptado porque es exactamente el
propósito de un dashboard "Hoy": juntar lo urgente de varias pestañas en
una sola vista, sin que el dueño tenga que recorrerlas todas.

**Verificado:** `tsc`/`vitest` (465)/`next build` limpios.

---

## D-062 · Se quita la pestaña "Users" de recruiting
**Fecha:** 2026-08-20 · **Versión:** v1.14.1 · **Pedido por:** Andrés

**Cambio:** se quita la entrada `{ id: "users", ... href: "/recruiting/users" }`
de `TABS` en `recruiting/constants.ts` y su entrada en `TAB_ES` del `TopBar`
de recruiting. La ruta `/recruiting/users/page.tsx` (un `redirect("/home/
users")` desde D-056) se queda tal cual, por si alguien todavía tiene esa
URL guardada.

**Razón (textual):** *"elimina el view de usaurios en recruiter por obvias
razones"*.

**Por qué era obvio.** D-056 ya había movido la gestión de usuarios entera
al hub (`/home/users`), reachable desde cualquier módulo vía
`ModuleSwitcher`/`HUB_TOOLS` — y en ese mismo cambio, la página de
recruiting se redujo a un simple `redirect`. Pero la pestaña "🛡 Users" se
quedó en `TABS`, así que seguía apareciendo en la barra de recruiting
como si llevara a algo propio del módulo, cuando en realidad su único
comportamiento era rebotar de inmediato a otra pantalla. Mismo patrón de
huérfano que D-058/D-059: una entrada que dejó de tener sentido cuando la
decisión de fondo cambió, pero que nadie borró en ese momento.

**Consecuencia aceptada:** ninguna — el acceso a Users no se pierde, solo
el atajo redundante. Se mantiene el `redirect` en vez de borrar la ruta
por completo, siguiendo el mismo criterio que D-056 ya había fijado para
bookmarks viejos.

**Verificado:** `tsc`/`vitest` (465)/`next build` limpios.

---

## D-063 · La barra de "nueva versión" solo salía en deliveries
**Fecha:** 2026-08-20 · **Versión:** v1.14.2 · **Pedido por:** Andrés

**Cambio:** `<AppUpdateBanner />` se monta también en `home/layout.tsx` (el
hub) y en `recruiting/(recruiting)/layout.tsx`, antes que nada más en cada
uno — mismo lugar donde ya vivía en `TopBar.tsx` de deliveries.

**Razón (textual):** *"la barra de update con una nueva version no esta
saliendo en toda la view solo en deliveries, no sale ni en hub ni en
recruiting"*.

**Por qué pasaba.** `AppUpdateBanner` nunca vivió en un layout raíz
compartido — estaba escrito directamente dentro de `src/components/
TopBar.tsx`, el `TopBar` de **deliveries**, no en ningún punto común a los
tres shells de la app (`(app)/layout.tsx`, `home/layout.tsx`,
`recruiting/(recruiting)/layout.tsx` son independientes entre sí desde
D-052/D-056 — ninguno hereda del otro). Cualquier página fuera de
`(app)` simplemente nunca montaba el componente, así que ni el hub ni
recruiting sabían nunca que había un deploy nuevo.

**Por qué no hacía falta tocar el componente en sí.** `AppUpdateBanner`
ya era completamente genérico — no depende del `DataProvider` de
deliveries, solo de `usePrefs()` (global) y de `/api/version`, que
siempre respondió con el `APP_VERSION` compartido de `@/lib/constants`
(un solo número para todo el contenedor, porque es un solo deploy). Bastó
con montarlo también en los otros dos layouts — no hay una versión "de
recruiting" separada que rastrear.

**Consecuencia aceptada:** ninguna — el hub y recruiting ahora comparten
la misma auto-recarga y el mismo comportamiento de "no molestar" que ya
tenía deliveries (nunca recarga con un modal abierto o un campo con foco).

**Verificado:** `tsc`/`vitest` (465)/`next build` limpios.

---

## D-064 · Merge con timetracker, Etapa 1 — datos unificados
**Fecha:** 2026-08-20 · **Versión:** v1.15.0 · **Pedido por:** Andrés

**Cambio:** cuatro migraciones nuevas (058–061) crean `timetracker.*` en el
Supabase de deliveries: 8 tablas (`employee_settings`, `projects`,
`assignments`, `sessions`, `requests`, `payrolls`, `settings`, `audit`,
`screenshots`) + bucket de Storage `timetracker-screenshots`, RLS completo,
realtime, retención por `pg_cron`. `public.profiles` gana `timetracker_role`
(`admin | employee`) y `'timetracker'` como tercer valor de `module_access`.
Sin UI todavía — no existe `/timetracker/*` — y sin datos reales migrados.

**Razón (textual):** *"ok ahora vamos a hacer el merge con otra apliacion
que es la timetracker"*.

**Por qué es un caso distinto a recruiting, no el mismo playbook otra vez.**
Recruiting era Next.js-a-Next.js — pasar a route group hermano fue
mecánico. Timetracker es una SPA de Vite (sin `react-router`, ruteo por
estado) con un TERCER cliente además de la web: un desktop de Electron que
hoy empaqueta el build de Vite localmente (`loadFile`), no carga un sitio
en vivo. Decisión tomada con el dueño antes de tocar código: cuando la UI
se porte, el desktop apuntará a la URL en vivo (`loadURL`), igual que el
APK de chofer — no se va a mantener un segundo árbol de Vite/React aparte
para siempre.

**Por qué `employee_settings` es una tabla propia y no más columnas en
`profiles`.** A diferencia de recruiting, cuyo perfil apenas tenía campos
propios, el `profiles` original de timetracker traía 8 columnas de HR/pago
(`pay_method`, `pay_details`, `worker_type`, `track_mode`,
`breaks_enabled`, `active`, `city`, `deleted_at`). Meterlas en el
`public.profiles` compartido las cargaría en todos los módulos para
siempre. Se quedan en `timetracker.employee_settings` (1 fila por persona,
`id references public.profiles(id)`) — el mismo límite que recruiting ya
respetaba, solo que aquí sí importaba porque esta vez había algo que
respetar.

**Por qué el RLS es más granular que el de recruiting.** 057 le dio a
recruiting una sola regla plana porque nada ahí es privado entre sus
propios miembros. Timetracker sí tiene eso: `sessions`/`requests`/
`payrolls`/`screenshots` son dueño-o-admin — un empleado lee su propio pago
y sus propias capturas, nunca las de un compañero. Es exactamente el
límite de privacidad que el propio historial de timetracker ya tuvo que
arreglar una vez (las reglas viejas de Firebase dejaban que cualquier
empleado leyera el pago de todos).

**Un bug de escalación de privilegios real, atrapado antes de tocar datos
reales.** El primer intento de `is_timetracker_admin()` devolvía `NULL`
(no `false`) para cualquier empleado sin `timetracker_role` — y un guard
en plpgsql escrito como `if not is_timetracker_admin() and ... then raise`
lo dejaba pasar, porque `not NULL` es `NULL`, y `NULL` es "falso" para un
`if`. Se detectó probando el camino exacto de auto-escalación (transacción
con rollback, impersonando a alguien sin rol) antes de confiar en la
migración — la misma disciplina de verificación que ya se usa en todo el
proyecto. Arreglado envolviendo la función como `select coalesce((select
...), false)`.

**GRANTs que faltaban por completo, y que revelaron que los de recruiting
tampoco están documentados.** `create schema` no le da permiso a nadie más
que al dueño — RLS solo corre después de que el GRANT estándar de SQL lo
permite. La migración 061 los agrega para `timetracker.*`. Comparando
contra producción salió que `recruiting.*` ya tiene los mismos GRANTs —
pero nunca quedaron en 055/056/057 ni en ningún otro archivo del repo;
alguien los aplicó a mano una vez, fuera de toda migración. No se corrige
retroactivamente aquí (fuera de alcance de este cambio), pero queda
anotado: las migraciones de recruiting por sí solas no reproducen su
propio schema desde cero.

**Por qué el bucket se llama `timetracker-screenshots` y no
`screenshots`.** La app original era dueña de ese nombre en su propio
proyecto; aquí comparte el namespace plano de Storage con los buckets de
deliveries y el `resumes` de recruiting, así que lleva el mismo prefijo de
módulo que todo lo demás.

**Por qué se descartó "el primer usuario en registrarse es admin".** Tenía
sentido en una app nueva y vacía; es peligroso en un contenedor con años
de usuarios y un admin real. El acceso se otorga igual que en recruiting:
un admin de deliveries pone `timetracker_role` desde el diálogo de
Usuarios del hub (D-057) — cuando exista esa UI —, nunca por registrarse.

**Consecuencia aceptada:** ninguna a datos reales — esta etapa es schema
vacío, verificado con transacciones que hacen rollback, sin tocar el
proyecto viejo de timetracker (`qklsxhzmbnglgzufdbmz`), que sigue vivo
intacto. Falta la Etapa 2 completa: puerto de ~18 pantallas a
`timetracker/(timetracker)/`, migración de datos reales de pago/capturas,
y reinvitar a los empleados actuales de timetracker al Auth de deliveries
(Supabase no soporta mover contraseñas entre proyectos).

**Verificado:** las 4 migraciones aplicadas contra producción y confirmadas
por consulta directa (9 tablas, columnas nuevas en `profiles`, conteo de
políticas RLS, bucket, publicación realtime, cron job, funciones). Bug de
`is_timetracker_admin()` reproducido y luego confirmado corregido con
transacciones de prueba (rollback, sin persistir nada). `tsc`/`vitest`
(465)/`next build` limpios (sin cambios de TypeScript en esta etapa).

---

## D-065 · Timetracker entra al hub y al diálogo de Usuarios
**Fecha:** 2026-08-20 · **Versión:** v1.15.1 · **Pedido por:** Andrés

**Cambio:** timetracker se agrega a los tres registros genéricos que
recruiting ya usaba — `MODULES` (tarjeta en el hub/`ModuleSwitcher`,
D-054), `MODULE_ACCESS` (bloque propio en el diálogo de Usuarios, D-057) —
más `updateUserTimetrackerAccess()` (mismo molde exacto que
`updateUserRecruitingAccess()`) en ambos `DataState` (Supabase y local-mode
stub, como recruiting). `ModuleAccessKey` gana `"timetracker"`;
`Profile.timetracker_role` se agrega al tipo compartido.

**Razón (textual):** *"si y siempre verdad asi se agrega al hub y de esa
forma al igual que al modo de usuario lo mismo porfavor"* — confirmando
seguir con la Etapa 2 y pidiendo el mismo tratamiento que recruiting tuvo
en el hub y en Usuarios.

**Estado intencional: la tarjeta puede llevar a un 404 hoy.** `/timetracker`
no existe todavía (Etapa 2, UI, sigue pendiente) — mismo estado a medio
portar que recruiting tuvo brevemente durante D-052, documentado ahí
mismo. Nadie tiene `timetracker` en `module_access` todavía (0 filas en
producción), así que en la práctica la tarjeta no aparece para nadie hasta
que un admin la otorgue a propósito desde el diálogo ya wireado.

**Un bug real encontrado al conectar el tercer módulo, no al escribir el
primero.** La lectura del rol actual en `UserDialog.tsx` no era tan
genérica como el resto: `const currentRole = m.roleColumn === "role" ?
u.role : (u.recruiting_role ?? undefined)` — funcionaba con dos módulos
por coincidencia (todo lo que no era `"role"` era recruiting), pero con un
tercero habría mostrado el rol de recruiting dentro del bloque de
timetracker. Corregido a una búsqueda genérica por `roleColumn`
(`u[m.roleColumn]`). El lado de ESCRITURA (`setModuleRole`/
`setModuleAccess`) ya estaba protegido por el `switch` exhaustivo de
D-057 — esto era el lado de LECTURA, que no tenía el mismo tipo de
defensa en tiempo de compilación.

**Consecuencia aceptada:** ninguna a datos reales — 0 personas con acceso
a timetracker en producción. `landing-route.test.ts` y
`security-log.test.ts` ampliados con casos de timetracker (467 pruebas).

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios.

---

## D-066 · Etapa 2, tramo 1 — Track Time ya funciona en /timetracker
**Fecha:** 2026-08-20 · **Versión:** v1.16.0 · **Pedido por:** Andrés

**Cambio:** `/timetracker` deja de ser un 404 — es una pantalla real,
"Track Time", portada de `timetracker-clean/web/src/employee/Tracker.jsx`.
Base completa: `timetracker/(timetracker)/layout.tsx` (guardia de acceso +
`TopBar` propio), `timetracker-data-provider.tsx`, tipos (`lib/timetracker/
types.ts`), helpers de fecha/dinero/semana portados casi textual (`lib/
timetracker/helpers.ts`), diccionario bilingüe portado casi textual (`lib/
timetracker/i18n.ts`, ~450 claves EN+ES), CSS escopado (`.timetracker-
module`, mismo patrón que `.recruiting-module`).

**Razón (textual):** *"dale, seguimos con la etapa 2"*.

**Por qué se portó mecánicamente, no se rediseñó.** El tracker original
tiene 44 versiones de iteración real, incluyendo bugs de producción ya
encontrados y corregidos (medidor de actividad nunca conectado, sesiones
abandonadas, privacidad de nómina). Rediseñar esa lógica desde cero
arriesgaba reintroducir exactamente esos bugs. Se tradujo función por
función preservando el algoritmo (el loop de 1s, el cálculo de límite
semanal, la detección de sesión ya corriendo en otro dispositivo), solo
cambiando la capa de datos (Supabase directo → `useData()`).

**Decisiones de diseño, no solo traducción:**
- **camelCase, no snake_case.** Diverge a propósito de
  `recruiting-data-provider.tsx` (que usa el shape crudo de Postgres). Cada
  pantalla del tracker original ya lee/escribe camelCase en todas partes;
  reescribir eso en las ~18 pantallas por consistencia cosmética no valía
  el riesgo. `lib/timetracker/supabase/rowcase.ts` hace la conversión en
  un solo punto, igual que `shared/lib/supabase.js` del original.
- **`i18n.ts` es su propio diccionario por clave (`t('track.start')`), no
  el `usePrefs()`/`t(en,es)` de deliveries.** Convertir cientos de sitios
  de llamada habría sido una reescritura mucho más grande sin ganancia
  funcional.
- **Lo específico de escritorio (Electron) simplemente no está, no es un
  `if (IS_DESKTOP)` siempre en falso.** Esta ruta nunca se renderiza dentro
  de Electron — no hay bridge nativo en una pestaña de navegador — así que
  se portó tal cual el propio build web del original ya se comportaba: sin
  metering de actividad a nivel de sistema, sin detección de movimiento en
  pantalla, sin captura de screenshots (los navegadores no pueden capturar
  pantalla en silencio — así lo dice el propio brief del proyecto original).

**Huecos conocidos en este tramo, no ocultos:** sin cola offline (una
escritura de sesión que falla reintenta 3 veces y luego avisa con un
`alert`, en vez de guardarse para sincronizar después — `lib/
offlineQueue.js` del original no se portó todavía); sin notificaciones de
SO/navegador (los avisos de límite semanal y "empezó a trackear" son solo
banners dentro de la app). Quedan pendientes: 17 de ~18 pantallas, la
migración real de datos de nómina/capturas, reinvitar a los empleados
actuales de timetracker, y el repunte del desktop de Electron a `loadURL`
(decisión ya tomada en D-064).

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios — `/timetracker`
aparece como página real (4.34 kB) en la salida del build.

---

## D-067 · Etapa 2, tramo 2 — "Mi semana"
**Fecha:** 2026-08-20 · **Versión:** v1.16.1 · **Pedido por:** Andrés

**Cambio:** `/timetracker/week`, portada de `employee/EmployeeWeek.jsx` —
hoja de horas semanal de solo lectura: total por proyecto (regular/extra/
sobre el límite), entradas agrupadas por día (acordeón), estado de la
semana (activa/en revisión/pagada). `myPayrolls` se agrega a
`timetracker-data-provider.tsx` (mismo patrón que `mySessions`:
`reloadAll()` + realtime filtrado por `employee_uid`).

**Razón (textual):** *"seguimos con la próxima pantalla"*.

**Por qué fue un puerto más directo que Track Time.** Es una pantalla de
reporte (lee `sessions`/`assignments`/`payrolls`, calcula con
`computePay()` ya portado, sin escribir nada) — no tiene las
preocupaciones de escritorio/cola offline/tick en vivo que Track Time sí
tenía. El `useSettings()` propio del original se reemplazó por leer
`settings` directo de `useData()` (ya existe ahí desde D-066, no hacía
falta portar un segundo contexto).

**Consecuencia aceptada:** ninguna nueva — mismos huecos ya documentados en
D-066 (siguen sin tocar esta pantalla, que no los necesita).

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios — `/timetracker/
week` aparece como página real (2.32 kB).

---

## D-068 · Etapa 2, tramo 3 — "Mis solicitudes"
**Fecha:** 2026-08-20 · **Versión:** v1.16.2 · **Pedido por:** Andrés

**Cambio:** `/timetracker/requests`, portada de `employee/
EmployeeRequests.jsx` — formulario para pedirle a un manager que agregue,
ajuste o elimine una entrada de tiempo, más la lista de solicitudes
propias con su estado (pendiente/aprobada/rechazada). `myRequests` y
`addRequest()` se agregan a `timetracker-data-provider.tsx`, mismo patrón
que `myPayrolls`.

**Razón (textual):** *"si"* (confirmando seguir con la siguiente pantalla
tras la propuesta de "Mis Solicitudes").

**Por qué fue directo.** Un formulario + `insert` + lista, sin
preocupaciones de escritorio, cola offline, ni tick en vivo — el tercer
puerto de esta etapa que no necesitó ninguna decisión de diseño nueva más
allá de las ya sentadas en D-066/D-067.

**Consecuencia aceptada:** ninguna nueva.

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios — `/timetracker/
requests` aparece como página real (2.43 kB).

---

## D-069 · Etapa 2, tramo 4 — Diario de trabajo y Mi cuenta (lado empleado completo)
**Fecha:** 2026-08-20 · **Versión:** v1.16.3 · **Pedido por:** Andrés

**Cambio:** `/timetracker/diary` (portada de `employee/
EmployeeScreenshots.jsx` + el componente compartido `WorkDiary.jsx`) y
`/timetracker/account` (portada de `employee/MyAccount.jsx`). Con esto se
completan las 5 pantallas del lado empleado. `WorkDiary` se portó como
componente compartido (`components/timetracker/WorkDiary.tsx`) — el
original ya lo reutiliza entre la vista de empleado y la de manager, así
que se porta una vez y la pantalla de manager (pendiente) lo reutiliza
igual.

**Razón (textual):** *"seguimos con esas dos"*.

**Decisiones de diseño:**
- **`myScreenshots` reemplaza a `latestScreenshot` como el dato base** en
  `timetracker-data-provider.tsx` — ahora carga TODAS las capturas propias
  (no solo la última), y `latestScreenshot` queda como valor derivado
  (`myScreenshots[0]`). Track Time (D-066) no cambió de comportamiento,
  solo de dónde saca el dato.
- **`Employee.email` es nuevo, viene de `auth.users` (server-side en
  `layout.tsx`), no de `public.profiles`.** A diferencia del `profiles`
  original de timetracker (que sí tenía columna `email`), el `profiles`
  compartido de deliveries no la tiene — el correo real vive en Auth. Se
  usa de solo lectura, igual que el original mostraba el email como campo
  deshabilitado.
- **Guardar "Mi cuenta" es DOS escrituras, no una.** El nombre va a
  `public.profiles.full_name` (identidad compartida); ciudad/método de
  pago/detalles van a `timetracker.employee_settings` (mismo split de
  D-066). `employee_settings` puede no tener fila todavía (nadie la crea
  al otorgar acceso — ver D-064), así que la escritura es un `upsert`, no
  un `update` que podría no encontrar nada.
- **Hallazgo aparte, no corregido aquí:** las políticas RLS de
  `public.profiles` de deliveries son totalmente permisivas
  (`USING true, WITH CHECK true` en el UPDATE) — la restricción real de
  "solo tu propio perfil" la pone el filtro `.eq('id', me.id)` del lado
  del cliente, no la base de datos. Preexistente, no introducido por este
  cambio, y consistente con cómo ya opera el resto de la app (p. ej.
  `UserDialog.tsx`); fuera de alcance corregirlo en este tramo.

**Consecuencia aceptada:** el Diario de trabajo estará vacío para
cualquiera hasta que exista una app de escritorio real capturando
pantallas — eso es correcto, no un bug (ver D-066).

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios —
`/timetracker/diary` (2.07 kB) y `/timetracker/account` (1.8 kB) aparecen
como páginas reales.

---

## D-070 · Etapa 2, tramo 5 — arranca el lado manager: Dashboard
**Fecha:** 2026-08-20 · **Versión:** v1.17.0 · **Pedido por:** Andrés

**Cambio:** `/timetracker/insights`, portada de `manager/Insights.jsx` —
KPIs generales, tendencia de 8 semanas, tabla ordenable por empleado, y
proyectos principales de la semana. Primera pantalla que necesita datos de
TODA la empresa, no solo los propios — extiende `timetracker-data-
provider.tsx` con una sección "solo manager": `allEmployees`,
`allProjects`, `allAssignments`, `allRequests` (vivos, con `reloadAll()` +
realtime, igual que el resto) y `sessionsSince(startISO)` (bajo demanda,
no en vivo). `TABS` se separa en `TABS` (empleado) y `MANAGER_TABS`
(admin) — un admin ve Dashboard primero y también sus propias pestañas
personales (puede trackear su propio tiempo, como el toggle "Ver como
empleado" del original, pero como rutas separadas en vez de un modo).

**Razón (textual):** *"seguimos con el manager"* (confirmando avanzar tras
completar el lado empleado).

**Por qué las sesiones NO viven en el provider como el resto.** Sessions
de toda la empresa es un dataset que crece sin límite — cargarlo entero en
memoria y suscribirlo en vivo (como sí es seguro hacer con `mySessions`,
acotado a un empleado) no escala. `sessionsSince()` es una consulta bajo
demanda que cada pantalla de manager pide con su propia ventana de fechas,
no algo que el provider mantiene siempre cargado.

**Bug de reglas de hooks, atrapado antes de compilar.** El primer intento
tenía `if (me.role !== "admin") return ...` ANTES de los `useState`/
`useEffect`/`useMemo` de la pantalla — viola las Reglas de los Hooks (deben
llamarse siempre, en el mismo orden). Corregido moviendo el chequeo de rol
al final, justo antes del JSX que se retorna; los hooks corren
incondicionalmente (no hacen daño para un no-admin, porque `sessionsSince`
ya no-opea del lado del provider).

**Consecuencia aceptada:** ninguna nueva — la guarda "Admins only" es solo
de UX; el límite real de seguridad (`is_timetracker_admin()`) ya está en
RLS, no en esta pantalla.

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios —
`/timetracker/insights` aparece como página real (3.33 kB).

---

## D-071 · Etapa 2 completa — las 10 pantallas de manager, de una vez
**Fecha:** 2026-08-20 · **Versión:** v1.18.0 · **Pedido por:** Andrés

**Cambio:** las 9 pantallas de manager que faltaban, todas en el mismo
tramo: Trabajando Ahora (`/timetracker/live`), Solicitudes de equipo
(`/timetracker/team-requests`), Proyectos (`/timetracker/projects`),
Asignaciones (`/timetracker/assignments`), Empleados
(`/timetracker/people`, rediseñada — ver abajo), Diario de equipo
(`/timetracker/team-diary`), Auditoría (`/timetracker/audit`), Ajustes
(`/timetracker/settings`, con dos omisiones deliberadas — ver abajo), y
Reportes/Pago (`/timetracker/reports`, la pantalla más grande y de más
riesgo de toda la app — calcula y registra nómina real). Con esto, las 15
pantallas de timetracker existen: 5 de empleado + 10 de manager.
`timetracker-data-provider.tsx` gana una sección grande de escrituras
genéricas (proyectos, asignaciones, sesiones, nómina, solicitudes,
auditoría, ajustes de empleado, configuración global) más `liveSessions`
(en vivo, acotado) y `auditLog` (en vivo, últimas 300).

**Razón (textual):** *"hazlo todo de una vez"* — mensaje enviado a mitad
del tramo anterior, pidiendo explícitamente no pausar entre pantalla y
pantalla.

**Decisiones de diseño reales, no solo traducción:**
- **`/timetracker/people` es más chica que el original, a propósito.**
  `ManagerPeople.jsx` original cambiaba el rol, creaba cuentas (vía una
  Edge Function `create-user` que ni siquiera existe en este proyecto de
  Supabase) y borraba/purgaba cuentas. Eso es exactamente lo que D-053/
  D-057 ya decidieron que vive en el diálogo de Usuarios del hub
  (`/home/users`), no dentro de un módulo — recruiting tampoco gestiona
  sus propios usuarios. Lo que sí quedó, porque es genuinamente del
  módulo y no le importa a ningún otro: tipo de trabajador, modo de
  seguimiento, almuerzo/descanso, y el toggle "activo" (independiente del
  acceso al módulo — ver D-064). Renombrar y editar datos de pago siguen
  siendo autoservicio (Mi Cuenta, D-069), igual que en el original.
- **Ajustes NO trae el respaldo/restauración de datos del original.** El
  backup/restore original tocaba `profiles` directo con un `upsert` — en
  este contenedor esa es la tabla de identidad COMPARTIDA que leen los
  otros dos módulos. Una restauración mal hecha podría sobrescribir en
  silencio el rol, la tienda o los datos de chofer de gente que no tiene
  nada que ver con timetracker. No es un ajuste chico: necesita su propio
  diseño (acotado a `timetracker.*` solamente) antes de ser seguro.
  Tampoco trae el selector de tema propio del original — este contenedor
  ya tiene uno solo, compartido (`data-theme`, D-052), que el CSS de
  timetracker ya escucha; un segundo selector pelearía con el primero.
- **Reportes/Pago no trae exportación a Excel/PDF.** Esas usaban una
  librería aparte (`lib/exportTimesheet.js`) que no se portó. La
  exportación a CSV (sin dependencias extra) sí se portó y cubre los
  mismos datos; el recibo imprimible (el diálogo de impresión del propio
  navegador) tampoco necesita librería y también se portó completo.
- **Nombres de ruta que evitan colisión, no copian el original 1:1.**
  El original overload-ea una sola pestaña "Requests"/"Work diary" con
  contenido distinto según el modo (empleado vs. manager). Con rutas por
  URL en vez de un switch de modo, hacían falta dos URLs distintas:
  `/timetracker/requests` (ya existía, D-068, la propia) vs.
  `/timetracker/team-requests` (la cola de aprobación); mismo patrón para
  `/timetracker/diary` (D-069) vs. `/timetracker/team-diary`.
- **`WorkDiary` (portado una sola vez en D-069) se reutiliza tal cual**
  en Diario de equipo — exactamente la razón por la que se portó como
  componente compartido desde el principio.
- **Provider: `liveSessions` y `auditLog` SÍ están en vivo (a diferencia
  de `sessionsSince`).** Ambos son acotados en la práctica — un puñado de
  gente trabajando a la vez, o las últimas 300 entradas de auditoría — a
  diferencia del historial completo de sesiones de toda la empresa, que
  sigue siendo bajo demanda (ver D-070).

**Consecuencia aceptada:** dos huecos reales, documentados, no ocultos:
sin respaldo/restauración de datos, sin exportación a Excel/PDF. Ninguno
bloquea el uso real del módulo — CSV e impresión cubren la necesidad
inmediata de Reportes/Pago; el respaldo puede diseñarse aparte cuando
haga falta.

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios — las 9
pantallas nuevas aparecen como páginas reales en la salida del build
(`/timetracker/live` 1.36 kB · `/team-requests` 2.17 kB · `/projects`
2.46 kB · `/assignments` 1.94 kB · `/people` 1.41 kB · `/team-diary` 2.79
kB · `/audit` 1.27 kB · `/settings` 2.84 kB · `/reports` 6.46 kB).

---

## D-072 · La barra superior de timetracker se veía plana e ilegible
**Fecha:** 2026-08-20 · **Versión:** v1.18.1 · **Pedido por:** Andrés

**Cambio:** `.timetracker-module .topbar` pasa de `background:var(--tt-bg)`
(cambia con el tema) a `background:var(--ink)` fijo, siempre oscuro, con
texto blanco — igual que el topbar de deliveries y de recruiting. Las
pestañas inactivas dejan de tener fondo tipo "chip" (`var(--tt-chip)`) y
pasan a texto plano claro (`#c6cede`), solo la activa lleva fondo sólido
de acento — igual que `.tab`/`.tab.active` de deliveries
(`globals.css`). El badge de rol y los botones de idioma/salir en
`TopBar.tsx` pasan a `rgba(255,255,255,.1–.18)` fijo en vez de las
variables de tema, mismo patrón que ya usa `recruiting/TopBar.tsx`. Se
agrega un separador visual entre las 10 pestañas de manager y las 5
personales cuando hay 15 juntas.

**Razón (textual):** *"mira como se mira el gui de horrible"*, con
captura de pantalla adjunta.

**Por qué pasaba.** El CSS SÍ compilaba y aplicaba — se confirmó grepeando
la salida de `.next/static/css/*.css`, no era un problema de build. El
bug real: en modo claro, `--tt-chip` (fondo de cada pestaña) y `--tt-bg`
(fondo del topbar) son dos tonos de azul pálido casi idénticos —
suficiente contraste en una paleta pensada para modo oscuro (el default
del original), invisible en la práctica en modo claro. La captura lo
mostró clarísimo: pestañas que parecían texto plano sin ningún fondo.

**Por qué se corrigió igualando el patrón existente, no ajustando
colores.** Ya existía una solución probada al mismo problema: deliveries
y recruiting NUNCA hacen que su topbar cambie con el tema — es oscuro
fijo (`var(--ink)`), con las pestañas inactivas en texto plano y sin
fondo. timetracker era el único de los tres módulos que intentaba que su
topbar seguiera el tema claro/oscuro, y ahí es donde entraba el problema
de contraste. Iguala el mismo patrón en vez de inventar una paleta de
modo claro más cuidada solo para este módulo.

**Consecuencia aceptada:** ninguna — el resto de `.timetracker-module`
(tarjetas, botones, formularios) sigue respetando el tema claro/oscuro
normalmente; solo el topbar queda fijo, igual que en los otros dos
módulos.

**Verificado:** `tsc`/`vitest` (467)/`next build` limpios; se confirmó
`.timetracker-module .topbar{...background:var(--ink);color:#fff}` en el
CSS compilado.

---

## D-073 · Datos reales de timetracker migrados desde el proyecto viejo
**Fecha:** 2026-08-20 · **Pedido por:** Andrés

**Cambio:** todo el historial real de timetracker (proyecto viejo
`qklsxhzmbnglgzufdbmz`) migrado a `timetracker.*` en el proyecto de
deliveries: 4 proyectos, 3 asignaciones, 231 sesiones, 4 pagos ya
liquidados ($1,641.23 en total), 7 solicitudes, 50 entradas de auditoría,
y 1,921 capturas de pantalla reales (814 MB) con sus metadatos. No es un
cambio de código — no lleva versión de `APP_VERSION` — es un cambio de
estado de datos en producción.

**Razón (textual):** *"haz todo lo demás"* (dejando el repunte del
desktop de Electron para el final), confirmando después paso a paso cada
acción con datos reales de personas.

**Identidades — solo 3 personas reales, no 4.** El roster del proyecto
viejo tenía 4 perfiles; uno (`andresugarte000@gmail.com`) era una cuenta
de prueba ya borrada en julio, sin ninguna fila de datos asociada en
ninguna tabla — se descartó sin migrar, nada se pierde. De las 3
personas reales, dos (andres, Roberto Rodríguez) ya tenían cuenta de
admin en deliveries — se les otorgó `timetracker_role` sin crear nada
nuevo. La tercera (Nick Huerta, `purchasing@rdztilegroup.net`) no tenía
cuenta — se creó una nueva, explícitamente **acotada a solo Timetracker**
(`module_access: ['timetracker']`, sin `recruiting_role`) por pedido
directo: *"si el user solo es de time tracker solo a eso tendra
acceso"*. El mecanismo de invitación de deliveries no manda correo
automático — genera una contraseña de un solo uso para que el admin se
la entregue a la persona directamente.

**Un bug de seguridad real, encontrado y corregido antes de mover
archivos.** Los metadatos de `screenshots` se migraron primero con el
`path` intacto del original — pero ese path usa el ID del empleado como
primer segmento de carpeta, y el RLS de `storage.objects` exige que ese
segmento coincida con `auth.uid()` de quien lee. Con el ID viejo sin
remapear, Nick nunca habría podido ver sus propias capturas (solo un
admin, vía `is_timetracker_admin()`) — atrapado antes de subir ningún
archivo, corregido reescribiendo el `path` con el ID nuevo de cada
fila antes de copiar los bytes.

**La copia de archivos se cayó a mitad de camino la primera vez — no
por los archivos, por el ritmo de escritura a la base.** Actualizar el
`path` de cada captura con una consulta individual (~2000 consultas)
saturó el límite de tasa de la API de gestión de Supabase
(`ThrottlerException`), lo que parecía "archivos fallidos" pero en
realidad casi todos ya se habían subido bien — solo faltaba guardar la
ruta nueva. Corregido agrupando las actualizaciones en lotes de 200 en
vez de una por archivo; el reintento fue seguro porque cada paso ya era
idempotente (una fila con ruta ya corregida se salta sola, una subida
repetida sobrescribe el mismo archivo sin error).

**Consecuencia aceptada:** ninguna a datos reales — todo el proceso fue
leer del proyecto viejo (nunca se modificó nada ahí) y agregar al nuevo
(nunca se sobrescribió nada existente). El proyecto viejo sigue vivo
como respaldo, sin tocar.

**Verificado:** conteos de filas comparados 1:1 contra el origen; suma de
pagos exacta; cero `employee_uid` fuera del mapeo de 3 personas; cero
FKs huérfanas (`project_id`/`assignment_id`/`payroll_id` en sesiones);
cero rutas de captura con el prefijo de ID viejo tras la corrección;
814 MB / 1,921 objetos confirmados en el bucket nuevo.

---

## D-074 · El desktop de Electron apunta a la URL en vivo, no a un bundle local
**Fecha:** 2026-08-20 · **Versión:** v1.19.0 · **Pedido por:** Andrés

**Cambio:** `timetracker-clean/desktop/main.js` (repo aparte, el shell de
Electron) ya no carga `web/dist` vía `loadFile` — carga
`https://deliveries-app-seven.vercel.app/timetracker` vía `loadURL`, el
mismo patrón que ya usa la APK de repartidores (`server.url` de
Capacitor). Un deploy de deliveries-app llega a cada cliente de
escritorio instalado sin reinstalar nada. `electron-builder`'s
`extraResources` (que copiaba `web/dist`) se quitó del `package.json`
del desktop; el script `dev` ahora apunta `TT_DEV_URL` al dev server de
Next.js (`:3000/timetracker`) en vez del de Vite (`:5173`).

**Razón:** pedido explícito y diferido a propósito — *"el 3 de ultimo,
haz todo lo demas"*, siendo el 3 este repunte. La decisión de apuntar a
la URL en vivo (en vez de seguir empaquetando localmente) ya se había
tomado al inicio del merge.

**Lo que casi se rompe: el bridge de escritorio no estaba portado.** El
puerto a Next.js de Track Time (D-066) había dejado fuera a propósito
todo lo que depende de `window.ttDesktop` — capturas de pantalla,
medición de actividad de teclado/mouse a nivel de sistema, detección de
movimiento en pantalla (smart-idle), auto-stop al bloquear/dormir la
máquina — porque esa ruta nunca se cargaba dentro de Electron. Repuntar
`loadURL` sin portar eso primero habría dejado el cliente de escritorio
como un reloj manual sin ninguna de las funciones que lo distinguen de
abrir el sitio en una pestaña. Se detectó antes de repuntar (comentario
explícito en `page.tsx` citando D-066) y se resolvió portando el bridge
completo antes de tocar `main.js`:
- `src/lib/timetracker/desktop.ts` (nuevo) — mismo contrato que
  `timetracker-clean/web/src/lib/desktop.js`, pero `isDesktop()` es una
  función evaluada en cada llamada, no una constante de módulo: en
  Next.js este archivo también se evalúa en el servidor durante SSR,
  donde `window` no existe.
- `timetracker-data-provider.tsx` ganó `uploadScreenshot` e
  `insertBlankScreenshot` (antes la sección de screenshots era
  explícitamente de solo lectura). RLS/storage ya lo permitían desde
  D-064 (`tt screenshots insert` / `tt shots upload own`) — no hizo
  falta migración nueva.
- `page.tsx` (Track Time) ganó: el conteo de actividad por contadores
  del sistema en vez de listeners con foco, la detección de movimiento
  en pantalla vía `desktopGetContext`, la suscripción a
  `desktopOnShot` que sube cada captura, y el auto-stop en
  `desktopOnPower` (bloqueo/suspensión). Mecánico, calcado del tick
  loop de `Tracker.jsx` — incluida una particularidad ya existente en
  el original: `isIdle`/`ctxApp` se comparan dentro del cierre del
  `setInterval` sin refrescarse por render, igual que el código
  original; no se "arregló" al portar para no divergir del
  comportamiento ya probado.

**Consecuencia aceptada:** el banner de auto-actualización
(`tt:update` de `main.js`) sigue sin consumidor en la UI — el shell
descarga e instala actualizaciones en silencio, sin avisar "reinicia
para actualizar". La cola offline (`offlineQueue.js`) tampoco se portó
(gap ya aceptado en D-066). `timetracker-clean/CLAUDE.md`,
`DEPLOY.md` y `RELEASE.md` siguen describiendo la arquitectura vieja
(app standalone con su propio Supabase) — no se reescribieron en este
pase, solo `desktop/README.md`.

**Revisar cuando:** se decida publicar el instalador (`electron-builder
--win nsis --publish always`, repo `CARRERSRTG/timetracker`) — ese
paso sube una release real a GitHub que los clientes ya instalados
descargan solos; no se ejecutó en este pase, requiere el `GH_TOKEN` del
usuario y confirmación explícita.

---

## D-075 · Cierre de los gaps conocidos del desktop: auto-update, offline, notificaciones
**Fecha:** 2026-08-20 · **Versión:** v1.19.1 · **Pedido por:** Andrés

**Cambio:** los tres gaps que D-074 dejó anotados como pendientes ahora
están portados:
- **Banner de auto-actualización** (`src/components/timetracker/UpdateBanner.tsx`,
  nuevo) — consume el canal `tt:update` de `main.js` vía 4 funciones nuevas
  en `desktop.ts` (`desktopOnUpdate`/`desktopGetUpdateState`/
  `desktopCheckUpdate`/`desktopInstallUpdate`). Muestra descarga en curso,
  "reinicia para instalar", y un botón manual de verificación en el
  `TopBar`. Solo-escritorio, calcado de `App.jsx`'s `UpdateBanner`.
- **Cola offline** (`src/lib/timetracker/offlineQueue.ts`, nuevo) —
  parches de sesión a `localStorage`, capturas a IndexedDB, sincroniza al
  reconectar o cada 30s. A diferencia del original (que importaba un
  cliente Supabase global), acá recibe `updateSession`/`uploadScreenshot`
  como parámetros — el cliente con schema `timetracker` y la conversión
  camelCase/snake_case siguen viviendo solo en el data provider, no se
  duplicaron. `writeSession` en `page.tsx` ahora encola en vez de solo
  alertar tras 3 reintentos fallidos; la subida de capturas hace lo mismo.
  `OfflineIndicator` (nuevo) muestra un pill fijo cuando hay algo
  pendiente de sincronizar.
- **Notificaciones reales del sistema** — `notify()` en el data provider
  ahora también dispara `new Notification()` cuando el permiso está
  concedido y NO es escritorio (el shell de Electron ya dibuja sus
  propios toasts flotantes para lo mismo — duplicarlo se vería peor, no
  mejor, igual que razonaba `notify.js` original). Se pide el permiso
  una vez al montar, solo en web. Se agregaron los dos disparadores que
  faltaban en `page.tsx`: "tracking started" y el aviso de límite
  semanal alcanzado/cerca de alcanzarse (con los mismos *latches*
  `limitHitRef`/`nearHitRef` del original para no repetir el aviso).

**Razón:** pedido explícito — *"hazlos todos"*, en respuesta a la lista
de pendientes que quedó tras D-074.

**Un hallazgo que cambia el marco de lo que se documentó como
"descontinuado".** Al investigar qué pasa con `timetracker-clean/web`
(la app Vite standalone, reemplazada en teoría por el puerto de
deliveries-app) apareció evidencia de que sigue activa: su historial de
commits reciente son *fixes reales de producción* ("Keep session on
wake", "Recover Supabase connection after sleep"), no código muerto. Se
preguntó directamente y se confirmó: **alguien todavía la usa**. Esa app
sigue apuntando al proyecto de Supabase viejo (`qklsxhzmbnglgzufdbmz`),
distinto del que usa `/timetracker` en deliveries-app desde D-073 — dos
bases de datos activas y divergiendo en silencio para cualquiera que
siga en la app vieja. No es un problema de código, no se resuelve solo
documentándolo: se dejó una advertencia explícita al inicio de
`timetracker-clean/CLAUDE.md`/`DEPLOY.md`/`RELEASE.md` marcándolo como
riesgo abierto, no como decisión tomada. Sigue pendiente que el negocio
decida cuándo y cómo mover a esas personas al `/timetracker` nuevo.

**De paso, arreglado:** el repo `timetracker` en GitHub se movió de
`CARRERSRTG` a `codingcodertg` (mismo org que `deliveries-app`) — el
`git remote` local, `desktop/package.json`'s `build.publish.owner`, y las
referencias en `RELEASE.md`/`DEPLOY.md` quedaron actualizados para no
depender del redirect de GitHub indefinidamente.

**Consecuencia aceptada:** el manual "check for updates" del `TopBar` es
un ícono sin label (⟳) por espacio — el original lo tenía como link de
texto en un footer que este puerto no tiene. Las notificaciones del
navegador dependen de que el usuario conceda el permiso la primera vez
que se le pide; si lo niega, se queda solo con el toast en pantalla
(igual que el original). Nada de esto se probó dentro de Electron en
una máquina Windows real — pasó `tsc`/`vitest` (467)/`next build`, que
no prueba el flujo real dentro del shell.

**Revisar cuando:** se resuelva qué hacer con `timetracker-clean/web` —
mover a la gente que falta, o decidir mantener ambas apps a propósito
(y entonces sí armar una sincronización real entre los dos proyectos de
Supabase, no una migración de una sola vez).

---

## D-076 · El login siempre mandaba a Deliveries, nunca de vuelta al módulo
**Fecha:** 2026-08-21 · **Versión:** v1.19.2 · **Pedido por:** Andrés

**Cambio:** entrar sin sesión a `/timetracker` (o `/recruiting`, `/home`,
`/home/users`) ahora redirige a `/login?next=<esa ruta>`, y el login
vuelve ahí después de autenticar en vez de mandar siempre a `/` (el
tablero de Deliveries). Reportado como *"open all 3 apps and it just
[should be] the time tracker"*: en el desktop de Electron —sin barra de
direcciones— la única forma de volver a Track Time después de iniciar
sesión era el selector de módulos (⌂/⇄) de la barra superior, que
además deja saltar a los otros 2 módulos. También se ocultó ese
selector por completo dentro del shell de escritorio (`isDesktop()` en
`ModuleSwitcher.tsx`) — moverse fuera de `/timetracker` detiene en
silencio la captura de actividad/pantallas (el tick loop solo vive
montado ahí), así que el cliente de escritorio ya no debe poder
navegar a ningún otro lado, ni siquiera si algún día vuelve a aterrizar
mal.

**Un hallazgo aparte, no corregido aquí: `middleware.ts` nunca se
ejecuta.** Al diagnosticar esto se probó primero arreglar el
redirect ahí — pero el archivo vive en la raíz del repo
(`./middleware.ts`) en vez de `src/middleware.ts`, que es donde Next.js
lo busca cuando el proyecto usa una carpeta `src/` (como este). El
`next dev` nunca imprime "Compiling /middleware", y una petición de
prueba nunca reflejó el `next=` que ese archivo debería agregar — la
guarda real de cada ruta siempre ha sido el `redirect()` propio de cada
`layout.tsx` server component, no el middleware. La app funciona hoy
solo porque cada layout ya hace su propio chequeo; el archivo de
middleware ha sido código muerto probablemente desde que se escribió.
No se movió en este pase — activar código que nunca corrió antes en
producción, en medio de un fix urgente, es exactamente el tipo de
cambio que merece su propia sesión, no ir empaquetado con otra cosa.

**Sobre el otro reporte — "no hay datos": los datos siguen ahí.**
Verificado directo contra la base: 231 sesiones, 4 proyectos, 3
asignaciones, 4 nóminas, 2,269 capturas (creciendo desde las 1,921
migradas en D-073 — uso real desde entonces), repartidas
correctamente entre Andrés (171 sesiones) y Nick Huerta (60). La
explicación más probable es la misma causa raíz: si el login nunca
aterrizaba en `/timetracker`, tampoco se llegaba nunca a ver la
pantalla donde esos datos se muestran.

**Corrección (2026-08-21, misma sesión):** esa última hipótesis era
incompleta. El redirect SÍ estaba roto y SÍ se arregló aquí, pero no
era la causa de "no hay datos" — con el redirect ya corregido, Track
Time seguía mostrando "no projects assigned" para un admin con
asignaciones reales. La causa real, más grave, está en D-077.

**Consecuencia aceptada:** `(app)/layout.tsx` no lleva `next=` — `/` ya
es su propio destino por defecto, no hacía falta. No se verificó el
flujo de login completo dentro de Electron con credenciales reales
(no es algo que deba hacer el asistente); sí se verificó la cadena de
redirects completa contra un dev server real (`/timetracker`,
`/recruiting`, `/home` sin sesión → cada uno a su propio `next=`
correcto). `tsc`/`vitest` (467)/`next build` limpios.

**Revisar cuando:** se decida si vale la pena mover `middleware.ts` a
`src/middleware.ts` y activarlo de verdad — hoy es puramente
redundante con las guardas de cada layout, así que no es urgente,
pero tampoco debería quedar ahí indefinidamente fingiendo que hace
algo.

---

## D-077 · El schema `timetracker` nunca estuvo expuesto a la API — nada leía datos reales
**Fecha:** 2026-08-21 · **Pedido por:** Andrés (reporte: *"todo projects y
assignments vacios y soy admin"*)

**Cambio:** el proyecto de Supabase tenía `db_schema` (la lista de
schemas que PostgREST expone a `supabase-js`) configurado como
`public,graphql_public,recruiting` — **`timetracker` nunca se agregó**,
desde que se creó el módulo en D-064. Corregido vía la API de gestión
de Supabase (`PATCH /v1/projects/{ref}/postgrest`,
`db_schema: "public,graphql_public,recruiting,timetracker"`). No es un
cambio de código — no hay migración `.sql` para esto, es config de la
plataforma, no un objeto de base de datos — así que no lleva versión
de `APP_VERSION`.

**Por qué esto es grave y por qué nadie lo vio antes.** Toda llamada
`supabase.from(...)` con `db: { schema: "timetracker" }` (es decir,
CADA lectura/escritura de `timetracker-data-provider.tsx`, desde
D-066) fallaba con `PGRST106: Invalid schema: timetracker` — pero la
capa `supabase-js`/PostgREST no lo trata como error visible en la UI
para un `select`, simplemente no hay filas, así que cada pantalla
mostraba su estado vacío normal ("no projects assigned", "0.00 h") en
vez de un error. `tsc`/`vitest`/`next build` nunca lo iban a atrapar
— ninguno hace una llamada real contra Supabase en producción. Nadie
lo notó en D-066 a D-076 porque hasta D-073 no había datos reales que
esperar ver, y el propio D-073 se verificó con SQL directo (el token
de gestión, que sí tiene acceso completo a todos los schemas — bypasa
PostgREST por completo), nunca con una sesión de navegador real contra
la API pública.

**Cómo se encontró.** El reporte de Andrés — página de Track Time
vacía para un admin con asignaciones reales, incluso después de
cerrar sesión y volver a entrar (descartando el patrón de "sesión
vieja" que resolvió un bug parecido antes) — llevó a probar la
petición REST exacta que hace el navegador
(`GET .../rest/v1/projects` con `Accept-Profile: timetracker`) en vez
de seguir verificando solo con SQL directo. Esa fue la primera vez en
todo este módulo que se probó una lectura real vía la API pública en
lugar de la API de gestión.

**El mismo patrón que las GRANTs faltantes de D-064.** Cuando
`recruiting.*` se creó, alguien agregó `recruiting` a los schemas
expuestos a mano, fuera de cualquier migración — nunca quedó
documentado como paso requerido. Para `timetracker`, ese paso a mano
simplemente nunca se hizo. Ninguna de las 4 migraciones de D-064
(058-061) podía haberlo cubierto: no es un objeto de Postgres, vive en
la config de la plataforma de Supabase, fuera del alcance de
`supabase/migrations/`.

**Consecuencia aceptada:** ninguna a los datos — es un cambio de
"quién puede leer", no de qué existe. Verificado con la misma petición
REST exacta antes/después del cambio: `406 PGRST106` → `200 OK`.
No se verificó con un JWT de usuario real firmado (generar uno
manualmente con el secreto del proyecto fue bloqueado por el
clasificador de seguridad del entorno, correctamente — eso es
indistinguible de forjar una sesión de otra persona); la combinación
de (a) el error de schema desaparece y (b) RLS ya se había verificado
por separado con una transacción revertida impersonando a Andrés
(ver D-073) es suficiente para confiar en el arreglo sin necesitar esa
prueba adicional.

**Revisar cuando:** se agregue un cuarto módulo — este mismo paso
("agregar el schema a `db_schema` vía la API de gestión, no una
migración") hay que recordarlo a mano otra vez, porque sigue sin
existir un lugar automatizado donde viva.

---

## D-078 · La brecha real de D-073: lo trabajado después del corte de la migración
**Fecha:** 2026-08-21 · **Pedido por:** Andrés (*"segui trabajando, busca
nuevos datos porque solo me salen screenshots a las 2pm y termine hasta
tipo 11pm"*)

**Cambio:** migradas 5 sesiones y 50 capturas de pantalla que quedaron
fuera de D-073 porque esa migración corrió a media tarde del
2026-08-20 mientras Andrés seguía trabajando en la app vieja (el
desktop no se había repuntado todavía — eso pasó hasta D-074, un día
después). Corte real encontrado: última captura migrada en D-073 fue
`2026-08-20 20:44:34 UTC` (≈15:44 hora del negocio). Después de ese
punto, en el proyecto viejo (`qklsxhzmbnglgzufdbmz`) quedaron: una
sesión de Andrés a medio terminar en el momento exacto de la migración
(capturada con duración parcial, 22,240s en vez de los 32,133s reales
— la sesión seguía corriendo cuando D-073 tomó su snapshot), dos
sesiones completas más de Andrés esa misma noche (hasta las 23:36 hora
del negocio — coincide con lo que reportó), y tres sesiones cortas de
Nick Huerta. `requests`, `audit`, y `payrolls` no tenían nada nuevo
después del corte — la brecha era solo `sessions` y `screenshots`.

**Cómo se hizo, sin duplicar nada.** Los IDs de fila se preservaron
igual en ambos proyectos desde D-073 (mismo `id` de sesión, mismo
`project_id`/`assignment_id` — solo `employee_uid` cambia porque viene
de `auth.users`, que es distinto por proyecto), así que comparar por
`id` bastó para saber qué faltaba: la sesión parcial se corrigió con
un `UPDATE` a sus valores finales; las 4 sesiones nuevas y las 50
capturas se insertaron con `employee_uid` remapeado al ID nuevo de
cada persona (mismo `ID_MAP` de D-073) e `INSERT ... ON CONFLICT (id)
DO NOTHING` para que el script sea seguro de re-correr. Las capturas
llevaron el mismo arreglo de ruta que D-073 ya estableció: el prefijo
de carpeta se reescribe al ID nuevo del empleado antes de subir el
archivo, porque el RLS de `storage.objects` exige que ese prefijo
coincida con `auth.uid()` de quien lee.

**Verificado:** conteos después de la migración — 236 sesiones (231 +
5), 2,319 capturas (2,269 + 50), cero capturas con `session_id`
huérfano. La última captura ahora es `2026-08-21 04:36:28 UTC`
(≈23:36 hora del negocio) — coincide con "hasta tipo 11pm". 50/50
archivos copiados sin fallos en la primera corrida (a diferencia de
D-073, no hubo problema de límite de tasa — son 50 archivos, no
~2,000). No es cambio de código — sin versión de `APP_VERSION`.

**Consecuencia aceptada:** el proyecto viejo sigue vivo — esta
migración, igual que D-073, solo leyó de ahí, nunca escribió. Sigue
sin resolverse el riesgo de fondo que D-075 dejó anotado:
`timetracker-clean/web` sigue activa, así que este mismo tipo de
brecha puede volver a aparecer mientras alguien siga trabajando ahí en
vez de en el `/timetracker` nuevo — y ahora hay evidencia directa
(este caso) de que sí pasa, no es solo un riesgo teórico.

**Revisar cuando:** se repita — cada vez que alguien reporte "me falta
lo de tal día", el patrón de este arreglo (comparar por `id` de sesión
entre los dos proyectos, ID_MAP fijo, script idempotente) se puede
reutilizar directo. Sigue siendo un parche manual, no una
sincronización automática — eso solo tiene sentido resolverlo una vez
que se decida el destino final de `timetracker-clean/web` (D-075).

---

## D-079 · D-073 tampoco migró `settings` — la semana de la empresa quedó mal
**Fecha:** 2026-08-21 · **Pedido por:** Andrés (*"el sistema las semanas
son de viernes a jueves y estoy viendo que no se paso asi"*)

**Cambio:** `timetracker.settings` (fila `id='app'`) nunca se tocó en
D-073 — de las 8 tablas que sí se migraron (proyectos, asignaciones,
sesiones, pagos, solicitudes, auditoría, capturas), `settings` se
quedó fuera. La fila nueva tenía casi puros valores por default del
código: `weekStartDay: 6` (sábado) en vez del real `5` (viernes),
y le faltaban por completo `appName`, `timeZone`
("America/Tegucigalpa"), `workApps`, `locations`, `idleLimitMin`.
Corregido con un `UPDATE ... data || '{...}'::jsonb` que agrega esos
campos exactos tal como estaban en el proyecto viejo, sin tocar los
que ya coincidían (`paymentMethods`, `adjustmentTypes`,
`defaultTrackMode`, etc. — esos sí se habían migrado bien).

**Cómo se encontró — un caso real de "los datos están bien, la
pantalla calcula mal, y la causa real es una tercera cosa".** Andrés
reportó que "Total hours tracked / This week" en Track Time mostraba
50.17h en vez de las 56.40h reales de esa semana. La base tenía las
56.40h completas (verificado). El cálculo de "esta semana" en
`TrackedTotals` usa la semana del PROYECTO seleccionado si hay uno
elegido, y si no, cae al default de la empresa
(`page.tsx`/`helpers.ts`, comportamiento calcado del original,
D-066) — sin proyecto elegido en pantalla, usó sábado-viernes en vez
de viernes-jueves, y bajo ese corte la sesión del viernes 14 de agosto
(6.24h) cae en la semana anterior: 56.40 − 6.24 = 50.17, exacto. La
recomendación inmediata (elegir el proyecto en el dropdown) hubiera
tapado el síntoma sin arreglar la causa — Andrés fue quien identificó
que el default de la empresa en sí estaba mal, no solo que faltaba
elegir un proyecto.

**Consecuencia aceptada:** el `timeZone` migrado
(`America/Tegucigalpa`) es DISTINTO al que usa deliveries/recruiting
(`America/Chicago`, ver `business_timezone_hydration`) — se restauró
tal cual estaba en el sistema viejo, sin unificarlo, porque unificar
zonas horarias es una decisión de negocio con impacto en cómo se
agrupan las semanas de nómina, no algo para decidir sin preguntar a
partir de un reporte de bug. Los datos ya escritos (fechas de sesión,
`week_of`) no cambian con este fix — se calcularon correctamente en su
momento por la app vieja, que sí tenía el `timeZone` correcto; el
único efecto es hacia adelante, en cómo el cliente nuevo agrupa
semanas al vivo. Cualquier sesión de navegador ya abierta debería
refrescar sola vía Realtime (la tabla `settings` ya está en la
publicación desde D-064); si no, basta con recargar.

**Revisar cuando:** se decida si `timetracker` debería compartir el
mismo `timeZone` que el resto del contenedor en vez del suyo propio
heredado del sistema viejo — hoy conviven dos zonas horarias distintas
dentro de la misma app, cada una correcta para su propio módulo, pero
es la clase de inconsistencia que vale la pena resolver a propósito en
algún momento, no dejarla así por accidente.

---

## D-080 · El desktop siempre caía en modo claro — nunca tuvo forma de estar oscuro
**Fecha:** 2026-08-21 · **Versión:** v1.20.0 (deliveries-app) · v0.0.45
(desktop) · **Pedido por:** Andrés (*"quiero que este al mismo tamano
del window y quiero que crees un darkmode muy agradable y eficiente"*)

**Cambio:** tres arreglos, uno de código y dos de UI:
- **`layout.tsx` (raíz, compartido por toda la app) fuerza `data-theme`
  en cada carga**, vía un script que corre antes de pintar: si no hay
  preferencia guardada, siempre caía en `light` — nunca dejaba el
  atributo ausente, que es lo único bajo lo cual el propio CSS de
  `.timetracker-module` (D-066) ya tiene un modo oscuro completo como
  default (`--tt-bg:#0f1420`, paleta calcada del original, "diseñada
  para el default oscuro del original" — D-072). El desktop, con
  `localStorage` vacío en su primer arranque, siempre pisaba ese
  default oscuro con claro. Corregido: el script (y el estado inicial
  de `PrefsProvider` en `prefs.tsx`, que si no se corrige por separado
  vuelve a pisarlo un instante después) ahora detectan
  `window.ttDesktop` y usan oscuro como default SOLO ahí, cuando no
  hay preferencia explícita guardada — cualquier elección manual
  previa sigue ganando.
- **Nuevo botón ☀️/🌙 en el `TopBar` de timetracker** — antes nada en
  el módulo exponía forma de cambiar de tema; ahora cualquiera (web o
  desktop) puede alternar con `usePrefs().toggleTheme()`, el mismo
  mecanismo compartido que deliveries/recruiting ya usan.
- **`desktop/main.js`:** `Menu.setApplicationMenu(null)` quita la
  barra de menú nativa de Electron (File/Edit/View/Window/Help) —
  chrome de navegador sin ningún uso en un cliente de un solo
  propósito. `backgroundColor:'#0f1420'` en el `BrowserWindow`, para
  que coincida con el tema oscuro desde el primer pixel pintado (antes
  de que la página cargue) en vez del blanco/negro por default de
  Electron, que es lo que se veía como un "vacío" alrededor del
  contenido en la captura del reporte.

**Consecuencia aceptada:** el modo oscuro no es nuevo — es la paleta
que el módulo siempre tuvo lista y nunca se mostraba por este bug de
default. No se rediseñó ningún color; el trabajo fue exponerlo y
arreglar por qué nunca se aplicaba. No se probó visualmente dentro de
Electron en una máquina Windows real (no tengo forma de ver la ventana
renderizada desde aquí) — pasó `tsc`/`vitest` (467)/`next build`
limpios y `node --check` sobre `main.js`.

**Revisar cuando:** el usuario confirme con una captura si el
resultado visual es el esperado — el diagnóstico de "vacío alrededor
del contenido" se hizo por inspección de código, no viéndolo
renderizado.

**Confirmado (2026-08-21, mismo día):** "perfecto ya esta" — el
resultado visual quedó bien. Queda pendiente solo publicar el
instalador v0.0.45 (quita la barra de menú nativa + `backgroundColor`)
cuando el usuario lo pida; el resto (modo oscuro por default, botón de
tema) ya se ve en producción sin necesitar instalador nuevo.

---

## D-081 · Sesión vieja → RLS lo trata como anónimo → "se borró toda la data"
**Fecha:** 2026-08-21 · **Versión:** v1.20.1 · **Pedido por:** Andrés
(*"toda la data del delivery app desaparecio esta completamente
vacio arregla eso ya"*)

**Cambio:** `reloadAll()` en `data-provider.tsx` (deliveries),
`recruiting-data-provider.tsx`, y `timetracker-data-provider.tsx`
(donde ya existía `ensureSession()` para escrituras pero nunca se
llamaba antes de leer) ahora refrescan el token de acceso ANTES de
cada lectura si está vencido o a menos de 60s de vencer — mismo patrón
en los tres, calcado del `ensureSession()` que timetracker ya tenía
para escrituras.

**El mecanismo exacto, encontrado leyendo el código, no adivinado.**
`reloadAll()` hace `if (d.data) setDeliveries(d.data as Delivery[])` —
y un array vacío `[]` es *verdadero* en JS. Cuando el token de acceso
expira (uso normal, más una pestaña en segundo plano puede retrasar el
refresco automático del propio cliente — los navegadores limitan
temporizadores en pestañas no activas), PostgREST no da error: RLS
simplemente trata la petición como anónima y devuelve `200` con `[]`.
`reloadAll()` no distingue "no hay datos" de "no pude leer tus
datos" — sobreescribe el estado real con nada, sin ningún error en
ningún lado. Confirmado con la base directo: las 75 órdenes seguían
ahí; el schema `public` seguía expuesto correctamente en la API; cerrar
sesión y volver a entrar lo arregló al instante — la firma exacta de
una sesión vencida, no de datos perdidos.

**No es la primera vez hoy — es la tercera.** La página de Usuarios
del hub (antes de esta sesión) y Track Time de timetracker (D-077, aunque
ahí la causa de fondo terminó siendo distinta — el schema sin exponer)
mostraron el mismo síntoma exacto: "vacío, sin error". Cada vez se
resolvió con un re-login manual, pero nadie había investigado por qué
se repite. Pedido explícito: *"revisa bien porque ha estado pasando
eso"* — la respuesta es este patrón, y ahora hay un arreglo real, no
solo un cerrar-sesión-y-volver-a-entrar cada vez.

**Consecuencia aceptada:** esto cubre el caso común (el token
simplemente venció con el tiempo) refrescándolo proactivamente antes
de leer — no cubre una sesión genuinamente revocada del lado del
servidor (ahí `refreshSession()` también fallaría, y seguiría
haciendo falta un re-login real). No se agregó ningún aviso visible de
"tu sesión expiró" — sigue siendo silencioso cuando SÍ falla, solo que
ahora falla mucho menos seguido. `tsc`/`vitest` (467)/`next build`
limpios.

**Revisar cuando:** si esto se repite después de este arreglo, la
siguiente capa razonable es un aviso explícito en pantalla ("tu sesión
expiró, vuelve a entrar") en vez de seguir tratando "cero filas" como
sinónimo de "no hay datos" — no se hizo aquí porque cambia cómo se ve
un estado vacío legítimo en cada pantalla, alcance más grande que un
arreglo de causa raíz puntual.

---

## D-082 · Sesión degradada mostraba a cualquiera la vista de vendedor
**Fecha:** 2026-08-21 · **Versión:** v1.20.2 · **Pedido por:** Andrés
(*"driver when login sees sales view"*)

**Cambio:** `(app)/layout.tsx`, `home/page.tsx`, y `home/users/layout.tsx`
tenían el mismo patrón peligroso: si `user` existía pero la fila de
`profiles` no cargaba, fabricaban un perfil falso con
`role: "sales"` en vez de tratarlo como una sesión rota. Un chofer (o
cualquiera) con una lectura de perfil fallida por RLS degradado —
misma clase de bug que D-081, esta vez del lado del servidor, con
cookies en vez de `localStorage` — terminaba viendo el tablero de
vendedor en vez de su propia pantalla, sin ningún error visible.
Corregido: sin perfil, se redirige a `/login` (fuerza un re-auth real)
en vez de inventar una identidad.

**Consecuencia aceptada:** un usuario legítimo pero sin fila en
`profiles` (caso borde — hoy todo signup crea una) también cae en este
redirect en vez de ver un "sales" ficticio — correcto: mostrar el rol
equivocado nunca fue mejor que pedir que vuelva a entrar. No se aplicó
el mismo `ensureSession()` proactivo de D-081 aquí porque este código
corre en el servidor con el cliente de cookies (`@/lib/supabase/server`),
no el de navegador — refrescar ahí es una pieza aparte, no incluida en
este pase.

**Revisar cuando:** si sigue apareciendo el mismo síntoma después de
este arreglo, hace falta el equivalente server-side de D-081
(refrescar la cookie de sesión antes de leer `profiles`), no solo
dejar de fabricar `sales` como fallback.

---

## D-083 · Almacén gana el filtro "Picked Up" (recogido, aún no entregado)
**Fecha:** 2026-08-21 · **Versión:** v1.20.3 · **Pedido por:** Andrés
(*"we should add a Dropped Off filter for the ones that got picked up
but didn't end up at final destination yet"*)

**Cambio:** `ROLE_FILTER_STAGES.warehouse` gana `"picked_up"` — era el
único rol con lista explícita que no lo tenía (sales, manager,
accounting, driver, y admin/logística por default ya lo tienen).
Confirmado con el usuario: no es un estado nuevo, es el stage
`picked_up` que ya existe, solo faltaba exponerlo donde no estaba.

**Consecuencia aceptada:** cambio de una línea, sin riesgo — solo
agrega un chip de filtro más a la vista de almacén.

---

## D-084 · Office/Accounting arrancan una orden nueva en Intertienda
**Fecha:** 2026-08-21 · **Versión:** v1.20.4 · **Pedido por:** Andrés
(*"default for office and acct should be customer type intertienda"*)

**Cambio:** al crear una orden nueva, el tipo por default sigue siendo
"Customer" para todos, EXCEPTO `manager` (office) y `accounting`, que
ahora arrancan en "Intertienda" — la mayoría de lo que esos dos roles
registran es traslado entre tiendas, no una entrega a cliente.

**Consecuencia aceptada:** sigue siendo editable — es solo el punto de
partida, cualquiera puede cambiarlo a Customer/Transfer manualmente.
Si `settings.order_types` no incluye "Intertienda" (config
personalizada sin ese tipo), cae de vuelta a "Customer" en vez de
fallar.

---

## D-085 · "Add time" en timetracker ya no deja pedir horas que se solapan
**Fecha:** 2026-08-21 · **Versión:** v1.21.0 · **Pedido por:** Andrés
(*"trabajé de 10 a 11 entonces en donde pongo el tiempo solo se puede
de 9 a 10 y 10:01 debería salir bloqueado"*)

**Cambio:** `/timetracker/requests`, formulario "Add time" — ahora
muestra los bloques ya fichados ese día ("Already tracked that day:
10:00–11:00") y los campos From/To llevan `min`/`max` acotados al hueco
libre alrededor de la hora que se está eligiendo. Al enviar, se vuelve
a validar contra TODOS los bloques del día (no solo el hueco visible
en ese momento) — si se solapa con cualquier sesión ya fichada, se
rechaza con un mensaje explícito en vez de dejar pasar horas
duplicadas.

**Por qué `min`/`max` solo, sin más, no alcanzaba.** Un `<input
type="time">` nativo solo puede expresar UN rango continuo permitido
— si alguien fichó 8–9 y 10–11 ese mismo día, no hay forma de que el
input bloquee ambos huecos ocupados a la vez y deje libres 9–10 y
11–24 con un solo `min`/`max`. Por eso el `min`/`max` cubre el caso
común (el hueco alrededor de lo que ya se está escribiendo), y la
validación al enviar —que sí revisa CADA bloque del día, no solo el
hueco visible— es la garantía real.

**Consecuencia aceptada:** solo aplica al tipo "Add time" — "Adjust" y
"Delete" ya parten de una sesión existente elegida de una lista, así
que el caso de "pedir horas que ya están fichadas" no aplica ahí de la
misma forma. `tsc`/`vitest` (467)/`next build` limpios.

**Reemplazada por D-086** (mismo día): esta versión usaba `<input
type="time">` nativo con `min`/`max` de un solo hueco continuo — D-086
la sustituye por dropdowns reales que muestran cada opción ocupada
deshabilitada, a pedido explícito ("imitando cómo lo hace Upwork").

---

## D-086 · "Add time" con dropdowns estilo Upwork, validado en 4 capas
**Fecha:** 2026-08-21 · **Versión:** v1.21.1 · **Pedido por:** Andrés

**Con especificación completa por escrito:** reglas de bloqueo, casos
de prueba pedidos, y pedido explícito de investigar antes de
programar.

**Cambio:** `/timetracker/requests`, formulario "Add time" — reemplaza
los `<input type="time">` de D-085 por dos `<select>` (inicio/fin,
pasos de 10 min, 144 opciones/día). Las horas ya ocupadas se muestran
deshabilitadas, no ocultas. Al elegir la hora de inicio, el dropdown
de fin se recalcula: solo permite hasta el comienzo del siguiente
bloque ocupado, no solo deshabilita opciones sueltas — así un rango
que empieza y termina en horas libres pero que CRUZA un bloque
completo por en medio (ej. ocupado 10–12, elegir 9 a 13) también
queda bloqueado, no solo los extremos.

**"Ocupado" = sesiones ya fichadas + las propias solicitudes
pendientes del mismo empleado ese día** (para que dos requests
pendientes tampoco se traslapen entre sí) — confirmado con el pedido
original, que lo pide explícito. Tocar bordes SÍ se permite (una
entrada que termina a las 12:00 no bloquea que otra empiece a las
12:00) — toda la lógica usa comparación estricta `<`/`>`, nunca
`<=`/`>=`.

**Cuatro capas de validación, no una:** (1) el dropdown de inicio
deshabilita horas ocupadas visualmente; (2) el de fin se acota al
hueco después de elegir inicio; (3) al ENVIAR la solicitud, se revisa
el rango completo contra TODO lo ocupado ese día (la garantía real —
un `min`/`max` de un solo hueco no puede expresar varios huecos
disjuntos a la vez); (4) al ACEPTAR — `team-requests/page.tsx`'s
`accept()` — se vuelve a calcular el ocupado del empleado AL MOMENTO
DE ACEPTAR (no al momento en que se envió la solicitud) y si algo se
solapó mientras estaba pendiente (otra sesión fichada en vivo, u otra
solicitud aprobada de la misma persona), NO se aplica en silencio: se
regresa la solicitud a pendiente y se le avisa al manager con el
detalle exacto (empleado, fecha, rango que chocó).

**La lógica de traslape vive en una función pura**
(`src/lib/timetracker/timeOverlap.ts`) sin ninguna dependencia de
React/Supabase — `rangesOverlap`, `isSlotOccupied`, `startOptions`,
`endOptions`, `maxEndAfter`, `rangeOverlapsAny`. 20 pruebas nuevas
(`timeOverlap.test.ts`) cubren exactamente los casos pedidos: dentro
del rango, bordes que se tocan, rango que cruza un bloque completo,
día sin entradas, y varias entradas ocupadas el mismo día — incluido
el caso de una sesión real que no cae en un múltiplo de 10 minutos
(ej. 10:03–10:47), que igual debe bloquear cada paso de 10 min que
toca.

**Consecuencia aceptada:** el reencaje al aceptar usa
`sessionsSince(date, date)` (bajo demanda, ver el comentario del
proveedor de datos sobre por qué las sesiones de toda la empresa no
viven en memoria) — un round trip extra por cada "Aceptar" de tipo
Add con horas, aceptado porque es exactamente el momento en que
importa estar seguro. Solo aplica a solicitudes con `fromTime`/`toTime`
— una solicitud vieja en solo-horas (`hours`, sin rango) no tiene
rango que revisar, se aplica igual que antes. Sigue sin tocarse el
hallazgo de zona horaria de D-066/D-071 (`fromRange()` interpreta
`date+fromTime` en la hora LOCAL DEL NAVEGADOR de quien acepta, no en
la hora de negocio fija) — la nueva verificación de traslape usa la
misma convención existente (`msToMin` con `getHours()`/`getMinutes()`
locales) para no mezclar dos supuestos de zona horaria distintos en el
mismo cálculo.

**Revisar cuando:** se decida resolver la inconsistencia de zona
horaria de fondo (D-066/D-071) — en ese momento este archivo también
necesita el mismo ajuste, no solo `fromRange()`.

---

## D-087 · El versionado deja de ser global — una versión por app
**Fecha:** 2026-08-21 · **Versión:** v1.21.2 (deliveries) · v0.1.0
(recruiting, timetracker — primera vez) · **Pedido por:** Andrés

**Con especificación completa por escrito.**

**Cambio:** `src/lib/app-versions.ts` (nuevo) reemplaza el `APP_VERSION`
único que vivía en `src/lib/constants.ts` con un mapa de tres números
independientes — `{ deliveries, recruiting, timetracker }`.
`/api/version` ahora devuelve `{ versions: {...}, apk }` en vez de
`{ web, apk }`. Los 4 montajes de `AppUpdateBanner` (TopBar de
deliveries, y los layouts de `home`, `recruiting`, `timetracker`) ahora
reciben una prop `app` fija — cada layout ya envuelve solo su propio
árbol de rutas, así que no hace falta detectar nada en runtime, cada
uno simplemente declara cuál es. Cada banner compara SOLO la versión
de su propia app: tocar únicamente timetracker ya no avisa a
deliveries ni a recruiting. `package.json`'s `"version"` se queda —
pasa a ser la versión del repo/monorepo, ya no lo que ningún cliente
compara.

**Versiones de arranque, investigadas antes de fijarlas, no
inventadas.** deliveries mantiene su número corriendo (1.21.x) — es la
app original, sin motivo para reiniciar un contador vivo. Para
recruiting y timetracker se buscó primero si existía un historial de
versión propio: `DECISIONS.md` no tiene ninguno — D-050 (recruiting se
vuelve módulo) y D-064 (merge de timetracker) están registrados contra
el contador global VIEJO (v1.9.6 y v1.15.0 respectivamente), no un
número propio de cada módulo. Se encontró algo que a primera vista
parecía contradecir esto: `src/lib/recruiting/constants.ts` tiene su
propio `export const APP_VERSION = "0.0.47"` — pero no lo importa
NADA en todo el proyecto (verificado con grep sobre cada uso). Es un
residuo congelado del port mecánico del repo original de recruiting
(que sí tenía su propio `package.json` antes del merge, D-050), nunca
más tocado desde entonces — no es un historial mantenido, es basura
inerte. No cuenta como continuidad real. Ambos módulos arrancan en
`0.1.0`, honesto, no `1.0.0` de adorno.

**`home`/`login` — decisión de criterio, explicada:** ambos son
infraestructura genuinamente compartida (`src/app/home/`, `/login`),
fuera de las tres carpetas propias de cada app, igual que `/api`. El
banner ahí usa la versión de **deliveries**: es la app dueña visual del
hub/login (mismo estilo, mismo `VersionFooter`), y todo el que llega
ahí ya tiene acceso a deliveries — es la única app que nadie necesita
que le concedan. No es una app "de verdad" con contenido propio, así
que atribuirle la versión de deliveries es la respuesta menos-mal en
vez de inventar una cuarta categoría.

**`apk` no es una cuarta app.** Es el número de build nativo del shell
de Capacitor, que carga deliveries específicamente
(`mobile/capacitor.config.ts`) — cuelga conceptualmente de deliveries,
no vive dentro de `versions` como un cuarto par clave-valor, porque es
otro TIPO de versión (build nativo comparado contra el user-agent
instalado, no un bundle web). Documentado en el comentario de
`/api/version` para que quien lo lea después no lo confunda con una
cuarta app. El chequeo de APK en `AppUpdateBanner` ahora solo corre
cuando `app === "deliveries"`.

**Regla de código compartido: la decide Andrés commit a commit, no un
script.** `constants.ts`, `TopBar.tsx` genérico, `src/app/api` los
importan las tres apps, pero una edición casi siempre toca la
rebanada de una sola — un script no puede distinguir eso con
certeza, solo criterio humano puede. Regla explícita: cambio dentro de
la carpeta propia de una app → sube solo esa. Cambio en compartido →
Andrés juzga si afecta a las otras; DEFAULT cuando dude: subir las
tres (un refresh de más es leve y visible; una app que no se enteró de
un cambio real se queda con código viejo, en silencio — la asimetría
justifica el default). Deliberadamente NO se implementó un auto-bump
que suba las tres por cualquier archivo compartido tocado — eso
recrearía el problema que este cambio resuelve (avisos gratis →
la gente aprende a ignorar el banner).

**Este mismo cambio es shared-code que afecta a las tres, aplicando su
propia regla:** `api/version/route.ts`, `AppUpdateBanner.tsx`,
`VersionFooter.tsx` son infraestructura compartida — el mecanismo de
chequeo que usan recruiting y timetracker cambió de verdad hoy, así
que sus propias versiones (0.1.0) son su primer número real bajo el
esquema nuevo, no un bump artificial sobre un 0.1.0 que nunca se
publicó.

**Propuesta de recordatorio en pre-commit — mostrada, NO instalada.**
Un hook que solo IMPRIME un aviso si el commit tocó algo fuera de las
carpetas propias de las tres apps ("Tocaste archivos compartidos:
[...] — revisa `app-versions.ts`"), nunca bloquea ni decide ni sube
nada — la decisión sigue siendo 100% de Andrés. Dos formas, con
trade-offs distintos:
- Hook crudo en `.git/hooks/pre-commit`: cero dependencias nuevas,
  pero NO vive en control de versiones — hay que reinstalarlo a mano
  en cada clon/máquina nueva.
- Husky: sí queda en el repo (se auto-instala vía `npm install` +
  script `prepare`), pero agrega una devDependency y un paso de
  instalación nuevo por algo puramente informativo.
Sin instalar hasta que Andrés confirme cuál (o ninguna).

**Actualización, misma sesión: Husky, confirmado por Andrés.**
Instalado (`husky` v9 como devDependency, `"prepare": "husky"` en
`package.json`, `npx husky init`). El hook en sí (`.husky/pre-commit`)
solo llama a `scripts/check-shared-files.mjs` (nuevo) — el mismo
script que se enseñó, ahora en disco: `git diff --cached --name-only`
contra las carpetas propias de cada app, imprime la lista si algo
compartido quedó staged, y siempre sale con código 0. Probado en vivo
contra el propio commit que instala esto (que sí toca archivos
compartidos: `.husky/`, `scripts/`, `package.json`) — imprimió el
aviso correctamente, sin bloquear nada.

**Consecuencia aceptada:** `HelpButton.tsx` y ambos `VersionFooter.tsx`
(el compartido y el de recruiting) se actualizaron para leer del mapa
nuevo — consecuencia directa de borrar el `APP_VERSION` global, no
alcance nuevo: dejarlos importando una constante borrada habría roto
el build. `CLAUDE.md`'s paso 3 del flujo se reescribió para reflejar
el esquema nuevo — la instrucción vieja ("sube `APP_VERSION` en
`constants.ts`, siempre") apuntaba a un símbolo que ya no existe.
`tsc`/`vitest` (487)/`next build` limpios.

**Revisar cuando:** el criterio manual de "compartido → yo decido"
empiece a fallar en la práctica (versiones que deberían haberse
subido juntas y no se subieron) — ahí sí valdría la pena reconsiderar
el auto-bump que se descartó aquí a propósito.

---

## D-088 · D-081 tenía un bug propio: una app abierta se quedaba vacía hasta refrescar
**Fecha:** 2026-08-21 · **Versión:** v1.21.4 (deliveries) · v0.1.1
(recruiting, timetracker) · **Pedido por:** Andrés (*"whenever you
open the app or switch modules you need to refresh it to be able to
see the data"*)

**Cambio:** `ensureSession()` en los tres proveedores de datos
(`data-provider.tsx`, `recruiting-data-provider.tsx`,
`timetracker-data-provider.tsx`) ahora envuelve TODO su cuerpo en
`try/catch` — antes solo `refreshSession()` tenía `.catch(()=>{})`,
pero `supabase.auth.getSession()` en la misma función no tenía ningún
manejo de error.

**El mecanismo exacto — un bug que yo mismo introduje horas antes en
D-081.** D-081 hizo que `reloadAll()` llamara `await ensureSession()`
como su PRIMERA línea, para refrescar un token vencido antes de leer.
Pero si `getSession()` fallaba por cualquier motivo — un fetch
abortado a media navegación (los navegadores cancelan peticiones en
vuelo cuando empieza una navegación nueva, y abrir la app o cambiar de
módulo es exactamente eso), un hipo de red transitorio — esa excepción
sin capturar tumbaba TODA la promesa de `reloadAll()` antes de llegar
a `Promise.all([...])` siquiera, y sobre todo, antes de llegar a
`setReady(true)` al final. La pantalla se quedaba pegada en su estado
inicial vacío/cargando, sin ningún error visible, hasta que algo
volviera a disparar `reloadAll()` desde cero — un refresh manual, que
por casualidad le da a `getSession()` una ejecución limpia sin
navegación de por medio, y por eso "funciona" al refrescar.

**Por qué no se atrapó antes de subir D-081:** `tsc`/`vitest`/`next
build` no ejercitan una navegación real del navegador con peticiones
en vuelo — el error solo aparece en el momento exacto de abrir la app
o cambiar de módulo, la clase de condición de carrera que ninguna de
esas tres herramientas puede reproducir.

**Consecuencia aceptada:** el propósito de `ensureSession()` (refrescar
proactivamente un token por vencer) ahora es estrictamente
best-effort — si falla por cualquier razón, `reloadAll()` sigue
adelante con la sesión que ya exista, exactamente el comportamiento de
ANTES de D-081. En el peor caso (el `getSession()` falla Y la sesión
de verdad estaba vencida) se vuelve al síntoma original de D-081 —
pantalla vacía sin error — pero ya no al síntoma NUEVO (pantalla vacía
SIEMPRE, en cada apertura/cambio de módulo). `tsc`/`vitest`
(487)/`next build` limpios.

**Revisar cuando:** si "pantalla vacía sin refrescar" vuelve a
aparecer, el siguiente sospechoso es el mismo patrón sin capturar en
`Promise.all([...])` de cada `reloadAll()` — hoy asumido seguro porque
los queries de Supabase normalmente resuelven con `{data, error}` en
vez de lanzar, pero un fallo de red real (no solo un error de API) sí
podría lanzar ahí también, con el mismo efecto de nunca llegar a
`setReady(true)`.

---

## D-089 · Salir se muda dentro de la burbuja del rol (solo roles que no son admin)
**Fecha:** 2026-08-22 · **Versión:** v1.21.4 (deliveries) · **Pedido por:** Andrés
(*"the sign out we said will be a dropdown inside the office manager
bubble"*)

**Cambio:** para todos los roles menos admin, la píldora del rol
(antes un `<span>` estático junto al botón "Sign out") ahora es un
botón que abre un menú desplegable pequeño con la opción de salir. El
botón de Sign out separado que estaba al lado desaparece para esos
roles.

**Razón:** ya se había acordado en una conversación anterior de esta
misma sesión — captura de pantalla del topbar mostrando
"PH Patricia Hernández [Office Manager] [Sign out]" como tres
elementos sueltos, con la instrucción de que Salir viviera dentro de
la burbuja en vez de al lado.

**Admin queda intacto, a propósito.** El propio Andrés lo aclaró
antes: *"admin que puede switch roles no porque ya tiene el dropdown
para cambiar roles"*. La burbuja de admin ya es un `<select>`
disfrazado de píldora para previsualizar otro rol — meterle Salir ahí
habría mezclado dos funciones distintas en un solo control. Admin
conserva su botón de Sign out separado, sin cambios.

**Consecuencia aceptada:** un elemento interactivo más en la barra
superior para los roles no-admin (antes era texto estático). Reusa el
mismo patrón visual que el menú "☰ General" (mismo `col-menu`/`col-opt`,
mismo backdrop para cerrar al hacer clic afuera, mismo cálculo de
volteo cuando no cabe a la derecha) para no introducir un componente
nuevo. `tsc`/`vitest` (487)/`next build` limpios.

## D-090 · Se invierte la fusión: deliveries-app es el anfitrión, el ERP se muda aquí
**Fecha:** 2026-08-25 · **Versión:** v1.22.0 (deliveries) · v0.2.0 (recruiting, timetracker) · **Pedido por:** Andrés
(*"WE WILL CHANGE THE APPROACH THIS IS NOT WORKING WE WILL MERGE THE
ORIGINAL FILES OF THE ERP INTO THE DELIVERIES"* · *"THE VIEWS ARE
WRONG, AND IS TAKING TOO LONG"*)

**Cambio:** se revierte la dirección de la fusión. Hasta ahora
deliveries + recruiting + timetracker se estaban reconstruyendo dentro
de `codingcodertg/rtg-erp`. A partir de aquí el anfitrión es
**deliveries-app**, y lo que se muda es el ERP (catálogo, compras,
inventario, analítica). Primer paso, en este commit: subir este repo a
**Next 15.5 + React 19**, que es la versión en la que está escrito el
código del ERP.

**Razón — y es la parte que importa:** la dirección anterior obligaba a
*reconstruir* cada pantalla de deliveries/recruiting/timetracker en
Tailwind sobre React 19. Reconstruir una pantalla no es moverla: sale
parecida, no igual. Andrés lo dijo en dos palabras —
*"the views are wrong"*— y eso no se arregla puliendo, porque el
problema no era el acabado sino el método. Además era lento, que fue
la segunda queja. Al invertir la dirección, las pantallas que el
personal usa todos los días **no se tocan**: son los archivos
originales. Lo que se reconstruye es el ERP, y el ERP son datos de
demostración, no el negocio real.

**Por qué se sube Next en vez de bajar el ERP:** el código del ERP usa
`params`/`searchParams` asíncronos, que es la forma de Next 15. Bajarlo
a Next 14 significaría reescribir cada página del ERP y quedarnos en
una versión vieja, divergiendo para siempre. Subir este repo es un solo
paso arriesgado, hecho una vez, con las pruebas como red.

**Superficie real del cambio de versión (fue chica):** solo dos
ficheros usaban `cookies()` y cinco recibían `params`. `cookies()` pasa
a ser asíncrono en Next 15, así que `createClient()` del servidor pasa
a ser `async` y sus 13 llamantes la esperan; las cuatro rutas con
`params` los reciben como promesa. `track/[id]` es un componente de
cliente y no puede ser `async`, así que desenvuelve con `React.use()`.

**Hallazgo de paso:** `src/lib/recruiting/supabase/server.ts` no lo
importa nadie. Queda como estaba, anotado aquí para no volver a
descubrirlo.

**Consecuencia aceptada:** el trabajo hecho en rtg-erp (30 pantallas
portadas, migraciones v4_68–v4_93) deja de ser el camino principal. No
se tira: los seis agujeros de seguridad que aparecieron ahí son
agujeros que **también existen aquí** —el estrechamiento de lectura por
rol que nunca se aplicó en ninguno de los dos sistemas, el banco de
preguntas escribible por cualquier reclutador, `active` de timetracker
que cada quien podía cambiarse— y hay que cerrarlos en este repo
también. Eso va aparte, no en esta entrada.

**Verificación:** `tsc` limpio · `vitest` 487/487 (idéntico al baseline
antes de subir) · `next build` compila, 61 páginas. Ninguna prueba
cambió de resultado con el salto de versión.

---

## D-091 · Clock-in entra como cuarto módulo, con su propio schema
**Fecha:** 2026-08-26 · **Versión:** v1.28.0 (deliveries) · **Pedido por:** Andrés
(*"si tiene usuarios propios, ahora si estos tienen users con emails que ya
están registrados solo se hará el merge y sino solo se crearán"*)

**Cambio:** `codingcodertg/rtg-clock-in` (fichaje, sitios, turnos, cobertura,
ausencias) se fusiona aquí como cuarto módulo, en `/clock-in`, con schema
`clockin` en la base de datos. Time Tracker sigue vivo e intacto: son dos
modelos distintos de fichar y no se tocan.

**No hizo falta subir el framework.** Venía en Next 16.2, pero no usa nada
exclusivo de esa versión — sin `use cache`, sin PPR, sin `next/form`, y ya con
`params` asíncronos. Corre en Next 15.5 tal cual.

**Su `profiles` se partió, siguiendo D-064/058.** Tenía 16 columnas y solo
cuatro son identidad. Las otras doce (`company_id`, `phone`, `language`,
`active`, `store_id`, `default_schedule`, `custom_schedule`, `is_runner`,
`vehicle_id`, `position`…) son negocio del módulo y viven en
`clockin.employee_settings`. En `public.profiles` solo entra `clockin_role`.

**Y una vista de compatibilidad, `clockin.profiles`.** Ese reparto es el
correcto para almacenar y rompe 71 puntos del código que hacen
`.from("profiles")` esperando la forma vieja. Reescribir 71 llamadas a mano son
71 ocasiones de equivocarse, y cada error sería una lectura silenciosa de la
columna equivocada, no un fallo de compilación. La vista devuelve la forma
original y su código no se toca; escribe a través de triggers `INSTEAD OF` que
mandan cada columna a la tabla que la posee. Va con `security_invoker` — una
vista corre como su dueño salvo que se diga lo contrario, que es como las
vistas del ERP acabaron ignorando RLS (v4/068).

**Identidad:** 11 usuarios. Cinco coincidían por email. Dos más —Patricia
Hernández y Alberto Garza— **ya trabajaban aquí con otro correo**; se
detectaron comparando nombres, no emails, y Andrés confirmó unificarlos. Si se
hubiera aplicado la regla del email tal cual, tendrían cuenta duplicada y su
historial de fichajes a nombre de otra persona. Los cuatro restantes se crearon
**sin contraseña**: la fila existe para que su historial quede atribuido, pero
no pueden entrar hasta que un admin les dé acceso.

**Datos:** 2.766 filas de 2.766. **Storage: 545 fotos, 351 MB** — esta vez se
migró junto con las tablas, no después de que alguien abriera un adjunto roto.

**Consecuencia aceptada:** dos formas de fichar conviviendo. Es lo que se pidió
y no se resuelve solo; si algún día una sustituye a la otra, eso es su propia
decisión y su propia migración.

---

---

<!-- PLANTILLA — copia esto para una entrada nueva
## D-0XX · Título corto en presente
**Fecha:** YYYY-MM-DD · **Versión:** vX.Y.Z · **Pedido por:** nombre

**Cambio:** qué hace distinto el sistema ahora.

**Razón:** por qué se pidió. Textual cuando se pueda.

**Consecuencia aceptada:** qué se sacrificó a cambio.

**Revisar cuando:** (opcional) qué haría que esta decisión caduque.
-->

## D-092 · Otorgar acceso a clock-in crea también su fila de configuración
**Fecha:** 2026-08-26 · **Versión:** migración 078 · **Pedido por:** Andrés
(*"aun no sale"* — la tarjeta de Fichaje no aparecía en el hub)

**Lo que no era un bug:** la tarjeta se dibuja desde `module_access`, que se
otorga persona por persona. De la fusión solo salieron con acceso los 11 que
venían en clock-in — Roberto entre ellos, Andrés no, porque Andrés no fichaba
en esa app. Así que el hub estaba haciendo exactamente lo suyo. Ninguna tarjeta
de módulo aparece por ser admin; recruiting y timetracker se comportan igual y
cambiar eso les rompería el suyo, porque sus layouts exigen su propio rol y no
perdonan al admin.

**Lo que sí era un bug, y salió al ir a otorgarlo:** `clockin.profiles` (077) es
un INNER JOIN entre `public.profiles` y `clockin.employee_settings`. Otorgar
acceso —desde el diálogo de Usuarios o desde SQL— solo escribe `clockin_role` y
`module_access` en `public.profiles`. Sin fila en `employee_settings` el join no
devuelve nada y las 71 llamadas que hacen `.from("profiles")` ven a esa persona
como inexistente: entra al módulo y el módulo no sabe quién es. Es peor que un
"no tienes acceso", porque parece roto en vez de cerrado.

**Cambio:** un trigger en `public.profiles` (078) crea la fila al aparecer
`clockin_role`, más un backfill para quien ya lo tuviera.

**Por qué en la base y no en `updateUserClockinAccess`:** hay más de un camino
para otorgar (el diálogo, un script, SQL a mano) y el trigger los cubre todos.
Y porque la política `employee_settings manager insert` (074) exige ser manager
u owner **de clock-in**: un admin de deliveries que todavía no tiene
`clockin_role` no puede insertar esa fila — que es justo quien otorga la primera
vez. `SECURITY DEFINER` rompe ese huevo-y-gallina sin abrirle la política a
nadie más.

**Se descartó** que la vista fuera LEFT JOIN con valores por defecto, que es lo
que hace timetracker en memoria (D-066). Ahí el layout lee `employee_settings`
aparte y puede inventar un defecto; aquí la vista *es* el contrato de 71
llamadas, y `company_id` no admite defecto: todo el scoping de clock-in cuelga
de esa columna vía `clockin.auth_company_id()`. Una fila real y vacía es honesta;
una vista que rellena huecos esconde a quién le falta configuración.

**`company_id` solo si es inequívoco:** hoy hay una sola compañía (Rodriguez
Tile Group) y se usa. Si algún día hay varias se deja NULL a propósito, para que
un manager la asigne, en vez de meter a alguien en la compañía equivocada.

## D-093 · Stop detiene en pantalla primero y guarda después
**Fecha:** 2026-08-26 · **Versión:** v0.4.2 (timetracker) · **Reportado por:** Andrés
(*"i press stop on the time tracker app and doesnt stop"*)

**Regresión del arreglo de 243484a** (*"leaving the Time view lost the running
session"* — adoptar al montar la sesión que sigue viva en el servidor; se
commiteó sin entrada aquí, y esta la cubre). Ese arreglo abrió dos caminos por
los que Stop podía no detener nada:

1. **Carrera con la adopción.** El efecto que adopta la sesión es asíncrono.
   Gracias a la miga de pan en localStorage la vista ya pinta *Stop* en el
   primer frame, así que se puede pulsar Stop **antes** de que vuelva
   `listLiveSessions()`. Cuando volvía, el efecto ponía `running = true` otra
   vez con la fila que ya había pedido: el botón parecía muerto porque un
   segundo después la sesión reaparecía.
2. **Stop sin id.** En esa misma ventana `sessionIdRef` todavía era `null`, así
   que Stop no escribía nada y la fila se quedaba `isLive` para siempre — el
   fallo original de D-089, de vuelta por otra puerta.

**Cambio:**
- `sessionIdRef` y `startMsRef` se siembran de la miga de pan, igual que ya se
  sembraban `running` y `worked`. Stop tiene id desde el primer frame.
- Un `stoppedRef` que la adopción consulta al volver: si se pulsó Stop mientras
  estaba en vuelo, no adopta; y si encuentra una fila abierta que Stop no
  alcanzó, la cierra en vez de resucitarla.
- **Stop cambia la pantalla antes de guardar, no después.** Estaba en un
  `finally`, así que una escritura lenta o con reintentos dejaba la vista
  diciendo "corriendo" durante segundos. Es seguro ser optimista porque
  `writeSession` no se rinde: cae a la cola offline, que se vacía al reconectar.

**De paso, dos cosas que el arreglo anterior dejó mal:**
- `if (!ok) alert(...)` era código muerto: `writeSession` devuelve `true` o el
  string `"queued"`, ambos verdaderos. Nunca podía avisar. Ahora avisa de lo que
  sí ocurre — que quedó en cola — y con `notify()`, no con un `alert` que
  bloquea.
- Si `listLiveSessions()` fallaba (sin conexión), el `catch` "dejaba la UI como
  no corriendo". Dejó de ser cierto al sembrar `running` de la miga: la vista
  mostraba un reloj **congelado** en el segundo del montaje. Ahora sigue
  contando desde la miga, que ya trae el id y el arranque.

## D-094 · Lo que la fusión de clock-in daba por sentado y aquí no es cierto
**Fecha:** 2026-08-26 · **Versión:** v0.2.0 (clockin) · **Pedido por:** Andrés
(*"continue with the merge"*)

Tres suposiciones de `rtg-clock-in` que eran ciertas cuando clock-in **era** la
aplicación entera y dejan de serlo dentro de este contenedor. Ninguna daba error.

### 1. Cuatro ficheros hablaban con PostgREST sin decir el schema

Las tres rutas de cron y `lib/clockin/notify.ts` usan `fetch` a pelo, no el
cliente de Supabase, así que **no** llevan el `db: { schema: "clockin" }` que
pone `lib/clockin/supabase/client.ts`. Sin cabecera de perfil PostgREST responde
desde `public`, que aquí es la base de otra app:

| tabla | en `public` | consecuencia |
|---|---|---|
| `notifications` | **existe** | las notificaciones de fichaje se escribían en la tabla de deliveries |
| `profiles` | **existe** | leía la fila de deliveries, sin `company_id`, `language` ni `active` |
| `scheduled_shifts` | 404 | `q()` devuelve `[]` si `!r.ok`: el cron no hacía nada, en silencio |
| `shift_cancellations` | 404 | igual |
| `push_subscriptions` | 404 | igual |

Nada de eso lanza un error. Por eso se arregla con una constante compartida
(`lib/clockin/rest.ts`) y no con una cabecera en cada llamada: un sitio que la
olvide no se rompe, lee o escribe los datos de la otra app sin decir nada.

### 2. Un manager de fichaje podía borrar a alguien de TODA la empresa

`deleteEmployee()` llamaba a la API admin de Auth para borrar el usuario,
razonando que eso arrastra el perfil y todos sus registros. Cierto en
`rtg-clock-in`, donde clock-in era todo. Aquí `public.profiles` es la identidad
compartida de deliveries, recruiting, timetracker y el ERP: pulsar 🗑️ en la
pantalla de Equipo habría borrado a esa persona de las cuatro, con su historial
de entregas. El texto en español incluso lo prometía — *"borra su acceso y todos
sus registros"*.

**Se elimina la acción, no se le pone un candado.** Una versión segura tampoco
cabía aquí: quitar a alguien de clock-in significa limpiar `clockin_role`, y el
guardián de 071 solo deja hacerlo a un admin de deliveries — el acceso se otorga
y se revoca desde el hub (D-091), a propósito. Lo que un manager de fichaje sí
necesita es dejar de contarle el tiempo a alguien, y `setEmployeeActive()` ya
hace exactamente eso, reversible y sin tocar la app de nadie más. Borrar a la
persona de la empresa sigue existiendo en **Usuarios** del hub, solo para admin
y con registro de seguridad.

### 3. Y podía cambiarle la contraseña a un admin

`resetEmployeePassword()` solo comprobaba ser manager u owner **de clock-in**.
La contraseña que restablece no es de clock-in — aquí no existe tal cosa: es el
único login del hub, el mismo que abre deliveries, recruiting, timetracker y el
ERP. Un owner de fichaje podía ponerle una contraseña temporal a un **admin de
deliveries** y entrar como él. Ahora exige `role = 'admin'`, la misma puerta que
`/api/reset-password` del hub.

### De paso: el secreto del cron ya no tiene que ir en la URL

Las tres rutas aceptaban solo `?key=<CRON_SECRET>` — por eso nunca fueron crons
de Vercel: las llama un programador externo. La query sigue funcionando, así que
lo que las llame hoy sigue llamándolas, pero ahora también vale
`Authorization: Bearer <CRON_SECRET>`, que no acaba en cada log de acceso.
Fallan cerradas si `CRON_SECRET` no está: sin secreto configurado no está
autorizado nadie, no todo el mundo.

**Pendiente de configuración, no de código:** `CRON_SECRET` y las tres claves
VAPID en Vercel — y las VAPID tienen que ser **las mismas** de `rtg-clock-in`,
porque las suscripciones push existentes están firmadas contra esa clave y con
otra dejan de valer. Y repuntar el programador externo a las rutas nuevas.


## D-095 · La pantalla de Equipo de fichaje se muda a Usuarios del hub
**Fecha:** 2026-08-26 · **Versión:** v0.3.0 (clockin) · **Pedido por:** Andrés
(*"haz merge el panel de usuarios con el de usuario de hub y elimina ese view y
solo deja la parte de vehiculo"*)

**Cambio:** `/clock-in/team` tenía un alta de empleados y una fila por persona
con puesto, horario, sitio, vehículo de repartidor, activar/desactivar y
restablecer contraseña. Todo eso es configuración de **una persona**, y esta app
ya tiene un sitio para eso: **Usuarios**, en el hub, donde a esa misma persona se
le pone su rol de entregas, su acceso a reclutamiento y al ERP. Dos listas del
mismo personal, cada una enseñando una mitad, es exactamente cómo alguien acaba
desactivado en una y activo en la otra.

La ruta se queda con **vehículos**, que es lo único que había ahí que no habla de
personas sino de camiones. El path sigue siendo `/clock-in/team` para no romper
marcadores.

**Es una reescritura, no una mudanza.** Los controles de clock-in son componentes
de Tailwind y en `/home/users` no hay Tailwind: el hub dibuja desde `globals.css`
y la hoja de cada módulo vive en el chunk de su propio layout (D-090). Los
controles nuevos son del hub (`.field`, `.grid g2`, `.perm-opt`); las acciones de
servidor detrás siguen siendo las de clock-in, intactas.

### `addEmployee()` se elimina

Creaba un usuario de Auth y un perfil. En `rtg-clock-in` era la única forma de
que alguien entrara. Aquí crear un usuario de Auth crea una **identidad del hub**
—alguien que puede entrar a entregas— desde una pantalla cuyo autor solo pensaba
en fichaje, con una contraseña que ese fichero se inventaba y sin que nadie
decidiera su `module_access`. Las personas se crean en Usuarios, que es también
donde se otorga cada módulo, y el trigger de 078 pone su ficha de fichaje en
cuanto se le da `clockin_role`.

### El puesto deja de escribir el rol

Arriba, ese control ponía puesto **y** rol, porque había dos desplegables y todo
el mundo los confundía. Aquí esa unión ya no se sostiene:

- El rol vive en `public.profiles.clockin_role` y el guardián de 071 solo deja
  cambiarlo a un admin de deliveries. Un owner de fichaje eligiendo "Gerente"
  habría chocado con *"Only an admin can change clock-in access or role"* — la
  escritura fallando en la mitad que nadie ve.
- En el diálogo del hub el rol de fichaje ya es su propio select, dos campos más
  arriba, con la misma forma que todos los módulos. Dos controles escribiendo la
  misma columna es justo la confusión que arriba se quería evitar, apuntando al
  revés.

Así que ahora escribe `position` y nada más. `position` es una etiqueta de
agrupación —el tablero de Cobertura es la única pantalla que la lee— y ya no
decide lo que nadie puede ver, que es también por qué deja de ser solo-owner y de
estar prohibida sobre uno mismo.

### El `managerCtx` duplicado se unifica, y admite al admin del hub

Había dos copias idénticas, en `actions/team.ts` y `actions/schedule.ts`, ambas
exigiendo `role in (manager, owner)` del propio escalafón de clock-in. Con la
configuración movida al hub, quien la usa es un admin — y estaba fuera. Además,
preguntarle a `clockin.profiles` por un admin contesta otra cosa: esa vista es un
INNER JOIN (077), así que alguien sin ficha de fichaje no está *denegado*, está
**ausente**, y el `.single()` fallaba y se leía como permiso denegado. Ahora se
consulta primero la identidad del hub, en `public`, donde un admin siempre existe.

### Y la base tenía que estar de acuerdo (079)

Dejar pasar al admin en el código y no en las políticas habría sido peor que
bloquearlo. Las políticas de 074 no lanzan error: **filtran filas**. Un UPDATE que
no encaja afecta cero filas y devuelve éxito — el admin habría visto el select
cambiar, el diálogo cerrarse contento y nada guardado. Peor aún,
`auth_company_id()` devuelve NULL para un admin sin ficha, y `company_id = NULL`
no es falso, es NULL, que para una política vale lo mismo que falso.

Así que 079 lo dice en las **tres funciones** que todas las políticas consultan,
en vez de en treinta y cinco políticas. No es un permiso nuevo: un admin ya puede
darse `clockin_role = 'owner'` desde Usuarios con dos clics — 071 lo autoriza
explícitamente — y `has_clockin_access()` ya trataba `role = 'admin'` como acceso.
Esto solo evita que tenga que hacerlo para que sus guardados dejen de perderse.
No viaja al revés: un owner de fichaje no gana nada en el hub.


## D-096 · Un cliente solo maneja la sesión que su propio tipo arrancó
**Fecha:** 2026-08-27 · **Versión:** v0.5.0 (timetracker) · **Reportado por:** Andrés
(*"mira el tracker sigue sin parar, en vez de estar en sync con la desktop"* ·
*"quisiera que cuando se use el desktop salga un mensaje tracking via desktop app"*)

**Lo que se veía:** la app de escritorio marcaba `0:22:07`, empezada a las 09:30,
79% de actividad. La web, abierta en la misma cuenta y en el mismo momento,
marcaba `25:22:07`, empezada a las 08:30 **del día anterior**, 0% de actividad, y
el Stop no la paraba.

### Por qué el reloj decía 25 horas — regresión de D-093

La miga de pan de `localStorage` era de la sesión de ayer. La llamada que la
confirma contra el servidor falló, y D-093 había puesto justo ahí un
`beginTicking()` para que el reloj no se quedara congelado. Así que el reloj no
se congeló: se puso a contar, con confianza, desde un arranque de hacía 25 horas.
Preferir un dato viejo sin confirmar a admitir que no se sabe.

Ahora la miga **caduca a las 18 horas** —no hay turno que dure eso, así que una
miga más vieja no es un turno en curso, es uno que este dispositivo nunca vio
cerrarse— y si la confirmación falla el reloj se muestra **sin escribir nada**,
y una consulta a los 20 segundos decide si sigue viva o se limpia.

### Y lo de fondo, que era peor

`beginTicking()` **escribe la fila cada diez segundos**: `endMs`,
`durationSeconds`, `activeSeconds`, `keystrokes`, `clicks`. Los dos clientes
hacían eso sobre cualquier sesión viva que encontraran. Con la app de escritorio
y una pestaña abiertas a la vez, se pisaban por turnos — y el navegador gana con
los números que **no puede medir**: una pestaña no ve el teclado de otras
ventanas, así que escribía 0% de actividad encima del 79% real del escritorio.

**Regla nueva:** la sesión lleva en `source` quién la arrancó (`desktop` o
`timer`), y **solo la maneja un cliente de ese tipo**. El otro la mira: mismo
reloj, calculado desde el mismo `startMs` —que es lo que hace que los dos números
coincidan—, y ni una escritura.

Al que mira se le quitan además el medidor de actividad, los descansos, y los
recuadros de *Activity* y *Lunch + break*. No es por limpieza: son contadores de
**este** cliente, y enseñar 0% al lado de alguien que está trabajando es
exactamente lo que se veía en la captura.

### El mensaje

Donde estaba el botón de Stop aparece **🖥 App de escritorio**, y bajo el reloj
*"Contando desde la app de escritorio — esta página solo mira."* Funciona en los
dos sentidos: desde el escritorio, una sesión empezada en la web dice *"Contando
desde la web"*.

**Se descartó** dejar un Stop en el que mira. Pararla desde aquí dejaría al dueño
contando contra una fila ya cerrada, que es la misma clase de desacuerdo que se
está arreglando. Se para donde se arrancó.

**`source` no rompe los informes:** solo distinguen `manual` y `adjusted` para
poner su etiqueta; `desktop` cae en el mismo sitio que `timer`, sin etiqueta.


## D-097 · Auditoría completa: dos fallos de fondo, encontrados y corregidos
**Fecha:** 2026-08-27 · **Versión:** migraciones 080 y 081 · **Pedido por:** Andrés
(*"hazme un audit completo de todo y si lo encuentras arreglalo"*)

Revisión de RLS, permisos, identidad, integridad, configuración y rutas sobre los
cinco módulos. Dos hallazgos reales; el resto salió limpio.

### 1 · Las políticas evaluaban sus helpers por fila (080)

Es el fallo que tumbó el catálogo del ERP y que se arregló **solo allí** (D-090,
migración 070). La auditoría lo encontró vivo en todos los demás: **80 políticas**
de `clockin`, `recruiting`, `timetracker` y `public` llamaban a
`auth_company_id()`, `auth_is_manager()`, `has_recruiting_access()`,
`current_user_role()` y `auth.uid()` sin envolver. Postgres no puede saber que son
constantes dentro de la consulta, así que las ejecuta **una vez por cada fila
examinada**.

Medido antes de tocar nada, sobre `clockin.notifications` (2.161 filas):

| | |
|---|---|
| `where company_id = clockin.auth_company_id()` | **100.9 ms** |
| `where company_id = (select clockin.auth_company_id())` | **2.4 ms** |

Hoy ninguna tabla es lo bastante grande para que se note en pantalla, y conviene
decirlo así en vez de inflarlo. El punto es que `time_entries` crece con cada
fichaje y `notifications` con cada aviso: el catálogo del ERP tampoco molestaba
hasta que llegó a 84.000 filas y empezó a dar timeout.

La migración **se generó leyendo `pg_policy` y reescribiendo cada expresión**, no
a mano: 165 llamadas envueltas, ninguna condición redactada de nuevo. Verificado
después: 171 políticas siguen existiendo, 0 llamadas por fila.

### 2 · `anon` podía TRUNCATE 31 tablas (081)

`anon` —el rol del visitante sin sesión, el que respalda la clave pública del
navegador— tenía SELECT, INSERT, UPDATE, DELETE y **TRUNCATE** sobre 31 tablas de
`public`, `recruiting` y `timetracker`. `clockin` y `erp` no: sus migraciones
concedieron solo a `authenticated` y `service_role`. Las otras tres heredaron el
reparto por defecto de Supabase y nadie lo recortó.

**No era una fuga abierta.** RLS filtra fila por fila, anon no tiene `auth.uid()`,
así que un SELECT anónimo trae cero filas; y se comprobó que ninguna pantalla
funciona sin sesión —todas redirigen a `/login`— así que nada legítimo se apoyaba
en esos permisos.

Lo que sí importa: **TRUNCATE no pasa por RLS**. Una política no lo filtra porque
no mira filas: vacía la tabla entera. Hoy no hay camino para invocarlo (PostgREST
no lo expone), pero es un permiso a una función RPC de distancia de ser
alcanzable. Revocado, y con `alter default privileges` para que una tabla nueva no
vuelva a nacer con él.

### Lo que se revisó y salió limpio

RLS activo en las 92 tablas y ninguna sin políticas · las 6 vistas con
`security_invoker` · las funciones `SECURITY DEFINER` todas con `search_path`
fijo · cero perfiles sin cuenta y cero cuentas sin perfil · cero accesos
incoherentes con su rol · cero capturas apuntando a ficheros que no existen ·
los 21 enlaces internos resuelven a alguna de las 111 rutas · la clave de servicio
no aparece en ningún bundle de cliente · ningún secreto en el repo.

### Anotado, no cambiado

- **`Andres Ugarte / andresugarte000@gmail.com`**: segunda cuenta tuya, rol
  `logistics`, sin módulos, sin datos y sin haber entrado nunca — pero con
  contraseña, así que es un login vivo que nadie usa. Borrar a una persona es
  decisión del negocio, no de una auditoría.
- **ESLint no está configurado** en el proyecto (`next lint` pide instalarlo).
  Instalarlo cambiaría el flujo de trabajo de cada cambio; se deja dicho.
- Las tres VAPID y el programador externo de los crons siguen pendientes de
  configuración (D-094).


## D-098 · No se puede fichar tiempo sobre tiempo ya fichado
**Fecha:** 2026-08-27 · **Versión:** v0.6.0 (timetracker), migración 082 · **Pedido por:** Andrés
(*"no se puede track time sobre track time... haz esa regla bulletproof"*)

**Por qué ahora:** dos filas infladas habían llegado ya a nómina. La fila fantasma
de 25.75 h que un tab web engordó sobre una sesión real (D-096), y antes las
19.27 h de Nick por olvidarse de parar. Las dos se cazaron mirando; ninguna avisó.
Y al buscar solapamientos en el histórico apareció una tercera, callada desde
julio: **0.50 h manuales dentro de una sesión cronometrada de 1.17 h** — Nick
cobró ese tramo dos veces el 11 de julio.

### La regla vive en la base, no en la interfaz

Una restricción `EXCLUDE` sobre `timetracker.sessions`: misma persona, rangos que
se cruzan, rechazado.

**Se descartó un trigger.** Un trigger que consulta "¿hay algo que solape?" y
luego inserta tiene una ventana entre las dos cosas: dos escrituras simultáneas
pueden pasar la comprobación a la vez y entrar las dos. `EXCLUDE` lo resuelve el
índice dentro de la misma operación, sin ventana. Eso es lo que *blindado*
significa aquí, y es la razón de la extensión `btree_gist`.

**Rangos semiabiertos `[inicio, fin)`.** Es lo que deja intacta la costumbre
normal: parar a las 13:03 y arrancar otra a las 13:03 no solapa, y en el
historial eso pasa a diario. Con rangos cerrados se habría rechazado media app.

**Fuera del índice** quedan las sesiones sin cierre (un rango sin tope superior
bloquearía todo lo posterior) y las de duración cero que deja un arranque anulado.

**Por persona.** Dos personas trabajan a la vez, evidentemente; lo que no puede
es una sola estar en dos sitios.

Probado contra los seis casos antes de darlo por bueno: sesión base *aceptada*;
otra encima *rechazada*; manual dentro *rechazada*; solape parcial por la cola
*rechazado*; pegada justo después *aceptada*; otra persona a la misma hora
*aceptada*.

### Los tres caminos escriben en la misma tabla

El cronómetro, el "add time" manual y el "adjust" aprobado. Antes solo el primero
tenía algo de cuidado, y **por el tercero entró el cobro doble de Nick**: aprobar
horas manuales encima de un tramo ya cronometrado no se quejaba. Ahora la
restricción los cubre a los tres por igual, porque está debajo de todos.

### Un solape no es un fallo de red

`writeSession` reintentaba tres veces y luego dejaba la escritura en la cola
offline. Para un solape eso es lo peor posible: la base lo va a rechazar igual
dentro de una hora, así que la cola reintenta para siempre mientras el reloj sigue
en pantalla como si estuviera guardando. Ahora se distingue por SQLSTATE 23P01 y
por el nombre de la restricción —PostgREST y supabase-js no siempre traen `code`
con la misma forma—, y se trata aparte:

- **el tick** para el reloj y lo dice, en vez de seguir contando algo que no se
  guarda — que es exactamente la forma que tenía el fantasma de 25.75 h;
- **Stop**, **Start**, el alta manual, el ajuste y la aprobación dan el mismo
  mensaje: *"Esas horas ya están fichadas"*, no el error crudo de Postgres.

Cinco pruebas cubren el detector, y la mitad son de lo contrario: que un
`Failed to fetch` o un JWT caducado **no** se confundan con un solape. Confundirlos
en ese sentido perdería horas legítimas por no reintentarlas.

### Dos filas retiradas para poder activarla

Una restricción `EXCLUDE` no admite `NOT VALID`: o los datos cumplen, o no entra.

- La fantasma de 25.75 h (0 s de actividad, 0 teclas, 0 clics, sin memo ni
  capturas). Respaldo en `scratchpad/sesion_fantasma_83944cec.json`.
- Las 0.50 h manuales de Nick del 11 de julio. Respaldo en
  `scratchpad/solape_ab792f7e.json`.

Las dos quedan anotadas en `timetracker.audit` con el motivo, para que dentro de
tres meses nadie se pregunte por qué falta una fila. **Andrés pasa de 84.19 h a
58.45 h esta semana**; a Nick se le retira medio tramo de julio que estaba pagado
dos veces, y eso conviene que lo sepa él.


## D-099 · El arreglo de D-088 tapaba una sola de las salidas
**Fecha:** 2026-08-27 · **Versión:** v1.30.0 (deliveries), v0.4.1 (recruiting), v0.6.1 (timetracker) · **Reportado por:** Andrés
(*"el app tiene el bug de nuevo que hay que darle reload para que la info cargue"*)

**Es el mismo síntoma de D-088 por otra puerta.** Aquel arreglo envolvió
`ensureSession()` en `try/catch`, y ahí se quedó. Pero `ensureSession()` era solo la
PRIMERA cosa que podía tumbar la promesa de `reloadAll()` antes de llegar a
`setReady(true)`: las nueve consultas que vienen después pueden hacer exactamente lo
mismo. Un fetch cancelado a media navegación —y abrir la app o cambiar de módulo **es**
una navegación— hace que `Promise.all` rechace, y la pantalla se queda como estaba:
vacía, sin ningún error, hasta que alguien refresca a mano.

D-088 dejó escrito el mecanismo con precisión y aun así arregló un solo punto de él.

**Cambio, en los tres proveedores** (`data-provider`, `recruiting-data-provider`,
`timetracker-data-provider`), porque los tres tenían la misma forma:

1. **`reloadAll()` entero en `try/catch/finally`,** con `setReady(true)` en el
   `finally`. La pantalla ya no puede quedarse colgada en "cargando" pase lo que pase.
2. **Un reintento marcado.** La carga fallida deja una marca, y un efecto reintenta
   tres veces con espera creciente (0.4 s, 1.5 s, 4 s) y además al recuperar el foco,
   al volver a ser visible y al volver la conexión.

**Las dos cosas, porque una sola no basta.** Solo con el `finally`, una carga fallida
enseñaría una app vacía en vez de una colgada — más honesto, igual de inútil. Solo con
el reintento, seguiría dependiendo de que algún intento gane la carrera. Juntas, el
caso normal se cura solo en menos de un segundo y sin que nadie toque nada.

**Por qué no lo atrapan las pruebas, otra vez:** `tsc`, `vitest` y `next build` no
ejercitan una navegación real con peticiones en vuelo. Lo que sí se puede comprobar
—y se comprobó— es la forma: que en los tres ficheros haya un `try`, un `finally`, y
que el `setReady(true)` esté **dentro** del `finally` y no después del `Promise.all`.
Esa comprobación estructural es la que habría detectado que D-088 estaba incompleto.

**Nota sobre el listener que ya existía:** `data-provider` escuchaba `focus`,
`online` y `visibilitychange` desde antes, pero solo para vaciar la cola de escrituras
pendientes. No recargaba nada, así que una primera carga fallida no se recuperaba por
ahí. Ahora hay un segundo efecto, separado, que sí lo hace — y solo cuando la última
carga falló, para que no sea un refresco periódico disfrazado.


## D-100 · Entregas se otorga como los demás, y la base lo comprueba
**Fecha:** 2026-08-27 · **Versión:** v1.31.0 (deliveries), migración 083 · **Pedido por:** Andrés
(*"en users estoy viendo que todos tienen acceso al delivery app por default y no!! todos pueden acceder solo la app a la que se le dio acceso"*)

**Revierte D-054 y D-057**, que trataban Entregas como implícita para todo el mundo.
La razón de entonces —todos entraban por Entregas— dejó de ser cierta en cuanto hubo
cuatro módulos y diez personas que solo fichan.

### Había dos puertas y solo estaba cerrada una

Quitar la tarjeta habría sido teatro. Los datos viven en Supabase y el navegador habla
**directamente** con Supabase: la llave es el token de la sesión, no la pantalla. Las
seis tablas de Entregas tenían la política de lectura **y la de escritura** en
`using (true)`.

Se comprobó haciéndose pasar por Alberto Garza —empleado de fichaje,
`module_access = {clockin}`, sin tarjeta de Entregas— con su propio `sub` en el JWT:

```
antes:   892 eventos · 90 entregas · 36 perfiles · 13 turnos
después:   0 eventos ·  0 entregas
```

Y con la de escritura abierta también podía modificarlos. No es que hubiera pasado: es
que nada lo impedía, y valía igual para cualquier cuenta futura.

### El reparto: los usuarios originales de Entregas

`has_deliveries_access()` = admin, o `'deliveries'` en `module_access`. El backfill se
lo dio a todos **menos** a quien solo tiene fichaje o time tracker — nueve personas: los
ocho de la cuadrilla y Nick. Los demás no notan nada. Comprobado uno a uno: Alberto y
Nick a cero; Baudelio (almacén), Máximo (chofer), Ángel (contabilidad) y Andrés (admin)
exactamente igual que antes.

`profiles.role` NO cambia: sigue decidiendo QUÉ ve dentro quien entra. Lo que se añade
es SI entra. Por eso quitar el acceso tampoco borra el rol — devolverlo no obliga a
recordar cuál era.

### `public.profiles` se deja abierta, y conviene decir por qué

No es un olvido. La vista `clockin.profiles` (077) es `security_invoker` —se ejecuta
como quien pregunta— y los layouts de recruiting y timetracker leen esa tabla para saber
quién eres. Cerrarla por acceso a Entregas dejaría a la cuadrilla sin poder entrar a su
propia app. Lo que expone son nombres, roles y tienda de 36 compañeros, no direcciones de
clientes. Merece su propia regla por módulo, que es un cambio aparte.

### Sin ningún módulo, una pantalla que lo diga

Antes no podía pasar. Ahora sí, y una pantalla vacía se lee como app rota y acaba en una
llamada. `/no-access` lo explica en los dos idiomas, ofrece cerrar sesión —no hay barra
ahí— y se redirige sola en cuanto alguien le otorga algo.

`landingRoute` también dejó de dar por sentado que el único módulo de alguien sea
Entregas: quien solo ficha entra a fichar. Y un chofer **sin** Entregas ya no va a
`/driver`, porque esa ruta vive dentro de Entregas.

### Trece pruebas se reescribieron, ninguna se borró

Fijaban la regla vieja (*"deliveries always first"*, *"sin module_access aterrizas en el
tablero"*). Ahora fijan la nueva, incluida una que antes no existía: que **ningún** módulo
sea `alwaysOn`, porque marcarlo dibuja su casilla en gris y el admin deja de poder
quitárselo a nadie.

### Encontrado de paso, NO cambiado

La política `auth write deliveries` es de tipo `ALL`, y `ALL` incluye `SELECT`. Como las
políticas permisivas se suman, su `using` estaba anulando el filtro cuidadoso de la
política de lectura: el límite del chofer (*"solo las suyas"*) y el del almacén (*"solo
ciertas etapas"*) **llevan muertos desde siempre**. No se notaba porque la pantalla del
chofer filtra en el cliente (`driver/page.tsx:47`).

Medido lo que costaría activarlo: Máximo pasaría de ver 89 entregas a 30; los cuatro de
almacén, de 89 a 83. Se deja como está a la espera de decisión, porque cambia lo que ve
gente que trabaja hoy y eso no se suelta un jueves por la tarde sin avisar.


## D-101 · Fusión Time Tracker + Clock-in, fase 1: un solo escalafón
**Fecha:** 2026-08-27 · **Versión:** v0.7.0 (timetracker), v0.6.0 (clockin), migración 084 · **Pedido por:** Andrés
(*"preparemos un merge entre time tracker y clock in app... el timetracker sería la app madre"*)

**Revierte D-091**, que dejó escrito *"Time Tracker sigue vivo e intacto: son dos
modelos distintos de fichar y no se tocan"*. Se dijo antes de empezar; Andrés confirmó
el cambio de rumbo.

**Elegido tras medir:** Time Tracker son 4.336 líneas y **un usuario real** (Nick);
clock-in son 11.930 y **diez**. La app madre es la pequeña, y conviene que conste que se
supo antes de decidirlo: la app de escritorio ya apunta a `/timetracker`, y ahí viven
proyectos, nóminas y la prueba de actividad.

**Forma elegida: una app, dos tipos de registro.** Los fichajes siguen en `time_entries`
y las sesiones de proyecto en `sessions`. Se descartó fundirlos en una sola tabla de
intervalos: obligaría a reescribir las 94 pantallas de clock-in contra un modelo nuevo,
que es exactamente lo que se hizo en el ERP y lo que provocó *"THE VIEWS ARE WRONG, AND
IS TAKING TOO LONG"*.

### El escalafón

Dos niveles (**admin / empleado**), los de Time Tracker. `clockin_role` deja de decidir
nada; lo sigue exigiendo la restricción de 071, así que un espejo lo mantiene al día
desde el rol de verdad y se retira en la fase 5.

**La primera propuesta era otra, y la evidencia la tumbó.** Se iba a mapear "solo dueño"
—geocercas y cierre de nómina— a "admin del hub", para que Patricia no ganara esos dos
poderes. Antes de escribirlo se miró quién los ejerce:

| | |
|---|---|
| cierre de nómina | **Jose Perez (Owner)** · 2 |
| aprobación de parte | Patricia Hernández · 2 · Jose Perez · 1 |
| turnos creados | **Jose Perez (Owner)** · 38 |

Jose no es admin del hub. La propuesta le habría quitado lo único que nadie más hace.
Con dos niveles, el admin del módulo puede lo de un gerente Y lo de un dueño.
**Consecuencia real, y es la única: Patricia gana cerrar nóminas y editar geocercas.**
El tercer nivel existía justo para separar eso.

### La atadura a la geocerca deja de colgar del rol

Estar atado a tu sitio salía de `role <> 'owner' && store_id`. Con dos niveles eso
desataría a **todo** admin — Patricia incluida, que hoy sí está atada a Brownsville.
Pasa a ser **tener sitio asignado**, que es lo que esa columna quiso decir siempre.

Para que el resultado sea idéntico al de hoy, 084 le quita el sitio a los dueños: hoy no
están atados y con la regla nueva lo estarían. Comprobado después uno a uno — los ocho
empleados siguen atados, Patricia sigue atada, los tres dueños siguen libres.

### La vista traduce, y por eso no se tocó ni una pantalla

`clockin.profiles` (077) ya era la capa de traducción entre la identidad del hub y lo
que espera el código de clock-in. Ahora traduce también el rol: deriva `owner` /
`employee` del escalafón único. Las 71 llamadas siguen comparando con las mismas
cadenas sin enterarse.

### Y en Usuarios ya no hay dos selectores para lo mismo

Clock-in tenía su propio desplegable de rol. Dejarlo sería **dos controles escribiendo
la misma decisión** — la confusión que D-095 quitó del puesto de trabajo, reaparecida a
escala de módulo. Ahora enseña una nota que dice dónde se define.

De paso: ese hueco dibujaba el texto del ERP —*"el costo y el margen…"*— en cualquier
módulo sin escalafón propio. En fichaje hablaba de costos y márgenes que ahí no existen.
Cada módulo trae ahora su propia nota, y una prueba lo exige.

### Qué NO cambia todavía

Ninguna pantalla se ha movido. `/clock-in` y `/timetracker` siguen donde estaban y
funcionando. Las fases 2 a 5 —regla de solapamiento cruzada, envoltorio único, nómina
unificada, retirada de `/clock-in`— quedan pendientes.


## D-102 · Fusión fase 2: la regla que planteé estaba mal, y la que faltaba era otra
**Fecha:** 2026-08-27 · **Versión:** v0.7.0 (clockin), migración 085

**Lo que iba a hacer:** prohibir que un fichaje y una sesión de proyecto de la misma
persona se solapasen. Se midió antes de escribirlo:

| | duración media |
|---|---|
| fichaje (clock-in) | **9.32 h** — una jornada |
| sesión de proyecto | **1.46 h** — una tarea |

**Las sesiones anidan dentro de la jornada, y eso no es un error: es la razón de que
sean dos registros distintos** (D-101). Fichar la entrada y luego cronometrar dos horas
de un proyecto dentro de esa jornada es el caso normal, no una anomalía. La regla lo
habría prohibido — y desde 084 las doce personas tienen los dos módulos, así que habría
empezado a morder de inmediato.

El doble cobro **entre** tablas existe, pero es un problema de informes, no de
restricciones: la nómina unificada (fase 4) tendrá que decir cuál de las dos paga. Se
decide ahí.

### Lo que sí faltaba

`clockin.time_entries` no tenía **ninguna** restricción de solapamiento — 082 solo cubrió
las sesiones de proyecto. Y había una violación real, callada desde julio: **Patricia, el
31, con un fichaje manual de 19 minutos (16:00-16:19) dentro de su jornada real de 08:49
a 19:44.** Mismo patrón que el de Nick: tiempo manual dentro de tiempo ya registrado,
cobrado dos veces. Retirado, con respaldo y nota en `clockin.audit_log`.

**Dos mecanismos, porque uno solo deja media puerta abierta:**

- `EXCLUDE` para los fichajes **cerrados** — misma persona, rangos que se cruzan.
- Un **índice único parcial** para el **abierto**. Un fichaje sin salida no tiene tope
  superior, así que no entra en el EXCLUDE; sin esto se podría abrir un segundo mientras
  corre otro, que es literalmente estar fichado dos veces. El código ya lo comprobaba,
  pero mira y luego inserta, y entre las dos cosas cabe otra pulsación.

Probado contra seis casos: jornada base *aceptada*; otra encima *rechazada*; manual
dentro (el caso de Patricia) *rechazada*; pegada justo después *aceptada*; abierta
mientras hay otra cerrada *aceptada*; segunda abierta *rechazada*.

### Y la app lo dice

Los dos caminos que escriben fichajes —el fichaje manual que abre un admin y la edición
desde el informe— traducen el rechazo en vez de soltar el mensaje de Postgres. El
detector es gemelo del de 082 y **deliberadamente no compartido**: cada módulo tiene su
restricción con su nombre, y una función para los dos tendría que conocer los dos nombres
para decir lo mismo. Tiene su matiz propio: `23505` lo produce cualquier índice único, así
que para ese se exige además el nombre; `23P01` aquí solo puede venir de esta regla.

### Encontrado de paso

Tres fichajes llevan **abiertos desde el 26 de agosto**: se les olvidó salir. La tabla
tiene una columna `auto_closed` y el cron que la usa existe, pero **no está corriendo**
porque el programador externo sigue sin repuntar (D-094). El fichaje más largo del
histórico son 47.37 h, que es el mismo olvido sin nadie que lo cerrara.


## D-103 · Fusión fase 3a: una puerta en cada sentido
**Fecha:** 2026-08-27 · **Versión:** v0.8.0 (timetracker y clockin)

La fase 3 era "el envoltorio": una navegación, un tema, y las pantallas de fichaje bajo
`/timetracker`. Se parte en dos, y esta es la mitad que no rompe nada.

**Por qué no se volcó la navegación entera.** La barra de un admin de Time Tracker ya
lleva **quince** pestañas. Fichaje tiene diecinueve pantallas. Sumarlas da una barra de
treinta y cuatro, que no es una navegación sino un buscador de pestañas. Así que va
**una** entrada por juego: al empleado a fichar, al admin al panel de la cuadrilla —
lo que cada uno necesita de ese módulo. La navegación propia de fichaje hace el resto.
Una prueba exige que siga siendo una sola, para el día que alguien tenga la tentación de
añadir "Cobertura", "Horarios" y "Excepciones".

**Y la vuelta.** El botón de salida de fichaje llevaba al hub. Ahora lleva a **Time
Tracker** cuando la persona tiene los dos módulos — desde 084, las doce. Fichaje dejó de
ser una app aparte a la que se entra desde el hub: es la otra mitad de Time Tracker, y
mandar al hub obligaría a pasar por un selector para volver a algo que está al lado. Al
hub se sigue yendo si Time Tracker no está otorgado pero sí hay otros módulos, y el botón
sigue escondiéndose si fichaje es lo único que tiene.

### Lo que queda para la 3b, y por qué está separado

Mover las pantallas de `/clock-in/*` a `/timetracker/*`. Ahí es donde se rompen las cosas
que no se ven en un build:

- el **service worker** está anclado a `/clock-in/` y dejaría de controlar sus páginas;
- los **accesos directos del móvil** de la cuadrilla apuntan a `/clock-in/clock`;
- son 74 enlaces internos y 76 ficheros de ruta.

Cada una de esas tres tiene su forma de fallar en silencio, y ninguna la detecta `tsc`.
Se hace sola, con redirecciones permanentes y sin tocar nada más, para que si algo se
rompe se sepa qué lo rompió.

**El tema tampoco se unifica todavía.** Fichaje es Tailwind y Time Tracker dibuja desde
`globals.css`; parecerse exige reescribir estilos, no mover ficheros. Los dos ya siguen el
mismo interruptor de claro/oscuro desde el arreglo de temas, que es la mitad que
importaba.


## D-104 · Fusión fase 3b: fichaje se muda dentro de Time Tracker
**Fecha:** 2026-08-27 · **Versión:** v0.9.0 (timetracker y clockin)

69 ficheros de ruta movidos de `/clock-in` a `/timetracker/clock-in`, 51 reescritos, las
rutas viejas redirigidas. Fichaje deja de ser un hermano al que se enlaza y pasa a estar
físicamente dentro de la app madre.

**Con subprefijo y no fusionado plano** porque tres nombres de pantalla chocan —
`reports`, `settings` y `account` existen en los dos. `/timetracker/clock-in` los separa
sin renombrarle la pantalla a nadie.

**Fuera del grupo `(timetracker)` a propósito.** Un grupo de rutas no cambia la URL pero
sí el anidamiento de layouts: dentro del grupo, fichaje heredaría la barra de Time Tracker
y llevaría dos navegaciones apiladas. Comprobado después en el manifiesto del build: el
chunk de CSS de fichaje sigue colgando de **un solo** layout y ninguna otra ruta lo carga.

### El service worker hizo esto seguro, no arriesgado

Era lo que más me preocupaba: diez móviles con un SW registrado en `/clock-in/`. Al leerlo
resultó ser **pase directo a propósito** — *"a time clock must never serve a stale cached
punch screen"* — así que no puede dejar a nadie con una pantalla vieja pegada; lo peor que
hace es proxiar la redirección.

Las suscripciones push sí van atadas al alcance del registro y habría que rehacerlas. Hoy
no cuesta nada: las claves VAPID siguen sin poner y el push está muerto desde la fusión
(D-094). Es, de hecho, el mejor momento para moverlo.

### Redirecciones 307 y no 308, a propósito

La cuadrilla tiene accesos directos en la pantalla de inicio apuntando a
`/clock-in/clock`, y hay notificaciones ya enviadas con esa url dentro. Un permanente lo
cachea el navegador **para siempre**: si algún día hay que deshacer la mudanza, no habría
forma de decirle a un teléfono que la olvide. Se endurece cuando esto lleve meses en pie.

### Dos cosas que la mudanza destapó, rotas desde antes

- **Los enlaces de exportación** de nómina apuntaban a `/api/clock-in/reports/export`,
  que no existe ni existió en ninguna de las dos disposiciones: al fusionar clock-in, el
  prefijo se insertó en el sitio equivocado para las rutas `/api`. Muertos desde entonces,
  y solo visible al pulsar.
- **El service worker** abría `/clock` cuando una notificación no traía url. Nunca fue
  una ruta de esta app: pulsar esa notificación abría un 404.

### Y una que cazaron las pruebas

El sello de versión resuelve el módulo por prefijo, y `/timetracker/clock-in` empieza por
`/timetracker`. Sin reordenar la lista, habría enseñado la versión de Time Tracker en las
pantallas de fichaje — el número de otra app, que es peor que ninguno. Lo cazó su propia
prueba en cuanto se movieron las rutas; el orden es ahora la razón de que eso sea una
lista y no un objeto.


## D-105 · Fusión fase 4: las horas de las dos mitades, sin sumarlas
**Fecha:** 2026-08-27 · **Versión:** v0.10.0 (timetracker), migración 086

Es lo que la fusión iba a buscar: una pantalla que diga cuántas horas tiene cada persona
en un periodo, mirando las dos mitades de la app.

### La decisión de la pantalla es NO sumar

Fichaje contesta *"¿estuviste?"* y las sesiones *"¿en qué?"*. Una sesión de proyecto
ocurre **dentro** de una jornada fichada — 9.32 h de media contra 1.46 h (D-102) — así que
sumar las dos columnas paga el mismo rato dos veces.

Pero elegir una en silencio es igual de malo en el otro sentido: a quien solo cronometra
proyectos no se le pagaría la asistencia, y a quien solo ficha no se le pagarían las
sesiones.

Así que se enseñan **por separado**, con una tercera columna que marca a quien tenga las
dos cosas ese periodo. Hoy no le pasa a nadie —la cuadrilla solo ficha, Nick solo
cronometra— pero desde 084 las doce personas tienen los dos módulos, así que puede empezar
cualquier día. Cuando pase, lo decide una persona mirando la fila, no una suma.

### El periodo ya coincidía

Los dos módulos cuentan de **viernes a jueves** sin habérselo propuesto: clock-in lo
calcula así y timetracker tiene `weekStartDay = 5` en sus ajustes. Comprobado también en
los datos — 221 de 287 sesiones tienen `week_of` en viernes; las 66 en sábado son de
cuando ese ajuste era 6.

Cuatro pruebas fijan el límite, incluida la que muerde: que el jueves y el viernes
siguiente caigan en periodos distintos. Si eso se corriera un día, la última jornada de la
semana se pagaría en la siguiente.

### El cálculo vive en la base, no en la pantalla

`timetracker.period_hours` (086). Si estuviera en la pantalla, esta y la nómina de fichaje
derivarían en cuanto alguien tocara una de las dos, y una nómina que no cuadra con la otra
es peor que no tener la segunda. La vista repite la regla de comida de
`clockin/payroll.ts` —la comida **fichada** manda, `lunch_minutes` es solo el respaldo—
por esa misma razón.

### Encontrado de paso: dos zonas horarias

Los ajustes de timetracker dicen `America/Tegucigalpa` y clock-in usa `America/Chicago`.
Tegucigalpa no tiene horario de verano, así que ahora mismo van una hora desfasadas.
Medido antes de alarmar: **2 sesiones de 287** caen en un día distinto según cuál se use,
las dos dentro de la misma semana de pago. **En nómina no cambia nada.** La vista calcula
en Chicago, que es donde está la empresa; corregir el ajuste es un cambio aparte.

### Lo que NO se tocó

Las pantallas de aprobar partes y cerrar periodo siguen donde estaban, una en cada mitad.
Esta vista informa; no aprueba ni cierra nada. Fundir también esos dos flujos —con sus
firmas y sus bloqueos de periodo— es más que un informe y merece su propia decisión.


## D-106 · Fusión de vistas #1 y #2
**Fecha:** 2026-08-27 · **Versión:** v0.13.0 (timetracker), v0.10.0 (clockin) · **Pedido por:** Andrés
(*"quiero que hagamos merge de las features del clock in app en la time tracker... merge views"*)

Antes de tocar nada se miraron las 31 pantallas, y salió el dato que decide el coste de
todo lo demás: **Time Tracker dibuja en el cliente (14 de 15 pantallas) y clock-in en el
servidor (16 de 16)**. No es una diferencia de estilo — cada fusión de vistas cruza esa
línea, y ahí está el trabajo, no en juntar dos tablas.

### #1 · Una sola Cuenta y unos solos Ajustes

Cuatro pantallas quedaron en dos.

La Cuenta de fichaje tenía exactamente dos cosas: contraseña e idioma. **La contraseña ya
estaba escrita en Time Tracker**, o sea que era la misma función dos veces. Lo único que se
mudó de verdad es el idioma.

Y llega con su nombre entero —*"Idioma de los avisos"*, no *"Idioma"*— porque es el idioma
en que **el servidor** escribe recordatorios y aprobaciones, no el de las pantallas, que
sigue al navegador y no se guarda en ningún sitio. Con la etiqueta corta, alguien lo habría
cambiado esperando que cambiara lo que estaba mirando.

Los Ajustes de fichaje no eran una pantalla de ajustes: eran **un menú de tres tarjetas**.
Una acaba de mudarse; las otras dos —vehículos y sitios— no necesitaban pantalla propia
para ser dos enlaces, y viven ahora en los Ajustes de Time Tracker, donde ya se configura
la empresa.

Las dos rutas viejas redirigen: cualquiera que abriera el menú de fichaje tenía Cuenta a un
toque, y los marcadores duran más que las pantallas.

### #2 · Una sola bandeja de pendientes

Un gerente miraba en **tres sitios** lo que es una sola pregunta —*"¿qué me toca
revisar?"*—: solicitudes de horas en Time Tracker, ausencias y excepciones en fichaje.

Las tres van ahora en la pantalla a la que ya venía, renombrada a **Pendientes**. **No se
creó una pantalla nueva**: una cuarta también habría que acordarse de abrirla.

**Siguen siendo tres decisiones distintas y se enseñan como tales:** cambiar un registro de
horas, conceder una ausencia, y dar por visto un fichaje raro. Juntar los botones habría
sido fingir que son la misma cosa — la excepción ni siquiera se aprueba, se revisa.

Reescrito y no mudado, por lo de siempre: los controles de fichaje son de Tailwind y esta
pantalla vive bajo el grupo `(timetracker)`, cuyo chunk no lo incluye. **Las acciones de
servidor sí son las mismas** (`reviewTimeOff`, `resolveException`), así que aprobar desde
aquí y desde fichaje hacen lo mismo, avisos incluidos.

**El alcance por tienda no se decide en la pantalla:** lo resuelve `getPendingForInbox` con
el mismo `storeScope` que usan las pantallas de fichaje. Escribir ese filtro otra vez en la
bandeja sería la segunda copia de una regla de permisos, y la segunda copia es la que se
queda vieja.

### Lo que se decidió NO fusionar

- **`insights` vs `coverage`** — parecen hermanas y no lo son: una analiza proyectos, la
  otra dice quién cubre qué tienda qué día.
- **`audit` vs `exceptions`** — auditoría es *quién cambió qué*; excepciones son anomalías
  de geocerca. Las excepciones sí entran en la bandeja; la auditoría no.
- **`diary` vs `notes`** — las dos son "qué hice hoy", pero una son capturas y la otra texto
  escrito a mano. Como pestañas, sí; fundidas, no.
- **`sites`, vehículos, `schedule`, `runs`, `me`** — no tienen pareja. Fusionarlas sería
  inventarles una.

### Siguientes, con un número en la mano

Quedan "Trabajando ahora" (`live` + `dashboard`) y "Mi semana" (`week` + `my-schedule`,
planeado contra real — la única de la lista que añade algo que hoy no contesta ninguna).
Se planifican sabiendo ya lo que cuesta cruzar la línea cliente/servidor, en vez de con una
estimación.


## D-107 · Las geocercas se ven desde Ajustes, y en Google Maps
**Fecha:** 2026-08-27 · **Versión:** v0.14.0 (timetracker) · **Pedido por:** Andrés
(*"agregame the view extra en settings donde se hace el geofencing de las tiendas"* ·
*"acuerdate que ahora usamos google maps asi que implementalo aqui"*)

Ajustes de Time Tracker enseña ahora las seis geocercas en un mapa, listadas con su forma,
su margen y su interruptor de activo. Antes solo había un enlace a la pantalla de fichaje.

### Google Maps, no Leaflet

Fichaje dibuja con **Leaflet sobre imágenes de Esri** porque llegó así de su repo de origen;
el hub, el ERP y las entregas llevan **Google Maps** desde siempre. Para una vista nueva no
había razón para heredar la excepción, y usar el cargador compartido significa **un solo
script por página** — cargarlo dos veces lanza, y cada carga se paga.

Se dibuja en `hybrid` (satélite con nombres de calle) a propósito: una geocerca se juzga
contra el edificio, no contra un mapa de carreteras. Y `gestureHandling: "cooperative"`,
porque un mapa dentro de una página larga que se traga la rueda del ratón es una trampa.

Si no hay clave de navegador, **lo dice**. Un mapa que no carga y un mapa sin datos se ven
igual —un rectángulo gris— y solo el primero se arregla poniendo una variable.

### Lo que NO se trajo, y por qué

**El editor de dibujo se queda en la pantalla de fichaje.** Son 318 líneas de Tailwind con
un mapa donde cada clic pone un vértice, y Ajustes vive bajo el grupo `(timetracker)`, cuyo
chunk de CSS no incluye Tailwind. Reescribirlo aquí sería duplicar **la herramienta más
delicada del módulo** —la que decide si el fichaje de alguien cuenta como dentro— para tener
dos versiones que se pueden desincronizar.

Así que aquí se **ve** y se **enciende o apaga**, que es lo que se hace el 90% de las veces
con una geocerca ya dibujada; dibujar abre la pantalla que ya funciona, con un enlace en cada
fila.

Tampoco se reutilizó el `BoundaryMap` de fichaje: aquel es un editor de **una** geocerca y
aquí hacen falta **las seis** sin que un clic despistado mueva nada. Un editor en modo
lectura acaba siendo un editor con un `if`, y ese `if` se rompe el día que alguien toca el
editor.

Las inactivas se dibujan en gris en vez de esconderse: una geocerca apagada sigue explicando
por qué los fichajes de esa tienda salen "fuera del sitio".


## D-108 · Las geocercas se dibujan en Ajustes, con Google Maps
**Fecha:** 2026-08-27 · **Versión:** v0.15.0 (timetracker) · **Pedido por:** Andrés
(*"hazme el geofencing y cuando le doy edit e redirect a un view de la app vieja, con
leaflet, arregla todo eso"*)

D-107 dejó las geocercas visibles en Ajustes pero **"editar" te sacaba de ahí** a la pantalla
de fichaje: otro mapa (Leaflet sobre Esri), otro estilo, otra app. Una costura visible en
mitad de una tarea. Ahora se ve, se enciende, se apaga, se dibuja y se corrige en el mismo
sitio, y la pantalla vieja se retira con redirección.

### Lo que gana al cambiar de mapa, que es la razón de fondo

Una geocerca de Leaflet solo se podía trazar **clic a clic**, y para corregir una esquina
había que borrar y empezar de nuevo. Los polígonos de Google son `editable`: se arrastran
vértices y se parten lados por su punto medio. **Corregir una esquina mal puesta pasa de
rehacer la tienda entera a arrastrar un punto.**

En D-107 escribí que no traía el editor porque duplicarlo sería tener dos versiones
desincronizables. Eso valía mientras la vieja siguiera en pie; la respuesta correcta no era
dejar el enlace, era **retirar la vieja**. Ahora hay uno solo.

### Lo que NO cambió, a propósito

**Se guarda con las mismas acciones** (`addSite`, `updateSite`), que son las que calculan el
centro del polígono y comprueban el permiso. Cambiar de mapa no es motivo para tener dos
formas de escribir una geocerca — habría sido repetir el error que este ADR arregla.

### Detalles que no son estéticos

- **Los vértices se leen del polígono, no de un estado paralelo.** Guardarlos aparte haría
  que arrastrar una esquina cambiara el mapa y no lo guardado, y eso no se ve hasta que
  alguien ficha fuera del sitio.
- **`gestureHandling: "greedy"` aquí, y `"cooperative"` en el visor.** Dibujando se quiere
  zoom con la rueda; en una lista larga de Ajustes, un mapa que se traga la rueda es una
  trampa.
- **El clic solo añade esquinas en modo polígono.** En círculo movería el centro sin querer,
  y para eso ya se arrastra la figura.
- **La dirección se geocodifica con la clave de SERVIDOR** (`geocodeForMap`), no con la del
  navegador: mantiene la separación que documenta `google-maps-loader` — la del navegador es
  pública y solo dibuja; la de servidor paga geocoding y no sale de ahí. `/api/geocode` no
  servía porque devuelve texto para autocompletar direcciones de entrega, no coordenadas.

### Leaflet sigue vivo, y es correcto que siga

`CrewMap` (dónde está la cuadrilla ahora) y `TripMap` (el recorrido de un repartidor) siguen
en Leaflet. No se tocaron: funcionan, están dentro del chunk de fichaje donde su CSS ya
vive, y cambiarlas por cambiar es el tipo de trabajo que rompe cosas sin arreglar ninguna.
Se migran cuando haya una razón, no por uniformidad.

---

## D-109 · Las fotos de fichaje se revisan dentro de Auditoría
**Fecha:** 2026-08-28 · **Versión:** v0.18.0 (timetracker) · v0.15.0 (clockin) · **Pedido por:**
Andrés (*"las fotos que se toman no se puede ver quiero que me hagas una view donde se pueda
review todas las fotos y se pueda estar cambiando los días"*, y después *"acuérdate que queremos
quitar el tab de clock in entonces esas fotos deben ir adentro de audit, solo mete views dentro
de audit"*)

Cada fichaje guarda una foto —entrada, salida, salir del sitio y volver, cuatro por persona y
día— y hasta ahora solo se veían **de una en una**, escarbando dentro del fichaje o de la
excepción concreta. Con cientos guardadas, *"revisar las fotos de ayer"* no era una tarea que se
pudiera hacer.

### Dónde vive, que es lo que se corrigió

El primer intento fue una pantalla propia colgada de la barra de fichaje. **Estaba mal y Andrés
lo paró:** esa barra se retira. Colgarle una pantalla nueva es construir encima de algo que se
está desmontando, y además habría hecho falta migrarla otra vez dentro de un mes.

Va en **Auditoría**, como una segunda vista de esa misma pantalla, y ahí es donde entran las que
vengan del módulo de fichaje. La razón no es solo que sobre sitio: Auditoría y las fotos
responden **la misma pregunta** —qué pasó, quién y cuándo— con la diferencia de que una lo
cuenta y la otra lo prueba. Separarlas por la barra de navegación obligaba a saltar entre dos
tabs para cerrar una sola duda.

**El tab de Clock-in NO se quitó todavía**, a propósito: dashboard, reports, schedule, time-off y
exceptions siguen colgando de él. Quitarlo hoy dejaría esas cinco pantallas sin puerta. Lo que
cambia desde hoy es que **no se le añade nada más**.

### Decisiones dentro de la vista

- **Se firman en bloque.** Cobertura firma las fotos una a una dentro de un bucle — bien para
  las de una semana de un equipo pequeño, pero es una llamada de red **por foto** y un día
  cargado son decenas. `createSignedUrls` (plural) hace lo mismo en una. Una hora de validez,
  como el resto del módulo: son fotos de personas y el enlace no debe sobrevivir a la sesión de
  quien las miró.
- **Una foto que no se pudo firmar no se enseña**, en vez de dejar un hueco roto en la rejilla.
  El contador de la cabecera cuenta las que se ven, que es lo honesto.
- **El día es estado de pantalla, no URL.** El primer intento navegaba con un enlace por día;
  dentro de Auditoría eso recargaría el registro entero para mover un día. Flechas y el selector
  nativo de fecha.
- **Hay guardia contra respuestas fuera de orden.** Pulsar la flecha tres veces seguidas lanza
  tres cargas y nada garantiza que lleguen en orden: sin el `ref` del día pedido, la respuesta
  del primer día puede llegar la última y pintar fotos que no son las de la pantalla.
- **Al abrir una foto se usa el visor del hub** (`PhotoLightbox`, con zoom) y no una pestaña
  nueva. `window.open` **no hace nada dentro de la app de escritorio ni del WebView** — es el
  motivo por el que ese visor existe (D-041) — y una foto de fichaje se abre precisamente para
  ampliarla: una cara, una matrícula, dónde está parado alguien.
- **Rejilla propia y no la `.photo-grid` del hub.** Aquella son miniaturas de 96 px pensadas
  para cuatro fotos de un pedido; aquí se revisan decenas y hay que reconocer el sitio antes de
  decidir cuál abrir. Y sus colores son los de deliveries: sobre el panel oscuro de este módulo
  quedan ilegibles. Lo mismo pasaba con `.section-label`, que es de donde salió la clase propia.
- **El alcance por tienda es el de siempre:** un gerente con tienda ve su cuadrilla y nadie más
  (`storeScope`). La acción entra por `clockinManagerCtx`, así que un admin del hub también pasa.

### Lo que la pantalla dice y no se puede callar

Un día vacío tiene **dos explicaciones muy distintas** —nadie trabajó, o la limpieza de 60 días
ya pasó— y sin decirlo, en fechas viejas parecería que la pantalla está rota. El pie lo aclara,
y aclara también que **las horas nunca se borran**: lo que caduca es la foto, no el fichaje.

---

## D-110 · Una sesión caducada se dice, no se reintenta en silencio
**Fecha:** 2026-08-28 · **Versión:** v1.34.0 (deliveries) · v0.6.0 (recruiting) · v0.19.0
(timetracker) · v0.16.0 (clockin) · **Pedido por:** Andrés (*"puse en sleep la computadora y al
volver el time tracker me da este error: permission denied for schema timetracker"*, y *"sigo
entrando a cualquiera de las apps y me aparecen vacías porque no has arreglado eso"*)

Las pantallas vacías se arreglaron tres veces —D-088, D-099 y el tope de reintentos que metí
encima— y las tres volvieron. **Las tres partían de la misma suposición equivocada:** que una
carga fallida se arregla reintentando.

Hay un caso en el que no se arregla nunca: **la sesión caducó de verdad.** Ahí reintentar cinco
veces, o quinientas, deja exactamente lo mismo — una pantalla vacía, sin un solo mensaje, que no
se distingue de "hoy no hay datos".

### Por qué al despertar el ordenador

El token de acceso dura una hora y el temporizador que lo refresca **no corre mientras la
máquina duerme**. Al volver, supabase-js intenta refrescar; si el token de refresco ya rotó,
caducó o se usó, se queda sin sesión. Y desde **081** una consulta sin sesión sale como `anon`,
que ya no tiene permisos.

De ahí salen los dos síntomas, que son **el mismo fallo** visto desde dos lados:

- **Al leer** — `reloadAll` no pregunta sin sesión, marca la carga como fallida y calla:
  pantalla vacía en cualquiera de las apps.
- **Al escribir** — las escrituras llamaban a `ensureSession()` y **tiraban el resultado a la
  basura**. La consulta salía igual, como anónima, y Postgres contestaba
  `permission denied for schema timetracker`. Ese texto crudo de base de datos acababa en un
  `alert`, delante de alguien que solo quería fichar.

### Lo que se cambió

**`checkSession()` devuelve tres estados, no un booleano** (`src/lib/session-guard.ts`):

| | |
|---|---|
| `ok` | hay sesión utilizable |
| `offline` | ahora no se pudo, pero puede que sí luego — red caída, petición cancelada a media navegación (D-088). **Reintentar sirve** |
| `gone` | no hay sesión y no la habrá sin volver a entrar. **Reintentar no sirve** |

La diferencia entre los dos últimos es la pieza que faltaba. Se decide por **quién contestó**:
si el servidor respondió 4xx al refresco, es definitivo; si no hubo respuesta —sin `status`, o
5xx, o una excepción— es la red, y ahí **no se echa a nadie de la app**: cerrarle la sesión a
alguien porque se le cayó el wifi un segundo sería peor que la pantalla vacía.

**El aviso existe.** Con `gone`, los tres proveedores dibujan `SessionExpired` **encima** de la
pantalla, no en su lugar: lo de abajo sigue montado, que en el cronómetro importa —hay un
contador corriendo y un turno a medias— y desmontarlo perdería lo que hubiera sin guardar. Lleva
un botón que devuelve a `/login?next=` la pantalla actual. Estilos en línea a propósito: sale en
tres módulos con tres paletas distintas, y una clase compartida se vería bien en uno e ilegible
en otro (ya pasó con `.section-label`).

**Las escrituras exigen sesión.** `requireSession()` lanza antes de consultar, en vez de
preguntar sin credenciales. `start()` reconoce ese error y **no repite el mensaje** — el aviso
ya está en pantalla.

**`isRlsError` reconocía media familia.** Solo miraba `row-level security` y el 42501. El error
de 081 no menciona RLS por ningún lado, porque Postgres corta en el esquema **antes de mirar una
sola política**; por eso no se reintentaba con un token nuevo. Ahora vive en `isAuthDenied` y
cubre las dos.

**Y el reintento se para.** Con `gone`, el efecto de recuperación deja de disparar: cada intento
salía como anónimo para cobrar otro 401.

### Con pruebas, esta vez

Once, en `session-guard.test.ts`. Fijan justo la distinción que se venía perdiendo: 4xx es
`gone`, 5xx y "sin respuesta" son `offline`, y `permission denied for schema` cuenta como token
muerto. Las tres reincidencias anteriores no dejaron ninguna prueba detrás — por eso pudieron
repetirse.

---

## D-111 · Fichaje deja de ser un módulo: se entra por Time Tracker
**Fecha:** 2026-08-28 · **Versión:** v1.35.0 (deliveries) · v0.20.0 (timetracker) · v0.17.0
(clockin) · **Pedido por:** Andrés (*"aún me sale Fichaje si ya hicimos el merge al tracking
app"*)

Fichaje tenía **tarjeta propia en el hub** y **casilla propia en Usuarios**. Eso era correcto
mientras fue una app aparte; desde la fusión es la otra mitad de Time Tracker, y dejarlo así
obligaba a elegir entre **dos puertas de la misma casa**.

Y no era solo cosmético: con dos casillas se podía conceder **media app**. Alguien con
`clockin` y sin `timetracker` tenía las pantallas de fichaje pero no la puerta por la que ahora
se entra a ellas.

### Por qué se puede quitar sin quitarle acceso a nadie

La palabra ya no decidía nada. Desde **087**, quien puede fichar lo dice `timetracker_role`:

```sql
has_clockin_access() -> timetracker_role is not null or role = 'admin'
```

y la restricción que ataba `'clockin'` en `module_access` a un rol se soltó en esa misma
migración. El propio `clock-in/layout.tsx` ya comprobaba `timetracker_role`, no el módulo.
Medido antes de tocar nada: **12 de 36 personas** llevaban la palabra, y **ninguna** sin tener
también `timetracker`. Así que no se retira un permiso, se retira un nombre que ya no se leía.

### La palabra vieja se traduce, no se ignora

`normalizeModules()` cuenta `'clockin'` como `'timetracker'`. Sin eso, alguien cuyo único módulo
fuera `clockin` se quedaría sin tarjetas y aterrizaría en `/no-access` — **echado de una app a
la que sí tiene derecho, por un cambio de nombre**. La migración limpia las filas; la traducción
cubre a quien lea antes de que corra, y a cualquier fila vieja restaurada de una copia.

### Lo que NO desapareció con la casilla

El bloque de fichaje en Usuarios dibujaba también **la configuración de cuadrilla de cada
persona** (vehículo, puesto, horario, tienda), que D-095 trajo ahí desde una pantalla propia.
Eso sigue existiendo y **se mudó al bloque de Time Tracker**. Borrarlo con la casilla habría
sido perder configuración real por retirar una etiqueta.

### La pestaña de Clock-in sigue dentro de Time Tracker

Sigue habiendo una entrada `⏰ Clock-in` en las dos barras del módulo, y es deliberado: de ella
cuelgan todavía dashboard, reports, schedule, time-off y exceptions. Lo que se retira aquí es
**el módulo**, no las pantallas. Cuando esas cinco se muden (como se mudaron las fotos en
D-109), la pestaña se va con ellas.

### En la base, además del código

**088** rellena primero y borra después —el orden importa: quitar la palabra antes de conceder
el módulo madre dejaría a alguien con `module_access` vacío, y eso es `/no-access`— y añade un
`check` para que no vuelva a entrar. Se comprueba en la base y no solo en el tipo de TypeScript
porque **el tipo no viaja**: un script, un `curl` o una sesión de SQL escriben igual. Va
`not valid` a propósito: valida lo nuevo sin exigir que lo viejo pase primero, para que una fila
rara de antes no tumbe el despliegue entero.

---

## D-112 · Fundir la interfaz de fichaje con la de Time Tracker · paso 1: la paleta
**Fecha:** 2026-08-28 · **Versión:** v0.18.0 (clockin) · **Pedido por:** Andrés (*"ahora quiero
que me vayas transformando la interfaz de clock poco a poco"*)

Fichaje y Time Tracker ya son una sola app, pero **no lo parecían**. Fichaje está construido
sobre la escala `zinc` de Tailwind —gris neutro, casi negro en oscuro— y Time Tracker sobre un
azul marino propio (`--tt-*`). Cruzar de un módulo al otro se sentía como cambiar de programa.

### Se reasigna la escala, no se reescriben las pantallas

Son 13 pantallas y unas **300 apariciones** de estas clases. Convertirlas a mano sería un cambio
enorme, imposible de revisar y con el que se rompe algo seguro. Reasignando los tokens de color
en `@theme`, **cambian las trece a la vez sin editar una línea de ninguna**, y se deshace
volviendo a una lista de once valores.

Funciona sin tener que distinguir claro de oscuro porque **las pantallas ya usan la escala por
su sitio**: el extremo claro (50–200) en modo claro y el oscuro (700–950) tras `dark:`. Basta
con que el extremo claro sea la paleta clara de Time Tracker y el oscuro la oscura. La rampa
sigue siendo monótona —50 el más claro, 950 el más oscuro— y eso es lo que garantiza que nada
se invierta ni pierda contraste.

También cambian el fondo de página (antes blanco puro / casi negro; ahora los dos de Time
Tracker) y **la tipografía**: Arial contra Segoe UI se nota en cuanto se cruza de un módulo al
otro, aunque cueste decir por qué.

### Por qué es seguro reasignar una escala entera de Tailwind

Porque esa hoja **no sale de fichaje**. Next emite un chunk de CSS por layout y lo carga solo en
las rutas de ese layout; verificado en `.next/app-build-manifest.json` — la hoja de fichaje
aparece en sus rutas y en **ninguna** de deliveries, recruiting, timetracker o el ERP. Si se
cargara en todas, redefinir `zinc` habría repintado media aplicación.

### Lo que este paso NO toca, a propósito

**El verde (`emerald`).** Ahí el color *significa* algo —fichado, dentro del sitio— y no es lo
mismo que un gris de superficie. Cambiarlo es una decisión de diseño pantalla por pantalla, no
un remapeo de tokens, y mezclarlo con este paso habría hecho imposible saber qué cambió qué.

### La distinción entre los dos tipos de persona no se perdió con D-111

Andrés señaló que la casilla de fichaje en Usuarios servía para **diferenciar quién usa una app
y quién la otra**. Esa distinción sigue existiendo, y con más precisión que antes: vive en
**Time Tracker › Employees**, por persona, en dos columnas que ya estaban —**Worker type**
(Remoto / Presencial) y **Track mode** (actividad / entrada-salida)—. La casilla solo decía "tiene
acceso"; nunca dijo "esta persona ficha". Es una propiedad de *cómo trabaja* alguien, no una
segunda llave de entrada.

---

## D-113 · Fundir la interfaz de fichaje · paso 2: las formas
**Fecha:** 2026-08-28 · **Versión:** v0.19.0 (clockin) · **Pedido por:** Andrés (*"sí hazlo"*,
sobre la recomendación de seguir por las formas)

Después del color (D-112), lo que más delataba que eran dos aplicaciones era **el redondeo**.
Fichaje usaba los valores de Tailwind —16 px en tarjetas, 12 px en controles— y Time Tracker los
suyos: **14 y 10**. Dos píxeles no se ven de uno en uno; se ven al poner las dos pantallas
seguidas, que es exactamente lo que hace quien usa las dos mitades de la app.

Mismo método que la paleta y por el mismo motivo: **83 apariciones** de esas clases. Se cambian
tres valores en `@theme` y cambian todas.

Comprobado en el CSS emitido, no supuesto: `--radius-xl:10px`, `--radius-2xl:14px`.

### Y la altura de los controles

Los botones de cabecera de fichaje medían **44 px** (`h-11`); los de Time Tracker miden **40**
(padding 10 px + 14 px de texto). Eran seis, en cinco archivos, y se bajaron a mano — aquí no
sirve el remapeo: la escala de espaciado de Tailwind es **una sola** para alturas, anchos,
márgenes y huecos, así que moverla para arreglar seis botones habría recolocado cada margen de
las trece pantallas.

**El botón flotante del tour se queda en 44.** No es cromo que conviva con controles de Time
Tracker: es un botón circular suelto sobre el contenido, y encogerlo solo lo haría más difícil
de acertar con el dedo.

### `rounded-full` no se toca

Una pastilla es una pastilla en los dos módulos.

---

## D-114 · Fundir la interfaz de fichaje · paso 3: el acento
**Fecha:** 2026-08-28 · **Versión:** v0.20.0 (clockin) · **Pedido por:** Andrés (*"sigue"*)

Este paso **no se podía hacer reasignando una escala**, y ahí está la diferencia con los dos
anteriores. Fichaje pintaba de verde **dos cosas que no son la misma**:

- **Lo que significa algo** — fichado, dentro del sitio, aprobado, guardado, viaje empezado. Ahí
  el verde es información, y en Time Tracker también lo es (`--tt-ok`).
- **Lo que solo es "el color de los botones"** — la pestaña activa, el borde al pasar por
  encima, un enlace, la semana siguiente, la opción elegida, el foco de un campo. Eso es cromo,
  y el cromo de Time Tracker es **azul** (`--tt-accent`).

Reasignar `emerald` habría movido las dos a la vez y **roto el significado**: un "guardado" en
azul, el turno de hoy sin marcar, el indicador de "estás fichado" indistinguible de un botón.

Así que el cromo pasó a un nombre nuevo, `brand`, **caso por caso**: 36 sitios. El verde que
informa se quedó donde estaba: 41 sitios.

### Cómo se decidió cada uno

Se leyeron las 72 apariciones. La regla fue: **si quitando el color se pierde un dato, es
verde; si solo se pierde el brillo, es cromo.** Los casos que costaron:

- **La opción elegida** (día de la semana, motivo del viaje) → cromo. Una selección es acento,
  no un estado del mundo.
- **El botón "siguiente" del tour** → cromo. Es un botón primario, no dice nada del fichaje.
- **El botón de fichar a alguien** (`AdminClockPanel`) → **verde**. Ahí el color sí dice qué va
  a pasar al pulsarlo.
- **El indicador de no leído** → verde, sin tocar. Es discutible, pero no es cromo, y moverlo
  sin necesidad era arriesgar por gusto.

### El token cambia con el tema

Porque el azul de Time Tracker cambia: **#3a63e0** sobre claro, **#4f7cff** sobre oscuro. Un
valor fijo se vería apagado en un tema o chillón en el otro. `@theme inline` hace que las clases
compilen a `var(--ci-accent)` en vez de a un color, así que el tema lo decide el mismo atributo
que ya manda en todo lo demás.

Verificado en el CSS emitido: `.bg-brand-600{background-color:var(--ci-accent)}`, con
`--ci-accent` definido dos veces, una por tema.

---

## D-115 · Las excepciones se parten por lo que se hace con ellas
**Fecha:** 2026-08-28 · **Versión:** v0.21.0 (timetracker) · v0.21.0 (clockin) · **Pedido por:**
Andrés (*"ok hazlo"*, sobre mudar excepciones como paso 4)

La pantalla de excepciones de fichaje mezclaba **dos cosas que se usan en momentos distintos**:
la cola de lo que falta por revisar, y el historial de lo ya revisado con sus fotos. Por eso no
tenía un sitio obvio al que mudarse entera.

Se parte por **lo que se hace con cada mitad**:

- **Lo pendiente → Pendientes.** Ya estaba ahí desde D-106, con las ausencias y las solicitudes
  de horas. Una sola bandeja.
- **El historial → Auditoría**, como tercera vista junto al registro y las fotos. Es la misma
  pregunta que esas dos —qué pasó, quién y cuándo— y una excepción resuelta desaparece de la
  cola pero sigue siendo historia.

### De solo lectura, a propósito

La vista de Auditoría **no lleva botón de resolver**, aunque enseñe también las abiertas. Dos
botones que hacen lo mismo en dos pantallas acaban en dos versiones de la verdad sobre si algo
está atendido. Lo que hay es un enlace a Pendientes, que es donde se actúa.

### Lo que la pantalla vieja hacía mal

Firmaba las fotos **una a una dentro de un bucle** — hasta 60 llamadas de red para abrir una
pantalla, y ese era el motivo real de que tardara. La nueva las firma en bloque, como ya hacen
las fotos (D-109).

### Los enlaces viejos no mueren

`/timetracker/clock-in/exceptions` → **Pendientes**, porque quien abría esa pantalla venía casi
siempre a resolver, no a mirar. Y de paso `/timetracker/clock-in/photos` → **Auditoría**: esa
redirección faltaba desde D-109, así que un marcador de la pantalla de fotos daba 404.

### La barra de fichaje encoge

Van cuatro pantallas mudadas y la barra ha pasado de siete entradas a cinco. Se queda con lo
que todavía no tiene sitio en Time Tracker, y **encoge conforme lo va teniendo** — en vez de
retirarla de golpe y dejar sus pantallas sin puerta.

---

## D-116 · El tiempo libre se pide donde se piden las demás cosas
**Fecha:** 2026-08-28 · **Versión:** v0.22.0 (timetracker) · v0.22.0 (clockin) · **Pedido por:**
Andrés (*"el tab de tiempo libre, merge it con el de My Requests"*)

La pantalla de tiempo libre de fichaje tenía **la misma forma que la de excepciones**: dos
mitades que se usan en momentos distintos, metidas en una pestaña. Se parte igual (D-115):

- **Pedir tiempo libre y ver en qué quedó → My Requests.** Es la misma pregunta que esa
  pantalla ya respondía: *qué le pedí a mi encargado y qué me contestó*. Que una petición sea
  de horas y la otra de días **no cambia a qué viene la persona**; en dos pestañas distintas
  había que acordarse de en cuál estaba cada cosa.
- **Aprobarlo → Pendientes.** Ya estaba ahí desde D-106.

Dentro de My Requests van en dos vistas (`⏱ Time` / `🗓 Time off`) y no en un scroll de cuatro
tarjetas: son dos formularios, y uno debajo del otro obliga a pasar por delante del que no se
quiere para llegar al que sí.

### Un fallo que salió al mudarla

`submitTimeOff` mandaba un aviso al gerente **con enlace a la pantalla que estoy retirando**.
Nadie lo habría notado hasta que a alguien le llegara la notificación y la abriera. Ahora apunta
a Pendientes, que es donde se revisa desde D-106. El aviso de la pantalla de fichar
(*"N por revisar"*) tenía el mismo problema y va al mismo sitio.

### A qué lado lleva el enlace viejo

A **My Requests**, el lado del empleado. La pantalla la abrían las dos partes, pero de las doce
personas que fichan, once entran a **pedir**, no a aprobar. El gerente que busque la cola la
tiene en su barra, en Pendientes, y con contador.

### Cosas pequeñas que se arreglaron de paso

La fecha de fin ahora **sigue a la de inicio** mientras vaya por detrás. El error más común de
la pantalla vieja era mandar un rango invertido y que el servidor lo rechazara después de
pulsar. Y **el comentario del encargado se ve en la fila**: es la razón por la que alguien
vuelve a esta pantalla después de que le contesten, y estaba escondido.

### La barra de fichaje

De cinco entradas a cuatro: quedan dashboard, reports, schedule y la pantalla de fichar.

---

## D-117 · Una sola nómina, con las dos vistas sobre el mismo periodo
**Fecha:** 2026-08-28 · **Versión:** v0.23.0 (timetracker) · v0.23.0 (clockin) · **Pedido por:**
Andrés (*"ahora hagamos lo mismo con lo de nómina"*)

La pantalla más grande que quedaba en fichaje, y la que peor sentaba tener aparte: **las dos
nóminas cuentan el mismo periodo** —viernes a jueves— y aun así vivían en dos sitios, con dos
estéticas y **dos calendarios propios**. El pie de la pantalla de Payroll lo decía con todas las
letras: *"cada mitad conserva su propia pantalla"*. Esa frase era la costura.

Ahora Payroll tiene dos vistas sobre el mismo `?period=`:

- **🧾 Period** — las horas de las dos mitades, sin sumarlas (D-102). Sin cambios.
- **✅ Timesheets** — lo que era la nómina de fichaje: total de empresa, aviso de fichajes sin
  salida, exportaciones, cierre del periodo, y por persona su aprobación y sus fichajes con
  edición, alta y borrado.

Que compartan la navegación de periodo **es la mitad del arreglo**. Antes, comprobar un dato de
la semana pasada obligaba a mover dos calendarios por separado y confiar en que apuntaran a lo
mismo.

### Lo que NO se reescribió, y es lo importante

**La aritmética.** Totales, comida, extras y turnos abiertos siguen saliendo de
`lib/clockin/payroll.ts` — el mismo módulo que usaba la pantalla vieja. Es puro, así que corre
igual en el cliente. Recalcularlo a mano habría creado **una segunda aritmética de nómina**, y
dos nóminas que no cuadran son peor que una sola pantalla fea.

Las **acciones de servidor** también son las mismas (`editEntry`, `addEntry`, `deleteEntry`,
`approveTimesheet`, `unapproveTimesheet`, `ownerSignoff`, `revokeSignoff`), así que se conservan
sus avisos, sus permisos y su bloqueo cuando el periodo está cerrado. Lo único nuevo es
`getPayrollPeriod`, que es la consulta de la pantalla vieja movida tal cual — y devuelve los
fichajes **crudos**, no totales, precisamente para no partir el cálculo en dos.

### Otro aviso que apuntaba a una pantalla que iba a desaparecer

`pushToOwners` tenía como destino por defecto `/timetracker/clock-in/reports`. Mismo fallo que
encontré en el tiempo libre (D-116) y del mismo tipo: **invisible hasta que a alguien le llega
la notificación y la abre**. Ya apunta a Payroll. Van dos; conviene revisar el resto de destinos
de aviso antes de retirar la siguiente pantalla.

### Cuidado con la redirección

`/timetracker/clock-in/reports` → Payroll. Pero las **exportaciones** viven en
`/timetracker/clock-in/api/reports/*` y siguen existiendo: la regla no las toca porque su ruta
empieza por `/api`. Comprobado en el build — las dos rutas de export siguen en la tabla.

### La barra de fichaje

De cuatro entradas a **tres**: quedan dashboard, schedule y la pantalla de fichar.

---

## D-118 · La nómina separa a quien ficha de quien cronometra
**Fecha:** 2026-08-28 · **Versión:** v0.24.0 (timetracker) · **Pedido por:** Andrés (*"en nómina
separa a los remote workers con los on site"*)

En la práctica son **dos nóminas distintas**: al de sitio se le paga la asistencia y al remoto
lo cronometrado. Mezclados en una tabla había que ir persona por persona recordando quién es
cuál. Ahora son dos grupos con subtotal propio, más un total general debajo.

El dato ya existía —`worker_type` por persona, editable en **Employees**— y no se añadió a la
vista `period_hours`: esa vista calcula horas, y meterle un campo de configuración la ataría a
una tabla que no necesita para contar. Se junta en la pantalla, que es donde importa.

### El fallo que habría tenido hacerlo de la manera obvia

Lo obvio era: si no tiene tipo puesto, hereda el de la empresa (`effWorkerType`). **Medido antes
de darlo por bueno: 8 personas en sitio, 2 remotas y 3 sin poner** — y el valor por defecto de
la empresa es *remoto*. Esas tres son Zulema Resendez, Santana Lozano y Roberto Rodriguez, con
**21 fichajes y cero sesiones entre las tres**.

Heredar habría puesto a tres personas que solo fichan en el grupo de "remotos": la pantalla
habría enseñado **exactamente lo contrario de la verdad**, y con aire de dato.

### Lo que hace en su lugar

A quien no lo tenga puesto se le mira **lo que hizo en el periodo**, que es un hecho y no una
suposición: fichó y no cronometró → de sitio; cronometró y no fichó → remoto; las dos cosas o
ninguna → ahí no hay nada que deducir y manda el valor de la empresa.

**Y lo deducido se marca** (`guessed`), con un aviso que enlaza a Employees. Una deducción
correcta que se presenta como certeza es una trampa para el siguiente que la lea; marcada, se
arregla una vez y deja de adivinarse cada semana.

### En la vista de partes

Ahí el grupo sigue siendo la **tienda** —un gerente revisa su cuadrilla, y ese es el corte que
necesita—, pero un remoto que además fichó lleva su marca. Sus horas pueden estar contadas dos
veces, una en el parte y otra en sus sesiones; la marca está para que quien aprueba lo vea
**antes** de darle a aprobar.

---

## D-119 · Todo salía vacío hasta recargar: el middleware llevaba un año muerto
**Fecha:** 2026-08-28 · **Versión:** v1.36.0 (deliveries) · v0.7.0 (recruiting) · v0.25.0
(timetracker) · v0.24.0 (clockin) · v0.2.0 (erp) · **Pedido por:** Andrés (*"al entrar al
sistema, las listas salen VACÍAS… recargo y entonces sí cargan. Ya se intentó arreglar antes y
NO se resolvió — sospecho que se parchó sin reproducir"*)

Tenía razón. Se intentó cuatro veces —D-088, D-099, el tope de reintentos y D-110— y **las
cuatro fueron arreglos de cliente para un fallo de servidor**. Por eso ninguna funcionó:
reintentar presentaba una y otra vez la misma credencial muerta.

### La causa, medida

Tres hechos, cada uno comprobado antes de tocar código:

1. **El middleware no se emitía.** `middleware-manifest.json` salía **vacío**. El fichero vivía
   en la raíz del repo, y Next lo busca **al lado de la carpeta `app`** — que aquí está en
   `src/`. Nunca corrió. Sin error, sin aviso: solo funciones que no ocurrían.
2. **`server.ts` se traga la escritura de cookies**, en un `catch` cuyo propio comentario dice
   que es *"seguro cuando el middleware refresca la sesión"*. Un Server Component **no puede**
   escribir cookies en Next 15, así que ese `set` lanza **siempre**.
3. **La configuración de auth del proyecto** (leída de la API de Supabase): `jwt_exp = 3600`,
   `refresh_token_rotation_enabled = true`, `security_refresh_token_reuse_interval = 10`.

Con los tres juntos, al entrar pasada una hora:

| | |
|---|---|
| 1 | El navegador manda el access token caducado + el refresh token **R1** |
| 2 | El Server Component llama a `getUser()`, refresca con R1 y obtiene **R2** — **R1 queda quemado** |
| 3 | Intenta persistir R2 → el `catch` se lo traga |
| 4 | No hay middleware que lo escriba → **R2 se pierde** |
| 5 | La página se pinta: el servidor **sí** tenía usuario. Se ve la cabecera y el menú, no los datos |
| 6 | El provider monta con R1 muerto, su refresco falla y las listas salen vacías |

**El servidor le robaba la sesión al navegador y tiraba la llave nueva.**

### Por qué recargar lo escondía

En la recarga, servidor y cliente compiten por refrescar dentro de los 10 s de reutilización.
Cuando gana el **cliente**, su cookie **sí se escribe** —el navegador puede escribir cookies, el
Server Component no— y a partir de ahí hay una hora buena. De ahí que fuera repetible pero no
constante, y que el reload "arreglara".

### Lo que se descartó midiendo, no opinando

Realtime como carga inicial (hay un fetch explícito en el montaje), provider duplicado (solo hay
uno en el árbol de `/home/users`), y modo local (`NEXT_PUBLIC_LOCAL_MODE="false"`).

### El arreglo (paso 1 de dos)

`src/middleware.ts`, con `refreshSession()`: refresca y **escribe la cookie en la respuesta**,
que es lo único que un middleware puede hacer y un Server Component no. Cuando el navegador
recibe el HTML ya trae el token nuevo, así que la primera consulta del provider sale
autenticada. **No hay carrera que ganar**, y por eso no lleva reintento, ni espera, ni recarga
forzada.

Usa `getUser()` y no `getSession()`: el primero valida contra el servidor de auth, que es lo que
dispara el refresco; el segundo se conforma con la cookie y no renovaría nada.

Las rutas de API se saltan el refresco —no pintan listas, el cron se autentica por secreto, y
sería pagar una llamada a Supabase por petición sin ganar nada—. El descarte va **dentro** de la
función y no en el `matcher` porque van anidadas (`/timetracker/clock-in/api/…`) y un lookahead
anclado al principio no las alcanza.

Comprobado, antes y después: el manifiesto pasa de `NINGUNA` a una entrada con su matcher, y el
build lista `ƒ Middleware 102 kB`.

### Lo que este paso NO hace, y es deliberado

**No redirige.** `updateSession` —el guard de rutas— sigue escrito y **sin conectar**. Ese
código nunca ha corrido en producción: encenderlo no es restaurar nada, es estrenar
redirecciones sobre rutas que hoy funcionan sin ellas. Va en el paso 2, con su propia revisión.
Verificado en ejecución: sin sesión, `/home/users` y `/timetracker/payroll` los siguen
redirigiendo **sus layouts** igual que antes, `/login` responde 200 y el cron sigue dando su 401.

### Una prueba para un fallo que no avisaba

`middleware-location.test.ts` exige que exista `src/middleware.ts` y que **no** haya otro en la
raíz. Tener los dos es peor que no tener ninguno: el de la raíz no corre, pero se lee como si
corriera — y fue exactamente esa lectura la que retrasó tanto encontrar esto.

---

## D-120 · La tarjeta de error deja copiar la traza
**Fecha:** 2026-08-29 · **Versión:** v1.37.0 (deliveries) · **Pedido por:** Andrés (*"me salió
al inicio algo como cant read length, le di reload y ya cargó"* → *"sí"*)

Ese *"algo como"* es el problema, y no es culpa de quien lo escribe: la tarjeta del
`ErrorBoundary` **solo enseñaba el mensaje**. Sin archivo, sin línea, sin árbol de componentes.
Buscar un `.length` en todo el árbol de render sin la traza es buscar a ciegas — y fue
exactamente así como se fueron cuatro intentos de arreglo a bulto en el fallo de las listas
vacías (D-119).

Ahora la tarjeta tiene **Copy details**, que copia mensaje, hora, ruta, versión de la app en esa
pestaña, rol, agente, stack y árbol de componentes.

### Decisiones pequeñas que importan

- **La hora se fija cuando revienta**, en `getDerivedStateFromError`, no al pintar. Calculada al
  pintar daría la hora de mirar la tarjeta, que no sirve para cruzarla con un log.
- **La versión de la app va dentro.** Ya hizo falta una vez para separar *"el arreglo no
  funciona"* de *"esta pestaña tiene el código viejo"*.
- **Hay salida de emergencia.** `navigator.clipboard` falla sin HTTPS y dentro del WebView de la
  app de escritorio — que es justo donde más falta hace. Si falla, se despliega un `textarea`
  con el texto ya seleccionado. Oculto hasta entonces: si no, la tarjeta de error se convierte
  en un muro de texto.

### Lo que este botón NO resuelve, y conviene saberlo

En producción el código va minificado y **los nombres de varios componentes no sobreviven**
—comprobado sobre los chunks del build: `ErrorBoundary` y `DataProvider` aparecen, `OrderModal`
y `PhotoLightbox` no—. Los source maps existen pero Sentry los sube y los borra del build, así
que el stack copiado trae `chunk.js:1:23456`, no `page.tsx:57`.

O sea: el botón da **el mensaje exacto, la pantalla, la versión y una parte del árbol**, que ya
es infinitamente más que "algo como cant read length". La traza legible sigue estando en Sentry,
que sí tiene los mapas. El token del repo es de subida y da 403 en lectura; hace falta uno con
`event:read` para leerla desde aquí.

---

## D-121 · El horario sube a Time Tracker, y por fin deja programar la semana siguiente
**Fecha:** 2026-08-29 · **Versión:** v0.26.0 (timetracker) · v0.25.0 (clockin) · **Pedido por:**
Andrés (*"el horario del clock in va a ir en un new view de time tracker"*)

Quinta pantalla que baja del módulo de fichaje, y va como pestaña propia —**📅 Schedule**—
justo detrás de **Employees**: programar es algo que se le hace a la gente, y la secuencia real
es abrir la lista, ver quién no tiene turno esta semana y ponérselo.

Trae las tres piezas de la pantalla vieja: **crear turnos** (persona, días, horas, comida,
sitio, y aplicar su patrón A/B/C si lo tiene), **fichar a alguien a mano** —para el teléfono que
se quedó sin batería, registrado como fichaje manual con su motivo— y **la rejilla de la semana**
agrupada por tienda, con borrado.

### La diferencia funcional, que es la que importa

La pantalla vieja **solo sabía enseñar la semana en curso**. Eso no era cosmético: un horario se
planifica hacia delante, así que no había forma de dejar programada la semana siguiente. Ahora
hay navegación entre semanas, y `getScheduleWeek` recibe el viernes del periodo en lugar de
suponer *hoy*.

Es el mismo tipo de hallazgo que en D-116: una limitación real de la pantalla que solo se ve al
mudarla, porque mudarla obliga a leer para qué servía.

### Lo que no cambió

Las acciones de servidor son las mismas —`createShifts`, `applySchedule`, `deleteShift`,
`adminClock`—, así que los permisos, los avisos y las validaciones son idénticos. El alcance por
tienda también: un gerente con tienda ve y programa a su cuadrilla y a nadie más, y el dueño no
aparece en la lista de un gerente.

Un turno de alguien que no se ve se descarta **en la acción**, no en la pantalla: si llegara,
saldría una fila sin nombre y parecería un fallo de datos.

### La barra de fichaje

De tres entradas a **dos**: quedan el panel del día y la pantalla de fichar. Enlace viejo
redirigido.

---

## D-122 · El cambio de idioma sí funcionaba; lo que faltaba era el idioma
**Fecha:** 2026-08-29 · **Versión:** v0.27.0 (timetracker) · **Pedido por:** Andrés (*"el cambio
de idioma no funciona"*)

Lo primero fue comprobar el mecanismo, y **el mecanismo estaba bien**: una prueba con
`setLang("es")` sobre una clave cualquiera devuelve el texto español correcto. Lo que fallaba
era otra cosa — dos cosas, en realidad.

### 1. El interpolador de variables estaba roto

```js
s.replace(/{(w+)}/g, …)   // la barra de \w se había perdido
```

Ese patrón casa con la letra **w literal**, no con una palabra. Resultado: **ninguna** de las 99
cadenas con variables sustituía nada, **en los dos idiomas**. En pantalla se leía literalmente
`{h} h restantes`. Se demostró con una prueba antes de tocarlo: *expected `'{h} h left'` to be
`'3 h left'`*.

### 2. La barra de pestañas nunca cambiaba de idioma

Sus etiquetas estaban **escritas a mano en inglés** dentro de `constants.ts`. La barra es lo
único que se ve en **todas** las pantallas, así que aunque media app cambiara, la impresión era
"esto no hace nada". Ahora son claves `tab.<id>` y las pinta `TopBar` con `t()`.

Al añadirlas apareció que ya existía un `tab.*` heredado —cinco claves sin emoji, con un solo
consumidor— **colocado después en el objeto, así que habría ganado y anulado las nuevas en
silencio**. Se retiraron las cuatro que chocaban.

De paso, `team-diary` decía `🗂 Work Diary` igual que `diary`: dos pestañas idénticas en la
barra de un admin, una del equipo y otra propia. Ahora son **Team Diary** y **My Diary**.

### Lo que sigue sin traducir, y conviene decirlo

Medido, no estimado: `account` tiene **0** llamadas a `t()`, `diary` 1, `requests` 2,
`schedule` 3, `payroll` 6. Y **las cinco vistas que bajaron de fichaje estos días** —fotos,
excepciones, tiempo libre, partes de nómina y horario— están **enteras en inglés**, porque se
escribieron así.

O sea: la barra y las pantallas con buena cobertura ya cambian; esas otras no. No es un fallo
del interruptor, es texto que no existe en español. Se traduce pantalla por pantalla, y quedó
apuntado como trabajo siguiente en vez de dejarlo a medias.

### Y hay tres idiomas independientes, que es lo de fondo

| dónde | de dónde lo lee |
|---|---|
| hub y entregas | `localStorage` `rtg_prefs` |
| Time Tracker | `localStorage` `tt_lang` |
| fichaje | columna `profiles.language` en la base |

Cambiarlo en un sitio no cambia los otros. Eso explica por sí solo buena parte de "no funciona",
y unificarlo es una decisión aparte —toca las tres apps— que no se mete en el mismo cambio.

---

## D-123 · "Registrar tiempo" reparte según cómo trabaja cada quien
**Fecha:** 2026-08-29 · **Versión:** v0.28.0 (timetracker) · **Pedido por:** Andrés (*"la parte
de clock in… lo vamos a poner en el mismo de registrar tiempo… dependiendo de cómo se configure
es lo que le va a aparecer, y para admin puede ver ambos views"*)

Una sola entrada para dos formas de trabajar que no se parecen en nada: quien **cronometra** un
proyecto desde su sitio y quien **ficha** entrada y salida en una tienda, con foto y ubicación.

Lo decide `worker_type`, que **ya se elige por persona en Employees** — ni un menú nuevo, ni una
pregunta más al entrar. Es el mismo dato con el que la nómina separa los dos grupos (D-118), así
que quien lo configura ya sabe qué está diciendo.

- **Presencial** → su reloj de fichaje.
- **Remoto** → el cronómetro de siempre.
- **Admin** → las dos, con un selector arriba.

### Por qué el presencial NO ve el cronómetro

No es suyo, y ofrecérselo solo da ocasión de empezar algo que después **descuadra su nómina**:
las dos mitades no se suman, porque una sesión ocurre *dentro* de la jornada fichada (D-102).
Un botón que no debería pulsarse es mejor no dibujarlo.

Se devuelve **antes** de pintar el cronómetro, no después de pintarlo y navegar: si no, a un
presencial le parpadearía en la cara un botón de empezar que no debe usar.

### Lo que este paso NO hace, y hay que decirlo claro

**La pantalla de fichar sigue siendo la del módulo de fichaje, con su aspecto propio.** Son 592
líneas con cámara, geolocalización, geocerca, cuenta atrás de comida, salidas del sitio, viajes
de vehículo y avisos del cierre automático de las 20:00. Rehacerla en el idioma visual de Time
Tracker es un trabajo aparte y **no es cosmético**: es la pantalla con la que doce personas
cobran, y reescribirla a ciegas —sin poder probarla en un navegador— es justo el tipo de riesgo
que no se asume de pasada al final de una sesión larga.

Así que el reparto está hecho y funciona: **a cada quien le aparece lo suyo donde dice Registrar
tiempo**. Lo que queda es que la de fichar se vea como el resto, y eso va como paso propio.

### Al admin se le enlaza, no se le duplica

El selector del admin lleva a la pantalla real de fichaje en vez de montar una copia dentro. Dos
sitios donde fichar y ninguno que mande es peor que un enlace.

---

## D-125 · Fichar deja de ser otra pantalla: pasa a la plantilla de Registrar tiempo
**Fecha:** 2026-08-29 · **Versión:** v0.29.0 (timetracker) · **Pedido por:** Andrés (*"no ocupa
que lo lleves a otra view, en el mismo template que ya está, con cuándo inició, cuándo terminó,
cuánto trabajado hoy y cuánto esta semana… para que ya eliminemos el clock in app"*)

D-123 repartía por tipo de trabajador, pero al presencial lo **mandaba** a la app de fichaje.
Funcionaba y no rompía nada, pero dejaba **dos sitios donde trabajar**, que es justo lo que hay
que quitar para poder retirar aquella app.

Ahora se pinta aquí, con lo que se pidió: **cuándo entró, cuándo salió, cuánto lleva hoy y
cuánto en la semana de pago.** La semana es la de pago (viernes→jueves), no la natural: usar una
aquí y otra en la nómina daría dos totales distintos para lo mismo.

### Lo que se conservó del original, porque no es adorno

- **La ubicación es obligatoria** y va en cada fichaje. El servidor decide si estás dentro del
  sitio; el navegador solo **reporta coordenadas**, nunca un "sí".
- **La foto sube al mismo bucket y con la misma forma de ruta.** Cambiarla habría dejado ciega
  a la vista de Fotos (D-109), que las busca exactamente ahí.
- **Se comprime antes de subir** —una foto de móvil son 8–12 MB— y la subida lleva su propio
  límite de 30 s, porque no trae ninguno de serie. Ese fue el *"hice la foto y no pasó nada"*
  del original.
- **Si el servidor pide motivo** (fuera del sitio, sin turno, en otra tienda) se pregunta y se
  reenvía. Sin eso, fichar fuera de la geocerca fallaría sin decir por qué.
- **Sin foto se ficha igual.** La hora y el sitio son lo que se paga; perder el fichaje porque
  la cámara no abrió sería peor que quedarse sin la foto.
- **Un fichaje abierto cuenta hasta ahora**, no cero. Enseñar cero mientras alguien está dentro
  sería el dato más confuso de la pantalla.

### El admin ve las dos, y las dos de verdad

Un selector arriba cambia entre cronómetro y fichaje **sin salir de la pantalla**. En D-123 la
segunda era un enlace a la app vieja; ya no.

### Lo que todavía NO permite borrar la app de fichaje

Sigue habiendo tres cosas fuera: los **viajes de vehículo** y las **salidas del sitio**
(`VehicleTripPanel`, 479 líneas), y **Today's Crew** (`coverage`, 462). Mientras eso siga ahí,
retirar el módulo dejaría a la cuadrilla sin registrar un viaje y al gerente sin la vista del
día. Se dice en vez de dar por hecho el borrado.

---

## D-126 · Tres arreglos de un mismo reporte: caché de PostgREST, tema del navegador, y la jornada completa al fichar
**Fecha:** 2026-08-30 · **Versión:** v1.38.0 (deliveries) · v0.8.0 (recruiting) · v0.30.0
(timetracker) · v0.26.0 (clockin) · v0.3.0 (erp)

### 1. El 404 de `driver_shifts` era la caché de esquema, no la tabla

La consola daba `driver_shifts … 404`. Medido antes de tocar nada: **la tabla existe**, la
columna `started_at` existe, y `public` está entre los esquemas expuestos. Lo que estaba viejo
era la **caché de esquema de PostgREST** — se queda atrás cuando el DDL entra por fuera, como
han entrado las migraciones de estos días.

Se recargó con `notify pgrst, 'reload schema'`. Comprobado con una prueba que distingue los dos
casos: `driver_shifts` pasó de **404** (no la conoce) a **401** (la conoce, pide permiso),
mientras una tabla inventada sigue dando 404 — así se sabe que la comprobación mide algo.

Importa más de lo que parece: una tabla que 404 hace fallar la carga del proveedor, que marca el
intento como fallido y reintenta; es una de las formas de acabar con pantallas vacías.

### 2. Las letras negras en modo oscuro: faltaba `color-scheme`

No se declaraba **en ninguna parte** de la app. Sin eso, todo lo que dibuja el navegador y no la
hoja de estilos —la lista de un `<select>`, las `<option>`, las casillas, los selectores de fecha
y hora, las barras de desplazamiento— se pinta con el esquema **claro** aunque la página esté
oscura. De ahí las letras negras que casi no se ven, y de ahí que se notara sobre todo en
Usuarios: es la pantalla con más desplegables de la app.

Se declara en las **dos** direcciones. Fijar solo el oscuro dejaría el modo claro a merced de
quien tenga el sistema en oscuro.

### 3. Fichar ya enseña la jornada entera

Al panel de D-125 le faltaba lo que la pantalla vieja daba nada más entrar, y que es lo primero
que uno mira: **el turno de hoy** (con su comida y su sitio), **la semana programada**
(trabajado / programado y cuántos días), **el almuerzo** y **las salidas del sitio**, más los
accesos a Mi horario, Notas diarias y Mi responsabilidad.

Almuerzo y salidas **solo se dibujan estando dentro**: un botón que va a fallar es peor que un
botón que no está.

Sigue fuera —y por eso el módulo de fichaje aún no se puede borrar— el **viaje de vehículo**,
con su selección de camión y su kilometraje.

---

## D-127 · El gerente de tienda existe por fin, y el acotado por tienda se aplica de verdad
**Fecha:** 2026-08-30 · **Versión:** v1.39.0 (deliveries) · v0.31.0 (timetracker) · v0.27.0
(clockin) · **Pedido por:** Andrés (*"admin que soy yo que tengo total control, store manager
que solo puede ver los de su tienda… y se le puede dar permiso de ver más tiendas"*)

### Lo que se encontró al ir a construirlo

Antes de escribir nada se miró cómo estaba, y estaba peor de lo que parecía:

- `clockin.profiles` derivaba `role` así: admin → **owner**, todo lo demás → **employee**.
  **Nunca emitía "manager".**
- `public.profiles.timetracker_role` solo admitía **admin | employee**.
- Y `storeScope` acotaba con `role === "manager" && storeId`.

Es decir: **esa condición nunca se cumplía**. El acotado por tienda que describían los
comentarios de media aplicación **no se aplicaba a nadie** — cualquiera que entrase a una
pantalla de gerente veía la empresa entera. Ocho de doce personas tenían `store_id` puesto sin
que sirviera para nada.

### Lo que se hizo

**089** crea el nivel (`timetracker_role` admite `manager`), lo emite la vista, añade
`extra_store_ids uuid[]`, y —esto era imprescindible— **abre `auth_is_manager()` al gerente**:
las dos funciones de rol tenían el cuerpo idéntico y solo aceptaban admin, así que el nivel
nuevo habría existido sin ver absolutamente nada. `auth_is_owner()` **no** se tocó: cerrar
nóminas y tocar los sitios de trabajo siguen siendo del dueño; que las dos fueran iguales era
justo lo que impedía distinguirlos.

**090** arregla la escritura, y aquí había una trampa que habría anulado todo:

```sql
when new.role in ('owner','manager') then 'admin'   -- guardar "manager" lo hacía ADMIN
```

El nivel se colapsaba solo, en silencio, y la persona pasaba a verlo todo — lo contrario de lo
pedido. Además `extra_store_ids` no estaba en el UPDATE, así que conceder una tienda no guardaba
nada y el control volvía a su sitio al recargar, sin error.

### Una sola regla, en un solo sitio

`visibleStores(role, store, extras)` decide, y todo lo demás la usa: `storeScope`,
`canManageEmployee`, y las tres acciones nuevas (nómina, horario, cuadrilla) donde yo mismo
había escrito el acotado a mano. Siete pruebas la fijan, incluido el caso fácil de equivocar:
**un gerente sin tienda no se queda sin ver a nadie** — acotarlo a una lista vacía parecería que
la app está rota, cuando lo que falta es configurarle la tienda.

`canManageEmployee` también mira las extras. Si se olvidaran ahí, un gerente vería a alguien en
su lista y no podría tocarlo: de los dos fallos posibles, el peor, porque parece un error de la
app y no un permiso.

### Lo que esto NO es, y no conviene creerse

El acotado lo aplica la **aplicación**, no las políticas: en la base, un gerente puede leer las
filas de su empresa igual que un admin. **No es un retroceso** —hoy cualquiera veía todo— pero
tampoco es una garantía de base de datos, y llamarlo así sería mentir. Convertirlo en garantía
significa meter la tienda dentro de las políticas de cada tabla, y va en su propio paso.

---

## D-128 · Working Now veía media empresa, y el almuerzo llevaba semanas "en curso"
**Fecha:** 2026-08-30 · **Versión:** v0.32.0 (timetracker) · v0.28.0 (clockin) · **Pedido por:**
Andrés (*"estoy clock in en un empleado… pero en el trabajando ahora solo aparezco yo"*, *"falta
voy a salir, empezar almuerzo"*, *"sale 0 de 52"*, *"que tengan un color code"*)

### El almuerzo que nunca terminaba

`getMyDay` buscaba la salida en curso así: la última `exception` con `returned_at` nulo. Pero
esa tabla guarda **también los avisos de geocerca** (`out_of_radius`), que por naturaleza no
llevan regreso. Medido: **54 abiertos** ahora mismo, 35 de ellos de Alberto.

Así que la app creía que llevaba semanas de almuerzo: enseñaba "I'm back" y **escondía los
botones de empezar almuerzo y voy a salir**, que es exactamente lo reportado. El original sí
filtraba por `type = 'leaving_while_clocked_in'`; al reescribir el panel se me perdió.

Ahora filtra por tipo **y** exige que la salida haya empezado dentro del turno abierto: una que
nadie cerró la semana pasada no es un almuerzo de ahora.

### El "0 de 52": dos semanas distintas, ninguna rota

No era un dato mal calculado. La pantalla vieja cuenta **lunes→domingo** (`weekDates`) y la
nómina —y por tanto la nueva— cuenta **viernes→jueves** (`payPeriodDates`). El viernes recién
empezado, lo trabajado el lunes anterior pertenece al periodo ANTERIOR. Las dos cifras eran
correctas para su ventana.

Se conserva la semana **de pago**, porque es la que paga y la que usan nómina, horario y partes;
tener dos definiciones fue el error. Y ahora la tarjeta **dice de qué fechas habla**
(`28/08 → 03/09 (Fri–Thu)`): un número sin su ventana invita justo a esta confusión.

### Working Now era ciego a quien ficha

Solo miraba `liveSessions`, que son sesiones del **cronómetro**. Con las dos formas de trabajar
conviviendo (D-123), "quién trabaja ahora" respondía por media empresa **sin decirlo** — fichar
a alguien y no verlo aparecer es peor que una lista vacía.

Ahora lleva **⏰ On the clock** (quién está dentro y desde cuándo) y, arriba del todo,
**⚠️ Needs attention** (quién llega tarde, quién no ha fichado con turno empezado) — que era lo
único que le quedaba al panel del módulo de fichaje. Se refresca cada 30 s: es un tablero que se
mira, no una alarma, y un fichaje no cambia cada segundo como el cronómetro.

### Color para las dos mitades

En Employees, un punto verde (presencial) o azul (remoto) delante del nombre, **con leyenda**:
un color sin leyenda es un adorno; con ella es un dato. Son dos nóminas distintas y hasta ahora
había que abrir el desplegable de cada fila para saber cuál era cuál.
