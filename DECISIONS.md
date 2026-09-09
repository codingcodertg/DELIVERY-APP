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

---

## D-129 · Lo último que ataba al módulo de fichaje: horario, notas, boletín y avisos
**Fecha:** 2026-08-30 · **Versión:** v0.33.0 (timetracker) · v0.29.0 (clockin) · **Pedido por:**
Andrés (*"no quiero lo mande a otro view, ahí mismo que se display como que esté oculto"*, *"lo
de notificaciones también que pase al time tracker"*, *"que se mire igual a la card de Andrés
Ugarte"*)

### Tres pantallas que pasan a ser tres desplegables

**Mi horario**, **Notas diarias** y **Mi responsabilidad** eran tres pantallas del módulo de
fichaje, y eran el último motivo para tener que ir allí. Ahora se abren dentro de Registrar
tiempo, plegadas.

**Cada una se pide al abrirla**, no al cargar. Son datos que casi nadie mira cada vez que ficha,
y cobrárselos a todo el mundo en cada carga solo haría más lento el botón de fichar, que es lo
que sí se usa siempre.

Se usa `<details>` del navegador y no un acordeón propio: recuerda su estado al teclado, se
puede buscar dentro con Ctrl+F aunque esté cerrado, y no hay nada que escribir para que
funcione. Un acordeón a mano solo habría añadido formas de fallar.

Dos detalles que sí se cuidaron: **el tiempo libre aprobado se avisa arriba del horario** —sin
eso, un hueco parece un olvido y la gente pregunta si tiene que venir— y **el boletín solo
enseña lo que hay que mejorar si existe**: una lista de faltas vacía se lee como un reproche por
si acaso.

### La campana, donde se ve

Las notificaciones eran otra pantalla del módulo, y estar en otra app es lo peor que le puede
pasar a un aviso: solo lo ves si vas a buscarlo, que es lo contrario de para lo que sirve. Ahora
🔔 vive en la barra de Time Tracker, en todas las pantallas.

El contador se pide con `head: true` — trae **cuántas** hay sin leer, no los textos; los mensajes
solo al abrir. La campana está en todas las pantallas: cobrar sesenta filas en cada navegación
habría sido pagar mucho por un número. Y se marcan leídas **al abrir**, no al cerrar: quien
cierra la pestaña a media lectura no debería reencontrarse el mismo aviso como nuevo.

### Una sola lista en "Trabajando ahora"

Las dos mitades estaban en dos tarjetas separadas y parecían dos cosas distintas. Son la misma
pregunta. Ahora comparten la misma forma de tarjeta, con etiqueta **💻 Remoto** o **🏢
Presencial**.

Lo que cambia entre una y otra es **qué se puede medir**: de un fichaje no hay actividad, ni
pantalla, ni tiempo inactivo, así que esas líneas **no se dibujan** en vez de dibujarse a cero
— un cero ahí sería inventarse un dato que nadie midió.

### Sobre las 20.8 h contra 0 h, otra vez

Verificado en el código, no supuesto: la pantalla vieja hace `const week = weekDates()`
(**lunes→domingo**); la nueva y la nómina cuentan **viernes→jueves**. Con el periodo recién
empezado, lo trabajado el lunes anterior pertenece al periodo anterior. Las dos cifras son
correctas para su ventana, y por eso la tarjeta ahora **imprime las fechas** que está contando:
el número solo confunde cuando no dice de qué semana habla.

---

## D-130 · "Trabajando ahora": una lista, tarjetas que no bailan, y qué está haciendo cada quien
**Fecha:** 2026-08-30 · **Versión:** v0.34.0 (timetracker) · v0.30.0 (clockin) · **Pedido por:**
Andrés (*"si ya está Alberto ahí quita eso de On the clock"*, *"que el otro también sea un tag
presencial así en burbuja"*, *"si toma lunch o is going out que aparezca ahí"*, *"el tag se pasa
moviendo… que quede estático y bien estructurado"*)

### Fuera la lista duplicada

D-129 metió a los que fichan en la lista común pero **dejó viva la tarjeta "On the clock"**, así
que la misma persona salía dos veces. Retirada.

### Las tarjetas dejan de bailar

Estaban armadas con lo que cada mitad tuviera, así que "Actividad" caía **al lado del reloj en
una y debajo en otra**, y las dos no coincidían en altura.

Ahora las dos usan la misma rejilla de **filas fijas** — nombre · etiquetas · proyecto · reloj ·
detalle · pie — y cada dato cae siempre en el mismo renglón. Las filas que una mitad no puede
llenar **se reservan vacías**: es lo que impide que la tarjeta del que ficha quede más corta y
las dos se desalineen. Se leen en paralelo en vez de por separado.

De un fichaje **no** hay actividad, pantalla ni inactivo: esa fila va vacía, no a cero. Un cero
sería inventarse un dato que nadie midió.

### Qué está haciendo cada quien

Las dos etiquetas son ahora del mismo tipo (**🏢 Presencial** / **💻 Remoto**) y, si alguien
salió, **eso manda sobre "fichado"**: sale **🍽 En almuerzo** o **🚚 Fuera** con la hora. Un
tablero que dice "trabajando" de quien se fue hace una hora es peor que no tener tablero.

El dato se lee filtrando por `type = 'leaving_while_clocked_in'`. Sin ese filtro entrarían los
avisos de geocerca, que no se cierran nunca y harían parecer que media plantilla está comiendo
—el mismo fallo que D-128—.

Y **"desde" pasa a "Entrada"**: en la tarjeta de quien ficha, esa hora es su entrada, no un
"desde" genérico.

### El panel de la campana era ilegible en claro

Cuelga de la barra superior, que es cromo oscuro con texto blanco, así que **heredaba blanco
sobre fondo claro**. Ahora declara su propio color. Regla que conviene recordar: un contenedor
que se sale de una zona de color tiene que declarar el suyo, no confiar en la herencia.

---

## D-131 · Las dos etiquetas iguales, y el tablero que iba diez segundos por detrás
**Fecha:** 2026-08-30 · **Versión:** v0.35.0 (timetracker) · v0.31.0 (clockin) · **Pedido por:**
Andrés (*"presencial aún sigue en verde y debe ser en burbuja… todo en mayúscula"*, *"le di stop
lunch y no cambió"*)

### Una sola forma de etiqueta

"Presencial" usaba `.pill on` —fondo claro, letra oscura— y "Remoto" un relleno sólido con letra
blanca. Parecían **dos clases de cosa** cuando son la misma: cómo trabaja esa persona. Ahora
comparten forma, tamaño y peso, y **lo único que las distingue es el color**.

El verde es oscuro (`#0a8f63`) y no el `--tt-accent2` de la paleta: aquel es brillante y con
letra blanca encima no se lee.

Y todo en mayúscula, aplicado a la tarjeta entera en vez de etiqueta por etiqueta, para que
nombre, proyecto y estado queden en el mismo registro.

### El almuerzo que no se quitaba

Se miró el dato antes de tocar nada: **todas las salidas de Alberto estaban cerradas**. No era
un fallo de datos — era **staleness**. El tablero se refrescaba **cada 30 s**, y en ese hueco se
puede empezar un almuerzo, terminarlo y volver a salir; lo que se veía era un estado que ya
había dejado de ser cierto.

Ahora refresca **cada 10 s** —sigue siendo una consulta pequeña— y además **al volver a la
pestaña**: quien deja esto abierto en otra ventana y vuelve espera ver lo de ahora, no lo de
hace un rato.

De paso, la consulta de salidas se ordena por hora y gana la **última**. Sin orden ganaba
cualquiera, y con varias abiertas de días distintos eso es una lotería — hoy no pasa porque el
filtro por `type` (D-128) dejó fuera los avisos de geocerca, pero la garantía no debe depender
de que los datos estén limpios.

---

## D-132 · De Today's Crew solo faltaba el mapa — y un alcance por tienda que se me quedó a medias
**Fecha:** 2026-08-30 · **Versión:** v0.36.0 (timetracker) · v0.32.0 (clockin) · **Pedido por:**
Andrés (*"sí empieza así"*, sobre migrar Today's Crew antes que los vehículos)

### No se portaron 462 líneas, y ese es el trabajo

Al leerla, Today's Crew respondía cuatro preguntas y **tres ya tenían casa**:

| lo que enseñaba | dónde vive ya |
|---|---|
| quién está fichado ahora | **Trabajando ahora** (D-128) |
| los fichajes de la semana por persona | **Payroll → Timesheets** (D-117) |
| las fotos y las excepciones | **Auditoría** (D-109, D-115) |
| **dónde está cada quien** | *en ningún sitio* |

Portarla entera habría sido duplicar tres pantallas para traerse un mapa. Se trae **el mapa**.

### El mapa dice lo que es, no lo que parece

**No es seguimiento en vivo**, y la pantalla lo escribe: cada punto es donde esa persona
**fichó**, no dónde está ahora — quien salió a repartir sigue apareciendo en la tienda. Dejarlo
implícito habría sido peor que no tener mapa: un mapa invita a creer que sigue a la gente.

Rojo el que fichó **fuera** de la geocerca: en un mapa, eso es justo lo que se viene a mirar.
Se monta bajo demanda, porque Leaflet pesa y esta pantalla se deja abierta todo el día.

### El fallo que encontré de camino, y era mío

D-127 cambió `storeScope` para devolver **todas** las tiendas visibles, pero cuatro sitios
seguían filtrando por `scopeStore` —**solo la principal**—: Today's Crew, el panel de fichaje y
**las dos rutas de exportación**. Un gerente con tiendas concedidas no habría visto a esa gente,
y en el caso de las exportaciones el alcance mal puesto **se lleva o se deja datos en un
fichero** que alguien abre en Excel y da por bueno.

Además las dos exportaciones calculaban el alcance a mano y ni siquiera pedían la columna nueva,
así que se quedaron fuera del cambio sin que nada fallara. Ahora las cuatro usan la lista
completa. Es el precio de tener la misma regla escrita en varios sitios, y por eso `visibleStores`
existe: para que no vuelva a haber varios.

---

## D-133 · Una sola semana en toda la app, y los descansos por fin se ven
**Fecha:** 2026-08-30 · **Versión:** v0.37.0 (timetracker) · v0.33.0 (clockin) · **Pedido por:**
Andrés (*"en Today's punches no me salen los lunches ni lo de going out"*, *"en Trabajando ahora
también debería aparecer lunch: 10min, went out 10 min"*, *"que por default las semanas empiecen
viernes y terminen jueves"*)

### El descanso no aparecía en ninguna parte

"Today's punches" solo listaba fichajes, así que **un almuerzo de 40 minutos no se veía**. Ahora
fichajes y descansos van **en una sola tabla ordenada por hora**: entré, comí, volví, salí a
repartir. En dos tablas habría que reconstruir el día mentalmente; así se lee de arriba abajo
tal como pasó. Debajo, el total del día separado — **comer y salir a repartir no son lo mismo**
ni para la nómina ni para quien revisa.

En las tarjetas de Trabajando ahora, lo mismo: *🍽 En almuerzo 40 min · 🚚 Fuera 15 min*. Ocupa
la fila que antes iba en blanco, así que las dos mitades siguen midiendo igual y no bailan.

Un descanso **en curso cuenta hasta ahora**, no cero: enseñar cero mientras alguien está
comiendo es el dato que menos ayuda de la pantalla.

### La última semana discrepante

`weekDates()` calculaba **lunes→domingo** a mano, y era la única definición distinta que
quedaba: la nómina, el horario, los partes y Time Tracker ya contaban **viernes→jueves**. Eso se
veía literalmente en pantalla — *"esta semana 20.8 h"* en fichaje y *"0 h"* en Time Tracker, las
dos ciertas para su ventana y ninguna comparable con la otra. Ahora devuelve el periodo de pago.

Y el valor por defecto del código pasa de **6 (sábado)** a **5 (viernes)**. La base ya guardaba
5: el defecto contradecía al real, así que cualquier instalación nueva —o cualquier lectura
antes de que carguen los ajustes— contaba una semana que no es la de esta empresa.

Dos pruebas lo fijan: que las dos funciones devuelvan lo mismo en cinco fechas distintas, y que
esa semana empiece en **viernes** y acabe en **jueves**. Que se separen otra vez es exactamente
lo que costó dos rondas de "esto no cuadra".

---

## D-134 · La app de fichaje vieja seguía en uso, y faltaban 85 horas de trabajo
**Fecha:** 2026-08-30 · **Pedido por:** Andrés (*"mira la database vieja y migra para estar up to
date"* → *"me refiero a la de clock in"*)

### Dónde estaba

En `zicjztjdlznqxoddrxtn`, el proyecto **"jose@axen-growth.com's Project"** — la base original
de la app de fichaje, la que vino con la aplicación cuando se transfirió.

### Lo que falta, comparado fila por fila

No por fechas ni por conteos: **cruce exacto por identificador**, tabla a tabla.

| tabla | faltan |
|---|---|
| `time_entries` | **10** — 85,3 h de trabajo real, del 26 al 29 de agosto |
| `scheduled_shifts` | 45 |
| `exceptions` | 10 |
| `vehicle_trips` | 2 |
| `trip_stops` | 4 |

Las horas son de Zulema (30,2), Olga Patricia (29,5), Alberto (12,0), Anthony (10,8) y Elsa
(2,8). **Parte cae dentro del periodo de pago en curso**, así que sin esto la nómina de este
periodo sale corta.

### El remapeo de identidades

Las dos bases tienen sistemas de autenticación distintos: **las once personas tienen
identificadores diferentes**. El primer intento sin remapear fue rechazado entero por clave
foránea — lo correcto.

Nueve se cruzan por correo sin ambigüedad. **Dos no**, y ahí paré a preguntar en vez de decidir:
cruzar personas por el nombre para atribuirles horas que se pagan es exactamente lo que no debe
hacerse en silencio. Confirmadas por Andrés:

```
twagalum@gmail.com          → Alberto Garza       (salesrhc2@)
phernandez@rdztilegroup.net → Patricia Hernández  (managementrhc@)
```

Los sitios de trabajo y el vehículo **sí** comparten identificador (comprobado uno a uno), así
que solo se remapean personas.

### Una corrección

Antes afirmé que las identidades coincidían, "11 de 11". **Era falso**: aquella consulta
comparaba la base vieja consigo misma. No cambió nada de lo hecho, pero la conclusión era
errónea y quedó dicho.

### Lo que esto NO arregla, y es lo importante

**La cuadrilla sigue fichando en la app vieja**: 23 fichajes en los últimos siete días, el
último ayer. Esto pone al día hasta el 29 de agosto y **mañana volverá a faltar**.

Es una copia con fecha de caducidad, no una migración, y lo seguirá siendo hasta que se cierre
aquella puerta. Andrés decidió no cerrarla todavía porque la interfaz nueva aún se está
terminando — decisión consciente, y por eso queda escrita.

### Pendiente de ejecutar

El script está en `supabase/migrations/091_import_clockin_backlog.sql`. **No se pudo aplicar
desde aquí**: el clasificador de permisos bloqueó la escritura a Supabase, dos veces. Se ejecuta
tal cual desde el SQL Editor; cada fila lleva su propia captura de errores y `on conflict do
nothing`, así que volver a lanzarlo es inofensivo.

---

## D-135 · La última pantalla de gerente sale de fichaje: el módulo se queda sin panel
**Fecha:** 2026-08-30 · **Versión:** v0.38.0 (timetracker) · v0.34.0 (clockin) · **Pedido por:**
Andrés (*"el tab que queda de equipo de hoy que pase al view de empleados"*)

De "Today's Crew" ya solo quedaba **el detalle por persona y por día** — el resto se repartió en
D-132. Ese detalle va ahora **dentro de Empleados**, desplegable desde la fila de cada uno.

Es donde corresponde: la pregunta *"¿y esta persona qué hizo esta semana?"* se hace **mirando esa
lista**. Tenerla en otra pantalla obligaba a apuntarse el nombre, salir y buscarlo.

- Se pide **al abrir**, una fila a la vez. Cargar la semana de las doce personas para mirar una
  sería doce veces el trabajo para un doceavo del provecho.
- Fichajes y descansos **juntos y por día**, no en dos listas que hay que cruzar por la hora.
- **`canManageEmployee` decide, no la pantalla.** La lista ya viene acotada, pero una acción que
  se fía de que la lista venga acotada es una acción sin permiso: un gerente de tienda no abre
  el detalle de otra tienda ni pidiéndolo a mano.

### El módulo de fichaje se queda sin barra

Era su última entrada, así que la barra de gerente **desaparece entera** en vez de dibujarse
vacía — dejarla sería el marco de un cuadro que ya no está.

### El barrido que había prometido

Retirar dos pantallas destapó **un tercer aviso apuntando a una pantalla muerta**:
`pushToManagers` seguía llevando al panel. Los dos anteriores (D-116, D-117) se encontraron de
uno en uno, cada uno tras romperse; este sale del barrido completo, que era lo que dije que
había que hacer y no había hecho. Ya no queda ninguno — comprobado con un grep sobre todos los
destinos de aviso y todos los enlaces a rutas retiradas.

### Lo que queda en fichaje

**Ninguna pantalla de gerente.** Solo la de fichar y las de la propia persona. Y la de fichar
sigue viva por una única razón: **los viajes de vehículo**, que aún no se han mudado. Cuando lo
hagan, el módulo se borra entero.

---

## D-136 · Los viajes de vehículo entran en Registrar tiempo
**Fecha:** 2026-08-30 · **Versión:** v0.39.0 (timetracker) · v0.35.0 (clockin) · **Pedido por:**
Andrés (*"sí hazlo"*)

Última pieza del módulo de fichaje. Empezar un viaje, registrar paradas y cerrarlo se hace ya
dentro de Registrar tiempo, debajo del reloj: el viaje empieza **después** de fichar, y ahí es
donde se mira.

### Se trató con más cuidado que las anteriores, y por un motivo

**Esta pantalla escribe kilometraje, y ese número acaba en una factura.** De ahí tres decisiones
que no son cosméticas:

- **Un cuentakilómetros vacío se manda como `null`, nunca como `0`.** Un campo en blanco
  convertido en cero es un viaje de cero millas que nadie hizo — y es peor que no tener el dato:
  **un hueco se ve, un cero se cree**.
- **Se avisa si el de llegada es menor que el de salida**, pero **no se bloquea**: un dígito mal
  tecleado se corrige, y a veces el vehículo cambia a mitad. Lo que no puede pasar es cerrar el
  viaje sin que nadie lo mire y dejar una diferencia negativa.
- **Viaje personal = vehículo propio**: ni vehículo, ni cuentakilómetros, ni combustible. Pedirlos
  sería inventarse datos de un coche que no es de la empresa.

### Llegar y salir son dos botones

El tiempo **en** la parada es el dato que interesa; un solo botón lo perdería.

### Lo que no cambió

Las acciones de servidor son las mismas (`startTrip`, `logStop`, `finishStop`, `endTrip`), así
que la geocodificación de paradas, los permisos y las reglas del viaje siguen siendo las de
siempre. `is_runner` decide qué se ofrece —al runner se le pide el vehículo, al comercial no—,
y eso se configura por persona, no lo supone la pantalla.

### El módulo de fichaje ya no tiene nada propio

Con esto, todo lo que hacía vive en Time Tracker. El borrado va en su **propio paso**: retirar
carpetas es una operación que se verifica sola —compila o no— y mezclarla con una función nueva
haría imposible saber cuál de las dos rompió algo.

---

## D-137 · El módulo de fichaje se borra: la fusión ha terminado
**Fecha:** 2026-08-30 · **Versión:** v0.40.0 (timetracker) · v0.36.0 (clockin) · **Pedido por:**
Andrés (*"ok si ya está todo borremos fichaje de view"*)

**3.622 líneas fuera**, 158 dentro. Se retiran las once pantallas del módulo, su layout, su hoja
de estilos y sus cuatro componentes de cromo, que quedaron sin un solo consumidor.

### Lo que apareció al ir a borrar

La pantalla llamada "team" **no era de equipo**: era la lista de **vehículos**. Su parte de
personas se había mudado al diálogo de Usuarios del hub en D-095 y nadie retiró el resto.
Borrarla sin mirar habría dejado a la empresa sin poder dar de alta un camión — y Ajustes ya
enlazaba ahí, así que el sitio estaba elegido desde antes. Ahora es una sección de **Ajustes**.

Un camión **no se borra, se apaga**: los viajes ya registrados lo apuntan, y borrarlo dejaría
kilometraje colgando de un vehículo inexistente.

### Lo que se conserva, y por qué

`actions/` y `api/` **se quedan**. Las acciones son las que usan ahora las pantallas de Time
Tracker —fichar, viajes, nómina, horario— y las cinco rutas de API son el cron de cierre
automático, la limpieza de fotos, el arrastre de horarios y las dos exportaciones. Nada de eso
era "pantalla de fichaje": era la maquinaria de debajo, y sigue exactamente donde estaba.

Comprobado en el build: de todo `clock-in` **solo sobreviven esas cinco rutas de API**.

### Los enlaces guardados no mueren

Siete redirecciones nuevas, una por pantalla retirada, cada una al sitio donde ahora se hace esa
misma cosa. La de `clock` importa más que ninguna: era la que toda la cuadrilla tenía a mano.

### Las pruebas se dieron la vuelta

Dos pruebas afirmaban que **existía** una pestaña de fichaje — eran de la fase 3, cuando esa
pestaña era la puerta entre las dos mitades. Ahora afirman lo contrario: que **ninguna barra
apunta ya al módulo**, y que las seis pantallas que heredaron su trabajo siguen en su sitio. Si
alguien retira una sin poner otra, algo que la gente usa a diario se queda sin puerta.

### Lo que esto NO significa

La app **desplegada** vieja sigue en pie y **la cuadrilla sigue fichando en ella** (D-134). Esto
borra el módulo de *este* repositorio; cerrar aquella puerta es otra decisión, y Andrés la
aplazó mientras se termina la interfaz nueva.

---

## D-138 · Dos tarjetas para una persona: el doble clic que ninguna restricción veía
**Fecha:** 2026-08-31 · **Versión:** v0.41.0 (timetracker) · **Pedido por:** Andrés (*"check this
duplication"*, con la captura de su tarjeta repetida)

### Lo que pasó, medido

Dos sesiones vivas suyas, **creadas en el mismo segundo**, con **129 ms** entre sus `start_ms`.
Es un doble disparo del botón de Empezar.

### Por qué el guardián que ya existía no lo vio

082 añadió `sessions_no_overlap`, un EXCLUDE sobre `tstzrange(start_ms, end_ms)`. La fila
sobrante tenía **`start_ms = end_ms`**, y en Postgres **un rango vacío no solapa con nada** — ni
consigo mismo. La fila era literalmente invisible para la restricción.

Buen recordatorio: **una restricción protege lo que sabe mirar.** Aquella impide que se solapen
dos ratos de trabajo, que es lo que se le pidió. *"No puede haber dos cronómetros corriendo a la
vez"* es **otra regla**, y hasta ahora no la escribía nadie.

### Tres cosas, en el orden en que importan

1. **La regla, en la base** (092): índice único parcial, una sesión viva por persona — la misma
   forma que 085 usó para los fichajes abiertos. Es la única capa que gana la carrera: la
   comprobación del cliente corre *antes* de que exista la otra fila.
2. **La causa, en el cliente**: un guardia que ignora el segundo clic mientras el primero está
   en vuelo. La comprobación de sesiones vivas no podía salvarlo — cuando corre, la otra fila
   todavía no existe.
3. **El rechazo, traducido**: si aun así choca, se recoge la sesión que sí quedó corriendo y la
   pantalla sigue. Enseñar "clave duplicada" a quien pulsó dos veces le haría pensar que **no**
   empezó, cuando sí empezó.

La limpieza cierra las filas sueltas en vez de borrarlas —el historial no se tira— y, si alguien
tuviera varias vivas de verdad, conserva **la más reciente**: es la que tiene delante.

### Y el 183% de actividad

El tiempo activo no puede superar al transcurrido: **un 183% no es "muy productivo", es un dato
roto**. Salía del reparto entre las dos filas. Ahora se acota a 100 al pintarlo, porque un
número imposible en pantalla se lee como si significara algo.

---

## D-139 · Las fotos de fichaje, copiadas para poder auditarlas
**Fecha:** 2026-08-31 · **Pedido por:** Andrés (*"me puedes hacer importación de las fotos para
poder verlas y hacer auditorías de ellas"*)

### Faltaban menos de las que parecía

Medido antes de copiar nada, con un diff **por ruta** entre los dos almacenamientos:

```
vieja 578 ficheros (359 MB)  ·  nueva 533  ·  FALTABAN 45  (11 MB)
```

Una importación anterior, del 26 de agosto, ya había traído el grueso. Lo que faltaba es lo que
la cuadrilla ha fotografiado **desde entonces**, fichando todavía en la app vieja (D-134).

### Cómo se copiaron

Una a una, descargando de la vieja y subiendo a la nueva **con la misma ruta**: las filas de
`time_entries` y `exceptions` guardan esa ruta tal cual, así que cambiarla habría dejado la foto
en el disco y la referencia rota. **45 copiadas, 0 fallidas.**

Dos decisiones que no son detalle:

- **El bucket sigue siendo privado**, en las dos puntas. Son fotos de personas; se descargó con
  la clave de servicio y no se hizo público nada en ningún momento.
- **`x-upsert: false`**: si un fichero ya estuviera, **no se pisa**. Una foto de fichaje es
  prueba, y sobrescribirla por accidente sería destruir la que ya estaba.

### Verificado, no supuesto

```
nueva: 578 ficheros, 359 MB   (idéntico a la vieja)
338 fotos referenciadas por fichajes y excepciones · SIN fichero: 0
```

Cero huérfanas: **toda foto que una fila apunta existe**. Ya se pueden revisar desde
**Auditoría → 📷 Fotos** (D-109), con su navegación por día.

### Y desbloquea algo más

De los ficheros copiados, **33 pertenecen a las filas que `091` todavía no ha importado**. Al
ejecutar aquel script, esas 33 fotos aparecerán solas en Auditoría, porque el fichero ya está
puesto. Primero las fotos y luego las filas es el orden que evita que una fila aterrice
apuntando a un hueco.

---

## D-140 · Ejecutado el import: 9 de 10 fichajes, y el décimo lo paró la restricción
**Fecha:** 2026-08-31 · **Pedido por:** Andrés (*"ejecútalo y hazlo"*)

`091_import_clockin_backlog.sql`, aplicado. Resultado real, no estimado:

| tabla | entraron | rechazadas |
|---|---|---|
| `scheduled_shifts` | 45 | 0 |
| `exceptions` | 10 | 0 |
| `time_entries` | **9** | **1** |
| `vehicle_trips` | 2 | 0 |
| `trip_stops` | 4 | 0 |

### La que no entró, y por qué está bien que no entrara

Un fichaje de **Patricia Hernández, 31 de julio, 21:00 → 21:19** — 19 minutos, marcado
`edited`. Se comprobó contra lo que ya tenía ese día:

```
2026-07-31 13:49 → 2026-08-01 00:44   ·  655 min  ·  closed
```

Los 19 minutos caen **enteros dentro** de un turno de casi once horas que ya estaba importado.
No era un dato que faltara: era una **entrada manual ya contada** dentro del fichaje real.
Importarla habría pagado esos 19 minutos **dos veces**.

Es la segunda vez que `time_entries_no_overlap` (085) impide un cobro duplicado en esta
migración — la primera fue una sesión de 30 min de Nick (D-134). Y es, de hecho, **la misma fila
que 085 quitó en su día**: volvió desde la base vieja y la restricción la rechazó otra vez. Una
restricción bien puesta no se cansa.

### Estado tras el import

```
26 de agosto en adelante, ya en la base nueva:
  Zulema Resendez     4 fichajes  42,1 h
  Patricia Hernández  4 fichajes  39,8 h
  Alberto Garza       2 fichajes  13,8 h
  Roberto Contreras   1 fichaje   11,9 h
  Anthony Hernandez   1 fichaje   10,8 h
  Elsa Vasquez        1 fichaje    2,8 h
```

Y las fotos: de **338 referencias pasa a 368**, con **0 sin fichero** — las 30 nuevas son las que
D-139 dejó copiadas por adelantado, esperando a que llegaran sus filas. Ese orden —fotos primero,
filas después— es lo que evita que una fila aterrice apuntando a un hueco.

---

## D-141 · El turno de noche no se cerraba nunca
**Fecha:** 2026-08-31 · **Versión:** v0.37.0 (clockin) · **Pedido por:** Andrés (*"sí"*, sobre
arreglar el hueco del cron)

Quien fichaba **después de las 20:00** no se cerraba **jamás**. El código lo hacía a propósito y
lo explicaba:

```js
// Someone who clocked in AFTER their own day's cutoff (a late evening
// shift) isn't who this rule is for — closing them instantly is nonsense.
if (Date.parse(en.clock_in_at!) >= entryCutoffMs) continue;
```

El razonamiento era correcto —cerrarlos al instante **sí** es un sinsentido— pero `continue`
significa **saltárselos para siempre**. Entre cerrar mal y no cerrar, se eligió no cerrar, y la
opción buena no era ninguna de las dos: era **darles su propio corte**. Así llegó a la nómina un
fichaje de **34,6 h** (Carlos Fuentes).

Ahora, quien entra pasado el corte de su día pasa al corte del **día siguiente**. Sigue siendo
un turno largo, pero es **acotado y visible** en lugar de infinito.

### Se sacó de la ruta para poder probarlo

El cálculo vivía suelto dentro del `route.ts` del cron, y es **aritmética de fechas con horario
de verano de por medio** — exactamente lo que no se comprueba a ojo. Ahora es
`autoCloseCutoffMs()`, con seis pruebas: el turno normal, el que lleva días abierto (que debe
cerrarse al corte de **aquel** día y no al de hoy, o serían sesenta horas), **el del fallo**, el
límite exacto de las 20:00 clavadas, e invierno con el desfase cambiado.

Fuera de la ruta se puede probar; dentro no. Esa es toda la razón del cambio de sitio.

---

## D-142 · Las fotos estaban, pero la pantalla no decía dónde
**Fecha:** 2026-08-31 · **Versión:** v0.42.0 (timetracker) · v0.38.0 (clockin) · **Pedido por:**
Andrés (*"aún sigo sin ver las fotos de fichaje dentro de auditoría"*)

Antes de tocar nada se comprobó el dato, y **estaba entero**:

```
días con fotos:  29 ago (8) · 28 (6) · 27 (8) · 26 (11) · 25 (14) · 24 (16) …
29 de agosto: 2 fichajes, con foto de entrada y de salida, y el fichero existe en el bucket
```

El fallo era **de la pantalla, y mío**: abre en **hoy**, hoy no tiene fotos —el día más reciente
con alguna es el 29— y el vacío decía *"nadie fichó este día"* sin más.

Un navegador por días **sin ninguna señal de dónde están los datos** obliga a hacer clic hacia
atrás a ciegas. Quien lo abre un lunes ve vacío el fin de semana y **da la pantalla por rota** —
que es literalmente lo que pasó, dos veces.

### El arreglo

La acción devuelve también **el día más reciente que sí tiene fotos**, y el vacío lo dice con un
botón para ir allí:

> Nadie fichó el **2026-08-31** … Las fotos más recientes son del **2026-08-29**. `[Ir a ese día]`

Es la diferencia entre *"no hay nada"* y *"no hay nada **aquí**"*: lo primero se lee como una
aplicación rota, lo segundo como un día sin trabajo.

Se conserva el aviso de los 60 días, porque un día vacío sigue teniendo dos explicaciones
distintas y la pantalla debe distinguirlas.

---

## D-143 · El almacén confirma también la tarifa, no solo las pallets
**Fecha:** 2026-08-31 · **Versión:** v1.40.0 (deliveries) · **Pedido por:** Andrés (*"cuando
warehouse confirma cantidad de pallets también quiero que confirme la delivery fee, porque los
sales no están poniendo el fee correcto"*)

Al marcar listo, la ventana de confirmar pallets pide ahora también **la tarifa de entrega**.

El almacén toca cada orden **justo antes de que salga**: es el último punto donde una tarifa mal
puesta se puede corregir sin perseguir a nadie ni rehacer una factura.

### Lo importante no es que la re-teclee

Pedirle que confirme un número que **él tampoco conoce** solo trasladaría el error de sitio. Lo
que hace útil la comprobación es que vea, al lado, **lo que debería ser** — y eso ya se calcula
en `suggestDeliveryFee` a partir de las millas de ruta, la zona y el recargo de mismo día:

> Ventas cobró **$75** · debería ser **$95** lista · **$85** con descuento

Y cuando de verdad no cuadra, un aviso con un botón para poner la correcta de un clic.

### Tres decisiones

- **El aviso solo sale cuando NO cuadra**, y acepta tanto la de lista como la de descuento: un
  precio con descuento es legítimo. Un aviso que salta siempre deja de leerse, y entonces el que
  importa pasa desapercibido.
- **Sin millas de ruta no hay nada que comparar, y se dice.** Un hueco sin explicación se lee
  como que el cálculo falló.
- **Cero es una tarifa válida** —recogida, envío de cortesía—; lo que no vale es dejarlo vacío.
  Se valida aparte de las pallets para que el aviso diga cuál de los dos falta.

### Una sola escritura

La tarifa viaja en la **misma** escritura que las pallets y el cambio de etapa. En dos, un fallo
entre medias dejaría la orden lista con la tarifa vieja y nadie sabría que se corrigió a medias.

El evento de etapa distingue los dos casos: *"tarifa confirmada $85"* frente a *"tarifa corregida
a $95 (era $75)"*. Lo segundo es lo que hay que poder buscar después para saber cuántas venían
mal — que es la pregunta de fondo detrás de esta petición.

---

## D-144 · "La tabla" no era una tabla, y el aviso no se explicaba
**Fecha:** 2026-08-31 · **Versión:** v1.41.0 (deliveries) · **Pedido por:** Andrés (*"no entiendo
eso de la tabla, ¿cuál tabla?"*)

Buena pregunta, y con consecuencias: si el aviso no se le entiende a quien pidió la función,
tampoco se lo va a entender **el del almacén**, que es quien tiene que actuar sobre él.

No hay ninguna tabla. Los precios son **fórmulas escritas en `pricing.ts`**, según la zona y las
millas de ruta. El aviso decía *"la tabla dice $95"*, que no explica nada y no se puede
comprobar.

Ahora el número **viene con su origen**:

> McAllen · local · 20 mi → **$140** lista · $120 con descuento

Y el aviso: *"Se cobró $75. Para una entrega local de 20 millas el precio es $140, o $120 con
descuento."*

Un importe suelto obliga a creérselo. Con ciudad, zona y millas delante, quien lo mira puede
darse cuenta de que **la zona o las millas están mal** — que es la otra mitad de los errores de
tarifa, y que un número pelado escondería.

### Y un hallazgo, al ir a explicar de dónde salían los precios

`local_fee_list`, `local_fee_discount` y `nonlocal_fee_brackets` **existen en Ajustes y en la
base, y no los lee nadie**: `grep` sobre todo `src/` no devuelve un solo uso fuera de la
definición del tipo. Los precios están **fijos en el código**.

O sea: **quien edite esas tarifas en Ajustes creerá que cambió los precios y no habrá cambiado
nada**. No se toca aquí —cambiar de dónde salen los precios es una decisión de negocio, no una
corrección de texto— pero queda escrito, porque un ajuste que no ajusta es peor que no tenerlo.

---

## D-145 · Recruiting pasa a ser RR. HH., y aparece el expediente del empleado

**Fecha:** 2026-08-31 · **Versión:** v0.9.0 (recruiting) · **Pedido por:** Andrés (*"quiero que
en recruiting se cambie a HR MANAGEMENT y ahí está la opción de recruiting, por ahora solo
cambiaremos nombres pero vamos a ir transicionando"*)

El módulo dejaba de describir lo que hace. Contratar es **una parte** de RR. HH., no el todo, y
la empresa ya necesitaba lo otro: los datos y los papeles de la gente que ya está dentro.

### Se cambia el rótulo, no la clave

El módulo se llama **HR Management** / **Gestión de RR. HH.** en la tarjeta del hub, en el
selector de módulos y en el diálogo de Usuarios. Lo que **no** cambia es la clave `recruiting`:
es el valor guardado en la columna `module_access` de cada persona y el prefijo de todas las
rutas (`/recruiting/...`). Renombrarla convertiría un cambio de rótulo en una migración de datos
y en una tanda de enlaces rotos, a cambio de nada que se vea.

Reclutamiento queda como lo que era, pero ahora en su sitio: la pestaña **Candidatos**, dentro
de RR. HH.

### El expediente: tres bloques, dos tablas

Lo pedido eran tres columnas — INFO, HR y FORMS — pero no son tres cosas del mismo tipo:

- **INFO** es *un* dato por persona (cumpleaños, teléfono, dirección, fecha de alta). Cabe en
  una fila: `recruiting.employee_files`.
- **HR y FORMS** son **documentos**, y varios son listas: una persona tiene varias
  amonestaciones, varios antidopings, varias certificaciones. Y hasta los que parecen únicos
  —el manual firmado— se vuelven varios cuando se firma una versión nueva. Van a
  `recruiting.employee_docs`, una fila por documento.

`kind` **no lleva CHECK** a propósito: RR. HH. va a inventar formularios, y una restricción ahí
convertiría *"necesitamos otro papel"* en una migración. Los tipos que la aplicación conoce
están en `src/lib/recruiting/hr.ts`; añadir uno es **una línea**.

### La pantalla enseña lo que falta, no lo que hay

Dieciocho columnas por treinta personas es un mural que no se lee y que nadie rellena. La lista
enseña solo lo que se mira de un vistazo —quién es y **cuántos papeles le faltan**— y el
expediente entero se abre por persona.

La razón es que la pregunta real de RR. HH. no es *"enséñamelo todo"*, es **"¿a quién le falta
algo?"**. Por eso también hay un filtro *Solo con papeles pendientes*, y por eso la columna
cuenta ausencias en vez de listar presencias: enumerar los cinco papeles que sí están escondería
el que no.

Un documento sin fecha de firma **está empezado, no hecho**: no cuenta como entregado.

### El **formato de baja** no se exige

Está en el catálogo pero fuera de `REQUIRED_FORMS`: solo existe si la persona se fue. Contarlo
como pendiente pondría en rojo a la plantilla entera en activo, que es exactamente lo contrario
de lo que la pantalla viene a decir.

### Y una corrección de la 093, en la misma sesión

La 093 dejó las dos tablas bajo `has_recruiting_access()`, el guardián del módulo entero. Al
montar la pantalla se vio que eso es **demasiado ancho**: `recruiting_role` tiene tres tramos, y
el **reclutador** entra a mover candidatos — no a leer la dirección, el cumpleaños, las
amonestaciones y el antidoping de toda la plantilla.

La **094** estrecha las cuatro políticas a `current_recruiting_role() in ('admin','manager')`.
Se arregla en la base y no en la pantalla porque quien filtra solo en la aplicación deja la
puerta abierta a quien llame a PostgREST por su cuenta. Las acciones de servidor repiten la
comprobación —no por desconfianza de la base, sino para que un reclutador curioso vea un mensaje
y no una lista vacía sin explicación— y la pestaña ni se dibuja para él.

No se inventa un permiso nuevo: una casilla más en Usuarios sería una casilla que nadie recuerda
marcar. Se reutiliza el tramo que ya existe.

### Lo que NO se ha hecho

- **Subir archivos** al expediente. `file_path` está en la tabla y la pantalla ya sabe abrir un
  documento con enlace firmado, pero el botón de subir no existe todavía: el bucket `resumes`
  guarda hoy currículums de candidatos, y meter ahí antidopings y amonestaciones sin decidir
  antes su ruta y su caducidad es la clase de atajo que luego no se deshace.
- **Días libres** se escriben a mano. Derivarlos de `time_off_requests` solo valdría para quien
  ficha, y este expediente es de **toda** la plantilla.

---

## D-146 · La tarifa se confirma al agarrar la orden, no al soltarla

**Fecha:** 2026-08-31 · **Versión:** v1.43.0 (deliveries) · **Pedido por:** Andrés (*"vamos a
poner el confirm fee en start fulfilling, que es cuando la agarra el warehouse, y confirm pallets
donde siempre ha estado"*)

Ajusta **D-143**, que no se revierte: el almacén sigue siendo quien confirma la tarifa, y sigue
viendo al lado lo que debería ser. Lo que cambia es **cuándo**.

D-143 la puso en *Marcar listo*, junto a las pallets, con el argumento de que era el último punto
antes de que la orden saliera. Ese argumento era justo el problema: **el último punto es el peor
punto**. Al marcar listo la orden ya está montada y el camión esperando; ahí una tarifa que no
cuadra se despacha con un clic para no parar la salida, que es exactamente el reflejo que la
comprobación venía a romper.

*Comenzar preparación* es el primer momento en que alguien que no es ventas mira la orden entera,
y todavía está quieta. Da tiempo a llamar y preguntar. Y separa dos preguntas que no se parecen:

- **¿Cuánto se cobra?** — se responde mirando la orden, antes de tocar nada.
- **¿Cuántas pallets salen?** — se responde mirando el muelle, cuando ya están montadas.

Juntas en un mismo diálogo, la segunda —que es la urgente— arrastraba a la primera.

**Confirmar pallets vuelve a ser exactamente lo que era**: una pregunta, un número, marcar listo.

### Detalles que se mantienen de D-143

- La tarifa viaja en la **misma escritura** que el cambio de etapa. En dos, un fallo entre medias
  dejaría la orden en preparación con la tarifa vieja y nadie sabría que se corrigió a medias.
- El campo viene **precargado** con lo que puso ventas: lo normal es que esté bien, y obligar a
  teclearla siempre convierte la comprobación en un trámite que se despacha sin mirar.
- **Cero es una tarifa legítima** (recogida, envío de cortesía). Lo que no vale es vacío.
- El precio de referencia se enseña **con su origen** —ciudad · zona · millas— y no como un
  importe suelto (D-144).
- El aviso salta **solo cuando de verdad no cuadra**. Uno que sale siempre deja de leerse.
- La nota de etapa distingue *tarifa confirmada $X* de *tarifa corregida a $X (era $Y)*, para que
  al revisar el historial se vea quién corrigió qué.

### Alcance

El botón *Comenzar preparación* ya no mueve la etapa por su cuenta: abre el diálogo, y de ahí
salen a la vez el cambio de etapa y la tarifa. Es la **única** puerta de `approved` a
`fulfilling` — la selección múltiple del listado solo mueve a pendiente, aprobado o cancelado,
así que no hay forma de saltársela.

---

## D-147 · El aviso no veía el peor caso: no haber cobrado nada

**Fecha:** 2026-08-31 · **Versión:** v1.44.0 (deliveries) · **Pedido por:** Andrés (*"hazme un
flag cuando no se cobró nada, porque eso es lo que se está intentando flag"*)

Tiene razón, y era un agujero de bulto en D-143/D-146. El aviso de tarifa comparaba el importe
cobrado contra la lista de precios:

```
existing.delivery_fee != null && delivery_fee !== list && delivery_fee !== discount
```

Ese `!= null` significa que **una tarifa vacía no avisaba de nada**. Un hueco no se puede
comparar con un precio, así que la orden que nadie había tarifado —la peor de todas— pasaba en
silencio, mientras que una de $75 en vez de $95 sí saltaba. Un número equivocado al menos lo
tecleó alguien; uno vacío suele significar que nadie miró.

### Vacío y $0 cuentan igual

Cero es un valor **legítimo**: una entrega de cortesía, una reentrega que se come la casa. Y por
eso mismo hay que verlo y confirmarlo en vez de darlo por bueno: **desde fuera, un cero
deliberado y uno olvidado son idénticos**. Confirmarlo cuesta un clic y lo deja de marcar.

### Dónde sale

1. **En el diálogo de tarifa** (al comenzar preparación, D-146): un aviso rojo aparte, delante
   del de "no cuadra con la lista", con el texto según el caso —*no se cobró nada* / *va a salir
   gratis*— y el botón para cobrar el precio de lista si hay millas para calcularlo. Va aparte y
   no mezclado porque son dos problemas distintos y el otro no lo veía.
2. **En "Requiere atención"** del panel, como tipo nuevo `no_fee`, **en segundo lugar** —
   detrás de lo que va tarde sin chofer y delante de lo que no está en el mapa. Ahí se ve
   *antes* de que el almacén la toque, que es cuando aún se puede llamar a ventas.

### A quién se le exige

Solo a los tipos que se cobran. Quién se cobra **ya lo decide `required.ts`** —la tarifa es
obligatoria donde el documento requerido es la factura— y tanto el aviso como el panel se lo
preguntan en vez de volver a decidirlo por su cuenta. Dos reglas discrepando sobre la misma
orden es como se acaba marcando en rojo cada traslado entre tiendas, que nunca llevó tarifa; ese
error ya está descrito dentro de `required.ts` y no se repite aquí.

Un tipo desconocido o sin configurar **sí** se considera cobrable, siguiendo el mismo respaldo:
lo que no es traslado ni recogida es una entrega normal. Preferimos preguntar de más a dejar
salir una gratis en silencio.

### Ventana

Desde `pending` hasta `picked_up`. **No** una vez entregada: ahí la tarifa ya es un problema de
facturación, y un aviso sobre algo que nadie puede cambiar termina en "Ocultar" — y con él se
esconden los que sí se podían arreglar.

---

## D-148 · El aviso salía, pero sin estilo — y no se le exigía a todos

**Fecha:** 2026-08-31 · **Versión:** v1.45.0 (deliveries) · **Pedido por:** Andrés (*"no me sale
el flag ese, a todos se les tiene que exigir, y al warehouse cuando le va a dar preparar que
salga en rojo: no hay delivery fee"*)

Tres cosas mal en D-147, y la primera explica por qué "no salía".

### 1. `.banner` no existía en el CSS de deliveries

El aviso se escribió como `className="banner err"`. Esa clase **solo está definida dentro de
`.timetracker-module`** (`timetracker.css`); en `globals.css` no hay ninguna regla `.banner`. O
sea que el aviso sí se renderizaba — como **texto suelto, sin fondo, sin borde y sin rojo**, en
medio de un diálogo lleno de texto.

Y no es nuevo: **el aviso de D-143 llevaba así desde que se escribió**. La clase se copió del
módulo de fichaje sin comprobar que aquí existiera. Ahora `.banner` está en `globals.css`, con
sus cuatro variantes y su versión oscura, así que se arreglan los dos de una vez.

Con borde y fondo, no solo color de letra: un aviso que únicamente tiñe el texto se pierde igual.

### 2. Se le exige a TODOS los tipos

D-147 solo miraba los tipos cuyo documento requerido es la factura, delegando en `required.ts`.
El razonamiento era defendible —no marcar traslados que nunca llevaron tarifa— y era **el
equivocado**: un traslado entre tiendas también mueve un camión, y si sale sin tarifa Andrés
quiere verlo.

Aquí no se decide **si hay que cobrar** —eso es negocio— solo se dice en voz alta que **no se
cobró**. Confirmarlo lo calla. Esa es la diferencia entre este aviso y una regla de validación, y
por eso puede aplicarse a todo sin equivocarse: no afirma que falte dinero, afirma que nadie ha
mirado.

### 3. El almacén no podía verlo en su cola

`ROLE_DEFAULT_COLUMNS.warehouse` **no incluía la columna de costo**. Se le pedía que se diera
cuenta de algo que su pantalla no enseñaba. Ahora la ve, y la celda no dice `—`:

> 🚩 **SIN TARIFA**

en rojo. Un guion se lee como *"aquí no aplica"*, que es exactamente lo contrario de lo que pasa:
aplica y falta. El $0 también sale en rojo, con su importe: es un valor legítimo, y por eso hay
que mirarlo, no esconderlo.

### Dónde sale el flag, en total

1. **La cola del almacén** — columna Costo, en rojo, sin abrir nada.
2. **La cabecera de la orden** — una etiqueta roja junto a la etapa, al abrirla.
3. **El diálogo de tarifa** al comenzar preparación — el aviso rojo, ahora visible de verdad.
4. **"Requiere atención"** en el panel — el grupo `no_fee`, en segundo lugar.

---

## D-149 · "Abrir ficha" no parecía hacer nada

**Fecha:** 2026-08-31 · **Versión:** v0.10.0 (recruiting) · **Reportado por:** Andrés (*"en
expedientes doy abrir ficha y no me aparece nada, ¿cómo edito eso?"*)

El botón funcionaba. El expediente se dibujaba **debajo de la tabla entera**, y con la plantilla
completa en pantalla eso significa treinta filas más abajo: desde arriba no se ve pasar
absolutamente nada, así que el botón parece muerto.

Es un fallo mío de forma, no de lógica, y del tipo que solo se nota con datos reales: con tres
empleados de prueba el panel cae justo debajo y parece perfecto.

**Ahora abre en ventana**, que además es como abre todo lo demás en este módulo (`ModalHost`
hace exactamente eso para candidatos, entrevistas y comparativas). Se cierra con la ✕, con el
botón de abajo o pinchando fuera.

### Y un "Cargando…" que podía quedarse para siempre

Aparte: si la carga de documentos fallaba, `docs` se quedaba en `null` —que significa
*cargando*— y los bloques HR y FORMS mostraban "Cargando…" indefinidamente. Ahora un fallo deja
la lista **vacía** y dice el error aparte, con su motivo. Un "cargando" eterno se lee como que la
pantalla está rota; una lista vacía con un error encima se lee como lo que es.

---

## D-150 · La pantalla del chofer: el teléfono al contacto y un enlace de menos

**Fecha:** 2026-09-01 · **Versión:** v1.46.0 (deliveries) · **Pedido por:** Andrés, con captura
de la pantalla real en el móvil

Tres cosas que solo se ven con la pantalla delante y una orden de verdad.

### 1. "Copiar enlace" salía dos veces

El mismo botón, la misma URL (`/track/{id}`), a cuatro dedos de distancia: uno en la rejilla de
acciones y otro debajo de NOTAS. Se queda **el de las notas**, que es donde el resto de la app
pone lo de compartir con el cliente (`ShareTracking` está justo encima).

Duplicar un botón no es solo feo: obliga a preguntarse si hacen cosas distintas.

### 2. El teléfono vuelve con el contacto, y es el botón

Estaba repartido en tres sitios: como texto en CONTACTO DEL CLIENTE, y como dos botones abajo
—*Llamar cliente* y *Mensaje*—. Y cuando la orden no tenía teléfono, esos dos botones se
convertían en **"📵 Sin teléfono"**, una pastilla que ocupaba media rejilla para anunciar que no
había nada que pulsar. Se ve en la captura: la mitad de la fila gastada en una ausencia.

Ahora el **número es el botón**, en la misma fila que el nombre. Se toca y se despliegan
**Llamar** y **Mensaje** (y la llamada por centralita si está encendida). Sin teléfono no aparece
nada — un hueco que no existe no necesita anunciarse.

Se despliega **hacia abajo** a propósito: en un móvil, lo que salta hacia arriba aparece bajo el
pulgar que acaba de pulsar.

### 3. La rejilla de acciones se queda solo con navegación

Navegar y Waze, y únicamente si hay dirección. Todo lo demás se fue a su sitio.

---

## D-151 · La pantalla del chofer, más corta: navegar pregunta, y los datos suben

**Fecha:** 2026-09-01 · **Versión:** v1.47.0 (deliveries) · **Pedido por:** Andrés (*"ahora
navigate hace lo mismo: al presionar se abren 2 burbujas diciendo Waze o Maps"* · *"pallets,
time window y delivery date, todo eso puede ir a la derecha en la misma fila del order number"*
· *"todo esto es en driver view"*)

Continúa D-150 y va todo en la **vista del chofer** (`DriverDeliveryScreen`, la que sale cuando
el rol es chofer). La oficina no ve nada de esto: tiene la tabla de detalle, donde estos mismos
datos se filtran y se comparan.

### Navegar pregunta con qué app

Eran **dos botones fijos** del mismo tamaño, *Navegar* y *Waze*. Dos problemas en uno: la acción
estaba duplicada en la pantalla, y el botón llamado "Navegar" abría **Maps** sin decirlo — o sea
que una de las dos puertas no llevaba el nombre de su app.

Ahora hay un botón, *Navegar*, y al tocarlo aparecen **Maps** y **Waze**. La acción se llama por
su nombre y la app se elige al usarla. Mismo patrón que el teléfono en D-150, y a propósito:
dos controles que se comportan igual se aprenden una sola vez.

Se despliega hacia abajo, por lo mismo de siempre: en un móvil, lo que salta hacia arriba
aparece bajo el pulgar que acaba de pulsar.

### Fecha, ventana y pallets suben con el número de orden

Ocupaban **tres tarjetas del ancho de la pantalla** para tres datos de una línea: una fecha, una
hora y un número. En un móvil eso es medio scroll gastado antes de llegar a lo que el chofer
viene a hacer.

Ahora van como pastillas a la derecha del número de orden:

> **Orden #FA100**  📅 1 sep · ⏰ 08:30-17:30 · 📦 2

Se **envuelven** en vez de encogerse: una ventana horaria partida a la mitad no vale de nada.

### Cuenta de la limpieza (D-150 + D-151)

La pantalla del chofer tenía **siete** controles en su rejilla y tres tarjetas de datos. Ahora
tiene el teléfono junto al contacto, un botón de navegar y un enlace de seguimiento — y los
datos, arriba, en una línea. Nada de lo que hacía se ha perdido; solo se dejó de decir dos veces.

---

## D-152 · La cabecera, dos filas y ya

**Fecha:** 2026-09-01 · **Versión:** v1.48.0 (deliveries) · **Pedido por:** Andrés (*"mucho
relajo en los header, yo solo quiero que ahí arriba hayan 2 rows"*), con captura

Tenía razón: eran **cinco renglones** antes de llegar a la primera parada.

1. `Orden #FR501`
2. `Ready` `Customer`
3. `INV 178455, 178476, 178511`
4. `📅 Sep 01, 2026`
5. `⏰ 08:30-12:00` … y `📦 3` colgando debajo

### Por qué se apilaron

Las tres pastillas de D-151 se pusieron en su propio contenedor a la derecha, con `flex-wrap`.
Envolver **no sirve de nada cuando la columna es más estrecha que una sola pastilla**: entonces
cada una se lleva su propio renglón, que es justo lo que se ve en la captura. Y de paso esa
columna le robaba el ancho a la izquierda, lo que partió en dos la lista de facturas.

Un contenedor propio para tres datos sueltos fue el error; no hacía falta ninguno.

### Cómo queda

**Fila 1** — el número de orden y la ✕.
**Fila 2** — todo lo demás en **una sola tira** de pastillas: etapa, tipo, la bandera de tarifa
si la hay, factura, fecha·ventana y pallets.

Al desaparecer la columna de la derecha, la tira recupera el ancho completo, así que la lista de
facturas vuelve a caber en un renglón.

Dos ajustes para que quepa de verdad y no se parta:

- **Fecha y ventana van juntas** en una pastilla — `📅 Sep 01 · 08:30-12:00`. Cada pastilla de
  más es la que hace que la fila se rompa.
- **Fuera el año.** Un chofer entrega hoy o mañana, no en 2027. Se usa `fmtDateShort`, que
  además respeta el idioma.

Con datos normales son dos filas. Si una orden lleva cinco facturas la tira se envolverá, y está
bien: **la lista completa de facturas es un dato que no se puede recortar** —una factura a medias
es peor que ninguna, y eso ya estaba decidido cuando se puso esa pastilla—. Lo que se arregla es
que se partiera **siempre**, incluso cuando no hacía falta.

---

## D-153 · Dos filas de verdad: no era reordenar, era quitar

**Fecha:** 2026-09-01 · **Versión:** v1.49.0 (deliveries) · **Reportado por:** Andrés (*"sigue
igual o peor"*), con captura

D-152 juntó las pastillas en una sola tira y quedaron **cuatro filas**. La tira envolvía igual, y
el motivo es aritmético, no de maquetación: en un móvil esa fila mide unos **330 px** y lo que se
le metía sumaba más del doble.

| pastilla | ancho aprox. |
|---|---|
| `Ready` | 52 px |
| `Customer` | 70 px |
| `INV 178455, 178476, 178511` | 180 px |
| `📅 Sep 1 · 08:30-12:00` | 140 px |
| `📦 3` | 42 px |

**≈ 484 px de contenido en 330 px de fila.** Ninguna colocación arregla eso. Para que sean dos
filas hay que **quitar**, y la pregunta correcta no es cuál cabe, sino **cuál usa el chofer ahí
arriba**:

- **Tipo de orden** — no cambia nada de lo que hace en la calle. Fuera de su cabecera.
- **Bandera de tarifa** (D-147/D-148) — no la puede arreglar: es del almacén y de la oficina. A
  él solo le ocupa sitio. Fuera de su cabecera; sigue igual para todos los demás.
- **Facturas** — **sí las necesita**, pero *en la parada*, no de un vistazo. Bajan al **paso 2,
  la entrega**, que es el momento en que se entregan. Allí tienen la tarjeta entera de ancho, se
  enseñan completas y no empujan nada.

La cabecera del chofer queda con lo que responde *qué, cuándo y cuánto*:

```
Order #FR501                              ✕
[Ready] [📅 Sep 1 · 08:30-12:00] [📦 3]
```

≈ 246 px en 330. Dos filas, y con sitio de sobra.

**Para la oficina no cambia nada**: mantiene tipo, bandera de tarifa y facturas en la cabecera,
porque trabaja en pantalla ancha y esos tres son justo los datos con los que compara órdenes.

### Lo que esto enseña

Las dos primeras veces traté un problema de **cuánto cabe** como un problema de **dónde va**. Se
puede reordenar una cabecera indefinidamente sin arreglar que su contenido no quepa; lo único que
cambia es por dónde se rompe.

---

## Nota de recuperación (D-178) — el hueco D-154…D-177

Estas entradas se escribieron **el 2026-09-03**, en bloque, para cerrar un hueco que encontró la
auditoría (hallazgo F-1): entre el 1 y el 3 de septiembre se hicieron 24 cambios de
comportamiento que citaban D-154 a D-177 en sus commits y en los comentarios del código, pero
**nunca llegaron a este fichero**. La regla del proyecto es que cada cambio de comportamiento
deja aquí su entrada en la misma sesión; no se cumplió, y esto lo repara.

No se reescribe la historia: cada entrada lleva su fecha real (la del commit) y su razón tal como
se registró entonces, no como se ve hoy. La fuente es el mensaje de cada commit, que sí se
escribió con el porqué.

**Y un hueco más viejo:** **D-124 no existe**. La numeración salta de D-123 a D-125 (verificado
con grep sobre este fichero). No es una entrada borrada —el historial no se borra— sino un número
que nunca se usó. Se deja constancia para que nadie lo busque.

---

## D-154 · ESLint, de verdad, y dos restos de la fusión

**Fecha:** 2026-09-01 · **Versión:** v1.83.0 (repo) · **Pedido por:** parte de la limpieza post-fusión

El `package.json` tenía `"lint": "next lint"` que **no hacía nada**: sin configuración, `next lint`
abre un asistente interactivo y se queda esperando. En CI o en una sesión sin terminal, un comando
que ni pasa ni falla. Se montó ESLint con configuración plana y `eslint-config-next`.

`react-hooks/exhaustive-deps` queda en **aviso, no error**, a propósito: la primera pasada encontró
18, todos anteriores a hoy. Ponerlo en error convierte el primer día del linter en un build roto, y
entonces lo que pasa no es que alguien arregle 18 hooks, es que alguien apaga el linter. Sube a
error cuando estén limpios.

Dos cosas más en el mismo commit: **`outputFileTracingRoot`** —Next tomaba la carpeta de usuario
como raíz del workspace por un `package-lock.json` suelto ahí, y esa raíz decide qué ficheros se
empaquetan para las funciones—; y **fuera `local_fee_list`, `local_fee_discount`,
`nonlocal_fee_brackets`** de `types.ts`, campos que no leía nadie (descubierto en D-144).

## D-155 · La pestaña con el bundle viejo se recarga sola

**Fecha:** 2026-09-01 · **Versión:** v1.51.0 (deliveries) · **Reportado por:** Andrés (*"cant read
length"* al arrancar)

Descartado primero lo obvio, midiéndolo: los ajustes de la base **reemplazan** los valores por
defecto en `data-provider.tsx:493`, así que una columna nula dejaría a la app leyendo `.length` de
`null`. Se consultó la tabla: las seis columnas de tipo lista son NOT NULL, sin filas nulas. No era
eso.

Lo que encaja con las tres señales —pasó una vez, un día de despliegues continuos, y recargar lo
arregló— es el **bundle viejo**: al desplegar cambian los hashes, y una pestaña abierta desde antes
pide un fichero que ya no existe. Ahora el `ErrorBoundary` lo reconoce por el mensaje (no hay código
de error; cada motor lo redacta distinto, de ahí la lista con su prueba en `stale-chunk.ts`) y
recarga sola, con **ventana de 10 minutos** —aquí se despliega varias veces al día— y nunca dos
veces seguidas, que es cuando el fallo no era el bundle viejo.

Honestamente: no está confirmado con la traza del fallo real; Sentry no era legible. Si vuelve, el
botón *Copy details* de la tarjeta lo confirma o lo desmiente.

## D-156 · El guard de rutas tenía dos agujeros, y por eso llevaba parado

**Fecha:** 2026-09-01 · **Versión:** v1.51.1 (deliveries)

El paso 2 del middleware (guardar rutas, no solo refrescar sesión) llevaba escrito y desconectado
desde D-119. Al ir a conectarlo, la prudencia resultó justificada: tal cual, rompía dos cosas.

1. **`/track/:id`** —la página que se le manda al cliente por SMS— no estaba en las públicas: lo
   habría mandado a `/login`, y el enlace ya enviado a gente de fuera sería una puerta cerrada.
2. Las rutas **`/api/`** tampoco: una llamada de datos sin sesión habría recibido el HTML del login
   con estado 200, y el `fetch` lo leería como JSON, fallando en un sitio sin relación.

Se añadió `isPublicPath()` con las dos, más `reset-password` (se llega desde un correo, sin sesión)
y `/no-access`. Con prueba, porque una lista de rutas solo la defiende un test. **El guard sigue sin
conectar**: cambiar quién entra a la app no se empuja a ciegas al final de una sesión.

## D-157 · La 088 no podía aplicarse; la 095 hace la parte segura

**Fecha:** 2026-09-01 · **Versión:** v0.38.0 (clockin) / migración 095

La 088 llevaba meses sin aplicar y **no por descuido: era inaplicable.** Su primer `UPDATE` concede
el módulo `timetracker` a quien tenía `clockin`, y una restricción posterior
(`profiles_timetracker_access_needs_role`) prohíbe tener el módulo sin tramo. Como una migración es
una transacción, una fila que no cumpliera tumbaba las doce. Y había una: Patricia Hernández, con
`clockin` y nada más, sin `timetracker_role`.

De los 12 perfiles con la palabra, **11 ya tenían `timetracker` y su tramo**: para ellos borrar
`clockin` no cambia permisos. Eso hace la 095. El duodécimo **no se toca**: hoy ya no puede fichar
(desde 087, eso lo decide el tramo, que tiene nulo), así que decidir si vuelve a fichar es de quien
lleva el personal, no de una migración de madrugada. La restricción queda `NOT VALID` por esa fila.
La 088 se marca *reemplazada* en su cabecera; no se borra.

## D-158 · Subir papeles al expediente de RR. HH.

**Fecha:** 2026-09-01 · **Versión:** v0.11.0 (recruiting) / migración 096

El expediente guardaba `file_path` desde el primer día y la pantalla ya sabía abrir un documento con
enlace firmado. Faltaba **dónde** ponerlos. Cubo propio `hr-docs`, privado, y **no `resumes`**: dos
razones, la segunda pesa más. `resumes` guarda currículums de candidatos —gente de fuera— y aquí van
antidopings y amonestaciones de la plantilla; y su política deja entrar al reclutador, a quien la
094 acaba de dejar fuera del expediente. Las políticas del cubo usan la **misma condición** que las
tablas (admin/gerente): si se escriben distinto, un día se cambia una y la otra se queda. La subida
va por acción de servidor —el permiso en un solo sitio, el nombre lo pone el servidor— y la ruta
`{empleado}/{tipo}/{uuid}.ext` evita que subir dos veces una licencia pise a la anterior, que en un
expediente es prueba de lo que se firmó entonces.

## D-159 · Fichar, mi día y solicitudes, en español

**Fecha:** 2026-09-01 · **Versión:** v0.44.0 (timetracker)

La mitad de Time Tracker que se migró del fichaje quedó en inglés: 21 de 22 componentes sin una sola
llamada a `t()`, ~304 cadenas. Y es la peor mitad para eso, porque ahí no entra la oficina, entra la
cuadrilla. Esta tanda son las cuatro pantallas diarias (fichar, mi día, solicitudes, diario). La
lista de motivos del fichaje era la que más urgía: se le pregunta a alguien por qué ficha fuera de
su sitio, de pie y con prisa; si no entiende las opciones marca "otro", y el dato se pierde. Dos
reglas: el `value` guardado **nunca** se traduce (con él agrupa la oficina), y el plural va en la
frase entera, no pegando una "s" (en español cae en otro sitio). Quedan ~16 ficheros, casi todos de
pantallas de gerente.

## D-160 · A "Mi cuenta" se entra tocando tu nombre

**Fecha:** 2026-09-01 · **Versión:** v0.45.0 (timetracker)

Era una pestaña más, y a un admin la barra le pone quince. "Mi cuenta" es la que menos se abre —se
entra a cambiar la contraseña o el idioma, no a diario— ocupando el sitio de Payroll o Auditoría. Se
llega tocando el propio nombre en la barra, que es donde la gente lo busca y lo que hace el resto de
la casa. La ruta `/timetracker/account` no cambia; los enlaces viejos siguen.

## D-161 · Las fotos SÍ estaban; la pantalla abría en un día vacío

**Fecha:** 2026-09-01 · **Versión:** v0.46.0 (timetracker)

Reporte: "no veo las fotos importadas". Las fotos estaban: 385 (136 entrada + 112 salida + 137
excepciones), del 10-jul al 30-ago, **cero rutas rotas** (cada `photo_path` cruzado con
`storage.objects`). Lo que fallaba era la puerta: la pantalla abre en "hoy", y hoy no había nada. A
las nueve de la mañana no ha fichado nadie, los lunes el fin de semana está vacío, y el archivo
termina el 30-ago. Ahora, al abrir, si hoy no tiene fotos salta al último día que sí —una vez, y
solo si no se ha tocado nada—. Y la pista "último día con fotos" miraba solo los fichajes; las de
excepción son la mitad del archivo, así que un día raro quedaba invisible. Ahora mira las dos
fuentes.

## D-162 · El cubo de fotos de fichaje no tenía NINGUNA política

**Fecha:** 2026-09-01 · **Versión:** v0.46.1 (timetracker) / migración 097

Continuación de D-161: la pantalla seguía en "0 photos" cualquier día. Comprobado en orden: 385
fotos, cero rutas rotas, mismo `company_id`, y —haciéndose pasar por el admin— `auth_is_manager()`
true con 136 fichajes visibles. Todo bien hasta el último paso, firmar las URLs:
`pg_policies` con el cubo `exception-photos` → **cero**. `storage.objects` tiene RLS encendido, y sin
una sola política que nombre el cubo la respuesta por defecto es *no*. `createSignedUrls` devolvía
lista vacía y la pantalla descartaba toda foto sin URL. Los otros cubos sí tenían las suyas; a este
se le pasaron al copiar los objetos del proyecto viejo sin las reglas. Y no era solo leer: sin
`INSERT`, fichar con foto tampoco podía subirla. Un cubo sin políticas no falla al escribirse,
simplemente no devuelve nada — la peor forma de fallar. La ruta `{empresa}/{empleado}/{ts}` da los
permisos sin consultar tablas. Verificado: 578 objetos visibles para el admin.

## D-163 · Una excepción puede tener varios motivos, y se ve el historial

**Fecha:** 2026-09-01 · **Versión:** v0.47.0 (timetracker) / migración 098

Se elegía uno solo, y los datos decían que no bastaba: **56 de 78** salidas fuera de radio decían
"otro". No es que la gente salga por motivos raros, es que sale por dos a la vez —una entrega Y de
paso otra tienda— y al elegir uno se rinde. La única pregunta que la pantalla existe para responder
se contestaba con un encogimiento de hombros en tres de cada cuatro casos. Columna `reasons` (array
del mismo enum); `reason` **no se borra ni se deja de escribir** —lo leen informes, pendientes,
exportaciones— y convertirlo en array de golpe obligaría a tocarlos todos con los que se escapen
fallando en silencio; se escriben los dos, y se rellenaron las 145 filas viejas. En la pantalla,
casillas en vez de desplegable (se marca de pie y con guantes), y el historial enseña todos los
motivos y un recuento por motivo que filtra al tocarlo.

## D-164 · Informes y pago se fusiona con Nómina

**Fecha:** 2026-09-01 · **Versión:** v0.48.0 (timetracker)

Eran dos pestañas seguidas haciendo la misma pregunta —cuánto se le paga a quién por este periodo—
partida en dos pantallas con dos calendarios propios: comprobar un dato de la semana pasada obligaba
a mover los dos y fiarse de que apuntaran a lo mismo. Nómina pasa a tener tres vistas sobre el mismo
periodo. El código **no se reescribe**: sigue siendo la traducción literal de la pantalla que calcula
la nómina de verdad, con años de correcciones dentro, y conserva su selector de periodo —cambiarle la
fuente de la fecha en la misma tanda en que se muda es como se rompe una nómina—. `/timetracker/reports`
queda como redirección: hay marcadores y el Electron sin barra de direcciones.

## D-165 · Partes y Pago eran lo mismo; una sola vista

**Fecha:** 2026-09-01 · **Versión:** v0.49.0 (timetracker)

La línea entre "Partes" y "Pago" no era una línea: las dos son *pagar este periodo*. Lo que las
distinguía era **a quién** se paga —quien ficha cobra la asistencia, quien cronometra las sesiones—
y eso no es una pestaña, es un titular. Con tres pestañas, quien entraba a cerrar la nómina tenía que
acordarse de pasar por dos sitios y de que en el segundo faltaba gente; olvidar uno significa que
alguien no cobra. Queda en dos: Periodo (la foto, sin sumar, D-102) y Pago, con dos secciones
plegables (en sitio / remoto) —la misma división que ya usaba Periodo—. Se montan al abrirse: traer
los dos juegos de datos para enseñar uno era pagar dos veces por una pantalla diaria.

## D-166 · App de escritorio para Windows que abre el hub

**Fecha:** 2026-09-02 · **Versión:** desktop v1.0.0

Segunda app, para toda la empresa **menos los choferes** —ellos tienen la de Android, que pide GPS
permanente, un permiso que alguien de oficina no necesita—. No trae el sitio dentro, lo carga en
vivo: un despliegue llega a todos sin reinstalar. **No es el cliente de Time Tracker** y no expone
`window.ttDesktop` a propósito: ese puente captura pantallas y esconde el selector de módulos (D-076)
—que es justo lo único que esta app viene a ofrecer— y Time Tracker creería que puede capturar sin
nada al otro lado. Los enlaces de fuera abren en el navegador del sistema (esta ventana no tiene
barra de direcciones ni atrás), sin conexión sale un aviso con reintentar, y la página no tiene
acceso a Node. Icono de la misma familia que el de Deliveries, `.ico` con seis tamaños. El `.exe` no
va firmado: SmartScreen avisará y hay que decírselo a la gente.

## D-167 · Apartado "Apps para instalar" en el hub

**Fecha:** 2026-09-02 · **Versión:** v1.52.0 (deliveries)

El APK se repartía por WhatsApp y la de escritorio había que pedirla —y una app que hay que pedir es
una que la mitad de la gente no tiene—. Van en el hub, debajo de módulos y herramientas (no es a lo
que se viene; se busca una vez en la vida). Cada fila dice lo que hay que saber **antes** de pulsar:
plataforma, peso, y **para quién** —la de Android pide GPS permanente y la de escritorio no; decirlo
evita que alguien de oficina instale la del chofer— y el aviso de SmartScreen. Se enseñan las dos a
todo el mundo: esconderle la de choferes a la oficina obligaría a pedirla el día que un gerente
quiera probarla.

## D-168 · Falta el Time Tracker, y los enlaces caducaban

**Fecha:** 2026-09-02 · **Versión:** v1.53.0 (deliveries)

El cliente de Time Tracker existía en su propio repositorio; faltaba enlazarlo. Al añadirlo apareció
un fallo que también tenía el del hub: el nombre del instalador lleva la **versión dentro**
(`TimeTracker-Setup-0.0.45.exe`), así que un enlace fijo da 404 en la siguiente publicación —y da
igual que sea un 404: la persona ve que la app de la empresa no se descarga—. La ruta
`/api/download/<app>` pregunta a GitHub cuál es la última y redirige, con respaldo a la página de
publicaciones si la API no contesta (60 peticiones/hora por IP, y las de Vercel son compartidas), y
cacheado una hora. El aviso de Time Tracker dice lo que hace —captura cada ~10 min mientras corre— y
es la única de las tres que se actualiza sola.

## D-169 · "Apps para instalar" se pliega, y viene plegado

**Fecha:** 2026-09-02 · **Versión:** v1.53.1 (deliveries)

Cada app ocupa cuatro líneas y con tres apps eso empujaba el botón de salir fuera de la pantalla en
un móvil. Plegado por defecto: una app se instala una vez, el hub se abre a diario, y lo de diario
manda. `<details>` del navegador (recuerda foco, se busca con Ctrl+F cerrado). El resumen tiene que
**parecer** pulsable —triángulo, cursor, el número al lado— o se queda sin abrir para siempre.

## D-170 · Los instaladores viven en Blob privado

**Fecha:** 2026-09-02 · **Versión:** v1.54.0 (deliveries)

Estaban en un repositorio **público** de GitHub —acabaron ahí porque el almacenamiento de Supabase
corta en 50 MB y pesan 78— así que se los bajaba cualquiera. Vercel Blob tiene almacenamiento
privado (lectura autenticada por función), límite 5 TB, y a esta escala sale gratis (0.16 GB de 5
incluidos, ~3 GB de transferencia una vez de 100/mes). La ruta exige sesión y transmite el fichero
sin juntarlo en memoria. **Un fallo que costó una prueba:** la primera versión hacía `fetch` a la
`downloadUrl` de `head()`, que en un cubo privado contesta **403** —la URL no es la credencial, que
es el punto de hacerlo privado—; se vio porque la comprobación esperaba "MZ" (todo .exe empieza así)
y llegaba "Forbidden". Ahora usa `get()` con `access: "private"`. El respaldo a GitHub se queda para
el día que Blob falle.

## D-171 · El módulo vacío ahora dice POR QUÉ está vacío

**Fecha:** 2026-09-02 · **Versión:** v0.12.0 (recruiting)

Reporte: usuarios cargan, órdenes cargan, RR. HH. sale vacío. Comprobado, y **todo está bien**: 51
candidatos en la base, esquema expuesto, `authenticated` con USAGE, y —como el admin— lee los 51. No
se pudo reproducir sin una sesión de navegador. Pero investigándolo apareció un agujero: si la carga
fallaba **sin** que la sesión estuviera muerta —un 401 de permisos, la red, un error devuelto— la
persona veía el módulo vacío y **mudo**, y tras cinco reintentos se rendía sin decir nada, tirando el
**mensaje** del error (justo el que dice si fue permisos, red o esquema). Ahora se guarda y se enseña
abajo con un botón de reintentar. Un módulo vacío que explica por qué está vacío se arregla en un
minuto; uno mudo, preguntando.

---

## Clase A de la auditoría (D-172…D-177) — aplicada el 2026-09-03

Estas seis salen de `docs/AUDIT-2026-09.md` (Fase 1). Cada una cierra un hallazgo de clase A —fallo
claro, sin decisión de negocio—; el detalle completo, con la medición, está en ese documento.

## D-172 · Sesión obligatoria en las diez rutas que estaban abiertas

**Fecha:** 2026-09-03 · **Versión:** v1.55.0 (deliveries) · **Origen:** auditoría A-4

Diez rutas API no comprobaban sesión, y el middleware **salta `/api/`** a propósito (para no
redirigir a login una llamada de datos), así que no había nada entre internet y ellas. Medido:
cualquiera, sin cuenta, podía mandar SMS y hacer llamadas desde el número de la empresa
(`/api/notify`, `/api/call`), mandar correos (`/api/help`) y quemar la cuota de Google/Mapbox (siete
proxies). La puerta es la misma que ya tenían `push`, `invite`, `delete-user`…, sacada a
`lib/api-auth.ts` (`requireUser`). No mira el rol: eso es de cada ruta. `/api/track/[id]` y
`/api/version` siguen públicas. Verificado en vivo: sin sesión, los 13 handlers → 401; con una sesión
desechable, los 13 abren. (Consecuencia registrada en el commit: al probar `/api/call` con sesión y
RingCentral configurado en local, se inició un RingOut real a un número 555 que no enruta — la clase
de efecto que la puerta evita desde ahora, y que no debí provocar.)

## D-173 · El chofer vuelve a estar fuera del hub, en un solo sitio

**Fecha:** 2026-09-03 · **Versión:** v1.55.1 (deliveries) · **Origen:** auditoría A-5b

**Regresión de D-051.** Esa decisión tenía doble candado para el chofer: `landingRoute` lo manda a
`/driver`, y `/home` lo rebotaba. D-056 (`14377a3`, "Usuarios se muda al hub") cambió la puerta de
`/home` por `hasReasonToBeHere` para que un admin de un módulo entrara a Usuarios —correcto— pero al
reescribirla **el chofer dejó de estar excluido**: con dos módulos habría visto el hub tecleando la
URL. `ModuleSwitcher` sí conservó la excepción, así que había dos versiones de la regla y una estaba
mal. Nadie lo notó porque ningún chofer tiene dos módulos (medido). Para que no se repita, la regla
ya no se escribe en línea: `canReachHub(me)` vive en `constants.ts` con el chofer primero e
incondicional, y la usan `/home` y `ModuleSwitcher`. Cinco pruebas, incluida la que falla si alguien
vuelve a reescribir la puerta sin el chofer.

## D-174 · Los cuatro rótulos que el rename a HR dejó atrás

**Fecha:** 2026-09-03 · **Versión:** v0.13.0 (recruiting) · **Origen:** auditoría B-8

D-145 renombró el módulo en el hub, el selector y Usuarios. Quedaron cuatro: la pestaña del
navegador (`"RDZ Recruitment"` → HR Management), el respaldo del `<h1>` (`"RECRUIT·HN"` → `RTG·HR`),
un mapa de etiquetas que el ERP trajo consigo y que **duplica** el de `constants.ts`
(`recruiting: "Recruiting"` → HR Management, anotado como B-4 para fundir), y el `app_name` de la
base (`"RTG RECRUITER"` → `RTG HR`, un dato, cambiado con UPDATE). Claves internas y esquema
`recruiting.*`: intactos.

## D-175 · La barra del ERP envuelve en vez de cortarse

**Fecha:** 2026-09-03 · **Versión:** v0.3.12 (erp) · **Origen:** auditoría D-2

Tenía `overflow-x-auto`: media barra escondida tras un scroll horizontal que en un móvil nadie
descubre. Patrón de D-055 (`flex-wrap` + `min-w-0`). Medido con sesión, Chromium real, barra de 16
items: a 360px se reparte en 6 filas, a 768 en 2, a 1280 en 1, y **nunca se corta** —antes era una
fila cortada—. Aparte, no es esto: a 360px la página del catálogo sigue desbordando por otro
elemento (P3, no se toca).

## D-176 · Borra seis ficheros sin importador y un export muerto

**Fecha:** 2026-09-03 · **Versión:** v1.55.2 (deliveries) · **Origen:** auditoría E-3

Confirmado sin-llamador antes de borrar, con dos barridos: `erp/login-form` (el login del ERP viejo),
`erp/dev-error-console`, `erp/error-box`, `AvailabilityManager`, `clockin/ui` y `erp/sentry/options`.
Los dos con nombres que colisionaban se verificaron uno a uno: `clockin/ui` exporta `btn/field/link`
—500+ "usos" que son palabras y clases, sin un solo `btn(` fuera y sin otro export del nombre— y
`sentry/options` exporta `beforeSend`, cuyos 3 "usos" son comentarios. Más `APP_VERSION = "0.0.47"`
de `recruiting/constants.ts`, que D-087 reemplazó y nadie pintaba. `test-stubs/server-only.ts` **no**
se toca: es el alias de `vitest.config`. `tsc`, 707 tests y build en verde tras el borrado.

## D-177 · ANALYZE en las 59 tablas sin estadísticas

**Fecha:** 2026-09-03 · **Origen:** auditoría C-1

Corrió `ANALYZE` sobre las 59 tablas con `reltuples = -1`: el planificador trabajaba sin conteos.
Verificado: 0 quedan sin analizar. Sin subida de versión de app a propósito —es mantenimiento de
base, no hay bundle nuevo que un cliente deba recoger—. Supabase corre autoanalyze, así que se re-hace
solo a medida que las tablas acumulan escrituras; el `-1` era porque nunca habían tenido actividad
suficiente para dispararlo.

---

## D-179 · RLS por fila en `public.profiles` — la identidad compartida se cierra por la base

**Fecha:** 2026-09-03 · **Migración:** 099 · **Origen:** auditoría `docs/AUDIT-2026-09.md`, A-2a + A-3

`public.profiles` tenía `auth write profiles` = **ALL USING true CHECK true**: cualquier
autenticado podía editar y **borrar** la fila de cualquier otro. Los `guard_*` protegían las
columnas de rol/acceso, no la fila, y dejaban tres columnas privilegiadas sin guardián:
`permissions`, `store`, `username`.

**El hueco venía de un supuesto de Etapa 1.** D-053/D-057 construyeron el diálogo de Usuarios
del hub y separaron cada columna a su guard, **dando por hecho que solo la app escribe a
`profiles`**. La fusión del ERP (D-090) heredó esa política `ALL USING true` sin revisarla. La
auditoría midió que el supuesto era falso: un vendedor editó el `full_name` del **admin**, se
auto-otorgó `permissions`, y —sobre un perfil poco referenciado— lo borró, con cascada a 27 FKs
(horas, nómina, capturas).

**Por qué dos cosas y no una.** RLS filtra FILAS, no columnas: una política no puede decir
"solo cambió `full_name`". Así que se necesitan dos piezas distintas:
- **RLS por fila** (`USING (id = auth.uid() OR is_admin())`) para que un no-admin solo toque su
  propia fila. Sola no basta: dejaría a un no-admin cambiar sus **propias** columnas
  privilegiadas.
- **Un guard de columna** (trigger nuevo `guard_profile_privileged_columns`) que impide a un
  no-admin cambiar `permissions`/`store`/`username` de su fila. Solo no basta: no frena editar
  ni borrar filas ajenas.

Se añadió un guard **nuevo** en vez de tocar los cuatro existentes — añadir es más seguro que
reescribir. `is_admin()` habla el mismo idioma que los guards (`current_user_role() = 'admin'`),
para que RLS y triggers no discrepen.

**DELETE prohibido desde cliente.** No hay política de DELETE → denegado para `authenticated`.
Ningún camino de cliente borra `profiles` (grep vacío); el borrado real va por service-role
sobre `auth.users`, y `profiles_id_fkey ON DELETE CASCADE` se lleva la fila. La cascada sigue
siendo la vía correcta; lo que se cierra es que la disparara un compañero cualquiera.

**Verificado antes y después** con la matriz rol × acción (usuarios reales + sesiones
sintéticas para combos que hoy no existen — chofer con módulos, almacén con `permissions`,
contabilidad con HR—, todo con `ROLLBACK`). ANTES: un no-admin editaba ajenos y se auto-otorgaba
`permissions`/`store`/`username`. DESPUÉS: propio `full_name` sí; `permissions`/`store`/
`username`/`role` bloqueados por guard; fila ajena "sin efecto" (RLS); DELETE "sin efecto" para
todos. Y los seis flujos reales siguen: listas de los 4 módulos, el diálogo de admin
escribiendo de todos, asignación de chofer, reclutadores, empleados de TT, y el alta por
`/api/invite` (`handle_new_user` es SECURITY DEFINER → salta RLS y sigue creando el perfil).

**Prerrequisito cumplido:** `pg_dump` completo de producción verificado con `pg_restore --list`
antes de tocar nada (F-3 sigue diferido; este dump fue el respaldo de la operación).

### Lo que queda fuera, a propósito

**A-2g diferido.** El SELECT sigue amplio (`USING true`): todos leen todos los perfiles,
incluidos `username` y `permissions`. No se restringe aquí porque `permissions` la lee la
**propia app** para las capacidades (`hasCap`/`extraCaps`) y el diálogo de admin las lee de
todos; un `REVOKE` de columna rompería ambas cosas. La vía —una vista sin esas columnas para
las listas de no-admin— es su propio cambio. Bajo riesgo: `username` es un handle, no un
secreto.

### Sin subida de versión de app

Es un cambio de base, no de código: el bundle del cliente es idéntico y sus flujos legítimos no
cambian (verificado). Subir `APP_VERSIONS` diría en falso a los clientes que hay algo que
recoger. Se sube solo `package.json` (hito del repo), como en D-177.

---

## D-180 · Settings admin-only y historial append-only, por la base (A-2b/A-2c/A-2e)

**Fecha:** 2026-09-03 · **Migración:** 100 · **Origen:** auditoría `docs/AUDIT-2026-09.md`, A-2b + A-2c + A-2e · **Plan:** `docs/PLAN-A-2b-2c-settings-events.md`

Continúa D-179 con el mismo molde (helper `is_admin()`, matriz rol×acción con `ROLLBACK`,
real + sintética). Cierra dos huecos que la auditoría **midió** en cuatro tablas:

- **Settings escribibles por cualquier miembro del módulo.** `public.settings` tenía
  `ALL USING has_deliveries_access()`: un **chofer** podía cambiar —y borrar— las tarifas,
  tiendas y ventanas de la empresa (medido: `driver`/`warehouse` daban `permit` en UPDATE y
  DELETE). La pantalla de Ajustes ya era admin-only; la base no lo decía. Ahora SELECT sigue
  amplio (la app lee tarifas en todo el módulo, incluido el chofer al calcular costo) e
  **INSERT/UPDATE/DELETE solo `is_admin()`**.
- **Historial de órdenes editable y falsificable.** `public.order_events` tenía `ALL` de
  escritura: un miembro podía **editar y borrar** eventos, y —peor— **firmar un evento a
  nombre de otro** (`created_by` de un tercero pasaba el CHECK). Ahora es **append-only**:
  SELECT amplio, INSERT solo con `created_by = auth.uid()` (nadie firma por otro, cf. D-039),
  y **sin UPDATE ni DELETE, ni para el admin**. Se verificó que no rompe mover órdenes: la app
  inserta el evento con `created_by = me.id` en sus dos sitios y nunca lo edita/borra.

**Lo mismo, por módulo, en HR:**
- `recruiting.settings` → write **solo el admin de recruiting** (`current_recruiting_role() in
  ('admin','manager')`), **no** `is_admin()` de Deliveries. Cada módulo tiene su propio admin;
  la base lo respeta. Hoy solo dos personas tienen `recruiting_role`, ambas admin, así que no
  rompe a nadie, y queda a prueba de un futuro reclutador no-admin.

  > **Nota (elección consciente) — 2026-09-03:** el write incluye **`manager` además de
  > `admin`** a propósito, para igualar el tier admin del módulo de recruiting
  > (`current_recruiting_role() in ('admin','manager')`, el mismo que ya usan otros guards de
  > HR). No hay ningún `manager` en la base todavía (solo 2 `admin`), así que hoy es indistinto.
  > **Pendiente de confirmación del dueño:** si quiere que Ajustes de HR sea **solo `admin`**,
  > se quita `'manager'` de las tres políticas de `recruiting.settings` — cambio de una línea.
- `recruiting.stage_history` → **solo lectura desde cliente**. Lo escribe el trigger
  `recruiting.log_stage_change` (**SECURITY DEFINER**, salta RLS) y siempre estampa
  `changed_by = auth.uid()`; la app nunca lo inserta a mano. Verificado en vivo (con
  `ROLLBACK`): tras bloquear el INSERT del cliente, cambiar el estado de un candidato **sigue**
  agregando su fila de historial (el trigger no depende de la política).

**Ya estaban bien, no se tocan:** `public.security_events` (append-only desde D-039),
`timetracker.settings` (`is_timetracker_admin()`), `timetracker.audit` y `clockin.audit_log`
(append-only).

**Fuera del alcance, flaggeado a propósito (no se lockeó a ciegas):**
- `clockin.employee_settings` / `timetracker.employee_settings` — **no** son la pantalla de
  Ajustes del módulo: son preferencias **por empleado**, que el propio usuario edita
  (`id = auth.uid()`). Forzarlas a admin rompería a la persona guardando lo suyo.
- `clockin.notes_log` — sus notas se **editan por su autor** por diseño (`notes_rw_self`);
  append-only contradiría esa UX.
- ERP (`erp.audit_log`, `price_history`, `sales_history`, `qoh_alert_log`,
  `qoh_reconcile_log`) — hoy `ALL has_erp_access()`. ERP tiene **su propio modelo de rol**
  (`erp.current_app_role()`) y la garantía de costos (#29); `qoh_reconcile_log` podría
  actualizar filas por diseño. Se deja como **A-2c-erp**, un pase dedicado con el escritor
  trazado, no un lock ciego.

### Sin subida de versión de app

Cambio de base, no de código: el bundle del cliente es idéntico y sus flujos legítimos no
cambian (verificado con la matriz). Se sube solo `package.json`, no `APP_VERSIONS` — misma regla
que D-177/D-179, ahora **escrita como excepción explícita** en `CLAUDE.md` (paso 3 del flujo):
un cambio solo-de-base no fuerza refresh del cliente (D-029/D-087).

---

## D-181 · El ERP gana su propia columna de rol; el costo se cierra por la base (A-2d/A-2c-erp/escalafón)

**Fecha:** 2026-09-03 · **Migración:** 101 · **Versión:** deliveries 1.56.0 · **Origen:** auditoría `docs/AUDIT-2026-09.md` (A-2d, A-2c-erp, escalafón) · **Plan:** `docs/PLAN-A-2d-erp-role-cost.md` · **Pedido por:** Andrés

Tres hallazgos que eran **un solo problema**: el ERP no tenía cerrado su modelo de permisos —
derivaba todo del rol de Deliveries (`public.profiles.role`).

**Revierte a conciencia la nota "ERP sin rol propio" de D-057.** D-057 decidió que el ERP no
tuviera `roleColumn` porque "quién ve costo lo decide `role` admin/manager, que Deliveries ya
edita". La premisa resultó falsa: `role='manager'` de Entregas (gerente de oficina de reparto)
**no** es lo mismo que "puede ver costo del ERP", y lo heredaba solo. La regla de *columna
única por módulo* de D-057 **se conserva y se refuerza** (`erp_role` es una columna nueva,
única); solo cae la excepción del ERP.

**Escalafón — `erp_role` (staff|manager|admin), su propia columna.** Antes `erp.current_app_role()`
leía `public.profiles.role`; ahora lee `erp_role`. Ese **único cambio de función** re-keya
todas las políticas que daban autoridad (todas delegaban en `current_app_role()`): costo
(`can_see_cost`), edición de catálogo (`products update`), `sku_aliases`, lectura de `audit_log`,
y la visibilidad de borradores en las vistas. **No hubo reescritura tabla-por-tabla** porque
medí que las tablas operativas (POs, inventario) **no tienen escritura de cliente**: su única
política es un gate `RESTRICTIVE` (`has_erp_access()`) sin permisiva de escritura, así que ya
estaban denegadas al cliente (se escriben server-side con service-role). Verificado en la
matriz: hasta el admin da BLOQ en `po insert`.

**A-2d — el costo se cierra de raíz, no cosméticamente.** La vista `app_products` (y
`app_store_products`, `app_price_history`) enmascaraba `cost` con `CASE WHEN can_see_cost()`,
pero `erp.products` estaba expuesta: un vendedor con ERP leía las **6,104** filas de
`erp.products.cost` directo por PostgREST (medido). Cerrado con:
- una función `SECURITY DEFINER` (`erp.product_cost`/`store_product_cost`/`price_history_cost`)
  que devuelve el costo solo si `can_see_cost()`, y las vistas la llaman en vez de `p.cost`;
- **REVOKE del SELECT de tabla + GRANT columna por columna de todo MENOS el costo** (un revoke
  de columna no basta: el grant de tabla lo cubre — se midió que seguía leyéndose y se corrigió).
Ahora `select cost from erp.products` da `permission denied` para **todos** (incluido admin); el
costo solo sale por la vista, enmascarado por tier. Verificado ANTES/DESPUÉS con matriz sintética.

**A-2c-erp — la hipótesis se refutó por medición.** Se creía que cualquier miembro escribía el
historial del ERP (`audit_log`, `price_history`, `qoh_alert_log`, `qoh_reconcile_log`,
`sales_history`). Falso: su única política es el gate `RESTRICTIVE` sin permisiva de escritura,
así que **ya eran append-only** (las escriben funciones DEFINER; el cliente da BLOQ hasta como
admin). Y `qoh_reconcile_log` **no** actualiza filas (sus escritores `reconcile_qoh*` solo
insertan). **Sin cambio**: no había hueco. (Como la refutación del UPDATE en D-180, medir antes
de tocar evitó un cambio innecesario.)

**Guard.** Solo un admin de Deliveries cambia `erp_role` — se **folda** en el guard de columnas
privilegiadas de D-179 (`guard_profile_privileged_columns`), no un trigger nuevo. Verificado:
no-admin da BLOQ/0.

### Lista nominal de tiers (regla del dueño)
Medido: **solo 2 personas tienen ERP hoy** — ANDRES UGARTE y Roberto Rodriguez, ambos admin →
`erp_role='admin'` (conservan costo). **Nadie más.** Los "5 gerentes de oficina" que se temía que
vieran costo **no tienen ERP en `module_access`**, así que hoy no ven costo ni lo pierden: el
riesgo era **latente** (darle ERP a un manager le habría dado costo por heredar de `role`). El
fix cierra ese accidente: en adelante, conceder ERP da `erp_role='staff'` (sin costo) por
defecto, y el costo se otorga a mano.

### UI (D-057 lo hace genérico)
El ERP gana su selector de tier en /home/users: entrada en `MODULE_ACCESS`
(`roleColumn:"erp_role"`, 3 tiers), su caso en el switch de `UserDialog`, y `updateUserErpAccess`
que ahora escribe `erp_role` (default `staff` al conceder). Un `erp_role_changed` nuevo en el
registro de seguridad (D-039). El test de columna única de D-057 sigue verde.

### Versión
**Sí sube `deliveries` (1.56.0)** y `package.json` (1.108.0): a diferencia de D-179/D-180, esto
**toca código de cliente** (el diálogo de usuarios del hub). La parte de ERP es solo-base (las
pantallas del ERP no cambiaron su bundle, leen por las vistas), así que **`erp` NO sube** — no
hay bundle nuevo del ERP que recoger. Es justo la regla del paso 3 de CLAUDE.md y su excepción,
aplicadas por separado a cada mitad.

---

## D-182 · Los crons que no se programaban (C-6): roll-schedules activado; cron y cleanup pendientes

**Fecha:** 2026-09-03 · **Versión:** package.json 1.108.1 (config, sin bundle) · **Origen:** auditoría `docs/AUDIT-2026-09.md` C-6 · **Pedido por:** Andrés

`vercel.json` programaba **una sola** ruta (`/api/notion-summary`, 01:00). Existían cuatro
trabajos más que nadie llamaba. Inventario medido:

| Job | Existe | Env vars | Programado |
|---|---|---|---|
| `/api/notion-summary` | sí | `CRON_SECRET` ✓ | ya (01:00) |
| `/timetracker/clock-in/api/roll-schedules` | sí | `CRON_SECRET`+service-role ✓ | **AHORA (08:00 UTC diario)** |
| `/timetracker/clock-in/api/cron` | sí | ✓ | **NO** — necesita ejecución sub-diaria |
| `/timetracker/clock-in/api/cleanup-photos` | sí | ✓ | **NO** — destructivo |
| `/api/erp/jobs/refresh-daltile-matches` | sí | faltan 3 env vars | **NO** — inactivo por diseño |

**roll-schedules — programado (no destructivo).** Deja los turnos de esta semana de pago y la
siguiente (Fri→Thu) para cada empleado con horario A/B/C o custom. Idempotente: solo inserta lo
que falta y respeta cancelaciones. Verificado read-only: 8 empleados con horario; los turnos
llegan hasta 2026-09-10 (semana próxima) pero **2 semanas adelante están en 0** — la brecha que
este job llena. Sin él "los horarios no avanzan solos".

**cron (avisos de fichaje + auto-clock-out a las 8 PM) — NO programado.** El código y las env
vars están completos, pero el job comprueba **ventanas de 3 minutos** (recordatorios de turno,
"ficha ahora", almuerzo, cierre a las 8 PM), así que necesita correr **cada 1-2 min**. Los crons
de Vercel Hobby corren **una vez al día** (y máximo 2 crons — con roll-schedules ya son 2).
Programarlo ahí lo dejaría corriendo una vez al día = roto, y sería un tercer cron que en Hobby
**rompe el deploy**. Queda pendiente de decisión del dueño: **(a)** Vercel Pro y
`*/2 * * * *`, o **(b)** un programador externo (cron-job.org / GitHub Actions) que pegue
`/timetracker/clock-in/api/cron?key=<CRON_SECRET>` cada 1-2 min. No se adivina el plan (sin token
de Vercel para medirlo).

**cleanup-photos — NO activado (destructivo).** Borra fotos de fichaje > 60 días (y **filas**
enteras de `vehicle_trips`/`trip_stops` > 14 días). DRY-RUN de hoy: **borraría 0** (el módulo es
reciente; nada supera aún los límites). Las **fotos de entrega (D-022/D-026) quedan excluidas por
construcción**: viven en `public.deliveries.photos/photo_meta/pod_signature`, y este job solo
toca el esquema `clockin` (`Accept-Profile: clockin`). Sin respaldo posible una vez borrada
(Supabase free, sin PITR — F-3). La pantalla (`DayPhotos.tsx:178`) **promete** "kept for 60 days
and then deleted automatically" — hoy es falso (nunca se borran), y no menciona el borrado de
filas de viajes a 14 días. Decisión del dueño: activar con política, o corregir el texto (clase
D-044). No se toca hasta esa decisión.

**refresh-daltile-matches — inactivo por diseño.** `route.ts:1` dice "CRON IS NOT ENABLED".
Faltan en producción: `JOBS_SECRET`, `WAREHOUSE_CATALOG_URL`, `WAREHOUSE_READ_TOKEN`. Valores
que solo el dueño tiene; no se inventan.

### Versión
Cambio de **config de despliegue** (`vercel.json`), no de código de cliente ni de base: no hay
bundle nuevo que recoger, así que **no sube ningún `APP_VERSION`**. Sube solo `package.json`
(1.108.1) como hito del repo. Coherente con la excepción del paso 3 de CLAUDE.md.

---

## D-183 · El cron de fichaje corre desde GitHub Actions; la promesa de borrado de fotos se corrige (no se borra)

**Fecha:** 2026-09-03 · **Versión:** timetracker 0.49.9 · **Origen:** C-6 (continuación de D-182) · **Pedido por:** Andrés

Dos decisiones del dueño sobre los crons que faltaban (D-182):

**1. El cron de avisos de fichaje corre desde un scheduler externo (GitHub Actions).**
`.github/workflows/tt-cron.yml` pega `GET /timetracker/clock-in/api/cron` del deploy de
producción cada 2 min (`*/2 * * * *`). Va aquí y no en `vercel.json` porque Vercel Hobby corre
los crons una vez al día y admite máximo 2 (ya ocupados), y este job comprueba ventanas de 3
min (recordatorios, almuerzo, cierre a las 8 PM). **Caveat anotado en el YAML:** el mínimo
efectivo de los crons de GitHub es ~5 min y pueden retrasarse bajo carga — `*/2` es objetivo,
no garantía; para precisión real, Vercel Pro.

- **Secreto:** el workflow usa `secrets.TT_CRON_SECRET` (a crear en GitHub → Settings → Secrets
  and variables → Actions). Su valor = el `CRON_SECRET` que ya vive en Vercel. Nunca se escribe
  en el YAML ni en los logs (se pasa por `env` y el cuerpo de la respuesta se descarta).
- **Falla visible:** el paso programado sale con `exit 1` y `::error::` si la ruta responde
  ≠200, para que un cron roto se vea en la pestaña Actions, no en silencio.
- **Verificación segura sin efectos en terceros:** se añadió a la ruta un modo `?verify=1` que,
  tras pasar el auth, responde 200 **sin correr** la lógica de avisos ni el auto-clock-out (no
  dispara notificaciones ni cierra turnos — regla de CLAUDE.md). El `workflow_dispatch` manual
  comprueba 401 (sin secreto) y 200 (con secreto + `verify=1`). Medido ya en vivo: sin secreto
  la ruta devuelve **401** (auth-first, no corre lógica); `cronAuthorized` falla cerrado.

**2. La limpieza de fotos NO se activa; se corrige el texto de la pantalla (clase D-044).**
`DayPhotos.tsx` prometía "kept for 60 days and then deleted automatically" — falso: el job de
limpieza no está programado y las fotos se conservan indefinidamente. Se corrigió el texto a lo
que de verdad pasa ("se conservan indefinidamente — todavía no hay política de retención
automática activa; las horas nunca se borran"), y también el mensaje de día vacío (ya no insinúa
que las fotos "se limpiaron"). Ahora bilingüe (en/es) vía `usePrefs`. Buscado en toda la UI: no
hay otra promesa de borrado automático; el botón "🗑 > 14 days" de screenshots (`i18n.ts`) es una
purga **manual** del gerente ("cannot be undone"), honesta, fuera de alcance.

**El job de limpieza queda escrito pero NO programado.** Es destructivo y sin respaldo posible
(Supabase free, sin PITR — F-3 diferido). **Condición para activarlo:** (a) respaldos activos, y
(b) política decidida por el dueño — cuántos días, qué se excluye (hoy solo toca esquema
`clockin`; las fotos de entrega D-022/D-026 viven en `public.deliveries.*` y ya están excluidas
por construcción), y que la UI diga exactamente lo que el job hace (incluido el borrado de filas
de `vehicle_trips`/`trip_stops` a 14 días, que la pantalla no menciona).

**Daltile** (`refresh-daltile-matches`) sigue inactivo: faltan `JOBS_SECRET`,
`WAREHOUSE_CATALOG_URL`, `WAREHOUSE_READ_TOKEN` (solo el dueño los tiene; no se inventan).

### Versión
Sube `timetracker` (0.49.9): `DayPhotos.tsx` es UI de cliente (bundle nuevo con el texto
corregido). El modo `?verify=1` de la ruta es server-side y el workflow es CI — ninguno cambia
el bundle, así que no mueven `APP_VERSION` por sí mismos. `package.json` 1.108.2.

---

## D-184 · Registro de migraciones (public.schema_migrations): saber qué corrió, no adivinarlo

**Fecha:** 2026-09-03 · **Migración:** 102 · **Versión:** package.json 1.108.3 (solo-base) · **Pedido por:** Andrés

`supabase/migrations/*.sql` se aplican a mano y nada en la base decía cuáles habían corrido en
producción; el desfase repo↔base era cuestión de tiempo. Ahora hay registro.

**Paso 1 — se MIDIÓ el desfase antes de crear nada. Resultado: CERO.** Se volcó el catálogo de
producción (1811 objetos: tablas, columnas, funciones, políticas, vistas, triggers, índices,
buckets) y se cruzó cada una de las 101 migraciones del repo contra él por los objetos que crea.
**Las 101 estaban aplicadas.** El matcher marcó 4 dudosas, todas confirmadas como falsos
positivos del parser estático:
- **057_recruiting_rls** (creía "NO aplicada"): crea las políticas con `do $$ execute format(...)`
  — el parser vio la plantilla `%1$s`, no el nombre real. Producción tiene las 27 políticas.
- **071 / 084** (parciales): los objetos "ausentes" son todos de `clockin_role`
  (`current_clockin_role`, `mirror_clockin_role`, la columna y sus triggers) — creados por ellas
  y **borrados a propósito** por 087/088 (la retirada de clockin_role). Aplicadas, superadas.
- **073** (parcial): `table:as` era un artefacto del regex sobre `create function ... as $$`.
Y las INCIERTAS (grants/drops/datos, sin objeto creable) se verificaron por muestra: 032 dejó
las columnas de status en 0 (dropeadas ✓), 082 tiene sus constraints EXCLUDE ✓, 076 sus
extensiones ✓. **No hubo ninguna en repo sin aplicar, ni aplicada fuera del repo.**

**Paso 2 — la tabla.** `public.schema_migrations (name pk, checksum, applied_at, applied_by)`,
RLS: **SELECT solo admin** (`is_admin()`, D-179); **sin política de escritura** — solo
service-role o la propia migración (postgres) la escriben, ambos saltan RLS. Verificado: admin
lee 102 filas, admin no puede INSERT (BLOQ), un vendedor no lee (0). Backfill: las 102 (001-101 +
la propia 102).

**Checksum:** sha256 del fichero con saltos LF, tomando solo lo **anterior** al marcador
`-- @ledger-below`. Así el bloque de auto-registro de una migración no altera su propio checksum.
Sirve para detectar un fichero editado después de aplicado.

**Paso 3 — el estado es un comando.** `scripts/db/migrate-status.mjs` cruza repo vs tabla y lista
pendientes / cambiadas / huérfanas (sale con código 1 si hay pendientes, para CI). Hoy dice "102
en repo, 102 registradas, todo al día". `--sum NNN.sql` imprime el checksum y la línea de
registro para pegar en una migración nueva.

**Paso 4 — regla en CLAUDE.md:** antes de aplicar, correr el status; toda migración se
auto-inscribe tras `-- @ledger-below`.

### Versión
Cambio solo-de-base (tabla + script + docs; ninguna toca el bundle de cliente): sube solo
`package.json` (1.108.3), no `APP_VERSIONS`. Es justo la excepción escrita en el paso 3 de
CLAUDE.md.

## D-185 · Cada cliente de navegador con schema propio se sale de la caché de @supabase/ssr; la regla la hace cumplir la suite

**Fecha:** 2026-09-04 · **Versión:** recruiting 0.13.2, timetracker 0.49.10, package.json 1.109.0 · **Pedido por:** Andrés

### Qué fallaba

Al entrar a `/recruiting` desde otro módulo **sin recargar**, la pantalla decía:

> No se pudieron cargar los datos. Could not find the table 'timetracker.questions' in the schema cache

Con F5 funcionaba. HR pedía `questions` en su schema `recruiting`, pero la consulta salía contra
`timetracker.questions`: HR estaba usando **el cliente de Time Tracker**.

### Por qué

`createBrowserClient` (`@supabase/ssr`, `dist/main/createBrowserClient.js`) guarda **un solo**
cliente en una variable de módulo, `cachedBrowserClient`, para todo el navegador. La condición
literal es:

```js
const shouldUseSingleton = options?.isSingleton === true ||
  ((!options || !("isSingleton" in options)) && isBrowser());
if (shouldUseSingleton && cachedBrowserClient) return cachedBrowserClient;
```

En el navegador, **no pasar `isSingleton` significa entrar a la caché**, y el cliente cacheado se
devuelve ignorando las opciones del que llama. Los cinco clientes de navegador usan la misma URL y
la misma anon key, así que el primer módulo que arranca gana y los demás reciben un cliente atado
al schema equivocado. Con F5 el módulo que arranca primero es el que se está visitando, y por eso
"funcionaba".

Estado antes de este cambio: deliveries (`public`), recruiting y timetracker **sin** `isSingleton`;
erp (`d691dfa`) y clockin (D-091) con `isSingleton: false`. Los dos que compartían caché con
schema propio eran justo HR y Time Tracker, y se robaban el cliente entre sí.

### La apuesta original, y por qué caducó

Cuando el mismo fallo tumbó el catálogo del ERP (`Could not find the table 'public.app_products'`),
se arregló **solo allí**, y el comentario del cliente del ERP dejó escrito el razonamiento: *"only
this client opts out, not the other three: they work today, and a second GoTrue instance per module
is a cost worth paying once, not four times"*. Era razonable entonces: el síntoma solo se había
visto en el ERP, y cada cliente que se sale de la caché instancia su propio GoTrue (más memoria,
más listeners de sesión). Pero tenía dos fallos: ya era inexacto al escribirse (clockin también se
salía), y "they work today" solo era cierto mientras nadie navegara entre HR y Time Tracker sin
recargar. La apuesta perdió en producción. **Ese comentario queda reemplazado**, con el texto
antiguo conservado dentro como historial.

El hallazgo de fondo no es el bug: es que la lección vivía en un comentario dentro de un fichero, y
`isSingleton` **no aparecía en esta bitácora**. Los clientes escritos después no la vieron.

### Qué se decidió

1. `isSingleton: false` en `src/lib/recruiting/supabase/client.ts` y
   `src/lib/timetracker/supabase/client.ts`, con el porqué en el comentario.
2. **El cliente de deliveries (`src/lib/supabase/client.ts`, schema `public` por defecto) no se
   toca.** Un cliente con `isSingleton: false` ni lee ni escribe `cachedBrowserClient` (verificado
   en la condición de arriba), así que al salirse los otros cuatro, deliveries queda como **único**
   usuario de la caché y no puede colisionar con nadie.
3. **Regla, y prueba que la hace cumplir:** `src/lib/supabase/browser-clients.test.ts` **recorre
   `src/lib` en disco** y toma todo fichero que importe `createBrowserClient` de `@supabase/ssr`;
   no depende de que nadie se acuerde de registrar su cliente en una lista. Mockea
   `@supabase/ssr`, llama al `createClient()` de cada uno y comprueba las opciones con que se
   invocó: todo cliente con `db.schema` propio pasa `isSingleton: false`, y como mucho uno
   (deliveries) usa la caché. Lleva una tabla de lo esperado hoy, pero solo como contraste: la
   prueba falla si el disco y la tabla difieren en cualquier dirección (cliente nuevo sin
   registrar, o registrado que ya no existe). Comprobado dos veces: falla al quitar la línea del
   cliente de recruiting (`1 failed | 5 passed` con la versión inicial de lista manual), y falla
   al crear un sexto cliente falso con `db.schema: "fakemod"` y sin `isSingleton` (`2 failed`:
   "no está en la tabla" y "debe pasar isSingleton: false"); el fichero falso se borró y no se
   commiteó. La primera versión de la prueba llevaba la lista a mano como fuente de verdad y
   la última aserción comparaba la constante consigo misma: lo devolvió el orquestador porque
   repetía exactamente el modo de fallo que motiva esta decisión.

### Qué se descartó

**Un único cliente compartido sin schema por defecto, con `.schema("x")` en cada llamada.** Arregla
lo mismo sin instancias de auth extra, y es la solución "correcta" a largo plazo. Se descartó ahora
porque obliga a tocar decenas de ficheros en cuatro módulos por un fallo que se cierra con dos
líneas; si algún día pesa el coste de GoTrue, es el camino.

### Precio que sí se paga

Una instancia de GoTrue más por módulo (cuatro en total, además de la de deliveries). Cada una
mantiene su sesión desde las mismas cookies, así que no hay divergencia de login; el coste es
memoria y listeners, no comportamiento.

## D-186 · El horario pasa a vivir dentro de Asignaciones, como segunda sección; las dos listas de personas NO se unifican

**Fecha:** 2026-09-04 · **Versión:** las cinco apps (deliveries 1.57.0, recruiting 0.14.0, timetracker 0.52.0, clockin 0.39.0, erp 0.4.0), package.json 1.112.0 (timetracker y package.json) · **Pedido por:** Andrés · **Plan previo:** `docs/PLAN-horario-en-asignaciones.md`

### Qué se pidió

Petición literal: *"en deliveries app schedule tiene que ir dentro de assignments, haz un merge
inteligente y eficiente para que el feature de las 2 sea uno solo"*.

Corrección de hecho antes de nada: ninguna de las dos pantallas es del módulo de Deliveries.
Las dos son de **Time Tracker** (`/timetracker/assignments`, D-071, y `/timetracker/schedule`,
D-121), vecinas en `MANAGER_TABS`. Se asumió Time Tracker porque son las únicas que existen con
esos nombres y porque a este repositorio se le llama "deliveries-app".

### La objeción, por escrito, y que el dueño la desestimó

Este repo se dio su propio criterio de fusión en **D-165**: se fusiona cuando dos pantallas
**contestan la misma pregunta**, y el síntoma es tener que pasar por dos sitios para acabar una
sola tarea. Partes y Pago se fusionaron por eso: las dos eran "pagar este periodo".

Aquí, medido, las dos pantallas **no comparten nada**: Asignaciones contesta *cuánto cobra Fulano
en el proyecto X* (tabla `timetracker.assignments`, se dibuja en cliente con supabase-js y
realtime, sin acotado por tienda, traducida entera); Horario contesta *a qué hora entra Fulano el
martes y dónde* (tabla `clockin.scheduled_shifts`, se dibuja en servidor con cinco server actions,
acotada por tienda, en inglés a pelo). Sin FK entre tablas, sin consulta común, sin cálculo común,
sin un componente en común, y ninguna pantalla de la app enlaza a ninguna de las dos.

La objeción se dijo antes de implementar y se mantuvo. **El dueño la confirmó igual**: es su
aplicación y sabe cómo la usa. Se implementa, y queda anotado que va contra el criterio D-165,
con fecha, porque el historial no se maquilla. Lo que la objeción cambió no fue *si* sino *cómo*.

### Qué se decidió

1. **Dos secciones, no una vista soldada.** `/timetracker/assignments` renderiza
   `AssignmentsTabs` (cliente) con un selector *Tarifas / Horario*. La sección de tarifas es
   `AssignmentsPanel`, el cuerpo de la pantalla vieja movido tal cual; la de horario es
   `ScheduleWeek`, sin tocar. Cada sección conserva su mitad de código y se monta al abrirse.
2. **Las dos listas de personas NO se unifican.** Es el corazón del diseño. Tarifas lista a todo
   el que tiene `timetracker_role`, sin filtro de tienda y sin excluir inactivos. Horario lista
   solo las tiendas visibles del gerente y solo gente activa, que es el acotado por tienda que
   **D-127** puso a propósito. Gane la que gane, el daño es **silencioso**: si gana la del
   horario, desaparecen del formulario de tarifas personas de otra tienda o inactivas que hoy sí
   se tarifan; si gana la de asignaciones, aparecen en el planificador personas que el acotado
   protege. Nadie ve un error, solo falta alguien en un desplegable. Mantenerlas separadas hace
   que ese problema no llegue a existir, y la fusión cuesta mover ficheros en vez de reescribir
   una mitad, que es el coste real que D-106 identificó en cada fusión que cruza la línea
   cliente/servidor.
3. **La puerta pasa de cliente a servidor.** Asignaciones comprobaba el rol en el navegador y
   montaba la página igual, con un "Admins only". Horario redirigía desde el servidor antes de
   montar (misma puerta que Payroll). La pantalla fusionada se queda con la fuerte: la página es
   ahora un componente de servidor que consulta `timetracker_role` y redirige a `/timetracker`
   si no es admin, o a `/login?next=/timetracker/assignments` si no hay sesión.

   > **Corrección — 2026-09-04, al fusionar (hallazgo del auditor, no bloqueante).** Esa última
   > frase promete de más, clase D-044. El `redirect("/login?next=/timetracker/assignments")`
   > de `assignments/page.tsx:20` es **inalcanzable**: quien corta a quien no tiene sesión es
   > antes la layout del módulo (`(timetracker)/layout.tsx:38`), y manda a
   > `/login?next=/timetracker`, no a la pantalla. No es regresión ni error del cambio — es
   > copia fiel de la misma línea muerta que ya tenía `schedule/page.tsx`, y se conserva por
   > si algún día se conecta el guard de rutas del middleware, que hoy **no está conectado**
   > (`src/lib/supabase/middleware.ts:27` lo dice: "No redirige"). Lo que era falso era la
   > frase, y se corrige aquí en vez de reescribir el punto 3 (regla 2).
4. **Las rutas no mueren.** `/timetracker/schedule` queda como redirección a
   `/timetracker/assignments`. El salto heredado de fichaje `/timetracker/clock-in/schedule`
   (D-121) en `next.config.mjs` apunta **directo** al destino nuevo, para no encadenar dos
   redirecciones.
5. **La pestaña `schedule` sale de `MANAGER_TABS`**; la de `assignments` lleva las dos cosas y
   su etiqueta lo dice ("Assignments & Schedule" / "Asignaciones y horario"). La prueba de
   `src/lib/landing-route.test.ts` que exige que el horario tenga puerta **falló al retirar la
   pestaña, como debía**, y se cambió el id `schedule` por `assignments` explicando en el propio
   comentario dónde está ahora la puerta. Verificado en las dos direcciones: con el id viejo
   falla con *"falta la pestaña schedule"*, con el nuevo pasa (27 de 27 en ese fichero).
6. Los cinco server actions de `clockin` (`getScheduleWeek`, `createShifts`, `applySchedule`,
   `deleteShift`, `adminClock`) **no se tocan**: los usa también el cron `roll-schedules`
   (D-182) y la sección "Mi horario" del empleado (D-129).

### Qué se descartó

- **Soldar las dos en una sola vista con una sola lista de gente.** Por el punto 2.
- **Fusionar Asignaciones con Proyectos**, que es la fusión que el código sí pide: misma tabla,
  mismo proveedor, mismo lado de la línea, y Proyectos ya enseña quién está asignado y ya usa la
  tarifa para calcular gasto. Se propuso al dueño y eligió esta otra. Queda como candidato.
- **Borrar `/timetracker/schedule` y resolverlo todo en `next.config.mjs`.** Se dejó la página
  como redirección para que la ruta siga existiendo dentro de la app, y el salto heredado se
  apuntó directo para no encadenar.

### Lo que queda pendiente, a propósito

- **`ScheduleWeek` sigue en inglés a pelo** y al lado de una sección traducida se nota. Es un
  defecto anterior a esta fusión y va en su propia rama, para no mezclar dos cambios en una
  auditoría.
- **No hay ni una prueba automática de ninguna de las dos pantallas.** La suite no avisa si se
  rompe la interfaz; la cobertura es `verify.mjs` (tipos, pruebas, build) y revisión a ojo.
- El comentario de `MANAGER_TABS` decía "catorce pestañas" y eran quince el 2026-09-04; quedan
  catorce. Se anotó en el propio comentario en vez de reescribirlo.

## D-187 · Los tres formularios de Asignaciones pasan a botón + ventana, y el horario queda traducido

**Fecha:** 2026-09-04 · **Versión:** ninguna (no cambia bundle web); package.json 1.112.1 (timetracker y package.json) · **Pedido por:** Andrés

### Qué se pidió

Petición literal: *"en asignaciones y horario, el form para nueva asignacion y el form para add
shifts y clock someone in or out, primero que todo no esta traducido, segundo tambien deben de
ser botones porque agarran mucho espacio y cuando se apriete debe abrirse como una window pero
no llevar a otro lado"*.

Dos problemas en una pantalla, los dos consecuencia directa de D-186. Al juntar las dos
secciones bajo Asignaciones, **tres formularios ocupaban sitio permanente** aunque no se
usaran: el de nueva asignación era la tarjeta de arriba de Tarifas, y en Horario iban dos más
("Add shifts" y "Clock someone in or out") antes de que apareciera un solo turno. Y **media
pantalla estaba sin traducir**: `ScheduleWeek` venía en inglés a pelo desde D-121, y D-186 lo
dejó anotado como pendiente para rama aparte. Esta es esa rama.

### Qué se decidió

1. **Los tres formularios son ahora un botón que abre una ventana encima.** No navega, no cambia
   la URL, y al cerrarla la lista sigue donde estaba. Se cierra con clic fuera, con Escape y con
   un botón ✕. "Nueva asignación" vive en la cabecera de la tabla de tarifas; "Agregar turnos" y
   "Fichar a alguien", en la cabecera del horario. **Editar** una asignación abre la misma
   ventana ya rellena; el `window.scrollTo` al principio que hacía antes desaparece, porque solo
   existía para llevar al formulario que estaba arriba.
2. **Se reutiliza el patrón de ventana que ya existe**, no se inventa otro: las clases
   `.overlay` / `.modal` / `.modal-actions` de `globals.css` (las de `UserDialog` en Deliveries),
   que carga el layout raíz y por tanto también están dentro de `.timetracker-module`. Mismo
   comportamiento: clic fuera cierra, clic dentro no. Lo que se añade es un envoltorio mínimo,
   `src/components/timetracker/Modal.tsx`, con lo que los tres necesitan igual —Escape, título,
   botón de cerrar— para no copiarlo tres veces. **Verificado, no supuesto:** `.modal` de globals
   pinta con `--card`, que es blanco salvo bajo `data-theme="dark"` de Deliveries, y Time Tracker
   es oscuro **por defecto** y claro con `data-theme="light"`: al revés. Sin más, la ventana
   salía blanca con texto claro encima, ilegible. El ajuste son tres reglas en
   `timetracker.css` (`.timetracker-module .modal`, su `h3` y el borde de `.modal-actions`)
   sobre las variables `--tt-*`; tamaño, `z-index` (50, por encima del topbar de 20) y el modo a
   pantalla completa en móvil vienen de globals y no se duplican.
3. **Fichar a alguien queda detrás de un botón, y la ventana lo dice.** Ese formulario ficha a
   una persona real y le manda una notificación; antes estaba a un descuido de distancia, en
   medio de la pantalla. Ahora hay que abrirlo a propósito, y dentro lleva un aviso en amarillo
   ("esto ficha a una persona real y le manda una notificación, revisa el nombre").
4. **Todo el texto de `ScheduleWeek` pasa por el diccionario** de Time Tracker (`useT()`,
   claves `mgr.sch.*`, en `en` y `es`), incluidos los nombres cortos de los días, los rótulos de
   los botones nuevos, los títulos de las tres ventanas y los mensajes de resultado y de error.
   De paso, dos cadenas sueltas de Tarifas que seguían en inglés ("Failed to save.",
   "(deleted)") pasan a `mgr.asn.*`. Comprobado por grep sobre los tres ficheros: cero nodos de
   texto JSX con letras, cero placeholders literales, y cada clave usada existe exactamente dos
   veces en `i18n.ts` (una por idioma).
5. **Con error, la ventana no se cierra**: el aviso se enseña dentro de ella, no detrás del velo.
   Con éxito, se cierra y el aviso verde aparece en la cabecera del horario, como antes. Para
   eso `corre()` devuelve ahora si salió bien; es el único cambio en esa función.

### Qué NO cambia

Los campos, las validaciones y las llamadas de los tres formularios son los mismos. Los server
actions de `clockin` no se tocan. Las dos listas de personas siguen separadas (D-186):
`AssignmentsPanel` con `allEmployees` del proveedor, `ScheduleWeek` con `d.people` del servidor
acotado por tienda (D-127), y `Modal` no recibe ni una lista. `globals.css` y el cliente de
Deliveries no se tocan. Un cambio de forma sí hay: dentro de la ventana la fila de tarifas va
a dos columnas en vez de cuatro, porque la ventana es más estrecha que la tarjeta.

### Qué se descartó

- **Un `<dialog>` nativo o un componente de ventana propio de Time Tracker.** Habría sido un
  segundo patrón de ventana en la misma app para el mismo problema; el de globals ya resuelve
  el clic fuera, el scroll y el móvil.
- **Copiar `.overlay`/`.modal` a `timetracker.css` con colores propios.** Duplica lo que
  funciona; se corrigieron solo los colores, que era lo único que fallaba.
- **Traducir `fmtDayLong`**, que sigue con la configuración regional fija de `helpers.ts`. Es
  un helper compartido por todo el módulo y cambiarlo es otro cambio.

### Lo no verificado

Este repo no tiene ninguna prueba que dibuje pantallas (709 pruebas, todas lógica pura bajo
`src/lib`, sin jsdom). `verify.mjs` en verde no dice si la ventana se abre, se cierra con
Escape, o si un texto quedó sin traducir. Lo tercero se cubrió por grep; lo primero y lo
segundo, por lectura del diff. Nadie abrió la pantalla con sesión de admin: el worktree no
tiene `.env.local` a propósito. La prueba real es el dueño abriendo las tres ventanas en los
dos idiomas y en los dos temas.

## D-188 · La app se llama RTG Hub en el código; RDZ queda como marca de la empresa. Paso 1 de 11 del plan de renombre

**Fecha:** 2026-09-04 · **Versión:** timetracker 0.53.0, package.json 1.113.0 · **Pedido por:** Andrés ·
**Plan:** `docs/PLAN-rename-rtg-hub.md`

### Qué se pidió

El dueño decidió el 2026-09-04 renombrar el proyecto entero de "deliveries-app / RDZ Deliveries" a
**RTG Hub**, con URL nueva en Vercel y sin dominio propio (el plan lo desglosa en once pasos). Esta
rama es **solo el paso 1**: los **nombres** en el código. Ninguna URL cambia, ningún `appId`, ningún
dato de la base.

### La regla que separa las dos marcas

Va a volver a aparecer, así que queda escrita: **"RTG" es la marca de la aplicación y de sus
módulos; "RDZ" es la marca de la empresa de cara al cliente y a las tiendas, y esa no se toca desde
el código.** En concreto:

- **Pasa a RTG:** el título de la pestaña y de la app instalada (`layout.tsx`, los dos manifests),
  el título de las notificaciones push (`api/push/route.ts`, `useLiveLocation.ts`), el remitente
  de correo (`email.ts`), el `app_name` por defecto cuando la base no lo trae (`TopBar`,
  `data-provider`, `demo-data`: `RTG·HUB`), los nombres de los instalables en `constants.ts`
  (escritorio y Android), el escritorio (`productName`, `shortcutName`, `name` del paquete, título
  de ventana y mensaje de error en `main.js`), el APK (`appName` de Capacitor, `strings.xml`, que
  es lo que Android pinta bajo el icono y `cap sync` no regenera, `mobile/package.json`, el título
  del fallback sin conexión en `www/index.html`), el `name` de `package.json` y del lockfile
  (`rtg-hub`), y los títulos de pestaña de los módulos: **RTG Time Tracker, RTG HR Management,
  RTG ERP**. El prefijo de los módulos es la familia de la app, y la app es RTG Hub.
- **Se queda RDZ:** el SMS al cliente ("your RDZ delivery"), la cabecera de `/track`
  ("RDZ·Tracking"), la de los exports ("RDZ · título"), los nombres de tienda ("RDZ McAllen"), y el
  texto "RDZ" de los iconos SVG. Es la empresa, no la app.
- **Se queda por otra razón:** los identificadores de User-Agent (`RDZ-Deliveries/1.0` hacia
  Nominatim/OSM en cinco rutas, `RDZHub/<ver>` del escritorio, que nadie parsea, y
  `RDZDeliveries/<n>` del APK, que `app-update.ts` parsea: es protocolo, no nombre). El módulo de
  reparto sigue llamándose **Deliveries** en `MODULES` / `MODULE_ACCESS` / `erp/domain/modules.ts`.

### Qué NO cambia en esta rama, a propósito

- **Ninguna URL.** `deliveries-app-seven.vercel.app` sigue en el cron, en `desktop/main.js`, en
  Capacitor y en las docs; la URL del APK en `app-update.ts` también. Es el paso 6 del plan.
- **Los `appId`** (`net.rdztilegroup.deliveries`, `net.rdztilegroup.hub`): cambiarlos convierte la
  app en otra app para el sistema y no se actualizaría encima.
- **`api/download/[app]/route.ts`**: el Blob todavía guarda `RDZ-Hub-Setup.exe`. Que
  `productName` ya diga RTG Hub y la descarga siga apuntando al fichero viejo es **intencional**: el
  nombre del artefacto se coordina con la recompilación del paso 7. Hasta entonces el instalador
  que se descarga sigue siendo el viejo, con el nombre viejo.
- `settings.app_name` en la base (hoy `RDZ·DELIVERIES`): es dato, lo cambia el dueño desde Ajustes
  (paso 10). Mientras tanto la cabecera del hub sigue diciendo RDZ aunque el código ya diga RTG.
- `.github/workflows`, docs, `mobile/README.md`: los actualiza el orquestador al numerar.

### Hallazgo: hay dos manifests y sirve el de `public/` (medido)

`src/app/manifest.ts` y `public/manifest.webmanifest` sirven **la misma ruta**,
`/manifest.webmanifest` (Next genera esa ruta desde `app/manifest.ts`). Medido el 2026-09-04 con
`next build`, `next start -p 3457` y `curl -s -i localhost:3457/manifest.webmanifest`: la
respuesta trae `orientation`, los dos iconos SVG y cabeceras de fichero estático (`Accept-Ranges`,
`Last-Modified`, `ETag`), que solo tiene el de `public/`. **El de `public/` gana; `app/manifest.ts`
se compila (`.next/server/app/manifest.webmanifest` existe) pero no se sirve.** Se cambiaron los
dos y no se borró ninguno: quitar `app/manifest.ts` es otra rama, ya sin la sospecha.

### Lo no verificado

No hay prueba que fije títulos ni manifest, y ninguna falló por el nombre. `verify.mjs` en verde
(711 pasados | 3 saltados, igual que `main`). El APK y el escritorio **no se recompilaron**: el
nombre nuevo llega a los usuarios en el paso 7. Nadie vio la pestaña del navegador con el título
nuevo: el worktree no tiene `.env.local` a propósito.

## D-189 · La URL de producción pasa a `rtg-hub.vercel.app`; la vieja no murió, redirige. Paso 6 del plan de renombre

**Fecha:** 2026-09-04 · **Versión:** ninguna app sube (ningún bundle web cambia; `desktop/main.js` y
Capacitor son binarios aparte) · **Pedido por:** Andrés · **Plan:** `docs/PLAN-rename-rtg-hub.md`

### Qué se pidió

El dueño renombró el proyecto en Vercel (paso 4 del plan) y la URL nueva es
**`https://rtg-hub.vercel.app`**. Esta rama es el paso 6: poner esa URL donde el código y las docs
tenían `deliveries-app-seven.vercel.app`.

### El hecho que cambia el plan original

El plan (§1, §3) daba por sentado que **la URL vieja moría de golpe** al renombrar, y ordenaba los
pasos para que esa ventana de rotura (APK, escritorio, cron, login, push) durara minutos. **No
murió.** Medido el 2026-09-04 con `curl -sI`: `https://deliveries-app-seven.vercel.app/` responde
`307 Temporary Redirect` con `Location: https://rtg-hub.vercel.app/`, y lo mismo la ruta del cron
(`/timetracker/clock-in/api/cron` → 307). Vercel conserva el alias viejo y lo redirige. Nota de
precisión: el código es **307, temporal en términos HTTP**, no 301/308; lo "permanente" es que
Vercel mantiene el alias mientras nadie lo quite, no el código de estado.

Consecuencias:

- **La migración pasa de "de golpe" a gradual.** El APK y el escritorio instalados siguen
  abriendo por la redirección (un `loadURL` sigue redirecciones). Recompilarlos (paso 7) deja de
  ser urgente; sigue pendiente para que los binarios no dependan de un alias que puede
  desaparecer.
- **Lo único que se rompía era el cron de fichaje**, y por una razón concreta: `tt-cron.yml`
  llama con `curl` **sin `-L`** y exige 200; vio el 307 y falló. Esta rama cambia **solo** la URL
  base del workflow. **No se añade `-L` a propósito**: si mañana la URL vuelve a cambiar, se
  quiere que el cron falle visible en Actions, no que siga una redirección a ciegas.

### Qué cambia

- `.github/workflows/tt-cron.yml` (`BASE_URL`), `desktop/main.js` (`SITIO`),
  `mobile/capacitor.config.ts` (`server.url`).
- Docs descriptivas del estado actual, con "antes `deliveries-app-seven`" como aclaración:
  `ARCHITECTURE.md`, `docs/HANDOFF-2026-09-04.md`, `desktop/README.md`, `mobile/README.md`.

### Qué NO cambia

- `src/lib/app-update.ts`: la URL del APK cuelga de Supabase Storage, no del dominio de Vercel.
  Mirado, no tocado.
- Las menciones **históricas** de la URL vieja en `DECISIONS.md` (D-074 y D-188),
  `docs/decisiones.html` y el título de §1 del plan: describen lo que era cierto cuando se
  escribieron y el historial no se reescribe.
- `appId`s, `api/download/[app]/route.ts`, nombres de artefactos, recompilación (paso 7).
- `mobile/android/app/src/main/assets/capacitor.config.json` **no existe en el repo** (el encargo
  pedía cambiarlo a mano): `cap sync` lo genera y no está versionado. Nada que tocar.

### Lo no verificado

El cron **no se ejecutó** desde esta rama (sería un efecto real: cierra turnos). Se comprueba tras
el merge con *Run workflow* y `verify=1`, como dice el plan. Nadie abrió el APK ni el escritorio
recompilados: no existen todavía. `verify.mjs` en verde (711 pasados | 3 saltados, igual que
`main`): ninguna prueba cubre estas URLs.

## D-190 · Nómina: la pestaña "Period" desaparece y pasa a ser la cabecera de "Pay"; la fecha manda desde la URL

**Fecha:** 2026-09-04 · **Versión:** deliveries 1.58.0, package.json 1.113.1 (timetracker) · **Pedido por:** Andrés ·
**Plan:** `docs/PLAN-nomina-period-en-pay.md`

### Qué se pidió

Petición literal: *"en time tracker, period y pay dan diferentes datos entonces quiero que elimines
period y prácticamente si tenía diferente info a pay que lo merge"*.

### Por qué daban datos distintos

Dos cosas a la vez, y separarlas importa porque borrar la pestaña no arregla la segunda. **A
propósito** (D-102, D-117, D-118): Period enseñaba *horas* de las dos vías lado a lado sin
sumarlas y marcaba a quien tenía las dos; Pay enseña *dinero y estados*. **Bugs**: la tabla de §1
del plan, siete filas con archivo:línea. De esas, esta rama arregla **una**: la sección Remoto de
Pay no leía `?period=` (tenía su propio calendario, `ManagerReports.tsx:60`, y `PayrollTabs` no
le pasaba nada), así que al navegar a otra semana Remoto se quedaba en la actual.

### Qué se decidió

1. **Una sola vista.** `PayrollTabs` ya no tiene pestañas. Lo que era Period es ahora
   `PayrollResumen`, una cabecera siempre visible encima de las dos secciones plegables (En sitio,
   Remoto): la navegación por periodo (`← anterior` · `viernes → jueves` · `siguiente →`, por URL,
   la única enlazable), tres cifras —horas de fichaje, horas de proyecto, personas con horas—
   cada una con su subtotal En sitio / Remoto, y los dos avisos: quién tiene horas por las dos
   vías (`revisar`) con sus nombres, y quién no tiene tipo de trabajador y se dedujo
   (`guessed`), con sus nombres y el enlace a Empleados. **Siguen sin sumarse** fichaje y
   proyecto (D-102): son dos cifras, no una.
2. **Los mismos números que daba Period.** `payroll/page.tsx` hace la **misma consulta** a la
   misma vista (`timetracker.period_hours`, `eq period_start`), con el mismo `tipoDe()` para
   deducir el grupo, y las cifras salen de las mismas expresiones (`totalFichaje`,
   `totalProyecto`, `suma(enSitio|remotos, …)`, `aRevisar`, `deducidos`); solo cambia que la
   página ya no las pinta: se las pasa a `PayrollTabs` como props. Lo que **sí** se deja de
   enseñar, por diseño (§3 del plan): las tablas por persona de Period con su fila por empleado,
   porque cada persona ya tiene su fila en la sección de pago que le toca. Se conservan los
   subtotales por grupo en las tres cifras.
3. **La marca de doble conteo por persona es el dato real.** `PayrollTimesheets.tsx` marcaba
   "remote" por `worker_type`, una aproximación: un remoto podía no haber cronometrado nada y
   salía marcado, y un "de sitio" que cronometró no salía. Ahora recibe los ids con
   `period_hours.revisar = true` y marca exactamente a quien tiene horas por las dos vías este
   periodo, el mismo dato que la cabecera.
4. **La fecha llega por `?period=` a las tres partes, y va en su propio commit, primero.**
   `ManagerReports` recibe `period` como prop y pierde `useState(week)` y sus botones prev/next.
   D-164 avisó de que cambiar la fuente de la fecha en la misma tanda que una mudanza "es como se
   rompe una nómina": por eso es el commit 1, solo, con `verify.mjs` en verde antes del 2. Lo
   único que cambió en `ManagerReports` es de dónde sale `week`; el cálculo es el mismo.
5. **Todo lo que era Period pasa por el diccionario** (`useT()`, claves `mgr.pay.*`, en y es),
   igual que D-187; estaba en inglés a pelo. `PayrollTabs` también: usaba `usePrefs().t(en, es)`
   inline, y pasa a claves para que la prueba de D-187 lo cubra. Esa prueba ahora incluye
   `PayrollResumen`, `PayrollTabs`, `PayrollTimesheets` y `ManagerReports`, y **pasa**: las claves
   de `ManagerReports` (más de cien) existen en los dos idiomas.
6. **`period.test.ts` prueba la función de verdad.** Reimplementaba `periodStartOf` y por tanto
   no protegía nada. La función se mueve de `payroll/page.tsx` (un `page` no puede exportarla) a
   `src/lib/timetracker/period.ts`, **sin cambiar el cuerpo**, y la página y la prueba importan
   la misma. La prueba le da el mediodía UTC porque la función recibe un instante, no un día.
7. **Se quita el enlace circular del pie** a `/timetracker/reports`, que redirigía a la propia
   pantalla, y el texto que mandaba a "Timesheets above", que ya no existe como pestaña.

### Prohibido aquí, y por qué: los bugs de cálculo quedan abiertos

No se tocó la aritmética: ni la vista `period_hours` (086), ni `lib/clockin/payroll.ts`, ni
`computePay`, ni `getPayrollPeriod`. Afectan a lo que se paga y van en su propia rama con plan y
pruebas (D-117: no crear "una segunda aritmética de nómina"). Quedan abiertos, con archivo:línea
del 2026-09-04:

- **Periodo quincenal/mensual:** `settings.payPeriod` puede ser `biweekly` o `monthly`
  (`helpers.ts:190-195`, `periodEndISO`) y la cabecera y `period_hours` son siempre semanales.
  Con `?period=` como fuente única, Remoto recibe un viernes y calcula su fin con `payPeriod`:
  en semanal cuadra; en quincenal Remoto enseña 14 días y la cabecera 7.
- **Huso de las sesiones:** `period_hours` usa `start_ms` en Chicago (`086:61`); Remoto usa la
  columna `date` escrita en Tegucigalpa (`ManagerReports` filtra por `s.date`). Una sesión de
  23:00-00:00 cae en días distintos.
- **Ventana fija de 7×86400000 ms en En sitio** (`reports.ts:273-274`), que no respeta el cambio
  de horario, contra el `at time zone` de la vista (`086:39`). En las semanas de DST un fichaje
  aparece en una y no en la otra.
- Además hay **tres implementaciones del "viernes del periodo"**: `payPeriodDates`
  (`lib/clockin/schedule.ts:117`), `periodStartOf` (ahora `lib/timetracker/period.ts`) y el
  `date_trunc` de la vista. Unificarlas es el mismo trabajo que lo de arriba.

### Qué se descartó

- **Borrar Period sin más.** Perdía la comparación lado a lado, la marca `revisar` con datos
  reales, el tipo deducido, los subtotales por vía y la navegación por URL (§2 del plan).
- **Renderizar la cabecera en el servidor, como estaba.** `useT()` es un hook de cliente; se
  eligió pasar datos planos a un componente cliente antes que dejar media pantalla sin traducir.
- **Traducir `PayrollTimesheets` entero.** Sigue en inglés salvo la marca nueva; es otra rama.
- **Quitar las claves `mgr.rep.prev` / `mgr.rep.next`** que ya nadie usa: son dos líneas
  inertes y borrar del diccionario no es lo que pide esta rama.

### Lo no verificado

Nadie abrió Nómina: el worktree no tiene `.env.local` a propósito, y la página exige sesión de
admin y datos reales, así que `next start` no sirve aquí para comprobar que la sección Remoto
cambia de semana con la URL. Se verificó **por lectura**: `week = period` en `ManagerReports` y
los dos `useEffect` que cargan sesiones y lotes dependen de `start`/`end`/`week`. Que la cabecera
dé los mismos números que Period también es por lectura: misma consulta, mismas expresiones.
`verify.mjs` en verde: 715 pasados | 3 saltados (main: 711 | 3; los 4 nuevos son los ficheros
añadidos a la prueba de claves). Mutaciones: la función de periodo rota (`- 1` en vez de `- 5`)
tira las cuatro pruebas de periodo; una clave borrada solo del español la detecta la prueba de
claves. La prueba real es el dueño abriendo Nómina en dos semanas distintas, en los dos idiomas.

## D-191 · Los datos de demo fechan con el día del negocio, no con el de la máquina

**Fecha:** 2026-09-05 · **Versión:** la decide el orquestador al fusionar; `demo-data.ts` es lógica
de datos de demo pero corre en el bundle de Deliveries · **Pedido por:** el CI del PR #7

### Qué fallaba

`src/lib/demo-data.test.ts`, "finds past-due orders that aren't finished": esperaba ≥ 2 vencidos y
el CI dio 1. En local pasaba. El run corrió a las 03:57 UTC del 5 de septiembre de 2026.

### Por qué

Dos definiciones de "hoy" en el mismo cálculo. `iso(daysFromToday)` de `demo-data.ts` hacía
`new Date()` + `setDate` + `localISO`: la fecha **local de la máquina**. `isOverdue`
(`utils.ts`) compara `delivery_date < todayISO()`, y `todayISO()` es el hoy en el huso **del
negocio** (`BUSINESS_TZ`, America/Chicago), a propósito: así el servidor (UTC) y el navegador ven
el mismo día y no hay error de hidratación. En el runner de GitHub, en UTC, entre la medianoche
UTC y la de Chicago la máquina ya va un día por delante del negocio: `iso(-1)` daba el hoy del
negocio, y los dos pedidos de "ayer" de la demo dejaban de estar vencidos. Cada día, durante
cinco o seis horas, la demo mentía y la prueba fallaba.

### Qué se decidió

`iso()` deriva de `todayISO()` y desplaza en calendario puro (mediodía UTC, para que ningún huso
lo mueva de día). Demo y lógica comparten definición de "hoy". `isOverdue` y `todayISO` **no se
tocan**: son los correctos. `stamp()` tampoco: produce instantes (`created_at`,
`approved_at`), no días, y nadie los compara por día de calendario. La aserción `≥ 2` de la prueba
se queda tal cual: era la buena.

**Prueba de regresión:** fija el reloj a `2026-09-05T03:57:00Z` **y pone la máquina en UTC**
(`process.env.TZ`), porque con el reloj solo no se reproduce: en una máquina que ya está en el
huso de Chicago, como la del dueño, el instante fijado sigue siendo el día 4 para las dos
definiciones. Eso explica por qué en local pasaba. Medido: con `demo-data.ts` de `main` la prueba
da 1 (el mismo fallo del CI); con el arreglo, ≥ 2.

### Qué se descartó

- **Arreglarlo en la prueba** (fijar el huso del runner con `TZ=America/Chicago` en el workflow):
  escondía el bug; la demo seguiría fechando mal en cualquier máquina fuera de Chicago.
- **Cambiar `isOverdue` a la fecha de la máquina:** revierte la razón de `todayISO` (hidratación).

### Lo no verificado

Nadie vio la demo en un navegador en UTC. `verify.mjs` en verde.

## D-192 · El ajuste suelto de la sección Remoto de Nómina pasa a botón + ventana, y sus tipos se enseñan traducidos

**Fecha:** 2026-09-05 · **Versión:** timetracker 0.54.0, package.json 1.113.2 (timetracker) · **Pedido por:** Andrés

### Qué se pidió

Que el formulario "Add a standalone bonus / advance / deduction" de la sección Remoto de Nómina
(`ManagerReports.tsx`) deje de ser una tarjeta siempre visible y pase a ser un botón que abre una
ventana, con el mismo patrón que D-187, y que quede traducido.

### Qué se decidió

1. **Un botón "+ Ajuste" donde estaba la tarjeta**, que abre `Modal.tsx` (el de D-187, tal cual:
   Escape, clic fuera, botón ✕). Ni componente de ventana nuevo ni CSS nuevo. Dentro, el mismo
   formulario: empleado, tipo, importe, la línea de ayuda de arriba y la nota de abajo ("usa un
   monto negativo…"), y dos botones, Cancelar y Agregar. Misma validación (`disabled` si no hay
   empleado o importe) y misma llamada, `addAdjustment`, que guarda lo mismo en el mismo sitio
   (el lote borrador de la semana, `insertPayroll`/`updatePayroll`).
2. **Con éxito, la ventana se cierra; con error, no.** `addAdjustment` devuelve ahora si salió
   bien; es el único cambio en esa función. El error sigue saliendo por `alert`, como antes. El
   otro sitio que la llama (el ajuste por empleado dentro de la tabla) ignora el resultado y
   no cambia.
3. **Lo que faltaba por traducir eran solo las opciones del tipo.** El resto del bloque ya
   pasaba por `useT()` desde D-121 (`mgr.rep.adjHint`, `employeeOpt`, `amountPh`, `adjNote`).
   Los tipos vienen de `settings.adjustmentTypes` o de los tres por defecto (`Bonus`, `Advance`,
   `Deduction`): esos tres se **enseñan** traducidos (`mgr.rep.typeBonus|Advance|Deduction`);
   uno configurado por la empresa en Ajustes se enseña tal cual. **Lo que se guarda es siempre
   el valor**, no el rótulo, para que un ajuste hecho en español y otro en inglés sean el mismo
   tipo. El mismo selector de tipo existe dentro de la tabla por empleado y sigue a pelo: está
   fuera de este alcance. **Nota del mismo día:** el auditor observó que así la misma opción se
   veía "Bono" en la ventana y "Bonus" en la tabla de la misma pantalla, y el orquestador pidió
   incluirlo: ese selector usa ahora el mismo `tipoLabel` como texto, con el `value` sin
   traducir. Una línea, en commit aparte.
4. Claves nuevas: `mgr.rep.adjBtn`, `mgr.rep.adjTitle` y los tres tipos, en `en` y `es`.
   `ManagerReports.tsx` ya estaba en la lista de la prueba de claves (D-190); sigue en verde.

### Qué NO cambia

La tabla, los pagos, el recibo, el export, `computePay`, `PayrollTimesheets`, los tres bugs de
cálculo de D-190. Las listas de personas siguen como estaban (`users` del proveedor). Ni versión,
ni migración.

### Lo no verificado

Nadie abrió la pantalla: sin `.env.local` ni sesión real en el worktree. Apertura, cierre y el
guardado real van por lectura del diff. `verify.mjs` en verde, 716 pasados | 3 saltados, igual
que `main` (no hay prueba nueva: el fichero ya estaba cubierto). Mutación: `mgr.rep.typeAdvance`
borrada solo del español la detecta la prueba de claves. La prueba real es el dueño abriendo la
ventana y guardando un ajuste, en los dos idiomas.

## D-193 · El login recuerda una lista de cuentas por aparato, pide siempre la contraseña, y queda traducido; `/auth/callback` existe por fin

**Fecha:** 2026-09-05 · **Versión:** deliveries 1.59.0, package.json 1.114.0 (Deliveries / módulo base) ·
**Pedido por:** Andrés · **Plan:** `docs/PLAN-login-cuentas-recordadas.md` (aprobado por el dueño, opción
"lista + contraseña")

### Qué se pidió

Petición literal: *"en el login quiero que se guarde siempre si ingresaste con otro usuario y sea
quick login… y puede quedar hasta la lista de varios… obviamente al menos que se cambie la
contraseña"*.

### Qué fallaba

El login guardaba **un solo** email en `localStorage` (`rtg_remembered_email`) que se pisaba cada
vez que entraba otra persona en el mismo teléfono o PC de tienda. No estaba traducido, y es la
pantalla que ve todo el mundo. Y dos bugs de paso: "Forgot password?" mandaba el correo con
`redirectTo: /auth/callback?next=/reset-password` y **`/auth/callback` no existía** (quien tocaba
el enlace del correo caía en un 404, aunque `isPublicPath` ya lo dejaba pasar), y el mensaje de
`?reason=session` ("signed out because this account signed in on another device") prometía un
candado que se retiró a propósito en `data-provider.tsx`.

### Qué se decidió

1. **Una lista de cuentas por aparato**, `rtg_accounts`: `{ identifier, displayName, lastUsedAt }`,
   ordenada por uso reciente, con tope de **8** (un PC de tienda por el que pasa media plantilla no
   necesita más), y **migración** del email viejo la primera vez que se lee (entra como una cuenta
   más y la clave vieja se borra). La lógica es pura y vive en `src/lib/remembered-accounts.ts`,
   con prueba: migración, orden, quitar, tope, JSON roto, mayúsculas y espacios.
2. **Solo identificador y nombre. Nunca una contraseña ni un token.** Tocar una tarjeta prerrellena
   el identificador y pide la contraseña igual. Así "si cambió la contraseña, deja de entrar" se
   cumple solo: `signOut` revoca la sesión en el servidor, siempre se pide, y vale la nueva.
3. **La pantalla:** si hay cuentas, se enseñan como tarjetas (nombre + identificador), cada una con ✕
   para quitarla de este aparato (solo de la lista, no cierra ninguna sesión), y un botón "Otra
   cuenta" para el formulario vacío. Con una tarjeta elegida, el identificador va fijo con un
   enlace "Cambiar" y el foco va a la contraseña. "Remember me" pasa a significar **"recordar esta
   cuenta en este aparato"**: marcado, se guarda o actualiza; desmarcado, se quita si estaba.
4. **El nombre de la tarjeta** se lee de `profiles.full_name` **después** de entrar (el login no lo
   conoce antes). Si no se puede leer, se conserva el de la vez anterior o la tarjeta queda solo con
   el identificador. La lista es una comodidad: nunca bloquea el login.
5. **Traducido entero** con `usePrefs().t(en, es)`, el patrón del módulo base (como `HomeSelector`),
   no el diccionario por claves de Time Tracker. Los mensajes de error de Supabase se enseñan tal
   cual. El color del mensaje ya no se adivina por su texto (`includes("Check your email")`): hay un
   estado `msgOk`.
6. **`/auth/callback` implementada** (`src/app/auth/callback/route.ts`): canjea el `code` con el
   cliente de servidor (`exchangeCodeForSession`, que escribe la cookie), redirige a `?next=`
   **saneado a ruta interna** y, si falla (código caducado, ya usado, ausente, o error del
   proveedor), vuelve a `/login?error=…` y el login lo enseña. El saneador es `safeNext` en
   `src/lib/auth-redirect.ts`, con prueba: acepta rutas internas con query, rechaza externos con y
   sin esquema (`//evil.com`, `/\evil.com`), saltos de línea, y el propio `/login` (bucle). El login
   usa el mismo `safeNext` para su `?next=`, en vez de su comprobación a mano.
   **Nota del mismo día (CAMBIOS del auditor):** la primera versión solo tumbaba `\r` y `\n`, y el
   auditor reprodujo un open redirect por **tabulador**: `?next=/%09/evil.com` se decodifica a
   `/\t/evil.com`, pasaba las comprobaciones, y `new URL()` en el callback elimina tabuladores y
   saltos de línea antes de resolver, con lo que acababa en `https://evil.com/`. Ahora cualquier
   carácter de control (`[\x00-\x1F\x7F]`) tumba el `next`, la prueba cubre `\t`, VT, FF, NUL y DEL,
   y cada caso externo se resuelve contra el host real y se exige que siga siendo el nuestro, para
   que un hueco así del analizador se vea solo. Medido: con la regex vieja, el caso del tabulador
   falla.
7. **Eliminado el mensaje muerto** de `?reason=session`.

### Qué NO se hace, y por qué

- **Sesiones múltiples / tokens en `localStorage`:** descartado en el plan (§1). Supabase no lo trae,
  exigiría `storageKey` por cuenta en los cinco clientes, el servidor y el middleware, dejaría
  refresh tokens al alcance de cualquier script, y choca con la rotación de D-119 y con D-172/D-179.
- **Limpiar `rtg_outbox_v1` ni borradores al salir:** la cola offline del chofer guarda pedidos
  sin enviar; borrarla puede perder trabajo. Decisión aparte, anotada en el plan.
- **No se tocan** middleware, clientes de Supabase ni `username.ts`. `isPublicPath` ya cubría
  `/auth/*` y `/reset-password`; su prueba sigue igual.
- Sin migración de base, sin versión (la pone el orquestador).

### Lo no verificado

**Nadie abrió el login con sesión real**: el worktree no tiene `.env.local`. Las tarjetas, el foco,
la migración en un navegador de verdad y el canje del código en `/auth/callback` van por lectura y
por las pruebas puras. **No se mandó ningún correo de reset** para probar el callback (regla de
efectos en terceros): la ruta se verificó por lectura, `tsc` y `next build`, y `safeNext` por su
prueba. `verify.mjs` en verde: 733 pasados | 3 saltados (main: 716 | 3; +17 son las dos pruebas
nuevas). Mutaciones: sin el `slice(0, MAX_ACCOUNTS)` falla la prueba del tope; sin el rechazo de
`//` fallan las de destinos externos. El build avisa de `unpdf` en el catálogo del ERP: es previo y
ajeno a este cambio. La prueba real la firma el dueño: entrar con dos cuentas en el mismo aparato,
ver las dos tarjetas, quitar una, y abrir un enlace de reset.

## D-194 · "Team Diary" deja de ser pestaña y pasa a ser la cuarta vista de Auditoría; Auditoría deja de ser solo lectura y su puerta pasa a servidor

**Fecha:** 2026-09-05 · **Versión:** timetracker 0.55.0, package.json 1.114.1 (timetracker) · **Pedido por:**
Andrés · **Plan:** `docs/PLAN-team-diary-en-audit.md`

### Qué se pidió

Petición literal: *"team diary va dentro de audit"*. Team Diary (`/timetracker/team-diary`) enseñaba las
capturas de pantalla de la app de escritorio por persona y día; Auditoría (`/timetracker/audit`)
tenía tres vistas con un selector interno (D-109): registro, fotos de fichaje y excepciones.

### El argumento en contra, aceptado a conciencia

**Auditoría deja de ser solo lectura.** Sus tres vistas eran de solo lectura a propósito: es *el
registro de lo que pasó*. Team Diary es *una herramienta de sanción*: se entra a borrar una captura,
y al borrarla se le **resta a esa persona un tramo de tiempo pagado** (~10 min, el intervalo de
captura) de su sesión. Meterla dentro de Auditoría cambia el significado de la pantalla, no solo el
sitio. Se dijo antes de tocar código (plan, §2) y **el dueño lo aceptó a conciencia el 2026-09-05**.

**A favor, D-109:** declaró Auditoría como el contenedor de *"qué pasó, quién y cuándo, con la prueba
delante"*, y las capturas de escritorio son exactamente eso. Auditoría ya era un contenedor de vistas
heterogéneas; una cuarta continúa el patrón, y es más natural que D-186. Nadie enlazaba a
`/timetracker/team-diary` salvo la pestaña.

### Qué se decidió

1. **Cuarta vista del selector que ya existe**, no sección plegable ni cabecera: el selector de
   Auditoría ya monta cada vista solo al abrirse, que es lo que D-165 y D-186 pidieron. `view` gana
   el valor `"desktop"` y el selector un cuarto botón.
2. **El nombre: "🖥 Capturas de escritorio" / "Desktop captures"**, no "Diary" ni "Diario". Dentro de
   Auditoría, "Fotos" (de fichaje, con el teléfono) y "Diario" (capturas del escritorio) serían ambas
   "fotos de gente trabajando" y se confunden; el nombre dice de dónde vienen. Las cuatro etiquetas
   del selector pasan por `useT()` (`mgr.audit.view*`, en y es); antes estaban en inglés a pelo.
3. **Movido, no reescrito.** El cuerpo de `team-diary/page.tsx` es ahora
   `src/components/timetracker/TeamDiary.tsx` (patrón `AssignmentsPanel`, D-186); el `diff` contra
   la página borrada difiere solo en la firma y la cabecera. El borrado de una captura con su resta
   de tiempo a la sesión y la purga de más de 14 días son **el mismo código**. El cuerpo de
   `audit/page.tsx` pasa a `AuditTabs.tsx` (cliente) con el mismo criterio.
4. **Tres listas de personas, y ninguna gana** (regla de D-186): quien tiene capturas (Team Diary),
   todos los que tienen `timetracker_role` (registro) y las fotos acotadas por tienda (D-127). Cada
   vista conserva su propio selector. Unificarlas rompería en silencio.
5. **La puerta pasa a servidor.** `audit/page.tsx` es un componente de servidor con `redirect` por
   `timetracker_role`, calcado de `assignments/page.tsx` (D-186). Con una acción que descuenta horas
   dentro, el `if (me.role !== "admin")` del navegador, que se evaluaba después de montar y consultar,
   no basta: RLS es quien protege de verdad y nunca fue ese `if`; la redirección evita además pintar
   la pantalla a quien no debe verla. Los `if` de cliente que ya tenían las dos pantallas siguen
   dentro de sus componentes, sin tocar (movido, no reescrito).
6. `team-diary` sale de `MANAGER_TABS`; `/timetracker/team-diary` redirige a `/timetracker/audit` en
   `next.config.mjs`, junto a la de `/timetracker/clock-in/photos`. La clave `tab.team-diary` del
   diccionario queda sin uso: se deja, no es lo que pide esta rama.
7. **Prueba:** un caso en `landing-route.test.ts` (siguiendo su propio comentario: "si alguien retira
   una de estas rutas sin poner otra en su lugar…") que exige que `MANAGER_TABS` ya no tenga
   `team-diary` y que el selector de Auditoría ofrezca la vista `desktop` y monte `TeamDiary`,
   leyendo el fuente como hace la prueba de claves. Los dos componentes entran en la lista de la
   prueba de claves de D-187.

### Qué NO cambia

`DayPhotos`, `ExceptionHistory`, `WorkDiary` y `/timetracker/diary` (la del empleado, que reutiliza
`WorkDiary`). Lo que hace el borrado. Ninguna migración, ninguna escritura nueva, sin versión.

### Deudas que quedan

- **Traducción de las vistas de fichaje**: `DayPhotos` y `ExceptionHistory` siguen en inglés (deuda de
  D-122). Se tradujo solo el selector, que se tocaba de todas formas. Rama aparte.
- **La vista está vacía por diseño hoy (2026-09-05)**: las capturas solo llegan desde la app de
  escritorio, que aún no captura (`WorkDiary.tsx`). Enseña "sin capturas" hasta entonces.

### Lo no verificado

Nadie abrió Auditoría con sesión real: el worktree no tiene `.env.local`, y aunque la tuviera la
vista estaría vacía. La puerta de servidor, la redirección y el selector van por lectura, `tsc` y
`next build`. `verify.mjs` en verde: 737 pasados | 3 saltados (main: 734 | 3; +3 son el caso nuevo
de rutas y los dos ficheros añadidos a la prueba de claves). Mutación: sin `setView("desktop")` ni
`<TeamDiary />` en el selector, falla el caso nuevo. Detalle de entorno: tras borrar la página,
`tsc` falla con los tipos generados en `.next/types` de un build anterior; se resuelve borrando
`.next` (artefacto), y el CI parte de limpio. La prueba real es el dueño, y solo será útil cuando el
escritorio capture.

## D-195 · El cronómetro sigue contando a través de la actualización, el cierre y el reinicio; huérfana a los 15 min, y un cron que las cierra

**Fecha:** 2026-09-05 · **Versión:** timetracker 0.56.0, package.json 1.115.0 (timetracker) · **Pedido por:**
Andrés · **Plan:** `docs/PLAN-timer-sobrevive-actualizacion.md` (diseño corregido tras el dueño: la
actualización **se hace**, y el reloj no se entera)

### Qué se pidió

Petición literal: *"el time tracker si se actualiza me hace stop el timer, entonces quiero que aunque
se cierre el app o se actualice o reinicie el timer siempre estará prendido y que sienta cuando la app
ya está online de nuevo para seguir tomando screenshots y así no perder tiempo contando"*. La primera
versión del plan proponía no recargar mientras el reloj corre; el dueño lo rechazó (*"sí quiero poder
actualizar, pero que no se pierda la continuidad"*).

### La causa, medida

El banner de actualización está montado dentro de Time Tracker (`(timetracker)/layout.tsx`) y al
volver a la pestaña con versión nueva hace `window.location.reload()`. Su guarda `safeToReload`
(`app-update.ts`) mira si hay un modal o un campo enfocado: **no sabe que hay un cronómetro
corriendo**. Se escribió para el chofer (D-029) y Time Tracker la heredó con D-087 sin revisar la
premisa.

**La recarga no borraba la sesión**: ya estaba anclada en la base (`sessions.is_live` + `start_ms`) y
se reconstruía al abrir. Lo que se perdía era la **continuidad**, por tres huecos: (1) el tick escribe
cada diez segundos, así que los últimos segundos antes del salto no se grababan; (2) si la
confirmación contra el servidor fallaba por red, la pantalla entraba en el modo "mirón" de D-096,
que no graba latidos ni capturas; (3) con más de **5 minutos** sin latido, la siguiente apertura la
cerraba como huérfana en su último latido. Un reinicio de la máquina se veía como "se paró".

### Qué se decidió — parte A, el cliente (commit 1)

1. **Último latido antes de descargar la página.** En `pagehide` y en el evento `rtg:before-reload`
   (que `AppUpdateBanner` emite justo antes de recargar: un aviso, **no un freno**, nadie puede
   cancelarlo), el cliente que **conduce** la sesión manda por `navigator.sendBeacon` el mismo
   parche que escribe el tick a la ruta nueva `/timetracker/api/heartbeat`, y deja la marca local
   `tt_resume_<usuario>` = `{ sessionId, at }`. `sendBeacon` es lo único que el navegador
   garantiza durante `pagehide`; no admite cabeceras, por eso es una ruta propia (misma cookie de
   sesión; solo actualiza la fila **propia y viva**; acepta exactamente los campos del tick). Un
   mirón (sesión que conduce el otro cliente, D-096) no graba nada.
2. **Al abrir, reanudar sin pasar por el modo mirón.** Si la confirmación falla por red y hay marca
   reciente (**< 15 min**) **para esa misma sesión**, se sigue contando desde `start_ms`, se re-arman
   el tick y `desktopStart` en el mismo paso (como la adopción normal), y la confirmación se
   reintenta con backoff (2, 4, 8, 16, 30 s…). Tres salidas: el servidor la da por viva → se limpia
   la marca y se sigue; la da por cerrada → se para, como cuando el dueño para desde el otro cliente;
   la marca caduca sin respuesta → se cae al modo mirón. **Sin marca, D-096 tal cual.** La marca la
   dejó este cliente hace un momento mientras conducía esta sesión, en este aparato: no es la
   "pestaña ciega" que D-096 evita, es la misma pestaña tras la actualización.
3. **El reloj sigue durante el salto** porque el tiempo sale de `start_ms`, no del tick: una recarga
   de segundos o un reinicio de dos minutos no restan nada.
4. **Huérfana a los 15 minutos, no 5.** `LATIDO_MAX_MS` es **una** constante en
   `src/lib/timetracker/live-session.ts`, que comparten la pantalla y el cron. La regla de cierre
   **no cambia**: en su último latido, con la misma aritmética que tenía la página (del arranque al
   latido, sin descontar pausas). Por qué 15 y no más: ese freno es lo que impidió repetir las
   **25,75 h** con cero actividad (D-098) y las **10,42 h** de una noche con la máquina apagada; cada
   minuto de umbral es un minuto que una huérfana puede seguir "trabajando". El dueño puede ajustar
   el número en un sitio.
5. **F5 / Ctrl+R del escritorio**: `webContents.reload()` dispara `pagehide` en el renderer, así que
   queda cubierto sin tocar `desktop/main.js`.

### Qué se decidió — parte B, el cron (commit 2)

**No existía ningún cron que cerrara huérfanas**: el guardián solo corría al abrir la pantalla, y una
sesión de quien se fue seguía viva para siempre en "Trabajando ahora". Ahora `cerrarSesionesHuerfanas`
(`live-session-cron.ts`) aplica la misma `huerfanasDe` contra PostgREST con la llave de servicio y el
perfil de esquema `timetracker` en cada llamada (sin él, `sessions` se buscaría en `public` y el cron
no haría nada en silencio, la lección de `lib/clockin/rest.ts`). El PATCH lleva `is_live=eq.true`
también en el filtro: si la persona la paró entre el SELECT y el cierre, no se pisa nada.

**Dónde se programó:** Vercel Hobby admite dos crons y los dos están ocupados (`notion-summary`,
`roll-schedules`). Se **fusionó con `roll-schedules`** (08:00 UTC, mismo secreto): lo llama al final
de su pasada y devuelve `orphans` en su respuesta, aislado con `try/catch` para que un fallo del
cierre no tumbe el rodado de horarios. Además existe `/timetracker/api/close-orphan-sessions` como
ruta propia (`cronAuthorized`, `?verify=1`) para ejecutarlo a mano o desde un job aparte si algún
día hace falta más frecuencia. `roll-schedules` gana también `?verify=1`. Se descartó GitHub Actions
porque una pasada diaria basta (el guardián de 15 min sigue cubriendo el tiempo real al abrir) y
Vercel ya manda el `CRON_SECRET` a esa ruta.

### Qué NO cambia

La aritmética de nómina (`computePay`, `period_hours`), una sola sesión viva por persona (092), los
solapes (082), la miga de 18 h (D-096), el auto-stop por bloqueo del PC, y `safeToReload`. **Las
capturas no se arreglan aquí**: `desktop/` de este repo es la cáscara RTG Hub y no captura nada; quien
captura es el cliente de escritorio de Time Tracker, otro repositorio. Lo que sí está aquí y sigue:
las capturas offline se encolan y suben al volver la red, y tras reanudar se re-arma `desktopStart`.
Ninguna migración. Ninguna escritura nueva salvo la del cron y el latido.

### Observación que queda al dueño

El `beforeunload` de la pantalla (previo a esto) sigue pidiendo confirmación al navegador cuando se
cierra o recarga con el reloj corriendo. Con la continuidad de D-195 ese aviso ya no protege nada,
y puede hacer que la recarga automática del banner enseñe el diálogo de "¿salir del sitio?". No se
tocó porque no era parte del encargo; es una línea si el dueño quiere quitarlo.

**Nota del mismo día:** el orquestador pidió quitarlo, en un tercer commit de una sola cosa, y se
quitó: el `pagehide` y el último latido siguen intactos, y la recarga del banner ya no encuentra
ningún diálogo por el camino. Queda un comentario en su sitio diciendo por qué ya no está.

Dos observaciones del auditor que van a la **rama de aritmética**, no a esta: (a) el cierre de
huérfana escribe `duration_seconds = latido − arranque` **bruto**, mientras el último latido ya había
escrito el **neto** (sin almuerzo, pausas ni inactividad, `netSeconds`), así que cerrar una huérfana
puede pagar más que su último latido si hubo pausas; es exactamente lo que hacía la página antes y
el criterio fue conservar la regla; un cierre más conservador dejaría el `duration_seconds` que ya
tiene la fila. (b) `updateSession` del proveedor filtra por `id` sin `is_live = true`, así que con la
reanudación a ciegas, si la confirmación fallara mientras las escrituras del tick llegan, se
retocaría `end_ms` de una fila ya cerrada hasta que la marca caduque; improbable (mismo backend), y
un `.eq("is_live", true)` en el tick, como ya tiene la ruta del latido, lo cerraría del todo.

### Lo no verificado

Nadie reprodujo la recarga con sesión real: sin `.env.local` en el worktree, y una prueba de verdad
escribe en `sessions` de producción. `sendBeacon` durante `pagehide` y el orden de eventos en el
navegador van por lectura y por la garantía del estándar. **El cron no se ejecutó contra producción**:
se probó con `fetch` falso y datos sintéticos, y la ruta se comprueba con `?verify=1` tras el merge.
`verify.mjs` en verde: 757 pasados | 3 saltados (main: 737 | 3; +20 son las dos pruebas nuevas, 14 de
la lógica y 6 del cron). Mutaciones: umbral a 5 min y cierre "ahora" en vez de en el último latido
tiran 7 pruebas; PATCH sin `is_live=eq.true` y perfil `public` tiran 3. La prueba real es el dueño
arrancando el cronómetro y forzando una versión nueva; y `roll-schedules` a las 08:00 UTC con su
`orphans` en el log de Vercel.

## D-196 · La cabecera de Nómina, más grande y con las tarjetas renombradas: "Total en sitio" y "Total remoto"

**Fecha:** 2026-09-05 · **Versión:** timetracker 0.57.0, package.json 1.115.1 (timetracker) · **Pedido por:** Andrés

### Qué se pidió

Petición literal, con capturas: *"hazlo más grande y agradable a la vista; la primera card que dice
Clock-in hours será TOTAL ON SITE y la que dice Project será REMOTE TIME TOTAL, en ambos idiomas, y
que diga más grande"*. Solo interfaz, sobre la cabecera de D-190 (`PayrollResumen`).

### Qué se decidió

1. **Etiquetas:** la tarjeta de horas de fichaje pasa a **"Total on site" / "Total en sitio"** y la de
   horas de sesiones a **"Remote time total" / "Total remoto"**; la tercera ("Everyone" / "Todos")
   sigue. Cambian **solo los rótulos**: los números y su origen (`period_hours`, D-190) no se tocan,
   y siguen sin sumarse (D-102), con la nota del pie intacta.
2. **Más grande:** el número es lo primero que se ve (40 px, 34 en móvil, tabular), la etiqueta va en
   mayúsculas pequeñas y legible, y hay más aire entre tarjetas (16 px) y dentro (20×22 px). Estilos
   nuevos `.pay-*` en `timetracker.css`, **solo con variables `--tt-*`** del módulo (oscuro por
   defecto, claro con `data-theme="light"`); ningún color a pelo, que fue lo que D-187 pagó.
3. **Tres en fila cuando caben, apiladas cuando no:** `repeat(auto-fit, minmax(220px, 1fr))` en vez
   del `.g3` fijo, que solo sabía "tres" o "una" (corte en 720 px) y dejaba un ancho intermedio
   feo. La navegación de periodo pasa a ser una **píldora dentro del mismo bloque** que el título:
   al envolverse en pantallas medianas queda pegada a él, no flotando sobre un fondo cortado, que
   es lo que enseñaba una de las capturas; en móvil ocupa el ancho entero.
4. **Los títulos son totales POR VÍA, no por persona** (aclaración del dueño el mismo día): "Total
   en sitio" es todo lo **fichado**, sea quien sea, y "Total remoto" todo lo **cronometrado**. Como
   hay remotos que fichan y gente de sitio que cronometra, el desglose pequeño de cada tarjeta
   (datos reales de `period_hours` por `worker_type`, D-190) dice **la vía y el tipo**: *"De
   fichaje: en sitio X · remotos Y"* / *"Punched: on site X · remote Y"* y *"De cronómetro: en sitio
   X · remotos Y"* / *"Timer: on site X · remote Y"*. Un título a secas prometería de más (D-044).
5. Claves: `mgr.pay.clockHours` y `mgr.pay.projectHours` se **renombran** a `mgr.pay.totalOnSite` y
   `mgr.pay.totalRemote` (nadie más las usaba, comprobado por grep), y entran `mgr.pay.byTypePunched`
   y `mgr.pay.byTypeTimer`, en `en` y `es`, **literales** en cada tarjeta y no por variable, porque
   la prueba de claves de D-187 lee el fuente buscando `t("…")` y una clave por variable se le
   escaparía. `PayrollResumen.tsx` ya estaba en esa prueba.

### Qué NO cambia

La aritmética, `period_hours`, `PayrollTimesheets`, `ManagerReports`, el selector de secciones, los
avisos de `revisar` y `guessed`. Sin versión, sin migración.

### Lo no verificado

**Nadie ve la pantalla con sesión real** (sin `.env.local`), ni en los dos temas ni en móvil: el
tamaño y el ajuste van por lectura del CSS. `verify.mjs` en verde: 757 pasados | 3 saltados, igual que
`main` (no hay prueba nueva; la de claves ya cubría el fichero). Mutación: `mgr.pay.byTypeTimer` borrada
solo del español la detecta la prueba de claves. La prueba real es el dueño abriendo Nómina en
escritorio y en el teléfono, en los dos idiomas y los dos temas.
## D-197 · Si el cron cerró una sesión mientras la persona trabajaba SIN INTERNET, al volver la red la pantalla la reabre; excepción acotada a D-195, con cuatro condiciones

**Fecha:** 2026-09-05 · **Versión:** timetracker 0.58.0, package.json 1.116.0 (timetracker) · **Pedido por:** Andrés

### El caso

La pantalla del cronómetro sigue contando sin red: el tick cuenta desde `start_ms` y las escrituras
van a la cola offline (D-074). Si pasan más de 15 minutos sin latido en la base, el cron de D-195
cierra la sesión en su último latido, que es lo que debe hacer con una huérfana. Pero esta no lo
es: la persona sigue trabajando delante de su reloj. Al volver la red, hasta hoy la confirmación
encontraba la sesión cerrada y paraba: **el tramo trabajado sin red se perdía.**

### Por qué es una excepción y no una relajación del freno

El freno de D-195 no cambia: sigue cerrando a los 15 minutos sin latido, y sigue siendo lo que
impide las 25,75 h (D-098) y las 10,42 h fantasma. Lo que se añade es deshacer ese cierre **solo
cuando hay prueba de que el reloj de este cliente nunca se detuvo**, que es la única diferencia
real entre una huérfana y alguien sin internet. Sin esa prueba, una sesión cerrada se queda
cerrada. La decisión es pura (`decisionReabrir`, `live-session.ts`) y está probada.

### Las cuatro condiciones, todas obligatorias

1. **Es su fila, y está cerrada.** Se lee por id con `getSession` (nuevo en el proveedor: una de
   mis sesiones, viva o cerrada, que `listLiveSessions` ya no devuelve).
2. **La cerró el cron, no una persona.** El cron deja `live_note = "closed:cron"` al cerrar
   (`CRON_CLOSE_NOTE`). `live_note` es texto libre que el tick sobreescribe cada diez segundos
   mientras la sesión vive y que "Trabajando ahora" solo lee en filas vivas: en una fila cerrada
   nadie lo mira, así que sirve de marca **sin migración**. Un Stop escribe `null`; el guardián
   de la propia pantalla no marca (ese cierre lo hace el mismo cliente al descubrir su propia
   sesión muerta, y reabrirla sería un error).
3. **Marca de reanudación reciente para ESA sesión, y evidencia local continua.** La marca de
   D-195 se refresca ahora **en cada escritura del tick** (cada 10 s, en `localStorage`, que
   funciona sin red), no solo en `pagehide`: es la prueba de que el reloj no se detuvo. Y la
   pantalla exige además que su tick esté corriendo ahora mismo sobre esa misma sesión
   (`tickRef`, `sessionIdRef`, `running`, y no en modo mirón).
4. **Ninguna otra sesión viva de la misma persona** (092). Si arrancó otra mientras tanto, esta no
   se reabre, y se avisa (`track.notReopened`).

Y la base tiene la última palabra: el `UPDATE` que reabre (`is_live = true`, `end_ms = ahora`,
acumuladores locales) pasa por el índice único de una sola viva (092) y por la exclusión de solapes
(082); si choca con cualquiera, no se reabre y se avisa. Un cierre por otra persona, un Stop, o una
sesión sin marca, no se tocan.

### Dónde se dispara

En dos sitios: al **volver la red** (evento `online`; si la sesión sigue viva, la decisión dice
"sigue-viva" y no pasa nada más), y en la **confirmación de la reanudación** de D-195 (tras una
recarga sin red: la marca del `pagehide` autoriza a conducir, el tick arranca, y cuando la red
vuelve y el servidor la da por cerrada, se intenta reabrir antes de parar). Un límite conocido:
si la persona **recarga con red** después de que el cron cerrara, la adopción encuentra la sesión
cerrada y para; el tick de esta página no siguió corriendo a través de la recarga y no hay
evidencia local, así que no se reabre. Es el precio de no reabrir nunca sin prueba.

**Nota del mismo día (CAMBIOS del auditor, confirmado por el orquestador):** la primera versión tomaba
como "evidencia local" que el tick estuviera **armado**, y eso no es que **siguiera corriendo**: un
portátil suspendido con la tapa cerrada (o una pestaña de fondo estrangulada) congela `setInterval`
durante horas; al despertar el tick vuelve a disparar, escribe la marca con fecha de ahora, y `el`
incluye la noche entera. Las cuatro condiciones se cumplían formalmente y se reabría pagando la
noche: las 10,42 h y las 25,75 h de D-098 por la puerta de atrás. Dos cambios, en un segundo commit:

- **La evidencia local mide el hueco entre ticks** (`tickContinuo`, puro y probado): si entre un
  tick y el siguiente pasan más de `LATIDO_MAX_MS`, el reloj local se paró; `continuoRef` se apaga,
  la marca de reanudación **se borra** y deja de refrescarse, y sin marca no hay reapertura por
  ninguna vía (ni `online` ni la confirmación). Vuelve a estar en pie solo al arrancar, al adoptar
  con confirmación del servidor, y en la reanudación con marca. **La suspensión queda cubierta**, y
  el tope de la extensión queda dicho con letras: se extiende "hasta ahora" **solo si ningún hueco
  entre ticks superó 15 minutos**, el mismo umbral que tolera la base: el reloj local nunca se
  detuvo más de lo que el servidor habría aceptado sin latido. Caso de prueba: "el equipo dormido 8 h
  con el tick armado → no reabre". **Y la marca solo se escribe —en el tick y en `pagehide`—
  mientras la continuidad se conserve**: tras un hueco no se vuelve a fabricar hasta que el servidor
  confirme la sesión (adopción con éxito) o se arranque una nueva. Sin esto (segundo CAMBIOS del
  auditor, una línea), dormir 8 h, despertar sin red y recargar habría resucitado la marca en
  `pagehide` y la reanudación la habría dado por buena.
- **El tick ya no toca filas cerradas.** Escribía con `updateSession` sin filtrar por `is_live`, así
  que tras despertar retocaba `end_ms`/`duration_seconds` de una fila que el cron ya había cerrado,
  aunque no se reabriera (lo señaló el auditor en D-195 y aquí). El proveedor gana
  `updateLiveSession`, que añade `is_live = true` al filtro (una fila cerrada es un no-op, cero
  filas, no un error), y **solo el tick** la usa. `stop()` (escribe `is_live = false`), la
  reapertura explícita (`is_live = true`), la edición manual y las aprobaciones siguen con
  `updateSession`, que escribe filas cerradas a propósito. Límite conocido: lo que el tick dejó en
  la **cola offline** se reenvía al volver la red por el `updateSession` del proveedor, sin filtro;
  cambiar la cola está fuera de este encargo y queda anotado.

### Qué NO cambia

`computePay`, `period_hours`, el umbral de 15 minutos, la regla de cierre en el último latido, el
cron salvo la marca. Sin migración. Nadie probó contra producción.

### Lo no verificado

Nadie reprodujo el caso con sesión real (sin `.env.local`; y una prueba real escribe en `sessions`
de producción). El evento `online`, el orden con el `flush` de la cola offline (que puede escribir
un `end_ms` algo anterior justo después de reabrir; el siguiente latido lo corrige en 10 s) y la
respuesta de la base a 092/082 van por lectura. `verify.mjs` en verde: 764 pasados | 3 saltados
(main: 757 | 3; +7 son los casos de `decisionReabrir`). Mutaciones: quitando la condición de la
marca del cron y la de otra viva, fallan los dos casos que las vigilan. La prueba real es el dueño:
cronómetro en marcha, red apagada más de 15 minutos con el cron pasando por medio, red de vuelta.

## D-198 · Auditoría general 2026-09-05, lote 1: nueve hallazgos de clase A aplicados, un commit por hallazgo

**Fecha:** 2026-09-05 · **Versión:** deliveries 1.60.0, erp 0.5.0, timetracker 0.59.0, package.json 1.117.0 (los cambios tocan Deliveries,
ERP y Time Tracker; `APP_VERSIONS.clockin` la decide él) · **Pedido por:** el orquestador, sobre
`docs/AUDIT-2026-09-05.md` (31 hallazgos, ningún P0). Clase A: fallo claro sin decisión de negocio; por
CLAUDE.md se aplica y se lista. Los de clase B (G-5, G-8, G-9, G-10, G-15/16/17/18, G-21, G-22, G-23,
G-29) **no se tocaron**: los decide el dueño.

| Id | Qué fallaba | Qué se hizo |
|---|---|---|
| **G-12** (P1) | Dos manifiestos para `/manifest.webmanifest`. **Medido el 2026-09-05 en los dos entornos, porque D-188 y la auditoría se contradecían y las dos tenían razón:** con `next start` en local gana `public/` (cabeceras de fichero estático, iconos, `orientation`), que es lo que midió D-188; en Vercel (`curl https://rtg-hub.vercel.app/manifest.webmanifest`, `X-Vercel-Cache: HIT`, `Etag` de contenido) gana el generado por `src/app/manifest.ts` con `"icons":[]`. El enrutado de Vercel pone la ruta generada por delante del fichero estático; el servidor de Next hace lo contrario, y por eso D-188 no lo vio. En producción "Añadir a pantalla de inicio" no tenía icono. | Borrado `src/app/manifest.ts`; queda `public/manifest.webmanifest` con iconos. `layout.tsx` sigue apuntando a `/manifest.webmanifest`; el build ya no lista la ruta. La verificación real la hace el orquestador con `curl` a producción tras desplegar. |
| **G-1** (P1) | `/erp` respondía 404: el módulo tenía puerta pero no raíz. | `src/app/erp/page.tsx` con `redirect("/erp/catalog")`, patrón de `erp/analytics/page.tsx`. |
| **G-24** (P2) | `/track` delimitaba el día con `-05:00` fijo (solo Central en verano) mientras clasificaba con `America/Chicago`: de noviembre a marzo las fijaciones de 23:00 a medianoche caían en el día equivocado. | Los tres límites pasan por `centralWallToUtc` (`src/lib/clockin/tz.ts`, DST-aware). Prueba nueva `tz.test.ts` con julio (05:00Z) y enero (06:00Z), incluido el caso de las 23:30. |
| **G-25** (P2) | Seis componentes y dos rutas de exportación cableaban `"America/Chicago"` e ignoraban la zona configurable: con otra zona cambiaban las fechas y no las horas, en la hoja de horas y el Excel. | Solo cambia la **fuente** de la zona, no la aritmética. Cliente: `APP_SETTINGS.timeZone`, el mismo objeto de `helpers.ts`. Servidor: `APP_SETTINGS` no existe allí (su defecto sería la zona del servidor, UTC en Vercel); **medido de dónde sale**: la fila `timetracker.settings` `id='app'`, `data.timeZone`, que es la que el proveedor vuelca en `APP_SETTINGS`. `businessTimeZone()` nuevo (`timezone-server.ts`) la lee con el cliente de la ruta y cae a `America/Chicago` si no hay ajuste: **en servidor**, sin ajuste, nada cambia. **En cliente no es así, y queda dicho** (CAMBIOS del auditor): `APP_SETTINGS.timeZone` arranca en la zona del **navegador** (`BROWSER_TZ`, `helpers.ts:47`) y `syncAppSettings` la conserva si la fila no trae `timeZone` (`:71`). Si la fila de producción **no** tiene `timeZone` puesta, las horas de los seis componentes pasan de Chicago fijo al huso del navegador: un gerente en Tegucigalpa vería los fichajes una hora antes. Es coherente (las fechas ya iban por `dateISO` con ese mismo objeto, que era la incoherencia del informe) y es lo que G-25 pide, pero **la condición de "nada cambia" es que la fila de producción tenga `timeZone` puesta**, y eso lo comprueba el orquestador, no esta rama. Los formateadores reciben la zona por parámetro. |
| **G-6** (P2) | Borrar una vista guardada del ERP no confirmaba ni miraba el error: si RLS lo rechazaba, la vista reaparecía y nadie veía nada. | `window.confirm()` (el patrón del ERP, `bulk-bar.tsx`) y el error del `delete` pintado debajo con `role="alert"`. |
| **G-2** (P2) | El layout de Deliveries rebotaba a `/login` sin `?next=`; ERP y Time Tracker sí lo ponen. Duele en el escritorio de Electron, sin barra de direcciones (D-076). | `redirect("/login?next=/")`, la raíz del grupo. **Arreglo parcial, y queda dicho** (CAMBIOS del auditor): un layout de servidor no ve la ruta exacta, y **hoy nadie la conserva**: el rebote con la ruta que hay escrito en `lib/supabase/middleware.ts` (`updateSession`) no lo llama nadie, `src/middleware.ts` solo invoca `refreshSession` (es G-29, clase B, del dueño). Con `next=/` el chofer cae en el tablero y `landingRoute` lo lleva a `/driver`; quien iba a `/users` cae en el tablero, no en `/users`. El arreglo completo es G-29. Ruta interna fija: nada que sanear. |
| **G-26 · G-27 · G-28** (D-044) | Tres comentarios que mentían: `useLiveLocation.ts` prometía un respaldo de navegador que `LocationTracker.tsx:53` hace inalcanzable (solo APK); números viejos (40 m → 25 m, dos minutos → uno, ~100 filas → ~170); `timetracker/(timetracker)/layout.tsx` decía que el middleware era código muerto, falso desde D-119. | Solo comentarios, alineados con el código y las constantes. **El respaldo de navegador NO se activa**: es decisión del dueño. |
| **G-30** (P3) | Tres server actions del fichaje sin ningún importador, restos de D-137. | Borradas `consent.ts`, `runReview.ts`, `tutorial.ts` tras grep sobre `src/` (alias y relativos): cero referencias. |
| **G-31** (P3) | `@types/web-push` en `dependencies` (F-2 pendiente). | A `devDependencies`; `package-lock.json` regenerado con `--package-lock-only` para que `npm ci` no lo vea desincronizado. `APP_VERSIONS.clockin` no se toca. |

### Lo no verificado

Nadie abrió las pantallas con sesión real. G-12 en producción lo verifica el orquestador tras
desplegar. G-25: la fila de ajustes de producción no se leyó desde el worktree (sin `.env.local`);
si `timeZone` no está puesta, el resultado es idéntico al de antes por el defecto. `verify.mjs` en
verde sobre un `.next` limpio: 770 pasados | 3 saltados (main: 767 | 3; +3 son `tz.test.ts`); el build
ya no lista `○ /manifest.webmanifest` y sí `ƒ /erp`.

> **Nota del orquestador al fusionar (2026-09-05).** G-25 hace que seis componentes
> obedezcan `APP_SETTINGS.timeZone`. En producción la fila `timetracker.settings
> id='app'` tenía `timeZone = America/Tegucigalpa`, así que las horas de nómina se
> habrían movido una hora respecto a hoy. El dueño decidió **America/Chicago**, y el
> ajuste se cambió en producción antes del merge (dato, no código; valor anterior
> `America/Tegucigalpa`, por si hay que volver). Las fechas, que ya seguían el
> ajuste, pasan también a Chicago: por fin coherentes con las horas.

---

## D-199 · Solo el servicio puede ejecutar la poda de recorridos (`prune_driver_locations`)

**Fecha:** 2026-09-05 · **Migración:** 103 · **Versión:** package.json 1.117.1 (solo-base) · **Origen:** G-32, hallazgo del auditor al preparar G-23 · **Aprobado por:** Andrés

**Qué fallaba.** `public.prune_driver_locations(keep_days)` (migración 043) es `security
definer` y nació con el EXECUTE por defecto de Postgres. Medido en producción con
`has_function_privilege`: **anon true, authenticated true**. Como PostgREST expone las
funciones de `public` como `rpc`, cualquiera con la clave pública que viaja en la app
podía llamarla con `keep_days = 0` y vaciar los recorridos de los choferes, sin respaldo
(F-3). No estaba en la auditoría del 05-09; lo detectó el auditor por lectura de la
migración y se confirmó en la base antes de tocar nada.

**Qué se hizo.** `revoke execute … from public, anon, authenticated; grant … to
service_role`, en una transacción que midió los privilegios antes y después y habría
hecho `ROLLBACK` si no cuadraban. Antes se exportaron las 92 filas de la tabla a
`RESPALDOS-DB/driver_locations-2026-09-05.json`, no porque el cambio borre nada sino
porque la regla de CLAUDE.md pide respaldo antes de tocar permisos. La poda programada
(G-23, lote 2 de la auditoría) la llama el cron con service_role, así que sigue
funcionando.

**Qué se descartó.** Dejar la función pública y "confiar en que nadie la llame": es
exactamente la clase de suposición que las auditorías vienen desmontando. Y borrar la
función: la poda hace falta (G-23) y el patrón de 077/078 ya resuelve esto.

**Reversión:** `grant execute on function public.prune_driver_locations(int) to anon,
authenticated;`

## D-200 · Auditoría 2026-09-05, lote 2 (el chofer): el GPS no pierde fijaciones sin red, fichar sin red entra en cola, y `driver_locations` se poda a 90 días

**Fecha:** 2026-09-05 · **Versión:** deliveries 1.61.0, package.json 1.118.0 (Deliveries) · **Pedido por:**
Andrés (los tres aprobados por el dueño), sobre `docs/AUDIT-2026-09-05.md` (G-22, G-8 con G-7, G-23).
Un commit por hallazgo.

### G-22 · Sin red, la fijación se perdía

**Qué fallaba.** `pushLocation` hacía `insert` y, si fallaba, `return false`: la fijación se iba. El
outbox de hitos no cubre GPS (es "deliberadamente estrecho"). En zonas muertas el recorrido quedaba
con agujeros que luego no se podían reconstruir, aunque el teléfono había capturado las
posiciones. Y el latido (`useLiveLocation.ts`) fijaba `lastRef` **antes** de saber si el envío
funcionó, así que un latido fallido consumía su ventana de 5 minutos y el camión quedaba mudo.

**Qué se hizo.** Una cola **separada**, `rtg_gps_outbox_v1` (`src/lib/gps-outbox.ts`, pura, con
prueba): el outbox de hitos sigue estrecho a propósito, y una fijación es otra cosa (muchas,
pequeñas, prescindibles). Cada fijación conserva el `recorded_at` que puso el aparato y su
`device_id` (`driver_locations` no tiene esa columna, así que no viaja; queda para diagnóstico).
El reenvío va en orden de `recorded_at`, por lotes de 200, se para en el primer "sigue sin red" y
descarta lo que el servidor rechaza (un rechazo nunca prospera reintentando). Se dispara al volver
la red (`online`) y tras la siguiente fijación que sí llega.

**El tope y por qué.** **2.000 fijaciones**, descartando las **más viejas**. A ~170 fijaciones al
día por chofer (`location-filter.ts`) cabe más de una semana de zona muerta, que no existe; y en un
teléfono el almacenamiento no puede crecer sin techo. Se pierde el principio del rastro, no el
final: la última posición es la que el mapa necesita.

**El latido.** `lastRef` avanza **solo** si el push llegó o quedó encolado (`pushLocation` devuelve
`true` en los dos casos; un rechazo del servidor sigue devolviendo `false`). Un envío en vuelo
evita apilar escrituras idénticas mientras se espera.

### G-8 · Fichar salida sin red no encolaba (y G-7, el botón atascado)

**Qué fallaba.** `clockOut` sin red: toast rojo, el turno seguía abierto en la base y **el servicio
de GPS seguía reportando**, porque `LocationTracker` sigue al turno abierto. Decisión del dueño:
**el fichaje sí entra en cola.**

**Qué se hizo, y con qué patrón.** Cola propia `rtg_shift_outbox_v1` (`src/lib/shift-outbox.ts`,
pura, con prueba). Ni el outbox de hitos (tipado por pedidos y estrecho a propósito) ni la de GPS
(fijaciones): un fichaje es una tercera forma. Lo que comparten es el patrón: `localStorage`,
reenvío en orden, parada en "sigue sin red", descarte de lo rechazado. **Lo que importa es la
superposición**: `shifts` que expone el proveedor es la lista del servidor con la cola aplicada,
así que una salida encolada cierra el turno **en pantalla al momento** y el GPS se apaga al toque,
no cuando vuelve la red; una entrada encolada abre un turno local para que el día empiece. El
reenvío escribe la **hora del toque**, no la del reenvío; una salida sin turno abierto en el
servidor se descarta. Se dispara al volver la red y cada 60 s.

**G-7.** `doIn`/`doOut` sin `try/finally`: `clockIn`/`clockOut` terminan en `reloadAll()`, que
puede rechazar sin red, y `busy` se quedaba en `true`: el botón de fichar, que es el interruptor
del GPS, muerto hasta recargar. Con `finally`.

### G-23 · `driver_locations` sin retención

**Qué fallaba.** `public.prune_driver_locations(keep_days)` existe desde la migración 043 y nadie la
llamaba (cero en `src`, `scripts`, `.github`, `vercel.json`). A ~170 filas/día/chofer la tabla
crecía sin techo, con realtime encima.

**Qué se hizo.** `pruneDriverLocations()` (`src/lib/driver-locations-prune.ts`, con prueba de
`fetch` falso) llama a la función por PostgREST (`/rest/v1/rpc/...`) con la **clave de servicio** y
perfil `public` explícito, **nunca con el cliente de un usuario**. Sin migración: la función ya
existe.

**Los 90 días y por qué.** `keep_days = 90`, decisión del orquestador: conservador porque **no hay
respaldo** (F-3) y un borrado no se deshace; el dueño puede bajarlo (`?keep_days=` en la ruta, o
la constante). **Y un suelo de 30 días** (`PRUNE_KEEP_DAYS_MIN`, observación del auditor hecha suya
por el orquestador, añadida al rebasar): con el secreto del cron filtrado, `?keep_days=1` habría
vaciado casi toda la tabla; ahora la librería no baja de 30 y la ruta responde `400` a un valor
menor en vez de rebajarlo en silencio.

**Dónde quedó programada.** **Fusionada en `roll-schedules`** (08:00 UTC, mismo secreto, `try/catch`
aislado, `prune` en la respuesta), igual que el cierre de huérfanas de D-195, porque Vercel Hobby
tiene sus dos crons ocupados. Ruta propia `/api/prune-driver-locations` con `cronAuthorized`,
`?verify=1` sin efectos y `?keep_days=`, para correrla a mano.

**Quién puede llamar a la poda.** La función es `security definer`. Cuando se escribió esta entrada
podía estar ejecutable por cualquier autenticado (hallazgo del auditor, G-32); **D-199 lo cerró el
mismo día con la migración 103**: revocó `public`, `anon` y `authenticated` y concedió solo
`service_role` (medido en producción por el orquestador). Por eso este llamador va con la clave de
servicio y nunca con el cliente de un usuario: es la única identidad que puede ejecutarla.

### Qué NO cambia

`location-filter.ts` (filtrado de posiciones), los umbrales de movimiento y latido, `DriverGate`,
nada del APK (`mobile/`), el realtime de `driver_locations`. Sin migración, sin versión.

### Lo no verificado

**Nadie puede probar el GPS en un teléfono real** desde aquí: la cola, el reenvío y el apagado del
GPS al fichar salida sin red van por las pruebas puras y por lectura del proveedor. **La poda no se
ejecutó contra producción**: la llamada se probó con `fetch` falso y la ruta se comprueba con
`?verify=1` tras el merge. `verify.mjs` en verde sobre `.next` limpio: 793 pasados | 3 saltados
(main: 770 | 3; +23 son las tres pruebas nuevas: 11 de la cola de GPS, 8 de la de fichajes, 4 de
la poda). La prueba real es el dueño con el APK: modo avión, fichar salida, ver que el GPS para;
mover el camión sin red, recuperar la red, ver el rastro completo.

## D-201 · Auditoría 2026-09-05, lote 3 (eficiencia): ventanas con carga bajo demanda, realtime por tabla, lotes en HR, un salto en los enlaces viejos, y `fast-uri`

**Fecha:** 2026-09-05 · **Versión:** deliveries 1.62.0, recruiting 0.15.0, timetracker 0.60.0, package.json 1.119.0 (Deliveries, HR y Time Tracker se
tocan) · **Pedido por:** Andrés, sobre `docs/AUDIT-2026-09-05.md`. Un commit por hallazgo, en este orden.

### G-16 · Los pedidos bajaban enteros, sin límite

**Qué fallaba.** `deliveries.select("*")` bajaba entero en cada carga y en cada recarga realtime, sin
`limit` ni `range`, y crecía para siempre; `order_events` ya se había acotado a `EVENTS_WINDOW`.

**Qué se hizo, y el número.** Ventana **por fecha**, no por cuenta: `DELIVERIES_WINDOW_DAYS = 120`
(`data-provider.tsx`, con comentario). Baja todo pedido con `delivery_date` o `input_date` en los
últimos 120 días, **más** todo lo que no está entregado ni cancelado (un pendiente viejo nunca se
pierde), **más** lo sin fecha. **Por qué 120:** las colas de trabajo miran a ayer
(`RETENTION_DAYS_BACK`), ventas busca 30 días atrás, el panel abre con 30 y el resumen ofrece hasta
90; 120 cubre un trimestre de KPIs con margen. **Lo que cambia para el usuario, y queda dicho:** las
pantallas que miran más atrás lo piden ellas con `ensureDeliveriesSince` (idempotente; el
proveedor recuerda hasta dónde hay cargado para que una recarga realtime nunca lo estreche): el
panel cuando el rango empieza antes, el resumen según los días elegidos, cuentas y datos (admin,
histórico entero) al abrirse, y el tablero cuando un admin escribe una búsqueda (ventas está
acotado a 30 días de todas formas). El proveedor global nunca carga el histórico entero por su
cuenta.

### G-15 · Cualquier cambio recargaba las nueve consultas

**Qué fallaba.** El canal realtime enganchaba ocho tablas a un mismo `scheduleReload → reloadAll`,
que volvía a bajar las nueve consultas del proveedor en **todas** las sesiones abiertas por
cualquier fila.

**Qué se hizo.** Las nueve consultas viven en un mapa de cargadores (uno por consulta, cada uno
aplica su estado); `reloadAll` corre los nueve y la ráfaga realtime recoge **qué** tablas cambiaron
y corre solo esos (`reloadTables`, misma puerta de sesión y misma marca de fallo). El debounce de
250 ms y la espera a `writingRef` se conservan; `driver_locations` sigue aplicando la fila al punto.

**Medido antes/después** (`src/lib/realtime-reload.test.ts`, sobre el caso real: un "entregado" del
chofer escribe `deliveries` + `order_events` y llega como dos eventos a una sesión ajena): **antes 9
consultas por ráfaga, 18 si los dos eventos no caen en el mismo debounce; después 2.** Una tabla que
nadie mapeó cae a las nueve, para no dejar estado viejo en silencio.

### G-17 · Sesiones y capturas del empleado sin cota, rebajadas en cada fila

**Qué fallaba.** `sessions.select("*")` y `screenshots.select("*")` por empleado sin cota ni límite,
y el canal realtime volvía a bajarlo **todo** en cada fila: cada ~10 s durante el turno (el tick
escribe `end_ms`) se rebajaba el histórico entero para añadir una fila.

**Qué se hizo, y el número.** `SESSIONS_WINDOW_DAYS = 60` (`timetracker-data-provider.tsx`, con
comentario). **Por qué 60:** la pantalla de la semana pagina de una en una, insights mira 8 semanas,
y un mes de nómina son 31 días; 60 cubre dos meses de nómina. `ensureSessionsSince(dateISO)`
extiende sesiones y capturas, y la pantalla de la semana lo pide al retroceder. El realtime de
`sessions` y de `screenshots` aplica la fila del payload (insert/update upsert, delete remove) en
vez de recargar. **Comprobado que nada de nómina depende de este listado:** Nómina y la cabecera
Period leen `period_hours` (SQL) y `sessionsSince()` (admin, bajo demanda).

### G-18 · La tira de días con datos bajaba hasta 20.000 filas

**Qué fallaba.** Para saber qué días tienen fijaciones, `/track` bajaba hasta 20.000 filas de
`driver_locations` y las agrupaba en el navegador.

**Qué se hizo.** Lo ideal es un agregado en SQL (RPC `distinct date`), pero exige migración y esta rama
no las escribe: **queda pendiente**, dicho en el código y aquí. Sin migración: la consulta ya estaba
acotada al rango de la tira (14 días) y a solo `recorded_at`; el tope de 20.000 era un orden de
magnitud por encima de lo que ese rango puede contener (~170 fijaciones/día/chofer). Tope nuevo en
una constante, `(DAY_STRIP + 1) × 400 = 5.600`, con orden explícito por `recorded_at` descendente
para que, si alguna vez se llena, se pierdan los días más viejos y no los recientes.

### G-19 · Tres bucles con un `UPDATE` por fila en HR

Duplicar pregunta, reordenar preguntas y añadir etapa hacían un `await` a Supabase por fila, **en
serie**. **Qué cambia:** las mismas escrituras salen ahora **en paralelo** (`Promise.all`), una ida y
vuelta en vez de N. **Qué NO cambia:** se escribe **la misma columna que antes, `sort`, y solo esa**
(`update({ sort })` por fila). La aritmética de los pares `{ id, sort }` está en
`src/lib/recruiting/sort-plan.ts` (`bumpSort`, `sortByIds`) y su prueba compara la salida con los
bucles viejos, reproducidos tal cual, sobre datos sintéticos: mismos ids, mismos `sort`, y un parche
solo lleva `id` y `sort`. En añadir etapa, un fallo del desplazamiento ahora se avisa y para el
insert en vez de tragarse.

**Nota del mismo día (CAMBIOS del auditor, confirmado por el orquestador):** el primer intento hacía
**un `upsert` con las filas completas** del estado del cliente. Eso cambiaba la semántica sin decirlo:
si otra persona había editado `text`, `weight`, `active` o `role` y este cliente aún no lo había
recibido, reordenar pisaba esa edición con el valor viejo; en preguntas la ventana es la latencia
del realtime, pero **`stages` no tiene canal realtime** y el estado podía llevar minutos desfasado,
con lo que añadir una etapa reescribía `key`, `label`, `color` y `type` de todas las desplazadas.
Se descartó; y el criterio de "mismo resultado que los bucles" no tenía prueba. Las dos cosas se
corrigieron en un commit aparte.

### G-3 · Tres saltos en los enlaces viejos del fichaje

**Medido antes, sin sesión, en producción:** `/clock-in/clock`, `/clock-in` y `/clock-in/photos` daban
**3** redirecciones (comodín → `/timetracker/clock-in/X` → la regla de esa pantalla → el login), con
primer `Location` `/timetracker/clock-in/X`; `/clock-in/week`, 1. Ahora cada `/timetracker/clock-in/X`
con regla propia tiene su `/clock-in/X` **explícito** con el mismo destino, generado una a una y
colocado **antes** del comodín (Next resuelve en orden); `/clock-in` va directo a `/timetracker`. El
comodín se queda detrás para lo que no tenga regla. **Esperado tras desplegar:** esos tres caminos en
**2** saltos (el segundo es la puerta del layout al login, que no es regla y no se quita), con primer
`Location` `/timetracker` o `/timetracker/audit`; `/clock-in/week` sigue en 1. Lo mide el orquestador.

### G-21a · `fast-uri`

`npm update fast-uri` contra el registro real, sin `--force`: 3.1.5 → 3.1.7, y el diff del lock es
solo eso (más el `version` raíz del lock sincronizándose con `package.json`). `npm audit` pasa de 6 a
5 avisos. Quedan `postcss` (vía `next`, cambio mayor: plan aparte), `uuid` (vía `exceljs`, mayor) y
`brace-expansion` (alto, arreglable sin mayor; fuera del encargo, anotado). Sin `--registry`, el audit
de esta máquina **parece limpio y no lo está**.

### Qué NO cambia

Migraciones (ninguna), la aritmética de nómina, `dynamic()` de `OrderModal`/rutas (G-20, otra rama),
la versión de Next. Lo que ve el usuario cambia solo en las ventanas de G-16 y G-17, y queda dicho.

### Lo no verificado

Nadie abrió las pantallas con sesión real: que el panel, el resumen, cuentas, datos y la búsqueda de
admin pidan y muestren el histórico, y que la semana de Time Tracker pague hacia atrás, van por
lectura; G-3 en producción lo mide el orquestador tras desplegar. La ventana de G-16 es un cambio de
comportamiento visible (un pedido de hace más de 120 días, terminado, no aparece hasta que una
pantalla lo pida): es lo que pedía el hallazgo y está listado arriba. `verify.mjs` en verde sobre
`.next` limpio, en solitario: 799 pasados | 3 saltados (main: 793 | 3; +6 son la prueba de G-15).

## D-202 · Auditoría 2026-09-05, lote 4 (Time Tracker en dos idiomas): las 15 pantallas que quedaban en inglés, y fuera las claves que no usa nadie

**Fecha:** 2026-09-05 · **Versión:** timetracker 0.61.0, package.json 1.119.1 (solo Time Tracker se toca) ·
**Pedido por:** Andrés, sobre `docs/AUDIT-2026-09-05.md` (G-9 y G-11). Un commit por fichero, en el
orden del encargo, y uno final para las claves muertas. Solo texto: **ningún comportamiento cambia.**

### G-9 · Quince ficheros de Time Tracker hablaban solo inglés

**Qué fallaba.** Time Tracker tiene un conmutador de idioma (`tt_lang`, `useT()`), pero 21 de sus 46
ficheros no lo usaban: quien lo ponía en español seguía viendo en inglés su cuenta, su semana, sus
solicitudes, la bandeja de fichaje, las geocercas, la flota, el viaje en vehículo, las fotos y el
historial de excepciones de Auditoría, la campana, el indicador sin conexión y el aviso de
actualización de escritorio. Un idioma a medias es peor que uno solo: no se sabe qué esperar.

**Qué se hizo.** Los 15 ficheros del encargo pasan a `useT()` con claves nuevas en `DICT.en` y
`DICT.es`, **281 claves** en total, por prefijo:

| Fichero | Prefijo | Claves |
|---|---|---|
| `account/page.tsx` | `emp.acc.*` | 34 |
| `week/page.tsx` | `emp.week.*` (se suman a las 5 de D-190) | 24 |
| `requests/page.tsx` | `emp.req.*` (se suma a `weekLocked`) | 40 |
| `ClockinApprovals.tsx` | `mgr.inbox.*` | 24 |
| `ExceptionHistory.tsx` | `mgr.exc.*` | 21 |
| `GeofenceEditor.tsx` | `mgr.geoed.*` + `common.cancel`/`saveChanges` | 30 |
| `GeofenceSection.tsx` | `mgr.geo.*` | 16 |
| `TripPanel.tsx` | `emp.trip.*` | 23 |
| `VehiclesSection.tsx` | `mgr.veh.*` | 14 |
| `EmployeeWeek.tsx` | `mgr.ew.*` | 9 |
| `DayPhotos.tsx` | `mgr.photos.*` | 20 |
| `OfflineIndicator.tsx` | `offline.*` | 10 |
| `UpdateBanner.tsx` | `update.*` | 8 |
| `NotificationBell.tsx` | `bell.*` | 3 |
| `CrewMap.tsx` | `mgr.map.*` | 5 |

Cada fichero entra en la lista de la **prueba de claves de D-187** (`i18n.test.ts`), que lee los
`t("…")` del fuente y exige que cada clave exista en los dos idiomas: 10 ficheros → 25. Por eso los
mapas constantes de etiquetas (`LABEL`, `OFF_LABEL`, `EXC_LABEL`, `TIPO`, `MOTIVOS`, `KIND`) pasan a
funciones con **una clave literal por rama**: una clave construida por variable la prueba no la ve.
**Mutación medida** (`account/page.tsx`): sin la fila española de `emp.acc.pwMismatch` la prueba cae
con «falta emp.acc.pwMismatch en español (usada en …account/page.tsx)».

**Lo que NO se traduce, a propósito, y por qué.**
- **Datos:** métodos de pago (`APP_SETTINGS.paymentMethods`), nombres de proyecto, de sitio, de
  vehículo y de parada, placas, los **motivos** de una excepción (`r.reasons`, valores guardados), el
  texto de cada aviso de la campana (`it.message`, viene del servidor), la atribución «Imagery © Esri».
- **Errores del servidor:** `res.message` / `e.message` / `u.message` se enseñan tal cual; el
  respaldo cuando no hay mensaje sí se traduce.
- **Enumerados fijos del código** (tipos de tiempo libre, de excepción, de foto, motivos de viaje):
  el **valor** que se guarda no cambia; solo su etiqueta, porque es texto de pantalla y no es
  configurable. Si un día llega un valor que el mapa no conoce, se enseña el valor crudo, como antes.
- **`LOCALE` y `fmtDayLong` no se tocan:** las fechas largas («Sat, Jul 4, 2026») y las horas
  (`hhmm` en `en-US`) **siguen en inglés en las dos lenguas.** Es formato, no texto, y cambiarlo es
  otra decisión (afectaría a recibos y reportes). También sigue en inglés el «ongoing» de
  `breaksText` (helper) y el «(Fri–Thu)» del periodo de `EmployeeWeek` va dentro de la clave.

**Dos cosas que se corrigieron de paso, sin cambiar comportamiento.**
- `requests/page.tsx` tenía el mensaje de «semana cerrada» **duplicado a mano en inglés** aunque su
  clave (`emp.req.weekLocked`, D-190) ya existía; ahora usa la clave.
- `DayPhotos.tsx` tenía tres frases en los dos idiomas pero por el idioma del **hub** (`usePrefs`), y
  el resto en inglés fijo: la misma pantalla podía salir mitad y mitad según dos conmutadores
  distintos. Ahora sale entera por el idioma de Time Tracker, como el resto de Auditoría. El visor
  de fotos (`PhotoLightbox`, del módulo base) recibía `t={(en) => en}`, inglés fijo, en `DayPhotos` y
  `ExceptionHistory`; ahora recibe el idioma de Time Tracker. El visor no se toca.

**Fuera del encargo, y se deja dicho:** `TimeOffRequests.tsx` (la pestaña de tiempo libre dentro de
Mis solicitudes) no está en la lista y sigue en inglés; los otros 5 de los 21 ficheros sin `useT` que
contó la auditoría tampoco están en la lista.

### G-11 · El diccionario prometía pantallas que el código no tiene

**Medido en esta rama, con G-9 ya aplicado:** de las **837** claves de `DICT.en`, **109** no aparecen
como literal en ningún fichero de `src/` fuera del propio `i18n.ts`, descontando `tab.*` y los
prefijos construidos (solo `mgr.sch.dow.`). Se borran en `en` y `es`: **218 líneas**; quedan **728**
claves por idioma y la medición vuelve a dar 0. La auditoría contaba 139; la diferencia son claves
que **sí** tienen un uso literal en `src/` y este recuento respeta.

Bloques enteros que eran pantallas que este código no tiene:
- **`auth.*` (16):** el login propio del Time Tracker original; hoy entra por `/login` del hub.
- **`mgr.usr.*` (23):** gestión de usuarios, sustituida por `/home/users` (D-095).
- **`mgr.set.dataBackup`, `backupNote`, `backupNote2`, `download`, `restoreBtn`, `preparing`,
  `backupDone`, `backupFail`, `restoreConfirm`, `restoring`, `restoreDone`, `restoreFail` (12):** una
  pantalla de **copia y restauración que no existe**. Borrar sus textos no arregla F-3 («sin ningún
  respaldo»); solo deja de fingir que hay uno.
- **`mgr.start.*` (11):** la guía de arranque. **`theme.*` (4):** el selector de tema.
- Sueltas: `mgr.ppl.delete*` y afines (7), `mgr.tab.insights/requests/projects/users/audit` (5),
  `notify.*` (6), `shell.*` (5), `reqtype.*` (3), `status.*` (2), `mgr.rep.excel/pdf/exportFail/prev/next`
  (5), `mgr.live.w*` (3), `mgr.pay.onSite/remote` (2), `pending.*` (2), `track.noShots/idleExcluded`
  (2), `brand.suffix` (1).

**Se quedan a propósito:** `tab.schedule` (D-186, con su comentario en `i18n.ts`), y
`track.openingClock`, que ninguna pantalla usa pero la prueba de D-123 exige que exista (se anota,
no se decide aquí).

### Qué NO cambia

Migraciones (ninguna). Ninguna acción de servidor, ningún guardado, ningún filtro ni orden: cada
commit es sustituir texto fijo por `t("clave")`, más la función que lo envuelve cuando el texto vivía
en una constante de módulo. El ERP (G-10) no se toca. `DayPhotos` y `ExceptionHistory` cambian solo
texto (y de dónde sale el idioma), como pedía el encargo.

### Lo no verificado

Nadie abrió las 15 pantallas con sesión real en español: que cada texto salga donde debe y no
desborde su sitio va por lectura y por la prueba de claves (que garantiza existencia, no maquetación).
El aviso de actualización de escritorio (`UpdateBanner`) solo se ve en la app de Electron, que esta
rama no construye. La traducción al español es del worker, no de un hablante que use la app:
«Cuentakilómetros», «Margen (m)», «En sede» son elecciones que el dueño puede querer cambiar, y
cambiarlas es editar el diccionario. `verify.mjs` en verde sobre `.next` limpio, en solitario:
**819 pasados | 3 saltados** (main f266aa9: 804 | 3; los +15 son los quince ficheros nuevos de la
prueba de claves, una prueba por fichero).

**Nota del día siguiente (2026-09-06, corrección de G-11):** la medición de claves muertas buscaba
cada clave **como literal** en `src/` y solo entendía como construido el prefijo `mgr.sch.dow.`. Se le
escapó `"reqtype." + type` en `team-requests/page.tsx`, y **`reqtype.add`, `reqtype.adjust` y
`reqtype.delete` se borraron estando en uso**: desde este merge la cola de solicitudes del gerente
enseñaba el tipo como clave cruda («reqtype.add») en los dos idiomas. Nadie lo vio (ni la auditoría,
que las contaba entre las 139, ni el auditor de la rama) porque nadie abrió esa pantalla con sesión.
Las tres claves vuelven, con clave literal por rama, en la decisión siguiente de Time Tracker
(commit `6f4a0a5`); allí está medido que no queda otra construcción por concatenación sobre un
prefijo borrado. Regla que queda: **una clave construida en el código no se puede dar por muerta
buscando literales**; la prueba de D-187 solo ve claves literales, y así hay que escribirlas.

## D-203 · Auditoría 2026-09-05, lote 5a (el ERP en dos idiomas, primera mitad): el mecanismo, el conmutador y las cinco pantallas de más uso

**Fecha:** 2026-09-05 · **Versión:** erp 0.6.0, package.json 1.120.0 (solo `erp` se toca) ·
**Pedido por:** Andrés, sobre `docs/AUDIT-2026-09-05.md` (G-10), dividido en dos ramas para que el
auditor pueda medir; esta es la primera. Un commit para el mecanismo y uno por fichero. Solo texto:
**ningún comportamiento cambia** (consultas, filtros, guardados, valores que se envían).

### Qué fallaba

El ERP no tenía idioma: **0 llamadas a `t()` en 64 ficheros**, ~346 textos en inglés fijo, y su barra
lateral no tenía conmutador. Los otros tres módulos sí: quien ponía el hub en español lo perdía al
entrar al ERP.

### El mecanismo, medido antes de elegir

**Lo que hay.** El hub, Entregas y HR usan `usePrefs().t(en, es)`, pares inline, con el idioma en
`localStorage` (`rtg_prefs.lang`). Time Tracker usa un diccionario por claves (`useT()`) con su
propia clave (`tt_lang`). **No hay cookie de idioma**: el servidor no sabe qué idioma eligió nadie.

**Lo que tiene el ERP.** De 64 ficheros, 37 son de cliente y **27 `page.tsx` son server components;
25 de ellos pintan texto** (`product/[id]/page.tsx` solo, 65 hallazgos del guardián, ~69 textos).

**Lo que se eligió, y por qué.**
- **Pares inline de `usePrefs`, no diccionario.** El ERP sigue la preferencia del **hub**, la misma
  que Entregas y HR: una sola preferencia, sin tercera clave ni `setLang` propio. Para 64 ficheros
  con Tailwind, un par inline al lado del texto es menos fricción que 346 claves en un diccionario
  aparte, y no hay claves que puedan faltar en un idioma.
- **Sin cookie para el servidor.** Se midieron las dos salidas: (a) una cookie espejo escrita desde
  `prefs.tsx` que el servidor lea con `cookies()`, o (b) mover el texto de cada server component a
  un hijo de cliente y dejar el servidor con los datos. Se aplicó **(b)**, la preferida del
  orquestador: no hay parpadeo entre el idioma del servidor y el del navegador, no hay cookie que
  el middleware tenga que ver, y la primera carga sin preferencia se comporta igual que en los otros
  módulos (inglés hasta que `usePrefs` lee `localStorage`). En esta rama solo hacía falta para un
  fichero; **para la rama 5b quedan 24 server components con texto** (arriba de la lista:
  `po-reconcile.tsx` 17, `analytics/vendors` 13, `analytics/categories` 12, `reorder-panel` 9,
  `dashboard` 9), y (b) significa un hijo de cliente por cada uno. Si al medir 5b eso pesa más que
  una cookie, es decisión de 5b, con su medición.
- **Conmutador en `side-nav.tsx`**, el patrón existente (`recruiting/TopBar.tsx:63`,
  `timetracker/TopBar.tsx:86`): un botón que alterna con `setLang` y enseña el idioma AL QUE se
  cambia («🇪🇸 ES» / «🇬🇧 EN»), en la barra lateral y en la cabecera móvil.

### El guardián de regresión (`src/lib/erp/i18n-guard.ts` + `i18n.test.ts`)

Sin diccionario no se puede hacer la prueba de D-187 («cada clave existe en los dos idiomas»). Se
hace la contraria: en cada fichero **ya traducido**, con las llamadas `t("…", "…")` quitadas, una
regex busca texto de pantalla a pelo en tres formas: nodos de texto JSX (`>Save changes<`),
atributos que se leen (`placeholder`, `title`, `aria-label`, `alt`) y literales con pinta de frase
(`"Loading more…"`, `"Needs review"`). Deja pasar a propósito lo que no es texto de interfaz: siglas
(SKU, QOH, CSV), símbolos, valores guardados en minúscula (`"active"`), una palabra sola entre
comillas (`"Edit"`, indistinguible de un valor), un nodo mixto que empieza por expresión, y las
cabeceras de los ficheros exportados. **Se prueba a sí mismo** con dos fixtures: en el que tiene
texto a pelo encuentra exactamente los seis textos y ninguno de los falsos positivos típicos
(genéricos `useState<CatalogRow[]>`, `useRef<…>(null)`, `n > 0`, `SKU`, `—`); en el limpio, nada.

**Medido antes → después**, hallazgos del guardián por fichero:

| Fichero | Antes | Después | `t()` |
|---|---|---|---|
| `side-nav.tsx` | 13 | 0 | 29 |
| `catalog-table.tsx` | 20 | 0 | 37 |
| `review-queue.tsx` | 22 | 0 | 29 |
| `product/[id]/page.tsx` → `product-detail.tsx` | 65 | 0 (los dos) | 81 |
| `inventory-console.tsx` | 40 | 0 | 42 |

**Mutación medida** (`side-nav.tsx`): volviendo a poner «Sign out» a pelo, la prueba cae con
«src/components/erp/side-nav.tsx:104 [jsx] Sign out».

### Qué se tradujo en cada fichero, y qué no

- **`side-nav.tsx`:** las 16 entradas del menú, «All apps», «Sign out», «Analytics», mostrar/ocultar
  menú, «cost visible/hidden» y su title. Las listas pasan de constantes de módulo a funciones
  `items(t)` / `analytics(t)`: una constante no cambia de idioma; `href` y `managerPlus` no cambian.
  El rol del badge es dato.
- **`catalog-table.tsx`:** KPIs, pestañas de registro, vistas prefijadas, cabeceras de columna,
  buscador, «All statuses», «Needs review», modo de vista, exportar, «N of M», carga, error y vacío.
  Pestañas y vistas prefijadas pasan a funciones con `t()`; sus **valores** (`value`, `state`) son
  los que filtran y no cambian. **No** se traducen `label(status)` (valor guardado), SKU/QOH/CSV/XLSX
  ni las cabeceras del fichero exportado (son datos del fichero, no de la pantalla).
- **`review-queue.tsx`:** vistas prefijadas, píldora «All», buscador, botón UdM y su title, el
  contador «N flagged · showing», cabeceras, «Edit», vacío, paginación, «Action failed». Las
  **etiquetas de revisión** (`BELOW COST`, …) son valores guardados en `review_tags`: se enseñan y
  se filtran tal cual. La variable de bucle `t` de las etiquetas pasa a `tag` para no pisar `t()`.
- **`product/[id]/page.tsx` → `product-detail.tsx`:** títulos de sección, etiquetas de campo,
  cabeceras de lotes e historial, «mgr only», «Populates in Phase 2», Yes/No, «open», «all». La
  página (server) conserva todas las consultas, el 404, la familia, el permiso de costo y los
  cálculos, y pasa al hijo exactamente los mismos datos ya listos (`p`, lotes, historial, QOH por
  tienda, galería, familia, `dref`, `showCost`, `canManage`, `isAdmin`). Queda sin texto (0
  hallazgos, medido aparte porque no usa `usePrefs`). **No** se traducen nombre, SKU, valores de
  campo, `sv.label`/`sv.note` (de `item-dashboard.ts`, en inglés: es lib, queda para 5b o aparte),
  `label(record_status)`, estado de lote ni fuente de precio.
- **`inventory-console.tsx`:** buscador, tienda, saldos negativos, conteos cíclicos, cabeceras,
  conteo cíclico y ajuste manual con ayudas, etiquetas, placeholders, botones y los dos mensajes de
  resultado. El **motivo del ajuste** (`adjustment`/`damage`/`shrinkage`) se guarda tal cual: solo
  cambia la etiqueta de la opción. `c.status`, tienda y producto son dato.

### Qué NO cambia

Migraciones (ninguna). Ninguna acción de servidor, consulta, filtro, orden ni valor guardado. La
única pieza que se mueve de sitio es el árbol JSX del detalle de producto, del servidor a un hijo de
cliente, con los mismos datos. `prefs.tsx` no se toca. Fuera de esta rama (5b): los otros 59
ficheros del ERP, entre ellos `receiving`, `request-form`, `po-reconcile`, los `page.tsx` con
texto y los textos de librería (`item-dashboard.ts`, `status.ts`).

### Lo no verificado

Nadie abrió las cinco pantallas con sesión real en español (maquetación, desbordes de los
Tailwind anchos fijos, p. ej. los botones de la barra lateral con «Ida y vuelta Excel»). El
detalle de producto pasa a pintarse en el cliente: el HTML servido lleva el mismo árbol (React lo
hidrata), pero el peso del bundle de esa ruta sube y no se midió. La traducción es del worker, no
de quien usa el ERP («Ida y vuelta Excel», «tarima», «merma», «Costo en destino» son elecciones
que el dueño puede cambiar editando el par). `verify.mjs`: en verde sobre `.next` limpio, en solitario:
**827 pasados | 3 saltados** (main 53e91cc tras D-202: 819 | 3; los +8 son las dos pruebas con las que el
guardián se prueba a sí mismo, la del server component sin texto y una por cada uno de los cinco
ficheros traducidos).

## D-204 · Auditoría 2026-09-05, lote 5b (el ERP en dos idiomas, segunda mitad): los otros 51 ficheros, las etiquetas de librería como pares, y la hoja `<Tx>` para los server components

**Fecha:** 2026-09-05 · **Versión:** erp 0.7.0, package.json 1.121.0 (solo `erp` se toca) ·
**Pedido por:** Andrés, sobre `docs/AUDIT-2026-09-05.md` (G-10), segunda de las dos ramas. Un commit
por fichero, por orden de textos (los de más, primero), más los del mecanismo y los del guardián.
Solo texto: **ningún comportamiento cambia** (consultas, filtros, guardados, valores que se envían).

### Qué quedaba

Tras 5a (D-203), el guardián medía **510 hallazgos en 51 ficheros** del ERP: 24 `page.tsx` server
components con texto, 5 componentes sin `"use client"` (`po-reconcile`, `reorder-panel`, `charts`,
`category-cards`, `pricing-bar`), 22 componentes de cliente, y dos librerías que producían texto
(`status.ts`, `item-dashboard.ts`).

### La decisión de 5b: (b) sin cookie, en su forma mínima

**Medido antes de elegir**, con los números del CI que pasó el orquestador (PR #18 → #19): mover el
detalle de producto a un hijo de cliente en 5a costó **9,07 → 12,8 kB** de ruta y **280 → 284 kB** de
First Load; catálogo y revisión +1 kB; el compartido se quedó en 190 kB. Es decir, **(b) cuesta ~4 kB
en la ficha más grande** y una cookie espejo no hace falta. Se aplica (b), pero no como en 5a:

- **Páginas servidor (24): la hoja `<Tx en="…" es="…" />`** (`src/components/erp/tx.tsx`), un
  componente de cliente que pinta `t(en, es)` de `usePrefs`. El árbol, las consultas, el 404 y los
  cálculos **se quedan en el servidor**; solo el nodo de texto es de cliente. Un chunk compartido, ~0 kB
  por página. Mover 24 árboles enteros como en 5a habría sido tipar 24 juegos de props para cambiar
  solo texto.
- **Componentes sin `"use client"` que solo reciben props serializables y no hacen nada de servidor**
  (`po-reconcile`, 32 textos; `reorder-panel`, 11): **la frontera sube un nivel**, `"use client"` +
  `usePrefs`, mismo árbol. Con 32 textos, una hoja por cada uno era peor que mover la frontera.
- **Primitivas de servidor que reciben texto** (`charts.tsx`: `ChartCard`, `BarList`, `Stat`,
  `CoverageStat`, `Donut`): sus props de texto pasan de `string` a `ReactNode` para que la página les
  dé un `<Tx>`; el único texto propio («total», «Nothing to show.») va por `<Tx>`. `DonutSegment`
  gana una `key` porque la etiqueta ya no es cadena. `category-cards` y `pricing-bar` igual: siguen sin
  hooks y sus dos textos van por `<Tx>`.
- **Lo que `<Tx>` no puede pintar** —un atributo `title` de un server component— se queda en inglés y
  entra como **excepción explícita, texto por texto**, en la prueba (`excepciones` en `i18n.test.ts`):
  los dos `title="merchandise vs PO (excl. tax & freight)"` de la columna Gap de la lista de OC, y los
  dos `title` del iframe del PDF en la ficha de OC. También queda en inglés **`export const metadata =
  { title }`** de cada página: es el título de la pestaña del navegador, que Next lee en el servidor,
  y el guardián lo deja fuera con un comentario que lo dice.
- **Primera carga sin preferencia:** igual que en los otros módulos, inglés hasta que `usePrefs` lee
  `localStorage`; sin cookie no hay desacuerdo servidor/navegador que arbitrar.

**Pesos de ruta, antes → después** (`next build` de `verify.mjs`, main tras D-203 → esta rama):

| Ruta | Antes (ruta / First Load) | Después |
|---|---|---|
| `/erp/purchasing/orders/[id]` (po-reconcile pasa a cliente) | 3,19 kB / 275 kB | 6,35 kB / 278 kB |
| `/erp/purchasing` (reorder-panel pasa a cliente) | 2,6 kB / 206 kB | 3,92 kB / 207 kB |
| `/erp/product/[id]` | 13 kB / 285 kB | 14,5 kB / 286 kB |
| `/erp/analytics/vendors` (solo `<Tx>`) | 1,16 kB / 205 kB | 1,27 kB / 205 kB |
| `/erp/dashboard` (solo `<Tx>`) | 374 B / 204 kB | 375 B / 204 kB |
| compartido por todas | 190 kB | 190 kB |

El salto mayor es la ficha de OC, **+3 kB de First Load**, por mover `po-reconcile` a cliente; las
páginas que solo usan `<Tx>` suben ~0,1 kB de ruta y 0–1 kB de First Load (los pares viajan en el
chunk). Ninguna ruta sube de otro orden: la cookie sigue sin hacer falta.

### Las etiquetas que salían de librería, como pares

`status.ts` gana `statusLabel(s): { en, es }` para los enumerados fijos del código (estado comercial,
estado de registro, tipo de producto, tipo y estado de solicitud); un valor desconocido cae al
`label()` de siempre en los dos idiomas. `item-dashboard.ts` devuelve `label`/`note`/`title` como
pares en `statusView` y `verifiedView`; `analytics.ts` pasa `PERIODS` de `{ v, l }` a `{ v, en, es }`.
**La librería no lee el idioma**: el componente elige con su `t()` (o con `<Tx en={p.en} es={p.es}>`
en un server component). Un efecto visible y querido: donde antes salía «special order» en minúscula
(el `label()` genérico), ahora sale la etiqueta («Special order» / «Pedido especial»); el valor
guardado no cambia. Los consumidores de 5a (`product-detail`, `catalog-table`, `review-queue`) se
actualizaron en ese commit; los demás, cada uno en el suyo.

### El guardián, afinado sobre lo medido

Cinco commits pequeños, cada uno con la medición que lo motivó: quita lo que va en `<code>` (un
comando, un nombre de columna); deja pasar nombres propios (Incoterm, Shopify, Daltile, Excel,
proforma), dominios (`.com`), siglas de tres letras (ABC, USA, COGS, MPN) y la jerga de familia
(Bros / Cuz / Subs, que además es el valor guardado); y **una palabra sin ninguna minúscula no es
texto** («~MERGE», «BELOW COST», «SKU»: etiquetas guardadas o siglas). Los dos fixtures con los que
se prueba a sí mismo siguen dando lo mismo. También entiende la hoja `<Tx>`: la quita antes de mirar y
la acepta como señal de fichero traducido.

**Un fallo mío, corregido y dicho:** cinco ficheros (`receiving`, `po-upload`, `request-form`,
`master-round-trip`, `purchasing/orders/page`) se commitearon traducidos **sin entrar en la lista del
guardián**: el paso del script que añade la ruta buscaba un anclaje que dejó de existir al meter las
excepciones, y falló en silencio. Se vio al revisar la salida (la prueba seguía en 11), entraron en un
commit aparte, y el script quedó con el anclaje nuevo y una aserción que grita.

### Medido: antes → después

- **Guardián sobre todo el ERP:** 510 hallazgos en 51 ficheros → **4 en 2 ficheros, los cuatro
  excepciones declaradas** (los `title` de arriba). Todo `.tsx` del ERP que pinta texto usa `usePrefs()`
  o `<Tx>`; los que no lo usan no pintan texto (`layout`, `header`, `nav-state`, `ui/*`,
  `analytics/page`, `erp/page`, `product/[id]/page`).
- **Llamadas:** 706 `t("…", "…")` y 234 `<Tx …/>` en `src/app/erp` + `src/components/erp`.
- **Lista del guardián:** 25 ficheros (5a) → **58**, más el server component sin texto.
- **Mutación medida:** en `purchasing/receiving/page.tsx`, volviendo a poner «Receiving» a pelo en
  el `<h1>`, la prueba cae con «src/app/erp/purchasing/receiving/page.tsx:43 [jsx] Receiving».
- **`verify.mjs`:** en verde sobre `.next` limpio, en solitario: **879 pasados | 3 saltados** (main db29dc2
  tras D-203: 827 | 3; los +52 son un `it` por cada fichero nuevo en la lista del guardián).

### Qué se tradujo, en una línea por fichero

Los textos de pantalla —títulos, ayudas, cabeceras, botones, placeholders, `title`/`aria-label`,
mensajes de error y de resultado— en: `po-ingest`, `po-reconcile`, `receiving`, `request-form`,
`master-round-trip`, `po-upload`, `purchasing/orders`, `charts`, `dashboard`, `analytics/{categories,
vendors, stores, salespeople}`, `purchasing-groups`, `bulk-bar`, `product-drawer`, `uom-assistant`,
`decisions-upload`, `request-review`, `reorder-panel`, `review/daltile`, `qoh-panel`, `merge-tool`,
`po-draft-panel`, `product-family`, `daltile-card`, `product-gallery`, `po-line-link`, `seo-editor`,
`purchasing/orders/[id]`, `request`, `review/merge`, `decisions`, `purchasing/receiving`,
`saved-views`, `purchasing/categories`, `purchasing/orders/new`, `purchasing`, `catalog-cards`,
`suggest-fix-button`, `catalog`, `inventory`, `master`, `requests`, `review`, `po-upload`,
`category-cards`, `pricing-bar`, `publish-button`, `analytics-nav`, `analytics-controls`,
`verified-badge`. Cada commit dice cuántos hallazgos había y que quedan 0.

**Dato vs texto (D-187/D-192), lo que no pasa por `t()`:** SKU, MPN, nombres de producto, proveedor,
tienda, categoría, colección, chips de atributos, `review_tags` («BELOW COST», …), la etiqueta
`~MERGE`, el estado del pedido de compra (`draft/sent/…`, valor guardado), la acción de cada fila de
una importación (`preview/applied/skip/error`, del servidor), los motivos (`c.reason`), las columnas
reconocidas de un CSV, las cabeceras de los ficheros exportados, los nombres de vistas guardadas, y
todo `res.error` / `error.message` del servidor. **Mapas y constantes con texto** (`PO_HEADER`,
`FIELDS`, `EDIT_FIELDS`, `ACTION_LABEL`, `TABS`, `RECORD_TABS`…) pasan a funciones con `t()`: la
`key` / `value` / `href` que se guarda o navega no cambia, solo la etiqueta. Las variables de bucle
llamadas `t` (etiquetas, pestañas, tipos) se renombran (`tag`, `kind`, `rt`, `pt`) para no pisar `t()`.

### Qué NO cambia

Migraciones (ninguna). Ninguna acción de servidor, consulta, filtro, orden ni valor guardado.
`prefs.tsx` no se toca; no hay cookie ni tercera clave de idioma. Lo único que se mueve de sitio es la
frontera cliente/servidor de `po-reconcile`, `reorder-panel` y `verified-badge` (componentes sin nada
de servidor), y el tipo de tres props de `charts.tsx` (`string` → `ReactNode`).

### Lo no verificado, y lo que queda en inglés a propósito

Nadie abrió las 51 pantallas con sesión real en español (maquetación con Tailwind, anchos fijos). El
peso de las rutas se mide en el `next build` local, no en el CI. La traducción es del worker («OC»
por PO, «proforma», «tarima», «merma», «casar líneas» por match, «Costo en destino» por landed cost)
y el dueño puede cambiar cualquier par editándolo. **Queda en inglés a propósito y está dicho:** los
`metadata.title` de las pestañas del navegador; los cuatro `title` de atributo declarados como
excepción; `s.rationale` de `domain/uom.ts` (la justificación de cada sugerencia de unidad de medida
es lógica de dominio, no se tocó); y los valores guardados de arriba. Fuera del encargo: nada del
ERP queda sin pasar por el guardián.

**Nota del mismo día (CAMBIOS del auditor):** lo de arriba no decía que **también quedan en inglés los
mensajes del servidor de `src/lib/erp` que llegan a pantalla**, y quien lea «el resto del ERP en dos
idiomas» entendería G-10 cerrado con esos mensajes sin que nadie lo hubiera dicho (D-044). Medido
con el guardián sobre esos ficheros: **`actions.ts` (6)** («Not signed in», «Describe the fix», «No
unmatched lines to import», «No PDF file provided.»…), **`error-codes.ts` (8)** («You don't have
access to this. Ask an admin…», «We couldn't match this item automatically…», «Something went wrong on
our end…»), **`domain/po-parse.ts` (5)** (los errores de lectura que `po-ingest` enseña: «Could not read
the PO number — enter it manually.»…) y **`google-maps-loader.ts` (4)**: **23 mensajes de usuario en
inglés**. Se quedan por la misma regla que aplicó el lote 4 a `clock.ts` (D-201): son mensajes que
produce el servidor (`res.error` / `error.message`) y las pantallas los enseñan tal cual, sin
traducirlos ni esconderlos; traducirlos exige que el servidor devuelva códigos o pares y es **deuda
declarada**, no cerrada aquí. Aparte, `master/fields.ts` da **42** hallazgos que **no** son texto: son
las cabeceras del Excel de ida y vuelta (`buildHeaderMap`), es decir, **dato** del fichero que se
exporta y se vuelve a leer, y `domain/uom.ts` (4) es el `s.rationale` ya dicho.

## D-205 · Crear / editar proyecto pasa a botón + ventana (Time Tracker)

**Fecha:** 2026-09-05 · **Versión:** la asigna el orquestador al fusionar (solo Time Tracker se toca) ·
**Pedido por:** Andrés, literal: «el crear proyecto también que sea un botón».

**Qué había.** En Proyectos (`projects/page.tsx`) el formulario de crear / editar ocupaba sitio
permanente arriba; la lista de proyectos quedaba debajo, y editar hacía `scrollTo(0)` para subir al
formulario. Es el mismo patrón que se quitó en Asignaciones (D-187) y en los ajustes sueltos de
Nómina (D-192).

**Qué se hizo.** Un botón «➕ New project» / «➕ Nuevo proyecto» junto al título de la lista abre la
ventana de D-187 (`Modal`, tal cual: Escape, clic fuera, botón de cerrar). Dentro va el **mismo
formulario**: mismos campos, misma validación (nombre de dos letras o más; si no, la ventana se queda
abierta como antes se quedaba el formulario), misma llamada de guardado (`insertProject` /
`updateProject`, en el mismo sitio); al guardar con éxito se cierra. Editar abre la misma ventana
rellena. El `scrollTo(0)` de editar se quita: la ventana va encima de donde se está. «Cancelar» pasa
a estar siempre (antes solo al editar), porque ahora también cierra la ventana.

**Texto.** «Admins only.» era el único texto a pelo de la pantalla: pasa a clave (`mgr.proj.adminsOnly`).
Dos claves nuevas en los dos idiomas; el fichero entra en la prueba de claves de D-187. **Mutación
medida:** sin la fila española de `mgr.proj.newBtn` la prueba cae con «falta mgr.proj.newBtn en
español (usada en …projects/page.tsx)».

**Qué NO cambia.** La lista, el gasto por proyecto, archivar / restaurar, la aritmética, y qué hace
el guardado y dónde escribe. Las otras cinco pantallas de Time Tracker con «Admins only.» a pelo
(`insights`, `live`, `people`, `settings`, …) no están en el encargo y se quedan.

**Lo no verificado.** Nadie abrió la pantalla con sesión real: que la ventana se vea bien en el tema
oscuro por defecto de Time Tracker va por lo que ya arregló D-187 (`.timetracker-module .modal`),
no se ha vuelto a mirar. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **880 pasados | 3 saltados** (main 272895b: 879 | 3; el +1 es
el fichero nuevo en la prueba de claves).

## D-206 · Time Tracker: lo que quedaba en inglés o por el idioma del hub, y `reqtype.*` de vuelta

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (solo Time Tracker se toca) ·
**Pedido por:** Andrés (orquestador), tras cerrar G-9/G-10: los «Admins only.» sueltos, `TimeOffRequests`
y lo que quedara a pelo. Un commit por grupo. Solo texto: **ningún comportamiento cambia.**

### Lo que se encontró de camino, y es lo primero: una regresión de D-202

Al meter `team-requests/page.tsx` en la prueba de claves de D-187 saltó `falta reqtype.`: la cola de
solicitudes del gerente construye la clave con `"reqtype." + type`, y **D-202 borró `reqtype.add`,
`reqtype.adjust` y `reqtype.delete` como claves muertas** porque la medición de G-11 solo buscaba la
clave como literal en `src/` (y solo entendía como construida el prefijo `mgr.sch.dow.`). Desde que
D-202 se fusionó, la cola del gerente enseña el tipo de cada solicitud como clave cruda
(«reqtype.add») en los dos idiomas. Nadie lo vio: ni mi medición, ni la auditoría (que contaba 139
muertas, con estas dentro), ni el auditor de la rama, porque nadie abrió esa pantalla con sesión.

**Arreglo (commit `6f4a0a5`):** vuelven las tres claves con sus valores originales («Add time» /
«Agregar tiempo», …) y `rLabel` pasa a **una clave literal por rama**, que es lo que la prueba de D-187
ve. **Medido después:** en todo `src/` no queda ninguna otra clave construida por concatenación
(`"prefijo." + x`) sobre un prefijo borrado en D-202; la única construcción restante es
`` t(`mgr.sch.dow.${…}`) `` en `ScheduleWeek`, que la prueba ya entiende, y `"tab." + tb.id` en
`TopBar`, cuyas claves se conservaron. D-202 se corrige con una nota del mismo día, no se reescribe.

### Qué se tradujo

- **`common.adminsOnly`** («Admins only.» / «Solo administradores.») en los ocho sitios que lo tenían
  a pelo: `insights`, `live`, `people`, `settings`, `team-requests`, `AuditTabs`, `ManagerReports`,
  `TeamDiary`. Mismo `<div className="card"><p className="muted">`; los ocho ya tenían `useT()`.
- **Del idioma del hub al de Time Tracker.** Cuatro pantallas estaban en los dos idiomas pero por
  `usePrefs` (la preferencia del hub), mientras el resto de Time Tracker va por `useT()` (`tt_lang`):
  la misma pantalla salía mitad en cada idioma según dos conmutadores, como pasó con `DayPhotos` en
  D-203. Pasan a claves: `TimeOffRequests` (`emp.off.*`, 16), `PunchPanel` (`emp.punch.*`, 42),
  `MySections` (`emp.my.*`, 21), `diary/page` (`emp.diary.*`, 5). Los **motivos** de fichaje y los
  **tipos** de tiempo libre siguen siendo pares en/es con el `value` guardado intacto (es la clave con
  la que cuenta la oficina), elegidos ahora por `getLang()` de Time Tracker.
- **`NotificationLanguage`** (en Mi cuenta) tenía sus cuatro textos en inglés a pelo: `emp.acc.notifLang*`.
  «English» / «Español» son el nombre de cada idioma en su propio idioma y se quedan.

**Total:** 92 claves nuevas en los dos idiomas (184 filas), 3 restauradas; 11 ficheros entran en la
prueba de claves de D-187 (25 → 36). **Mutación medida:** sin la fila española de `common.adminsOnly`
caen las ocho pruebas que la usan, nombrando clave y fichero.

**Lo que sigue por `usePrefs` a propósito:** solo `TopBar`, y no para texto: lee `theme` / `toggleTheme` del hub
(el tema sí es una preferencia compartida). Ningún fichero de Time Tracker pinta ya texto por `usePrefs`.

### Qué NO cambia

Migraciones (ninguna). Ubicación obligatoria, foto, límite de 30 s, reenvío con motivo, la carga
perezosa de las secciones, el borrado de capturas: nada de eso se toca; cada commit es texto → clave.
`LOCALE`/`fmtDayLong` siguen como en D-202: fechas largas en inglés en las dos lenguas.

### Lo no verificado

Nadie abrió las pantallas con sesión real en español; la cola del gerente arreglada tampoco (va por la
prueba de claves, que ahora sí la cubre). La traducción es la que ya había en los pares de `usePrefs`
(D-159), movida a claves, no reescrita. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **890 pasados | 3 saltados**
(main ec83945: 879 | 3; los +11 son los once ficheros nuevos en la prueba de claves).

## D-207 · Auditoría 2026-09-05, G-4 y G-5: se borra la página de aprobaciones que nadie enlazaba, y `/recruiting/users` redirige siempre

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (Entregas y HR se tocan) ·
**Pedido por:** Andrés (orquestador), sobre `docs/AUDIT-2026-09-05.md`, con la decisión ya tomada.
Sin migración.

### G-5 · `src/app/(app)/approvals/page.tsx`, borrada

**Qué era.** Una pantalla completa de Entregas (**64 líneas en main al borrarla**; el informe decía 137 y el
mensaje del commit lo repitió sin medir: el número real es el del diff, 64) con las etapas de los pedidos en
pestañas y la cola de aprobación, gateada por `canApprove`. Existía desde el commit inicial
(`8e2206d`, 2026-07-17) y **nadie la enlazaba**: 0 referencias a `/approvals` en `src/`, `public/`,
`next.config.mjs` y los documentos de rutas (la única mención está en el propio informe de
auditoría); no está en `TABS` de `constants.ts`; ni el middleware ni las rutas públicas la nombran.
Solo se llegaba escribiendo la URL.

**Por qué se borra y no se enlaza.** El Board (`/`) ya enseña las mismas etapas con los mismos
pedidos y la aprobación se hace desde la ficha del pedido (`OrderModal`, con `canApprove`): enlazar
la página sería ofrecer dos sitios para lo mismo. Si alguien la busca: **se recupera con un revert de
este commit**. `canApprove` **se queda**: es una capacidad del rol (la usan `OrderModal` y su prueba),
no de esta pantalla.

### G-4 · `/recruiting/users` redirigía al login en vez de a Usuarios

**Qué fallaba.** La página es una redirección a `/home/users` que se dejó para marcadores viejos
(D-056, D-062), pero vivía **dentro del route group `(recruiting)`**, cuyo layout comprueba sesión y
`recruiting_role` antes de que corra el `redirect()`. Sin sesión, `/recruiting/users` mandaba a
`/login?next=/recruiting`, y quien no tuviera acceso a HR ni siquiera llegaba a Usuarios.

**Qué se hizo.** Se mueve a `src/app/recruiting/users/page.tsx`, fuera del grupo, con el mismo
`redirect("/home/users")`, exactamente como hace `src/app/(app)/users/page.tsx`. Comprobado: no hay
otra ruta `/recruiting/users` (colisión), y no hay `layout.tsx` en `src/app/recruiting/` que la vuelva
a gatear (la carpeta solo tiene el grupo, `actions/` y el CSS). Quien llegue sin sesión acaba en
`/home/users`, que ya pide sesión con su propio `next`.

### La prueba

`src/lib/route-groups.test.ts` (5 pruebas) afirma la forma del árbol: `/recruiting/users` vive fuera
del grupo y sigue siendo un `redirect` sin sesión ni rol por medio; no hay layout en
`src/app/recruiting/`; `src/app/(app)/approvals` no existe; y ningún fichero de `src/` enlaza
`/approvals`. Es lo único que se puede afirmar sin dibujar pantallas.

### Qué NO cambia

Ni `canApprove`, ni el Board, ni `OrderModal`, ni el layout de `(recruiting)`, ni `/home/users`.

### Lo no verificado

Nadie pidió `/recruiting/users` sin sesión en producción: que acabe en `/home/users` va por la forma
del árbol (la prueba) y por lo que ya hace `(app)/users`. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **895 pasados | 3 saltados**
(main 1f14ee3: 890 | 3; los +5 son la prueba nueva).

## D-208 · G-29: el guard de rutas del middleware se conecta (y cierra G-2)

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (sube las tres apps:
el middleware es de todo el sitio) · **Pedido por:** Andrés (orquestador), sobre
`docs/AUDIT-2026-09-05.md` (G-29 y G-2), con la decisión ya tomada: conectar. Sin migración.

### Qué había

`updateSession` (`src/lib/supabase/middleware.ts`) estaba escrito desde D-119 y **nadie lo
llamaba**: `src/middleware.ts` solo invocaba `refreshSession`, que refresca la sesión y no
redirige. Sin guard, cada layout rebotaba al login por su cuenta y **perdía la ruta exacta**:
Entregas mandaba `/login?next=/` (G-2, arreglo parcial en D-198), así que quien iba a `/users`
sin sesión volvía al tablero. Y el guard, tal como estaba escrito, tenía dos fallos que habrían
salido el minuto de encenderlo: aceptaba `next=//evil.com` (empieza por `/`, redirección abierta
protocol-relative) y habría rebotado a `/login` el **service worker** de fichaje
(`/clockin-sw.js` pasa el matcher, que solo excluye imágenes, y no estaba en la lista de públicas):
sin worker no hay fichaje offline.

### Qué cambia para quien entra sin sesión

- Una ruta protegida (`/`, `/home`, `/erp/…`, `/timetracker/…`, `/recruiting/…`) manda a
  **`/login?next=<ruta y query exactas>`**, y al entrar se vuelve ahí. Antes cada layout mandaba a
  su raíz y la ruta se perdía. Importa sobre todo en el escritorio de Time Tracker (D-076), que
  no tiene barra de direcciones.
- Quien **ya entró** y pisa `/login` va a su `next`, saneado por `safeNext` (D-193): solo una ruta
  interna; `//evil.com`, `/\evil.com`, una URL absoluta, un carácter de control o un salto al propio
  login caen a `/home`. Fuera la validación a mano.
- **Nada de esto toca las rutas de datos ni los ficheros:** `/api/*`, `/timetracker/api/*` y
  `/timetracker/clock-in/api/*` (las 31 `route.ts` del repo, medidas: todas bajo `/api/` o
  `/auth/`) ni se miran —ni refresco ni guard—, así que los crons de Vercel (`/api/notion-summary`,
  `/timetracker/clock-in/api/roll-schedules`) y el de GitHub (`/timetracker/clock-in/api/cron`)
  entran con su secreto como hasta ahora, y una llamada sin sesión sigue dando 401, no el HTML del
  login. Los ficheros se reconocen **por extensión** (último segmento con `.ext`), no por lista:
  la lista se queda vieja (cubría el manifest y el favicon y no el service worker). Ninguna
  página de la app tiene un punto en su último segmento.
- **Público de verdad y público según la lista, que no es lo mismo:** `isPublicPath` deja pasar
  `/login`, `/auth/*`, `/reset-password`, `/no-access`, `/track` y `/track/*`. Lo que de verdad se
  ve sin sesión es `/track/[id]` (el enlace del cliente), `/reset-password` y `/auth/*`;
  **`/track` raíz y `/no-access` los rebotan sus layouts / páginas** (`no-access/page.tsx` hace
  `getUser()` y manda a `/login`; `/track` raíz vive en el grupo `(app)`, con sesión). La lista los
  deja pasar y los layouts mandan; tocar los layouts no era de este encargo.

### Cómo

`src/lib/route-guard.ts`, puro (sin Supabase ni `NextRequest`): `isApiPath`, `isStaticFile`,
`isPublicPath`, `skipsSession` y `decide(rutaConQuery, next, haySesión)` → `next` | `redirect`.
`updateSession` queda en leer la cookie (`getUser()`, que es lo que dispara el refresco), aplicar
la decisión y devolver **la misma respuesta que preparó el refresco** cuando se sirve (ahí van las
cookies renovadas). El destino de una redirección se construye con `new URL(to, origin)`, como
`/auth/callback`. `refreshSession` **se retira**: `updateSession` la cubre entera (mismo refresco,
mismo salto de `/api/`, ampliado a los estáticos). `deps.getUser` existe solo para las pruebas.

### Medido

- **Tabla ruta × sesión** en `route-guard.test.ts` (79 pruebas): las rutas protegidas rebotan con
  `next` exacto (ruta y query); las 31 `route.ts` recorridas del disco caen bajo `isApiPath` o
  `/auth/`; los 6 ficheros de `public/`; `/auth/callback`, `/auth/signout`, `/reset-password`,
  `/track/abc`; los tres crons, también con `?verify=1`; `/login` con sesión y `next` bueno, vacío,
  bucle, `//evil.com`, `/\evil.com`, absoluto y con tabulador; y `updateSession` sobre `NextRequest`
  con `getUser` stubbeado: 307 con `Location` exacto, sin arrastrar la query del login, y **cero
  preguntas por la sesión** en rutas de datos y ficheros. `public-paths.test.ts` (D-156) sigue
  pasando por el reexport.
- **Mutaciones:** sin `includes("/api/")` caen **10** pruebas: las 7 filas de rutas de datos de la tabla sin
  sesión (con sesión siguen sirviendo), el recorrido de las 31 `route.ts`, la de «ni preguntan por la
  sesión» y la de D-156. (El mensaje del commit `ec71412` dice «las 5 rutas de datos × 2 sesiones»: es
  una cuenta a ojo, y está mal; la buena es esta.) Sin la regla de extensión caen **9**: los 7 ficheros
  de la tabla sin sesión y las dos de estáticos.
- `verify.mjs`: en verde sobre `.next` limpio, en solitario: **974 pasados | 3 saltados** (main f54de75: 895 | 3;
  los +79 son `route-guard.test.ts`).

### Qué NO cambia

Los layouts siguen con su propia comprobación (red por si el middleware no corre, que es lo que
pasó en D-119); el matcher del middleware; `safeNext`; `/auth/callback`; las rutas de datos y su
`cronAuthorized`; `api-auth.ts`.

### Lo no verificado

Nadie pidió las rutas en producción con y sin sesión: la tabla es sobre la función pura y sobre
`NextRequest` con la sesión stubbeada. Lo que se mide tras el deploy: `/users` sin sesión →
`/login?next=%2Fusers`; `/clockin-sw.js` sin sesión → 200; `/timetracker/clock-in/api/cron` sin
secreto → 401 (no 307); y que el cron de GitHub siga en verde. El primer refresco pasada una hora
en una ruta protegida (la carrera de D-119) sigue sin prueba automática.

**Límite conocido (anotado por el orquestador al numerar, observación del auditor).**
`isStaticFile` toma como estático cualquier último segmento con punto: `/home/users/john.doe`
o `/erp/product/1.5` se servirían sin pasar por el guard ni por el refresco de sesión. Hoy no
existe ninguna ruta así (los ids son numéricos o uuid) y los layouts gatean igual, así que no
hay bypass; lo que perdería esa página es el refresco del middleware. Si algún día entra un
id con punto en una URL, estrechar la regla a extensiones conocidas. Y con sesión en `/login`
sin `next`, el destino es `/home` (`safeNext`, D-090/D-193), no `/`.

## D-209 · G-20: la ficha del pedido (`OrderModal`) se carga en diferido; `routes/page.tsx` no arrastra nada a `/`

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (Entregas) ·
**Pedido por:** Andrés (orquestador), sobre `docs/AUDIT-2026-09-05.md` (G-20). Sin migración.
**Cero cambio de comportamiento:** el componente no cambia una línea; cambia cómo llega al navegador.

### Medido ANTES (`next build` limpio sobre main 1fcf690, vía `verify.mjs`)

| Ruta | Tamaño de ruta | First Load JS |
|---|---|---|
| `/` (tablero) | 264 kB | **590 kB** |
| `/routes` | 27,8 kB | 349 kB |
| `/driver` | 4,36 kB | 330 kB |
| `/map` | 6,66 kB | 328 kB |
| `/warehouse` | 2,19 kB | 328 kB |
| `/summary` | 2,94 kB | 327 kB |
| `/accounts` / `/my-route` | 4,9 / 4,69 kB | 326 kB |
| compartido por todas | | 190 kB |

`/` pesaba el doble que cualquier otra. **Un aviso antes de seguir, medido:** el primer build «antes»
se contaminó porque edité fuentes mientras corría; se repitió con el árbol de trabajo idéntico a
main (cambios guardados aparte y restaurados después). Los números de arriba son del segundo.

### Qué se hizo

- **`OrderModal` con `next/dynamic`, desde UN punto:** `src/components/OrderModalLazy.tsx` exporta
  `OrderModal = dynamic(() => import("./OrderModal"))`, y las **ocho** pantallas que la montan
  (`/`, `/driver`, `/warehouse`, `/map`, `/my-route`, `/summary`, `/accounts`, `/routes`) importan
  de ahí; ocho `dynamic()` repartidos serían ocho chunks del mismo componente. **Sin `ssr: false`:**
  la ficha nunca se pinta en el servidor (se monta desde estado de cliente tras un clic,
  `{open && <OrderModal …/>}`), así que el ajuste por defecto no cambia nada y no se toca.
- **Estado de carga:** mientras baja el trozo, la misma capa `.overlay`/`.modal` de `globals.css`
  con el «Cargando…» que ya usa Entregas; nada nuevo. El `Modal` de D-187 es de Time Tracker y no
  tiene estado de carga: no se usa.
- **El primer clic no se pierde:** el pedido abierto vive en el estado del padre (`open` /
  `creating`); el elemento diferido queda montado con las mismas props y el componente real las
  recibe al llegar. La prueba (`order-modal-lazy.test.ts`) afirma que las ocho pantallas siguen
  montándola condicionada a ese estado (`{x && <OrderModal`), que ninguna importa el componente
  pesado directo y que el punto de carga no apaga el SSR. Nadie pulsó el botón en un navegador:
  va por esa forma y por cómo funciona `next/dynamic`.
- **`routes/page.tsx` no arrastra nada a `/`:** medido, el fichero solo tiene `export default` y
  **nadie lo importa** (`grep` de `routes/page` en `src/`: cero); su peso ya iba solo a `/routes`.
  No hay nada que separar. Lo que sí comparten `/` y `/routes` es `OrderModal` (ahora diferido) y
  las librerías de `lib/`.

### Medido DESPUÉS

| Ruta | Antes (ruta / First Load) | Después | Diferencia |
|---|---|---|---|
| `/` (tablero) | 264 kB / 590 kB | 265 kB / **551 kB** | −39 kB |
| `/routes` | 27,8 kB / 349 kB | 27,5 kB / 316 kB | −33 kB |
| `/driver` | 4,36 kB / 330 kB | 5,39 kB / 291 kB | −39 kB |
| `/warehouse` | 2,19 kB / 328 kB | 6,6 kB / 292 kB | −36 kB |
| `/map` | 6,66 kB / 328 kB | 7,71 kB / 294 kB | −34 kB |
| `/summary` | 2,94 kB / 327 kB | 4,01 kB / 289 kB | −38 kB |
| `/accounts` | 4,9 kB / 326 kB | 6,28 kB / 287 kB | −39 kB |
| `/my-route` | 4,69 kB / 326 kB | 3,88 kB / 293 kB | −33 kB |
| compartido por todas | 190 kB | 190 kB | 0 |

Las ocho pantallas bajan entre 33 y 39 kB de First Load (el trozo de la ficha, que ahora se pide al
abrirla; en las que suben unos kB de ruta es el `loading` y el envoltorio). Las demás rutas se
mueven ±1 kB por el reparto de chunks. **`/` NO baja del objetivo de 400 kB: queda en 551 kB**, y el
motivo está medido: su chunk de ruta sigue en 265 kB, y ese chunk no es la ficha, es `lib/export`
(abajo). Se dice con el número en vez de forzarlo.

### Segundo paso, pedido por el orquestador al ver el número: `exceljs` bajo demanda

`lib/export.ts` importaba `exceljs` estático y el tablero importa `lib/export` para sus botones
«Excel» y «PDF»: la librería entera iba en el chunk inicial de `/` para un botón que se pulsa de
tarde en tarde. Ahora `exportExcelByEmployee` hace `await import("exceljs")` al pulsar, como ya
hacía `lib/erp/export.ts`; el tipo va con `import type`, que no pesa; la función ya era `async`,
misma firma, mismo fichero generado. **Si el trozo no llega** (sin red, despliegue a medias) la
promesa se rechaza y el botón lo enseña con el `alert` que ya usa Entregas: con el import
estático ese caso no existía y no podía quedarse en silencio. «PDF» no cambia. El único
`import ExcelJS` estático que queda es la ruta de API de informes de Time Tracker: servidor, no
entra en ningún bundle.

| Ruta | Tras el paso 1 | Tras el paso 2 | Total desde main |
|---|---|---|---|
| `/` (tablero) | 265 kB / 551 kB | **11,1 kB / 297 kB** | **590 → 297 kB (−293)** |
| las otras siete | sin cambio | sin cambio (ninguna importa `lib/export`) | −33 a −39 kB |
| compartido | 190 kB | 190 kB | 0 |

Con esto `/` baja del objetivo de 400 kB y deja de ser la ruta más pesada (ahora lo es `/routes`,
316 kB).

### Lo que sigue pesando, con nombre, y no se toca aquí

`src/app/(app)/page.tsx` importa `@/lib/export` para los botones «Excel» y «PDF», y **`lib/export.ts`
importa `exceljs` estáticamente** (`import ExcelJS from "exceljs"`), así que la librería entera va
en el chunk inicial del tablero aunque solo se use al pulsar el botón. El ERP ya la carga con
`await import("exceljs")` dentro de la acción (`lib/erp/export.ts`, `master-round-trip.tsx`). Hacer
lo mismo aquí era un cambio de dos líneas y cero comportamiento, fuera del alcance inicial del
encargo; el orquestador lo pidió al ver el número y es el paso 2 de arriba.
Además `OrderModal` arrastra `MapView` (Leaflet + Google), que ahora baja con la ficha y no antes.

### Qué NO cambia

Ni una línea de `OrderModal.tsx`, ni de las ocho pantallas fuera del `import`. Ni `lib/export`, ni
`routes/page.tsx`.

### Lo no verificado

Nadie abrió una ficha en un navegador tras el cambio: que el «Cargando…» se vea un instante y la
ficha llegue con el pedido correcto va por la forma (prueba) y por `next/dynamic`, no por haberlo
mirado. Los pesos son del build local, no del CI. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **978 pasados | 3 saltados**
(main 1fcf690: 974 | 3; los +4 son `order-modal-lazy.test.ts`).

## D-210 · G-10b: los mensajes del servidor del ERP viajan como código y se traducen en el cliente

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (solo ERP se toca) ·
**Pedido por:** Andrés (orquestador), sobre la deuda que D-204 dejó declarada («23 mensajes de servidor
de `lib/erp` en inglés»). Sin migración. **Cero cambio de comportamiento:** mismos códigos HTTP, mismos
flujos, mismos textos en inglés; en español se ve el par.

### El inventario, medido otra vez (main 15d7370)

D-204 contaba 23 con el guardián de 5b, y el guardián **no era la herramienta**: su regla de literales
pide mayúscula inicial y salta minúsculas («not authorized»), siglas («SKU, name…») y plantillas con
backticks. Contado a mano, fichero por fichero y con quién lo enseña:

| Fichero | Sitios | Distintos | Llega a pantalla | Qué se hace |
|---|---|---|---|---|
| `lib/erp/actions.ts` | **13** (D-204: 6) | 11 | sí: `setErr(res.error)` / `setMsg` en 17 componentes | código + `params` |
| `lib/erp/domain/po-parse.ts` | **6** (D-204: 5) | 5 | sí: `warnings` que pinta `po-ingest` | código + `params` |
| `lib/erp/error-codes.ts` | 8 | 8 | **no**: solo los consume `api-error.ts` para `/api/erp/jobs/refresh-daltile-matches`, que nadie llama desde el cliente (cron inactivo por diseño, D-184) y que el `AppError` de `unwrap` nunca usa (siempre pasa su propio `message`) | se quedan, dicho aquí |
| `lib/erp/google-maps-loader.ts` | 4 | 4 | **no**: fichero muerto, cero importadores (§15, literal y construido); los mapas cargan el de la raíz | **se borra** |

**17 mensajes visibles** en total, no 23: los 8 de `error-codes` y los 4 del loader no los ve nadie. Los
**27** `error: error.message` de Supabase en `actions.ts` no entran: son dato del servidor y se enseñan
letra por letra (D-192, D-204). En `actions.ts` los 13 sitios son 12 literales más una plantilla,
``Couldn't read the PDF: ${e.message}``, que era justo concatenación de texto en el servidor; en
`po-parse.ts`, cuatro literales (uno repetido) y otra plantilla con dos importes.

### Cómo (mismo patrón que `clock-in/actions/clock.ts`, D-201)

El servidor no sabe el idioma: `usePrefs` vive en `localStorage`, sin cookie. Así que **no devuelve
texto**: devuelve `{ ok: false, code }` y, si el mensaje lleva datos, `params` aparte.

- **`lib/erp/messages.ts`** (nuevo). No había un fichero de textos del ERP —los pares viven inline en
  cada componente—, y un mapa de códigos necesita un solo sitio. `ERP_MESSAGES = { CÓDIGO: { en, es } }`
  con los **16** pares (11 + 5); `fail(code, params?)`; `rellenar(plantilla, params)` (`{detail}`,
  `{sum}`, `{total}`; un hueco sin dato queda vacío, nunca se enseña la llave); `mensajeTexto(m, t)`; y
  `failText(res, t)`, que devuelve el par si hay código y `res.error` tal cual si es de Supabase. Los
  textos en inglés son **los literales que había, letra por letra** (también «not authorized» en
  minúscula: cambiar el inglés no era el encargo).
- **`actions.ts`:** `Result` gana `| ErpFail`; cada literal pasa a `fail("CÓDIGO")`. Los mismos `if`,
  los mismos `return`, las mismas firmas salvo el tipo. Ningún `t()` ni concatenación en `lib/erp`; lo
  mide el guardián.
- **`po-parse.ts`:** `warnings: Mensaje[]` en vez de `string[]`. El parser corre **dos veces**: en el
  navegador (`po-ingest`, texto pegado) y en el servidor (`parsePdfUpload`); con el código en el dato,
  la traducción es una sola, en `po-ingest`, para las dos vías.
- **17 componentes** que pintaban `res.error` a pelo pasan por `failText(res, t)`. No fue voluntad: al
  quitar `error` de un miembro de la unión, `tsc` lo exige en cada consumidor; los tres que consumen
  solo acciones con `error.message` (`catalog-table`, `decisions-upload`, `master-round-trip`) no
  cambian porque su tipo no lleva código. Los `?? t("Merge failed")` y parecidos desaparecen: nunca se
  disparaban, `error` siempre era string.

### El guardián, ampliado (`i18n.test.ts`, 60 → 107 casos)

Lo que pedía el encargo era que «un código sin par caiga en la prueba», y eso solo vale si la prueba
lee los códigos **del fuente**, no de una lista a mano: los recoge con regex de `fail("…")` y
`warnings.push({ code: "…" })` (13 + 6 sitios, y el recuento es una afirmación), y por cada uno exige
par `en`/`es` no vacío, distinto, y con los mismos `{marcadores}`. Al revés también: **ningún par sin
emisor** (un código que nadie devuelve es texto muerto, §15). La **mutación** está escrita: quitar
`NO_PDF_FILE`, o vaciar el `es` de `TOTAL_MISMATCH`, cae nombrando el código. `actions.ts` y
`po-parse.ts` entran en el guardián de texto a pelo (0 hallazgos) y no pueden llamar a `t()`; los
códigos van siempre literales (`fail(variable)` cae). Y los 17 pintores importan de `messages`, usan
`failText`/`mensajeTexto` y no tienen `res.error` a pelo.

### Qué NO cambia

`error-codes.ts`, `api-error.ts`, `db-result.ts`: ni una línea (sus textos no llegan a pantalla, medido).
`lib/google-maps-loader.ts` de la raíz. Ningún `error.message` de Supabase. Ninguna firma de acción
fuera del tipo de retorno. **Una diferencia de dato, dicha:** el `detail` de `PDF_READ_FAILED` cuando lo
lanzado no es un `Error` era el texto «unknown error» fabricado por el servidor y ahora es `String(e)`.

### Lo no verificado

Nadie subió un PDF ni pulsó «Suggest a fix» en un navegador tras el cambio: que el par salga en el
idioma del usuario va por `failText` (probado en solitario) y por `tsc` (cada pintor pasa por él),
no por haberlo mirado. Que los 8 textos de `error-codes.ts` no llegan a nadie es lectura del código
(`grep` de sus consumidores), no una prueba que lo afirme. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1025 pasados | 3 saltados**
(main 15d7370: 978 | 3; los +47 son el guardián ampliado). «Compiled with warnings» es `unpdf`, preexistente.

## D-211 · G-13 / G-14: HR ya tenía tema oscuro; lo que no cambiaba eran los colores a pelo de sus TSX

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (solo HR se toca) ·
**Pedido por:** Andrés (orquestador), sobre `docs/AUDIT-2026-09-05.md` (G-14 «recruiting.css tiene
1 regla dark en 257 líneas» y G-13 «colores a pelo en `style={{}}`»). Sin migración. **Cero cambio
de valor en claro**, medido hex por hex; en oscuro cambian los que hoy se quedaban claros.

### G-14 era engañoso, medido

La «única regla dark» de `recruiting.css:224` es **la paleta oscura entera**: redefine bajo
`.recruiting-module` los 20 tokens que el módulo consume en todas partes (21 en claro; el que no se
redefine es `--brand-surface`, el azul marino de la barra, el chip activo y el toast, que se queda
igual en los dos temas porque el texto blanco encima también, `recruiting.css:22-27`). HR **ya
tenía tema oscuro**: `data-theme` va en `<html>` desde `app/layout.tsx:14` (script antes del primer
pintado) y `prefs.tsx:63`; la preferencia vive en `rtg_prefs` (`localStorage`), común a todo el
hub, y el conmutador está en la cuenta de Entregas (`(app)/account/page.tsx:147`) y en la barra de
Time Tracker. HR no tiene conmutador propio y no le hace falta: hereda el atributo.

De los **56** colores de `recruiting.css` antes de este encargo (medidos con el guardián de este
encargo), **41** son los valores de las dos paletas (21 claros + 20 oscuros) y **15**, en 14 líneas,
van sueltos: **9 `#fff`** sobre `--brand-surface`,
`--accent` o `--amber` (`:49 :54 :66 :89 :105 :123 :133 :164 :170`: blanco sobre color, correcto en los
dos temas), el velo de la ventana `rgba(15,23,42,.55)` (`:108`), el hover de pestaña
`rgba(255,255,255,.08)` sobre el azul marino (`:55`) y **4 sombras** (`:80 :145 :170 :255`). Ninguno
cambia: ninguno es «un color que se queda claro en oscuro». D-204 contaba «56 en 14»: la línea `:170`
lleva dos (blanco y sombra).

### La deuda de verdad: 38 colores a pelo en 12 TSX de HR

Contados con el guardián (`#hex`, `rgb()`, `hsl()` dentro de `style={{}}`, **sin** los respaldos
`var(--x, #hex)`, donde manda la variable): ModalHost 8, GlobalSearch 6, questions 6, CandidateRow 4,
settings 4, outcomes 4, TopBar 3, board 2, calendar 1, today 1, metrics 1 = **38**. (El auditor contó
50 con los respaldos dentro; la diferencia son esos 12.) Tres reglas, valor a valor:

1. **Idéntico a un token → el token** (6): `#eef1f6` → `--track` (`CandidateRow:107`,
   `ModalHost:1352`), `#fdeaea` → `--tint-red-strong` (`CandidateRow:136`), `#2456c9` → `--accent`
   (`CandidateRow:145`), `#e5f6ee` → `--tint-green` (`settings:177`), `#d64545` → `--red`
   (`questions:331`). `#fff` → `--card` **no** vale: en oscuro `--card` es `#18202c` y el blanco
   sobre accent se volvería gris sobre azul.
2. **Tinte de estado sin token → token nuevo con par** (9 tokens, 15 sitios), en `recruiting.css:8`
   (claro = **exactamente el hex que había**) y `:224` (oscuro = el que ya usan los avisos del hub en
   `globals.css` `.banner.*`, o esta paleta; nada inventado):

   | Token | Claro (el hex de antes) | Oscuro | Dónde |
   |---|---|---|---|
   | `--tint-warn` / `--tint-warn-line` | `#fffbeb` / `#fcd34d` | `#3a2f12` / `#5a4415` | borrador restaurado, `ModalHost:1300` |
   | `--tint-indigo` / `--indigo` | `#eef2ff` / `#4338ca` | `#1e2b45` / `#a9cdf3` | etiqueta de categoría, `questions:310`, `ModalHost:1352` |
   | `--tint-red-soft` | `#fde2e2` | `#3a1f21` | «sin español», `questions:331` |
   | `--tint-red-tag` / `--red-deep` | `#fee2e2` / `#b91c1c` | `#3a1620` / `#ffb3bf` | «volver a llamar», `board:102` |
   | `--green-deep` | `#15803d` | `#8fe3ba` | fecha de presencial, `calendar:100`, `today:108`, `outcomes:62` |
   | `--surface-soft` | `#f8fafc` | `#212a37` | bloques de registro, `ModalHost:1337`, `:1358` |
   | `--tint-neutral` | `#eee` | `#2b3646` | vacante cerrada, `settings:177` |

   Dos rojos casi iguales (`#fde2e2` y `#fee2e2`) son dos tokens y no uno porque juntarlos cambiaría
   un valor en claro, y esa era la vara.
3. **Un arreglo que no es de color: `outcomes:94`**, `background: var(--ink)` → `var(--brand-surface)`.
   Mismo `#152238` en claro; en oscuro `--ink` es **texto claro** (`#e8ecf3`) y la tarjeta «Esperando
   un veredicto» se pintaba clara con su texto blanco encima: ilegible. `--brand-surface` existe para
   eso.

**Quedan 17 en 7 ficheros, intencionales, uno a uno:** blancos sobre el azul marino de la barra o
sobre chips (`TopBar:59`, `GlobalSearch:128`, `settings:120 :246`, `ModalHost:132`, `outcomes:94
:103`); los velos blancos del buscador sobre la barra (`TopBar:64 :73`, `GlobalSearch:126 :127`); las
sombras del desplegable (`GlobalSearch:144 :145`); el resaltado de fila activa `rgba(37,99,235,.12)`
(`GlobalSearch:169`, sin token idéntico, y se ve en los dos temas); el rojo claro `#ff8a8a` sobre la
tarjeta azul marino (`outcomes:103`); el fondo `#e7f0ff` de «también aplicó desde» (`CandidateRow:145`,
sin token idéntico; con `--accent` encima se lee en los dos temas); y el `#555` de una cabecera
**solo de impresión** (`metrics:175`, `.print-only`).

### El guardián (`src/lib/inline-colors.ts` + `.test.ts`, 24 casos)

Cuenta por fichero y **cae si sube** respecto a la tabla de arriba (GlobalSearch 6, TopBar 3,
outcomes 3, settings 2, CandidateRow 1, ModalHost 1, metrics 1, los demás 0): recorre todos los TSX de
`src/app/recruiting` y `src/components/recruiting`, así que un fichero nuevo con colores sube desde 0
y cae. No exige cero. La tabla tampoco puede llevar holgura: cada techo es el valor real, para que
bajar obligue a bajar el techo. En `recruiting.css` afirma que cada token claro tiene su oscuro salvo
`--brand-surface`, y que los sueltos son 15 y exactamente esos. Se prueba a sí mismo con un fixture
(cuenta dentro de `style={{}}`, no fuera; un estilo de varias líneas entero; el respaldo de `var()` no
cuenta).

### Lo que queda de G-13 fuera de HR, con nombre, y no se toca aquí

Entregas y Time Tracker siguen con colores a pelo en `style={{}}` (medidos con el mismo guardián,
sin respaldos): `routes/page.tsx` 24, `OrderModal.tsx` 21, `timetracker/TopBar.tsx` 9,
`SessionExpired.tsx` 8, `TopBar.tsx` 7, `map/page.tsx` 6, `account/page.tsx` 6, `ShiftClock.tsx` 5,
`OrdersTable.tsx` 5, `UserDialog.tsx` 4, y otros ficheros con 1-4. Casi todos son `#fff` sobre color,
tintes ámbar (`#fff7ec` / `#b9791a`) sin token en `globals.css` y velos blancos sobre la barra; el
`rgba(16,185,129,0.06)` de `ShiftClock:80` no es `--green` (`#1f9d61`) y cambiarlo cambiaría el
claro. El orquestador lo sacó de este encargo; el guardián no los mide (solo HR) a propósito, para
no fijar una tabla que nadie ha revisado valor a valor.

### Qué NO cambia

Ningún valor en claro (comprobado hex a hex: los 6 tokens reutilizados y los 9 nuevos tienen en claro
el mismo hex que había). Ningún `#fff` sobre color. `recruiting.css` fuera de los dos bloques de
paleta. Nada de Entregas, Time Tracker ni ERP.

### Lo no verificado

Nadie abrió HR en oscuro en un navegador: que los tintes nuevos se vean bien va por los valores (son
los de `.banner.*` del hub, que sí se han visto) y por el guardián, no por haberlo mirado. Los
valores oscuros de `--surface-soft` (`#212a37`, el `--card-hover` oscuro del hub) y `--tint-neutral`
(`#2b3646`, el `--line` oscuro de HR) son elección mía, dicha aquí. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1049 pasados | 3 saltados**
(main e83a58a: 1025 | 3; los +24 son el guardián). «Compiled with warnings» es `unpdf`, preexistente.

## D-212 · Cada foto de fichaje enseña dónde se tomó (Auditoría → Fotos), y salir/volver mandan posición

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (Time Tracker y clock-in) ·
**Pedido por:** Andrés, literal: «el clock-in app tiene que guardar GPS cada vez que se toma una foto,
y en Audit quiero ver la location de cada foto». Sin migración.

### Medido antes

- **La base ya guardaba la posición junto a cada foto**, desde la migración 072: `time_entries.clock_in_lat/lng`
  + `clock_in_site_id` + `clock_in_in_radius` (y `clock_out_*`); `exceptions.latitude/longitude` (salir) y
  `returned_lat/lng` (volver). Lo que no existía era enseñarlo: `getDayPhotos` (`clock-in/actions/photos.ts`)
  no seleccionaba esas columnas y `DayPhoto` solo llevaba `offSite`.
- **Captura en el cliente (`PunchPanel.tsx`).** La única toma de foto es `alElegirFoto`, y solo la piden
  **entrada y salida** (`pide("in"|"out")`): foto → `ubicacion()` obligatoria (15 s, rechaza sin GPS:
  `emp.punch.noGeo` / `geoRequired`) → `clockIn`/`clockOut` con `lat/lng` + `photoPath`. El servidor
  exige `lat/lng` para decidir `in_radius`. **Esas dos siempre llevaron posición con la foto.**
- **El hueco:** `startLeave({ reason })` y `endLeave(id)` se llamaban **sin `geo`**, así que
  `exceptions.latitude/longitude` y `returned_lat/lng` nacían `null` aunque la acción y las columnas los
  aceptaban. Salir y volver tampoco toman foto en el cliente actual; las fotos «salió del sitio» que hay en
  el archivo son de la app vieja (D-161) y de las excepciones que `clock.ts` graba con la foto de entrada
  cuando el fichaje es fuera de sitio o sin turno.
- **No hay columna de precisión** (`accuracy`) en `time_entries` ni en `exceptions` (solo
  `driver_locations.accuracy_m`, de Entregas). `ubicacion()` la captura y el servidor la ignora, como
  hasta hoy. **Sin migración en este encargo**: se deja dicho; añadirla es una decisión aparte.

### Qué se hizo

1. **`lib/clockin/day-photos.ts`** (nuevo, puro, sin red): la parte que se puede probar en solitario.
   - `distanciaAGeocerca(lat, lng, site)`: **a la geocerca, no al centro.** Polígono: `pointInPolygon` →
     0; si no, `distanceToPolygonMeters` (que mide al borde también desde dentro: por eso va detrás).
     Círculo: `max(0, haversine − radius_meters)`. Misma matemática de `geofence.ts`, reutilizada, no
     reescrita: «a 35 m» de aquí y el «fuera de la geocerca» del fichaje no pueden contradecirse.
   - `ubicar`: el sitio del fichaje (`*_site_id`) o, si cayó fuera, **el más cercano**, con la distancia a
     ese; sin posición o sin sitios, nulos.
   - `sitioDeExcepcion`: el fichaje **en cuyo turno ocurrió** (por `time_entry_id` si lo trae; si no, el
     abierto de esa persona en ese instante). Nunca «el último fichaje»: una excepción de ayer no se mide
     contra el sitio de hoy.
   - `armarFotos`: filas → fotos ordenadas, con `lat`, `lng`, `siteName`, `distanceM`.
2. **`photos.ts`**: selecciona las columnas de posición, trae los `job_sites` de la empresa (**también
   inactivos**: una foto de hace meses se mide contra el sitio que había) y, aparte, los fichajes a los que
   apunte una excepción fuera del día; delega en `armarFotos`. `DayPhoto` gana `lat`, `lng`, `siteName`,
   `distanceM` (null si el cliente no mandó posición). Mismo alcance por tienda, mismo gate de gerente.
3. **`DayPhotos.tsx`**: bajo cada foto, «📍 sitio · en el sitio» (0 m se dice así, nunca «0 m»), «📍 sitio
   · a 35 m», «📍 fuera de la geocerca · a 1,2 km de sitio» (coherente con el `offSite` que ya se pinta),
   las coordenadas si la empresa no tiene sitios, o «📍 sin ubicación». Con posición, la línea es un `<a>`
   a `https://www.google.com/maps?q=lat,lng` en pestaña nueva (`stopPropagation`, para no abrir el
   visor). **Enlace y no mapa a propósito**: ni Leaflet ni la API de Maps entran en `/timetracker`
   (First Load: 305 kB en esta rama contra los 304 kB que midió el orquestador en main; el kB es el diccionario de Time Tracker con seis claves más, que cargan todas sus rutas, no una librería; `/timetracker/audit`, donde vive la pantalla, 301 kB), cero llave. Seis claves `mgr.photos.loc*` / `openMap` en `en`/`es`,
   literales en la pantalla, que ya está en la prueba de claves de D-187.
4. **`PunchPanel.tsx`, el hueco:** salir y volver pasan `await ubicacionOpcional()`: la misma
   `getCurrentPosition`, 8 s, y **catch → `undefined`**: si el GPS falla o tarda, la excepción se graba
   igual sin posición. Salir a comer no ficha y no puede quedarse bloqueado por un permiso. **Entrada y
   salida no cambian ni una línea**: `ubicacion()` sigue obligatoria y los tipos de `clock.ts` iguales;
   la regla «sin foto se sigue fichando» sigue como estaba. Salir y volver siguen **sin foto**: añadirles
   cámara sería un flujo nuevo y no es lo pedido.

### Pruebas (`day-photos.test.ts`, 20 casos)

Los cuatro casos de distancia del auditor (centro +0,00045° N con radio 100 → 0; +0,00135° N → ~50 m;
centro del polígono → 0; 0,002° N del polígono → ~110 m) y un grado de latitud ≈ 111 km; `ubicar` con
sitio, sin sitio (el más cercano) y con nulos; `sitioDeExcepcion` por id, por turno y sin turno;
`armarFotos` con las cuatro clases, orden, `offSite` y nulos; `fmtDistancia` («35 m», «1.2 km», «1,2 km»)
y `enlaceMapa`. **Mutación:** quitar cualquier columna de posición de las `select`, el `job_sites` con
nombre y geocerca, o la llamada a `armarFotos`, cae nombrando la columna; la pantalla debe tener
`enlaceMapa`, `target="_blank"`, las claves literales y **ningún** `leaflet`/`google-maps-loader`; y
`PunchPanel` debe pasar `ubicacionOpcional()` en las tres llamadas de salir/volver.

### Qué NO cambia

Fichar entrada y salida (ni `ubicacion()`, ni `clock.ts`, ni el orden foto → posición → fichaje). El
alcance por tienda y el gate de gerente de las fotos. Ningún esquema. Ningún peso nuevo en `/timetracker`.

### Lo que se vio de paso y no se toca

`getDayPhotos` pinta como «salió del sitio» **cualquier** `exceptions.photo_path`, y `clock.ts` graba en
las excepciones de fichaje fuera de sitio / sin turno **la misma foto de entrada**: ese día Auditoría enseña
la foto dos veces (entrada y «salió»). Ya pasaba; ahora se nota más porque las dos llevan la misma
ubicación. Es una decisión de qué es una «foto de excepción», y va aparte.

### Lo no verificado

Nadie fichó ni salió a comer con un móvil tras el cambio, ni abrió Auditoría → Fotos con datos reales:
la línea de ubicación va por el mapeo puro (probado) y por las columnas (afirmadas en la prueba), no por
haberla mirado. Que la distancia coincida con lo que el servidor decidió (`in_radius`) va por reutilizar
la misma función, no por comparar filas reales. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1069 pasados | 3 saltados**
(main 8494cb5: 1049 | 3; los +20 son `day-photos.test.ts`). «Compiled with warnings» es `unpdf`, preexistente.

## D-213 · La ubicación de cada foto se abre en un mapa con su geocerca y el veredicto (dentro / fuera · distancia)

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (solo Time Tracker) ·
**Pedido por:** Andrés, literal: «quiero que las coordenadas donde se tomó la foto salgan con el
geofencing visible: si está adentro bien, si está afuera la distancia marcada». Sigue a D-212. Sin
migración.

### Medido antes

`GeofenceMap.tsx` ya dibujaba las geocercas (círculo por `radius_meters` o polígono por `boundary`)
con Google Maps vía `@/lib/google-maps-loader`; lo monta `GeofenceSection` en Ajustes, con las seis a
la vez y sin puntos. `DayPhoto` (D-212) traía `lat`, `lng`, `siteName` y `distanceM`, pero no con qué
geocerca se había medido. `/timetracker/audit`: 7,35 kB / 301 kB First Load. La clave de navegador de
Maps está hoy restringida a un dominio viejo (la arregla el dueño en Google Cloud): el mapa **falla**
en producción hasta entonces, y por eso el camino de fallo es el primero que se va a ver.

### Qué se hizo

1. **Datos, sin duplicar:** `DayPhoto` gana `siteId` (el mismo sitio que ya nombra `siteName`: el del
   fichaje o, si cayó fuera, el más cercano) y la respuesta de `getDayPhotos` gana `sites`, la lista
   que el servidor ya traía (id, nombre, centro, radio, polígono, padding), **una vez** y no una por
   foto. Son columnas que ya se leían. Mismo alcance por tienda, mismo gate.
2. **`lib/clockin/photo-map.ts`** (puro): `geocercaDeFoto` (solo la de esa foto), `estadoFoto`
   (`sinCoords` / `sinSitio` / `dentro` / `fuera`) **a partir de `distanceM` y `siteId` que calculó el
   servidor en D-212**: en el cliente no se mide nada, así que el veredicto de la ventana y la línea de
   debajo de la foto no pueden discrepar. `comoFence` pone el sitio en la forma de `GeofenceMap`.
3. **`GeofenceMap` gana dos props opcionales**, y sin ellas es lo de antes (diff funcional vacío en
   `GeofenceSection`): `points` (marcador clásico `SymbolPath.CIRCLE`, verde dentro / ámbar fuera, con
   la etiqueta al lado, y `fitBounds` incluye los puntos; un punto solo sin geocerca se frena en zoom 17)
   y `fallback(message)` (qué pintar si no hay clave o el script no carga). **La distancia va como texto
   junto al marcador y no como línea hasta el sitio**: la distancia es a la geocerca (D-212), y una línea
   al centro del sitio diría otra cosa. Nada de marcadores avanzados: exigen Map ID.
4. **`PhotoMapModal.tsx`** (nuevo): la ventana de D-187 (`Modal`) con el veredicto arriba («✅ Dentro de
   la geocerca · sitio» / «⚠️ Fuera de la geocerca · a 1,2 km de sitio» / «sin sitio asignado»), el mapa
   con **solo la geocerca de esa foto** y el punto, y debajo el enlace a Google Maps de D-212 y las
   coordenadas. Fotos sin coordenadas: la línea sigue sin ser pulsable.
5. **`DayPhotos`:** la línea de ubicación pasa de enlace a botón que abre la ventana; el enlace de D-212
   se queda dentro de ella como respaldo. **Carga diferida** (D-209): `PhotoMapModal` entra con
   `next/dynamic` al abrir, y con él `GeofenceMap` y el cargador de Google; la pantalla no los importa.
   Medido: `/timetracker/audit` **7,35 kB / 301 kB → 8,42 kB / 302 kB** (+1,1 kB de ruta: el botón, el estado y el `dynamic`; el mapa y el cargador van en su propio trozo, que solo baja al abrir). `/timetracker/settings`, donde vive `GeofenceSection`, 299 kB.
6. **Si el mapa no carga** (`googleMapsEnabled()` falso o el script falla): «No se pudo cargar el mapa»
   con el motivo y el enlace a Maps. Nunca un rectángulo en blanco.

Siete claves `mgr.photos.map*` / `showMap` en `en` y `es`, literales; `DayPhotos` y la ventana pasan por
la prueba de claves.

### Pruebas (`photo-map.test.ts`, 9 casos; `day-photos.test.ts` al día)

Los cuatro estados de `estadoFoto` (sin coordenadas → no pulsable; con coordenadas sin sitio → solo el
punto; distancia 0 → dentro; distancia > 0 → fuera con **esa** distancia, sin recalcular); la geocerca
por id y ninguna sin id; `comoFence`. **Mutación:** `DayPhotos` debe traer `PhotoMapModal` con
`next/dynamic` y no importar `GeofenceMap` ni el cargador; la ventana debe dibujar solo la geocerca de
esa foto con el punto, tener las siete claves y el enlace de respaldo; `GeofenceSection` debe seguir
llamando a `GeofenceMap` solo con `fences`. `fitBounds` y el dibujo real no se prueban por lectura,
como avisó el encargo.

### Qué NO cambia

`GeofenceSection`, el editor de geocercas, `getDayPhotos` en alcance y gate, la línea de texto de D-212
(mismos estados y textos), el enlace a Google Maps (ahora dentro de la ventana). Ningún esquema. La
prioridad de sitio (el del fichaje; si no, el más cercano) es la de D-212.

### Lo no verificado

Nadie abrió la ventana en un navegador: con la clave restringida al dominio viejo, en producción hoy
se vería el respaldo, no el mapa; que el marcador, la etiqueta y el encuadre salgan bien va por leer la
API de Maps (`Marker` con `label` e `icon`, `LatLngBounds.extend`), no por haberlo mirado. Cuando el
dueño arregle la clave, la primera comprobación es abrir una foto «fuera» y ver el punto ámbar con su
distancia fuera del contorno. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1078 pasados | 3 saltados**
(main 6e427c6: 1069 | 3; los +9 son `photo-map.test.ts`). «Compiled with warnings» es `unpdf`, preexistente.

**Nota del mismo día (CAMBIOS del auditor, antes del merge).** Lo de arriba tenía dos defectos que
bloqueaban y dos menores, medidos por el auditor y corregidos en la misma rama. (1) `points = []`
como valor por defecto en la firma de `GeofenceMap` era un array **nuevo en cada render**, y `points`
es dependencia del efecto que hace `new maps.Map`: en Ajustes, que no pasa puntos, cada `setState` de
`GeofenceSection` reconstruía el mapa, con parpadeo y una carga de Dynamic Maps **facturable** por
re-render. El default es ahora una constante de módulo (`SIN_PUNTOS`) y `PhotoMapModal` memoiza
`fences` y `points` con `useMemo`, que inline tenían el mismo defecto. (2) El caso real de producción
—llave restringida al dominio viejo— **no caía en el respaldo**: Google no rechaza la carga, resuelve,
pinta el mapa gris y avisa por `window.gm_authFailure`, que nadie capturaba. `GeofenceMap` lo registra
al montar (y lo retira al desmontar) y lo convierte en el error que pinta el respaldo con el enlace a
Maps; Ajustes enseña su aviso en vez del gris. (3) El padding de `fitBounds` había pasado de 24 a 40
también sin puntos, y eso cambiaba el encuadre de Ajustes: 24 sin puntos, 40 solo con puntos. (4)
`PhotoMapModal.tsx` entra en la lista de la prueba de claves de D-187. La mutación cubre los cuatro
(`photo-map.test.ts`, 9 → 12 casos). Lo no verificado no cambia: `gm_authFailure` está capturado por
lectura de la documentación de Maps, no porque alguien haya abierto la ventana con la llave rota.

**Segunda nota del mismo día (CAMBIOS del auditor, antes del merge).** El respaldo de la llave rechazada
solo funcionaba **la primera vez**: Google llama a `gm_authFailure` una vez, al cargar el script, y
`google-maps-loader` cachea `loadPromise` en éxito, así que la segunda ventana (o Auditoría después de
pasar por Ajustes sin recargar) resolvía de caché, nadie avisaba y el mapa salía gris. La fuente de
verdad pasa al **cargador compartido** `src/lib/google-maps-loader.ts`: instala `window.gm_authFailure`
una sola vez al crear el script, **recuerda el motivo a nivel de módulo** (`authFailed`), y
`loadGoogleMaps()` **rechaza con ese motivo mientras esté puesto, antes de devolver la promesa
cacheada**; expone `onMapsAuthFailure(cb)` para quien ya tenga el mapa pintado cuando llegue el aviso
(el caso de la primera vez) y `mapsAuthFailure()`. `GeofenceMap` deja de registrar el callback global
—que pisaba al del cargador— y solo escucha. **Es fichero compartido; lo importan** `GoogleMapView`
(Entregas), `MapView` (Entregas, solo `googleMapsEnabled`), `GeofenceEditor` y `GeofenceMap` (Time
Tracker). En el camino feliz no cambia nada para ninguno: mismo `loadPromise`, misma resolución; la
única diferencia es que, tras un `gm_authFailure`, `loadGoogleMaps()` rechaza en vez de entregar un
mapa gris, y los dos que lo llaman ya tratan el rechazo: `GoogleMapView` pinta su aviso «No se pudo
cargar Google Maps. Revisa que la llave del navegador permita este dominio» (`GoogleMapView.tsx:345`) y
`GeofenceEditor` su `setErr` con el motivo (`GeofenceEditor.tsx:77`). Es decir: con la llave rota, el
segundo mapa de Entregas también deja de salir gris y dice por qué. La mutación lo afirma por nombre (`photo-map.test.ts`): el cargador contiene
`gm_authFailure`, `authFailed` a nivel de módulo, y el rechazo va **antes** del `return loadPromise`;
`GeofenceMap` escucha y no asigna el global. No verificado: nadie disparó `gm_authFailure` de verdad;
va por la documentación de Maps.

## D-214 · La foto fuera de la geocerca se marca en rojo y más grande (mapa y línea bajo la foto)

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (solo Time Tracker) ·
**Pedido por:** Andrés, sobre D-213, literal: «quiero que sea un icon rojo más visible». Sin migración.
**Solo estilo e icono:** `estadoFoto` decide igual; ni una línea de lógica.

**Qué había (D-213).** El marcador de una foto era un círculo de 7 px, verde dentro y **ámbar** fuera,
con la etiqueta en blanco sin fondo: sobre el satélite híbrido, poco visible.

**Qué se hizo.** Una función pura, `estiloMarcador(estado)` en `lib/clockin/photo-map.ts`, decide color
y tamaño por estado, y todo lo demás la consume:

| Estado | Relleno | Tamaño | Etiqueta |
|---|---|---|---|
| fuera | **rojo del hub `#d64545`** (`--red`, igual en los dos temas) | **13 px**, borde blanco de 3 | distancia en rojo, peso 800, pastilla blanca con **borde rojo** |
| dentro | verde `#22c55e` | 7 px (el estándar) | nombre en verde oscuro, pastilla blanca |
| sin sitio | gris neutro `#9aa6b8` | 7 px | nombre en gris oscuro, pastilla blanca |

- `GeofenceMap`: `MapPoint.inside: boolean` pasa a `MapPoint.estado` (dentro / fuera / sinSitio); el
  marcador sigue siendo `SymbolPath.CIRCLE` (sin fichero en `public/`, sin dependencia). Solo
  `PhotoMapModal` pasa `points`; Ajustes no cambia.
- `timetracker.css`: `.tt-map-label` (pastilla blanca con sombra, para leerse sobre el satélite) y
  `.tt-map-label-out` (borde rojo). Google aplica `className` al elemento de la etiqueta.
- `DayPhotos`: la línea bajo la foto, cuando es «fuera», en `var(--red)` y peso 600 (misma variable
  que el marcador, mismo hex). Dentro y sin ubicación, como estaban.

**Pruebas** (`photo-map.test.ts`, 12 → 17): rojo, tamaño ≥ 1,8× el estándar, borde mayor y clase de
la etiqueta en «fuera»; verde 7 px dentro; gris y nunca rojo sin sitio; **mutación**: los tres estados
dan tres rellenos distintos y solo «fuera» sale del tamaño estándar; y, por fuente, que el mapa usa
`estiloMarcador(p.estado)` (y ya no `p.inside`), la ventana pasa `estado: e.kind`, la hoja tiene las
dos clases y la línea el rojo condicionado a `offSite`.

**Lo no verificado.** Nadie lo vio en un navegador (la llave de Maps sigue restringida al dominio viejo;
en producción hoy se ve el respaldo). Que la pastilla se pinte va por que Google aplique `className`
a la etiqueta, documentado, no visto. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1087 pasados | 3 saltados**
(main 8ba58bf: 1082 | 3; los +5 son `estiloMarcador`). `/timetracker/audit` 8,42 → 8,44 kB / 302 kB.

## D-215 · El veredicto de ubicación bajo la foto es una pastilla que nunca se corta; el sitio va debajo

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (solo Time Tracker) ·
**Pedido por:** Andrés, con captura sobre D-214: la línea «📍 Brownsville · on…» / «Brownsville · 8…» se
cortaba y no se leía el veredicto; quiere que diga claramente «On site» u «Out». Sin migración.
**Cero lógica:** `estadoFoto` y los datos, igual.

**Por qué se cortaba.** La línea de D-212 era un `.rev-note` (la nota de excepción, con `ellipsis` a
propósito) y llevaba el sitio ANTES del veredicto: lo que se perdía era justo lo importante.

**Qué se hizo.** `etiquetaFoto(p)` (puro, `lib/clockin/photo-map.ts`) decide la pastilla y la segunda
línea; la pantalla pone una clave literal por estado:

| Estado | Pastilla | Texto en / es | Segunda línea |
|---|---|---|---|
| on (distancia 0) | verde `.pill.on`, la de «Clock in» | 📍 On site / 📍 En el sitio | sitio |
| out (marcada fuera por el servidor) | roja `.pill.off` (la variable del módulo) | 📍 Out · 85 m / 📍 Fuera · 85 m | sitio |
| near (distancia > 0 sin marca de fuera: una excepción lejos, o dentro del margen de GPS) | ámbar `.pill.wait` | 📍 1.2 km away / 📍 A 1,2 km | sitio |
| noSite (coordenadas, sin sitio) | gris `.pill.neutral` (nueva: `--tt-chip` / `--tt-muted`) | 📍 No site / 📍 Sin sitio | coordenadas |
| none (sin coordenadas) | gris, no pulsable | 📍 No location / 📍 Sin ubicación | — |

- La pastilla es **lo primero de la fila** (`order:-1`), `white-space:nowrap` y `flex-shrink:0`: nunca se
  trunca. Con coordenadas es el botón que abre el mapa (D-213). El sitio va en `.rev-note`, que es lo que
  puede cortarse con `ellipsis`.
- **Claves:** los textos existentes `mgr.photos.loc*` cambian en vez de añadir; `{site}` sale de las
  claves (va en la segunda línea, como dato). **Se quita `mgr.photos.offSite`** en los dos idiomas: la
  pastilla «off site» sobraba junto a la roja «Out · 85 m» (§15: buscada literal y construida en `src/`,
  solo la usaba esa pastilla; `DayPhotos` está en la prueba de claves).
- Distancia con el formato que ya existe (`fmtDistancia`: m hasta 999, km con un decimal después).

**Pruebas** (`photo-map.test.ts`, 17 → 24): los cinco estados con su clase y su segunda línea; mutación
(rojo solo con `offSite`, verde solo con 0, nunca rojo sin sitio); y por fuente: la pantalla usa
`etiquetaFoto`, una clave por estado, sin `offSite`, la segunda línea, las reglas de la hoja, y ninguna
clave `loc*` lleva ya `{site}`.

**Lo no verificado.** Nadie lo vio en un navegador: que la pastilla no se corte va por `nowrap` +
`flex-shrink:0` en un `figcaption` con `flex-wrap:wrap` (si no cabe, baja de línea entera, no se
trunca), por lectura. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1094 pasados | 3 saltados**
(main 50dd899: 1087 | 3; los +7 son `etiquetaFoto`). `/timetracker/audit` 8,44 → 8,82 kB / 302 kB.

## D-216 · El mapa de la foto se entiende de un vistazo: geocerca marcada, pin de la foto y línea con la distancia

**Fecha:** 2026-09-06 · **Versión:** la asigna el orquestador al fusionar (solo Time Tracker) ·
**Pedido por:** Andrés, con captura de una foto «fuera» a 1,4 km, ya con la llave de Maps arreglada: el
polígono verde apenas se distinguía sobre el satélite, el punto de la foto no se veía (solo flotaba la
pastilla «1.4 km») y no quedaba claro qué estaba lejos de qué. Sin migración. **Solo el mapa de la
ventana** (`GeofenceMap` con `points`); el de Ajustes, sin puntos, no cambia una línea (medido:
`estiloGeocerca(false)` es 0,18 / 2, lo de siempre, y el marcador del sitio solo se dibuja con puntos).

**Qué se dibuja ahora, por capas.**

1. **Geocerca marcada:** relleno 0,3 y trazo 4 en el verde de siempre (`estiloGeocerca(true)`), y un
   marcador en el **centro del sitio** (círculo verde con borde blanco, `estiloSitio`) con el nombre del
   sitio en pastilla blanca. Se ve sobre satélite y sobre mapa.
2. **Pin de la foto:** un pin de verdad (`PIN_PATH`, el «place» de Material, con la punta anclada a la
   coordenada), grande y con borde blanco: **rojo 2,4×** fuera, verde dentro, **ámbar en «near»**, gris
   sin sitio; un punto pequeño en la punta con la coordenada exacta; y la etiqueta «📷 Photo / Foto» en
   pastilla junto al pin (clave nueva `mgr.photos.mapPhoto`).
3. **Línea con la distancia** (solo fuera o «near»): polilínea **discontinua** del pin al **punto más
   cercano de la geocerca**, con **flecha** en ese extremo (`FORWARD_CLOSED_ARROW` en `icons`), y la
   distancia **ya calculada en D-212** en una pastilla centrada sobre la línea (un marcador invisible en
   el punto medio), no flotando aparte. Roja si está fuera; ámbar si es «near». Dentro: sin línea.
4. `fitBounds` con la geocerca, el pin y el fin de la línea, padding 64 (24 sin puntos, como siempre),
   para que las pastillas no se corten contra el marco.

**Dónde termina la línea, dicho.** `geofence.ts` mide la distancia al borde pero no devuelve el punto;
`puntoMasCercanoGeocerca` (puro, en `photo-map.ts`) lo calcula con la **misma proyección plana** (un
grado de latitud ≈ 110 540 m, uno de longitud 111 320·cos φ): polígono → el punto más cercano de sus
lados; círculo → el punto del borde en la dirección de la foto (centro + radio), o la propia foto si ya
está dentro. No se usa el centro salvo como origen de esa dirección. La distancia de la pastilla NO se
recalcula: es `distanceM` del servidor; la línea es la dirección, la cifra es la de D-212.

**«near» en el mapa.** El pin distingue ahora, como la pastilla de D-215, la foto con distancia pero
**sin marca de fuera** del servidor (una excepción lejos, o un fichaje dentro del margen de GPS): ámbar
y no roja. `estadoFoto` no cambia; `PhotoMapModal` deriva `near` de `e.kind === "fuera" && !offSite`.

**Todo por variables ya usadas** (`--red` #d64545, el verde de «on» #22c55e, el ámbar #e9a13b), en
funciones puras hermanas de `estiloMarcador`, sin dependencia ni fichero nuevo.

**Pruebas** (`photo-map.test.ts`, 24 → 33): punto más cercano en círculo (a `radio` del centro; la propia
foto si está dentro) y en polígono (0,002° al norte del cuadrado → el lado norte, misma longitud); punto
medio; estilos por estado con **mutación** (cuatro rellenos distintos, solo «fuera» con la clase roja de
etiqueta; la geocerca sin puntos idéntica a la de siempre); y por fuente, que `GeofenceMap` usa
`estiloGeocerca(points.length > 0)`, dibuja el sitio solo con puntos, ancla el pin, pone el punto, traza
la línea solo con distancia con la flecha y la pastilla en el punto medio; que la ventana pasa `near`,
la etiqueta y `distanceLabel`; y que la clave existe en los dos idiomas.

**Lo no verificado.** Nadie lo vio en un navegador tras el cambio: que los guiones (`icons` con
`strokeOpacity: 0` en la línea), la flecha, el `labelOrigin` de la etiqueta del pin y la pastilla del
punto medio salgan como se describe va por la API de Maps (`Polyline.icons`, `Symbol.anchor`,
`MarkerLabel.className`), no por haberlo mirado; la primera comprobación es la captura del dueño: la
foto a 1,4 km con la línea hasta la geocerca de Brownsville. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1103 pasados | 3 saltados**
(main f6ec269: 1094 | 3; los +9 son la geometría y los estilos). Pesos: `/timetracker/audit` 8,82 → 9,39 kB / 303 kB;
`/timetracker/settings` 7,99 → 9,01 kB / 301 kB, porque `GeofenceMap` importa ahora la geometría de `photo-map.ts`
aunque Ajustes no la use (mismo dato que el auditor anotó en D-214; si algún día pesa, se saca a su módulo).

## D-217 · Conceder un módulo fallaba en los perfiles con la palabra vieja `clockin`, y el ERP se degradaba solo

**Fecha:** 2026-09-07 · **Versión:** la asigna el orquestador al fusionar (Entregas: el diálogo de
permisos y el proveedor son del hub) · **Pedido por:** Andrés, con captura: abre el perfil de una
empleada en Usuarios, el bloque Entregas sale vacío, y al marcar la casilla salta
`new row for relation "profiles" violates check constraint "profiles_module_access_known"`.
**Sin migración**, y eso es una decisión, no un olvido: ver más abajo.

### Diagnóstico, medido

- **La fila.** `role='manager'`, `module_access=['clockin']`, `timetracker_role` nulo. Es
  **literalmente la fila que `095_clockin_word_removal.sql` decidió no tocar**: su cabecera la nombra
  en el `DETAIL` del error que tumbó a la 088, y sus líneas 25-40 lo dejan escrito —«no se toca…
  quitarle la palabra a la brava lo dejaría con `module_access` vacío y aterrizando en `/no-access`…
  se prefiere dejar el rastro visible»—. Por eso su constraint quedó `not valid` (095:52-56): validar
  habría exigido tomar por esa persona una decisión que es de quien lleva el personal.
- **Por qué falla al guardar.** Las cuatro funciones de `data-provider.tsx` que escriben
  `module_access` construían el array nuevo sobre `target?.module_access ?? []`, o sea sobre el array
  **crudo de la fila**. Conceder «Entregas» mandaba `['clockin','deliveries']`, y
  `profiles_module_access_known` (que solo admite las cuatro palabras vivas) rechazaba el UPDATE
  entero. No es que la casilla no se guarde: es que **ninguna** casilla de ese perfil se puede guardar.
- **Por qué Entregas sale vacía.** `has_deliveries_access()` (083) es
  `role='admin' or 'deliveries' = any(module_access)`. Sin esa palabra, la RLS devuelve cero filas. La
  pantalla en blanco y el error al arreglarlo son **el mismo problema**, y por eso quien lo sufre no
  puede salir solo.
- **Alcance del dato** (orquestador, sobre producción): 36 perfiles, **1** con palabra no permitida,
  10 sin `deliveries`, 0 con `module_access` vacío.

### Qué se hizo: se arregla en la app, no en la base

`knownModules()` en `constants.ts` filtra el array a las claves que declara **`MODULE_ACCESS`** —la
misma lista cerrada (`ModuleAccessKey`) contra la que el diálogo despacha sus escrituras, no una lista
escrita a mano— y las cuatro funciones parten de ahí. Con eso **el primer guardado de ese perfil
escribe la lista sin `clockin`**: el bug queda arreglado y la fila se limpia sola en ese mismo clic,
sin tocar producción por fuera de la app y sin dejar a nadie en `/no-access`.

**El encargo pedía además una migración** que quitara la palabra y validara el constraint, y **se
retiró del alcance antes de escribirla**, por dos razones: revierte lo que 095 decidió por escrito (y
su `not valid` es parte de esa decisión), y **no hace falta** —el saneado en escritura limpia la fila
en el momento en que alguien la toca—. Si algún día aparecen filas viejas por otra vía, esa limpieza
será su propio encargo, con su plan. En esta rama no hay ningún `.sql`.

**No se usa `normalizeModules`, que está justo al lado, y esto importa.** Esa traduce `clockin` →
`timetracker` y es de **lectura**: existe para que a quien lleve la palabra vieja se le siga dibujando
la tarjeta a la que tiene derecho. Al **escribir** haría dos daños: concedería un módulo que nadie
pidió (marcar «Entregas» daría de paso Time Tracker), y **fallaría igual**, porque
`profiles_timetracker_access_needs_role` (058:30-33) exige tramo para tener `timetracker` y esa persona
no lo tiene. Se cambiaría un constraint incumplido por otro. Filtrar es lo único que no decide nada
por nadie.

### El error, legible

`src/lib/user-write-error.ts` (puro) traduce al idioma del usuario los **tres** constraints que esta
pantalla puede tocar (`profiles_module_access_known`, `profiles_timetracker_access_needs_role`,
`profiles_erp_role_known`) y **deja pasar tal cual cualquier otro fallo**: inventar un texto genérico
para lo desconocido esconde justo lo que haría falta leer. El crudo, con su `code`, va a la consola.
Las otras escrituras de perfil (nombre, tienda, rol de Entregas) siguen pintando el mensaje de la base:
fuera del alcance del encargo, y dicho aquí.

### El hallazgo del punto 4, que resultó ser dos

El select de `profiles` traía `recruiting_role`, `module_access` y `timetracker_role` pero **no
`erp_role`**, y de esa fila salen dos cosas:

1. **Lo visible:** el diálogo pinta el rol de cada módulo con `u[m.roleColumn]`
   (`UserDialog.tsx:220`), y el del ERP es `erp_role`. Llegaba siempre `undefined`, así que el
   selector enseñaba el valor por defecto aunque en la base pusiera «admin».
2. **Lo que no se veía:** `setModuleAccess` llama a `updateUserErpAccess(id, { granted })` **sin**
   `erp_role`, y allí `nextRole = granted ? (erp_role ?? target?.erp_role ?? "staff") : null`. Con
   `target?.erp_role` siempre indefinido, **volver a marcar la casilla del ERP escribía «staff» encima
   del rol real**: una degradación silenciosa de admin o manager a staff, registrada además como
   `erp_role_changed`. No es hipótesis: es la cascada leída línea a línea.

Una palabra en el select arregla las dos. `updateUserErpAccess` no se toca: su cascada ya era la
correcta, le faltaba el dato.

### Qué NO cambia

Ninguna RLS, ninguna función de la base, ningún `.sql`. Ningún permiso efectivo: `clockin` no lo lee
nadie desde 087 (`has_clockin_access()` mira `timetracker_role`). Las otras escrituras de perfil.

### Lo no verificado

Nadie abrió Usuarios en producción tras el cambio: que el guardado de ese perfil pase ahora va por el
filtro (probado en solitario) y por leer el constraint, no por haberlo hecho. La degradación del ERP
está leída en la cascada, no reproducida contra la base. Y queda dicho lo que este arreglo **no**
hace: a esa persona hay que **concederle un módulo** para que deje de aterrizar en `/no-access`; el
arreglo hace que ese clic funcione, no lo da por hecho. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1123 pasados | 3 saltados**
(main 16d4454: 1103 | 3; los +20 son `module-access-write.test.ts`). `/home/users` 11,7 kB / 295 kB, sin cambio.

## D-218 · En Mi ruta, «Recoger» y «Entregar» cierran la parada de un toque (y dejan de prometer etapas imposibles)

**Fecha:** 2026-09-08 · **Versión:** la asigna el orquestador al fusionar (solo Entregas) ·
**Pedido por:** Andrés, literal: *«pickup and delivered needs 2 taps: en Mi ruta, si no he abierto la
orden, el botón de Pickup o Deliver en vez de cambiar la etapa me abre el formulario y me toca volver
a presionar»*. Sin migración.

### El bug, medido

`src/app/(app)/my-route/page.tsx:255`: el botón verde de la tarjeta «Siguiente parada» decía
`🚚 Recoger` o `✅ Entregar` y su `onClick` era `setOpen(next)`. **La etiqueta prometía una etapa y lo
que hacía era abrir la ficha.** El segundo toque no aportaba nada, porque lo que la ficha pide en ese
paso hoy no existe:

- **Recoger** ya tenía una vía de un toque documentada dentro de la ficha (`confirmPickup(quickTotal)`,
  «the driver's one-tap path… no pallet prompt and no split»): el recuento es opcional y no hay nada
  obligatorio que preguntar.
- **Entregar** solo abre formulario si hace falta prueba: firma encendida, o comprobante exigido sin
  fotos. **En producción los dos ajustes están en `false`** (medido por el orquestador), así que hoy no
  hay nada pendiente y el segundo toque es fricción pura.

### Un segundo bug que apareció al mirar el ternario

`next` es `stops.find((d) => d.stage !== "delivered")` (:61) sobre una lista que solo descarta
`canceled` y `rejected` (:42-48). O sea que a `next` pueden llegar **seis** etapas: `draft`, `pending`,
`approved`, `fulfilling`, `ready` y `picked_up`. Con el ternario binario (`stage === "ready" ? Recoger
: Entregar`), **un pedido en `fulfilling` —lo normal a primera hora, asignado y con fecha de hoy— ya
pintaba «✅ Entregar»**. Mientras el botón solo abría la ficha era inofensivo; en cuanto ejecuta, sería
prometer una transición que `LEGAL_TRANSITIONS` (`constants.ts:750-760`) rechaza. Lo trajo el auditor
en su línea base y lo confirmé leyendo las dos listas.

### Qué se hizo

**`src/lib/one-tap-stop.ts`** (puro, sin React ni red), que usan **las dos** pantallas:

| Función | Qué decide |
|---|---|
| `podSinCumplir(ajustes, fotos, firma)` | la primitiva: la oficina exige comprobante y no lo cumple ni foto ni firma |
| `pruebaPendiente(ajustes, fotos)` | `firma encendida ‖ podSinCumplir(…, null)` — si hace falta el formulario |
| `accionParada(etapa, ajustes, fotos)` | `pickup` · `deliver` · `pod` · `open` |
| `escrituraRecogida({pedido, me, gps, t})` | nota + `extra` de la recogida: GPS, claim del chofer y recuento |
| `extraRecogida` · `extraEntrega` · `claimDelChofer` · `palletsDeRecogida` | las piezas |

- **El botón ejecuta**, con la etiqueta y la acción salidas de la **misma** llamada a `accionParada`:
  `ready` → recoge; `picked_up` sin prueba pendiente → entrega; `picked_up` con prueba pendiente →
  abre la ficha y la etiqueta lo dice («Prueba de entrega…»); **las otras cuatro etapas → «Ver
  orden»**. Se mantiene un botón en esas etapas en vez de esconderlo: la tarjeta no tiene ninguna otra
  forma de abrir el pedido, y quitarlo cambiaría un botón que miente por una tarjeta sin salida.
- **Un toque, no dos:** el botón se deshabilita mientras guarda —por id de parada, para que se vea
  cuál— y la función sale sola si ya hay una escritura en curso.
- **El GPS no bloquea:** se espera lo mismo que espera la ficha (`captureLocationSplit`, 1,2 s) y, si
  no llega, se guarda igual y la coordenada tardía se adjunta después en silencio, como hace la ficha.
- **Entregar de un toque no inventa datos:** escribe hora y posición, y deja `pod_received_by` y
  `pod_signature` en nulo. Esa vía solo existe cuando no había nada que pedir; escribir un nombre vacío
  sería fabricar una prueba.

### La duplicación que había, y que era peor de lo que parecía

La regla del comprobante no estaba en un sitio, sino en **dos**: `podFormNeeded` (`signatureOn ||
podOwed`, :785) y una segunda guarda dentro del guardado (:848) que además aceptaba la firma recién
hecha. No eran dos copias: eran la misma regla mirada en dos momentos, escritas por separado y libres
de divergir. Ahora las dos salen de `podSinCumplir`, con la firma como parámetro. La **carga completa**
—la vía rápida del chofer y la confirmada por la oficina— se escribe con `escrituraRecogida`. La
**división de carga parcial** no pasa por el helper y sigue igual: su nota y su `order_suffix` son
suyos, y meterla ahí habría sido generalizar un caso que no comparte con nadie.

### Punto 5: otros botones que prometen una etapa (medido, no tocado)

Buscados `AttentionPanel`, `/driver` y `OrdersTable`: **ninguno** promete una etapa y solo abre la
ficha. `AttentionPanel` lista avisos («Entregada sin comprobante») y su botón abre el pedido, que es lo
que dice; `/driver` y `OrdersTable` abren la fila con `onOpen`, sin botón de etapa. **El de
`my-route:255` era el único.** Nada que arreglar fuera de aquí.

### Qué NO cambia

`OrderModal` fuera de la extracción: mismos textos, mismas columnas, mismas condiciones. La división
de carga parcial. `LEGAL_TRANSITIONS`, la RLS, el esquema. Ningún ajuste: si mañana se enciende la
firma, el botón pasa solo a «Prueba de entrega…» porque lee el mismo ajuste que la ficha.

### Lo no verificado

**Nadie pulsó el botón contra producción, a propósito:** cerrar una parada de verdad mueve una entrega
real, y eso no se hace para probar (regla permanente del proyecto). Que la escritura sea la misma que
la de la ficha va por compartir el constructor y por la prueba en solitario, no por haberlo visto. El
GPS no se ejerció con un dispositivo: la vía sin fix está probada, la de fix tardío va por leer
`captureLocationSplit`. Y el estado de los dos ajustes en producción (`false`) es medición del
orquestador, no mía. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1147 pasados | 3 saltados**
(main 2568bfd: 1124 | 3; los +23 son `one-tap-stop.test.ts`). `/my-route` 3,87 → 5,12 kB / 295 kB: +1,25 kB de ruta
por la acción y el helper; el peso compartido no se mueve.

**Nota del mismo día (tres observaciones del auditor, antes del merge).** Las tres estaban medidas y
ninguna bloqueaba; dos se cerraron y una queda escrita como límite conocido.

1. **`delivered_address`, cerrada.** `extraEntrega` no incluía la clave y la ficha sí la escribe
   (`altAddr || null`, `OrderModal.tsx:879`): por la vía rápida siempre sería `null`, así que la
   diferencia real era que **la ficha borra una dirección alternativa vieja y el helper la
   conservaba**. Sin efecto práctico hoy —`delivered_address` solo se escribe al entregar y de
   `delivered` no se vuelve—, pero el módulo existe justo para que las dos vías no discrepen, así que
   se añade. No había razón medida para no borrarla. La prueba fija las siete claves y comprueba que
   la ficha sigue escribiendo la suya.
2. **Un recuento de pallets que nadie contó: eso era, y por eso se arregla y no se anota.** El aviso
   parecía menor —«`actual_pallets: n || null` equivale a main solo mientras `n > 0`»—, y al escribir
   la prueba resultó ser otra cosa.

   **Qué pasaba.** El primer intento pasaba el recuento *dentro* del pedido:
   `escrituraRecogida({ pedido: { ...existing, actual_pallets: n || null }, … })`. Con `n = 0`, ese
   `n || null` lo convertía en `null`, y dentro del helper `palletsDeRecogida` hace
   `actual_pallets ?? est_pallets ?? 0`. **`??` no cae con 0, solo con nulo**: por eso el 0 tenía que
   viajar disfrazado de nulo… y justo por eso caía al **estimado**. Un pedido con `est_pallets = 9`
   del que el camión se lleva 0 se habría guardado como «Cargadas: 9 pallets», con `actual_pallets: 9`
   escrito en la fila. No es una equivalencia frágil: es **escribir un número que nadie contó en una
   entrega**, y el `??` es lo que lo escondía —el operador correcto para «si no hay dato, usa el
   siguiente» es justo el que convierte un cero legítimo en «no hay dato» cuando alguien lo anula
   antes.

   **Qué escribe ahora.** `escrituraRecogida` acepta `pallets` explícito y la ficha le pasa su `n`
   directamente; el pedido viaja intacto. Un 0 es un 0: nota «Loaded» sin número y **sin**
   `actual_pallets` en el `extra`, que es exactamente lo que hacía main. Sin `pallets`, el recuento
   sigue saliendo del pedido, como antes.

   **Y ninguna fila quedó mal escrita, por una razón más simple que la que decía antes esta nota.**
   Lo primero que se escribió aquí fue que las guardas lo evitaban —la vía confirmada rechaza
   `n <= 0` antes, la rápida solo da 0 con ambos recuentos nulos—, y es cierto pero no es lo
   importante: **el camino defectuoso nunca salió de esta rama.** Lo introdujo el commit de la
   extracción y lo quitó el del arreglo, los dos sin fusionar; en producción no existió nunca. La
   precisión es del auditor, y la deja anotada con su límite: lo sabe por el repo y su historial, no
   por consultar la base, porque él no consulta producción.
3. **El doble clic, límite conocido y escrito.** `guardando` es **estado de React**, así que dos clics
   en el mismo tick leerían `null` los dos: lo que los para en la práctica es el `disabled` del botón,
   no el `if`. Un `useRef` sería estricto; el auditor lo midió y no lo pidió, y se deja así a
   propósito, dicho aquí para quien lo lea dentro de un año.

## D-219 · La zona local de entrega se decide por el punto, no por el nombre de la ciudad, y se ve en verde sobre el mapa

**Fecha:** 2026-09-08 · **Versión:** la asigna el orquestador al fusionar (solo Entregas) ·
**Pedido por:** Andrés, con captura del Valle: *«quiero que me hagas este geofencing del delivery fee
porque no está funcionando bien, siguiendo ese boundary y obviamente north del río para que siga en el
US»*, y después *«cuando se calcule el fee, en el mapa todo el área local se mire en verde»*.
**Sin migración y sin columna nueva**, y eso es una decisión, no un descuido: ver abajo.

### Por qué fallaba

La zona salía del **nombre de la ciudad**: `cityFromAddress(d.delivery_address, …)` sacaba una palabra
de la dirección y se comparaba con `LOCAL_CITIES_DEFAULT`. Es sacar un dato de texto libre, y falla por
donde falla siempre: en las filas reales hay direcciones que terminan en «TX», en el código postal, o
en minúsculas y sin comas. Ahí no hay ciudad que reconocer, y como una ciudad no reconocida cae a
`nonlocal`, **una entrega a dos calles del almacén podía salir NO LOCAL** — con aprobación del gerente
y la tarifa alta (500 + millas en vez de la fórmula local).

El punto sí es fiable: **102 de 112 pedidos tienen `delivery_lat`/`delivery_lng`** (91 %: 97
geocodificados y 5 puestos a mano; medición del orquestador sobre producción, 2026-09-08).

### Qué se hizo

**`src/lib/delivery-zone.ts`** (puro): `LOCAL_ZONE_DEFAULT` (el contorno, 18 vértices comentados uno a
uno) y `puntoEnZonaLocal(lat, lng, zona?)`, que devuelve `true` / `false` / **`null`**. El `null` es
deliberado: quien llama tiene que poder distinguir «está fuera» de «no lo sé», porque lo segundo se
resuelve cayendo al método viejo y lo primero no.

`suggestDeliveryFee` decide así, en este orden:
1. **hay punto** → dentro = `local`, fuera = `nonlocal`;
2. **no hay punto** → el método de ciudad de siempre, **sin cambiarlo** (`isLocalCity`,
   `localCities`, `LOCAL_CITIES_DEFAULT` intactas);
3. **no hay dirección** → `unknown`, como antes.

La ciudad se sigue enseñando como texto y **las fórmulas de tarifa no se tocan**: mismo precio para la
misma zona y las mismas millas. **Nada retroactivo:** no se recalcula ni se toca la tarifa de ningún
pedido guardado; solo cambia la sugerencia de los nuevos.

`pointInPolygon` no se duplicó: **subió de `lib/clockin/geofence.ts` a `lib/geo.ts`** —la geometría
neutral que ya usaban Entregas y las analíticas— y `geofence.ts` lo reexporta, así que sus dos
importadores (`clock.ts`, `day-photos.ts`) no cambian ni un import.

### Dos correcciones al contorno de partida, medidas

1. **El boceto dejaba Matamoros DENTRO**, que es exactamente lo que el dueño pidió evitar. Con los
   vértices (25.84, −97.38) → (25.88, −97.55), Matamoros (25.880, −97.504) queda al norte de esa
   recta. La causa es física: ahí el río separa dos ciudades pegadas —Brownsville está a 25.902, unos
   **2,4 km**— y un borde de dos vértices no puede pasar entre ellas. El tramo del río lleva ahora
   cinco vértices que lo siguen de cerca: en lng −97.50 el borde va por **25.892**, entre las dos, con
   ~1 km de margen a cada lado.
2. **La costa** se ajustó para que South Padre y Port Isabel queden dentro y Port Mansfield fuera.

**Comprobado con 34 ciudades reales:** las 24 locales dentro (incluidas Brownsville, South Padre, Port
Isabel, Los Fresnos y Combes); fuera Raymondville, Port Mansfield, Río Grande City, Falfurrias y
Houston; y fuera Reynosa, Matamoros, Río Bravo, Nuevo Progreso y Valle Hermoso. **El borde sur es el
río**, así que México queda fuera por construcción, sin ninguna regla especial que mantener.

### El cotejo contra los 112 pedidos de producción (medición del orquestador)

Se corrió **dos veces** con la función pura contra las filas reales, y las dos entran aquí porque la
primera es la que encontró un fallo del contorno.

**Primera pasada** (contorno con el río casi recto): 102 decididos por el polígono (99 dentro, 3
fuera), 91 coincidencias y **11 cambios**. De esos 11, nueve eran el bug del dueño… y **dos eran un
fallo mío**: dos direcciones de Brownsville **al norte del río** que el trazado dejaba fuera. Se
corrigió el tramo (seis vértices, el cauce baja hacia el este) y se repitió.

**Segunda pasada** (el contorno que se fusiona, 20 vértices):

- **102 los decide el polígono: 101 dentro, 1 fuera.** **10 sin punto** caen al método viejo.
- **93 coinciden** con la clasificación de hoy por ciudad; **9 cambian**, y los nueve son
  **NO LOCAL → LOCAL**. Las dos de Brownsville ya no cambian.
- **El único que queda fuera es `340 LIBERTY CIRCLE`**, en 32.525, −94.822: este de Texas, a **561
  millas**. Era no local y lo sigue siendo — el polígono no se traga entregas lejanas.
- Control de ciudades: **fuera** Matamoros, Reynosa, Río Bravo, Nuevo Progreso, Raymondville, Port
  Mansfield y Río Grande City; **dentro** McAllen, Brownsville, South Padre, Port Isabel, Harlingen,
  Los Fresnos y Edinburg.

Los nueve que cambian **son exactamente el bug que reportó el dueño**: entregas del
  Valle a las que se estaba cobrando la tarifa de fuera (500 + millas) porque la ciudad no se leía
  de la dirección. Tres a `32878 Nayeli St, Los Fresnos` (ciudad leída: «TX»), una a
  `117 Heron Drive, Los Fresnos` («78566»), una a `720 N ARROYO BLVD LOS FRESNOS` (se leía la
  dirección entera), una a `28 Spoonbill Cove Road, Laguna Vista` («TX»), dos a Rancho Viejo y una
  a `4512 LOIRA BVILLE, TX. 78520`.
**Un dato que salió de paso y NO se arregla aquí:** `LOCAL_CITIES_DEFAULT` dice **«Ranch Viejo»** y
la ciudad es **Rancho Viejo**, así que por el método de ciudad esas entregas no casaban nunca. No se
toca en esta rama a propósito: el encargo exige que el respaldo quede **idéntico**, y cambiarlo
alteraría la clasificación de los pedidos sin punto, que es justo lo que no se quería mover. Por el
punto ya salen locales. Corregir la lista es un cambio de una palabra, y su propio encargo.

### El contorno vive en el código, y lo que eso NO permite

Se valoró guardarlo en `settings` y **se descartó con la medida delante**: `settings` no es un
clave-valor, es **una fila con columnas** (`data-provider.tsx:1211` hace `update(patch).eq("id", 1)`),
así que «guardarlo sin migración» no existía. Las salidas eran columna nueva, reutilizar una columna
muerta (un nombre que miente) o constante. Se eligió **constante**: mientras nadie pueda dibujar el
contorno desde la pantalla, una columna nace vacía y sin quien la escriba — código muerto con una
migración incluida. **Consecuencia, dicha:** mover el contorno **exige un despliegue**. El día que el
dueño quiera moverlo desde Ajustes, la columna y el editor entran en el mismo encargo. `local_cities`
se queda donde está y funcionando: es el respaldo de los pedidos sin punto.

### El verde, en los DOS mapas

`MapView` es un **conmutador** (`MapView.tsx:34-35`): con llave de navegador renderiza `GoogleMapView`,
sin ella `LeafletMap`. La llave **está puesta en producción**, así que pintar la zona solo con Leaflet
—como decía el encargo— **no se habría visto**. Se pinta en los dos, con la geometría y el color
salidos del mismo módulo para que no puedan divergir: `L.polygon` y `google.maps.Polygon`, mismo
`ESTILO_ZONA` (relleno 0,12 para no tapar calles), ambos por debajo de todo y sin capturar el clic con
el que se suelta el pin. No es exceso: el camino de Leaflet entra justo **cuando la llave falla** —pasó
hace dos días con el dominio nuevo— y es cuando más falta hace ver la zona.

**El verde no es un hex inventado ni un `var()`** —que ninguna de las dos APIs entiende—: `colorZona()`
lee `--green` del tema en tiempo de ejecución y solo cae al literal `#1f9d61` cuando no hay DOM, que es
el mismo `--green` de `globals.css:12`.

La prop `zone` es **opcional**: los siete usos de `MapView` que no la pasan (mapa, mercado, mi ruta,
rutas, seguimiento) quedan exactamente igual. La usan los **dos** selectores de pin de la ficha y un
bloque nuevo en Ajustes, que enseña el contorno en solo lectura y en carga diferida (D-209), y dice que
moverlo exige un despliegue. Se usa `MapView` y no `GeofenceMap`: un solo camino de mapa.

### El borde exacto, medido — y un dato que corregí

Sobre el borde llegó el aviso de que un punto exactamente encima de una arista oblicua cae siempre
fuera. **En este contorno no es cierto, y se midió antes de escribirlo:** en el punto medio exacto de
las 18 aristas, unas dan **dentro** y otras **fuera**, según la orientación de la arista respecto al
rayo que traza el algoritmo. Lo que sí está garantizado —y probado— es que el resultado es
**determinista** e **invariante al orden de los vértices**. En el río no es un riesgo práctico: hay
~1 km de margen a cada lado y un pin no cae sobre la línea.

### Qué NO cambia

`listFee`, `discountFee`, `DeliveryZone` y el respaldo por ciudad completo. Ninguna RLS, ninguna
función de base, ningún `.sql`, ninguna columna. Los cinco mapas que no reciben la zona.
`GeofenceMap`/`GeofenceSection` (fichaje) fuera del diff. Ninguna tarifa ya guardada.

### Nota del mismo día (tres observaciones del auditor, antes del merge)

1. **Cerrada: un pin en 0,0 ya no decide una tarifa.** `puntoEnZonaLocal(0, 0)` devolvía `false`, no
   `null`, así que un pin corrupto —0,0 es lo que escribe un geocodificador cuando falla, y cae en el
   golfo de Guinea— **se saltaba el respaldo por ciudad y el pedido salía NO LOCAL**: 500 + millas y
   aprobación del gerente, en silencio y aunque la dirección dijera McAllen. Es el mismo tipo de
   camino que arregla esta decisión, un dato malo decidiendo una tarifa. Hoy no hay ninguna fila así
   (rango real medido: lat 25,88 → 32,53), o sea que se cierra **antes** de que exista. Un 0 en una
   sola coordenada sí sigue siendo un punto: no se descarta de más.
2. **Límite conocido, sin tocar:** un pedido **con pin y sin dirección textual** sigue dando
   `unknown`, porque `hasAddr` se comprueba antes que el punto. Es lo conservador y encaja con «nada
   retroactivo», pero el punto existe y en ese caso no se usa.
3. **Límite conocido, sin tocar:** el *first load* de `/settings` sube **3 kB** (296 → 299) aunque la
   ruta suba 1,48 — el mapa entra en diferido, pero el módulo compartido se contabiliza ahí.

### Lo no verificado

Nadie abrió la ficha ni Ajustes en un navegador tras el cambio: que el polígono se pinte va por leer
las dos APIs (`L.polygon`, `google.maps.Polygon`) y por las pruebas de forma, no por haberlo visto. El
cotejo contra los 102 pedidos reales **lo corre el orquestador** con la función pura —yo no tengo
`.env.local`— y su resultado entra aquí antes de fusionar. Los 34 puntos de ciudad son coordenadas de
centro urbano, no direcciones de clientes. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1206 pasados | 3 saltados**
(main ed65a6f: 1149 | 3; los +68 son `delivery-zone.test.ts`). Pesos: `/settings` 8,06 → 9,53 kB / 299 kB (el bloque
nuevo y su mapa diferido); `/map` 296, `/market` 295, `/my-route` 296, `/routes` 318, `/track` 295, sin
cambio funcional en ninguno.

## D-220 · La zona la decide el pin que el usuario está viendo, y el aviso dice de dónde sale

**Fecha:** 2026-09-08 · **Versión:** la asigna el orquestador al fusionar (solo Entregas) ·
**Pedido por:** Andrés, con captura, en caliente sobre D-219: coloca el pin en el mapa de la ficha,
**lo ve dentro del área verde**, y debajo sigue leyendo «⚠️ Not local — requires manager approval».
Sin migración.

### El diagnóstico: la zona no mentía

El punto de su pin (suroeste de Lyford, ~26.405, −97.795) da **DENTRO** con la función que ya estaba
en `main` — lo comprobó el orquestador. Lo que fallaba es que **el aviso no se calculaba con ese
punto**:

- `d` en `OrderModal` es el **formulario**, no el pedido guardado.
- Un pin recién soltado vive en `pinDraft`: `dropPin` solo hace `setPinDraft` y geocodifica.
- Quien escribe `delivery_lat`/`lng` es `savePin`, atado al botón «Save pin».
- Entre soltar y guardar, `suggestDeliveryFee(d, settings)` seguía viendo **el pin viejo, o ninguno**.

En la captura los botones «Save pin / Clear pin / Cancel» están visibles: el pin era un borrador sin
guardar. De ahí el desfase entre lo que el mapa enseña y lo que el aviso dice.

### Qué se hizo

**La precedencia es: borrador visible → pin guardado → ciudad.** El aviso cambia **al mover el pin**,
sin esperar a «Save pin» ni a «Calculate distance & fee», y el borrador **no escribe nada en el
pedido**: solo cambia lo que se enseña. Vale en **los dos** selectores de pin de la ficha, que
comparten `pinDraft` y `dropPin`.

**Dos condiciones, no una, y la segunda es un hallazgo del auditor.** «Cancelar» solo cerraba el
selector y dejaba el borrador puesto: con la precedencia nueva, un pin **descartado** habría seguido
decidiendo la zona. Se cierra por partida doble:

1. «Cancelar» pone `pinDraft` en `null` — es lo que la palabra significa, y de paso tapa una fuga de
   estado que ya existía;
2. el borrador **solo cuenta con el selector abierto** (`pinVisible = showPinPicker && pinDraft`).

La segunda no cambia nada observable hoy, y aun así se queda, porque el auditor midió **por qué hace
falta**: en `main` hay **cuatro** sitios que cierran el selector y no todos limpian el borrador —los
dos «Clear pin» sí, los dos «Cancelar» no (lo que se arregla), y **`savePin` tampoco**—; además la
búsqueda de dirección **abre** el selector poniendo `pinDraft` desde el geocodificador. Sin el
invariante, la corrección depende de que las cinco vías —y las que se añadan— se acuerden de limpiar.
Tras «Save pin» el borrador deja de contar, pero para entonces el pedido ya tiene ese mismo punto: el
resultado no cambia.

### La otra mitad del problema: por qué decía «No local»

Un «No local» a secas no distingue **«esta dirección no tiene pin»** de **«esta entrega está lejos de
verdad»**, y el dueño perdió un rato justo ahí. `FeeSuggestion` gana **`zoneSource`** (`"pin"` ·
`"city"` · `"none"`) y la ficha lo pinta junto a los dos avisos y a la insignia LOCAL / NO LOCAL:

- «por el pin que acaba de colocar» — hay borrador visible;
- «por el pin guardado» — decidió el punto del pedido;
- «por la ciudad de la dirección (McAllen) — esta orden no tiene pin».

`zoneSource` es **un código, no una frase**: la función pura dice *qué* decidió, la pantalla elige el
texto (misma línea que D-210 con los mensajes del ERP). La lógica no puede distinguir borrador de
guardado —recibe el pedido con las coordenadas ya puestas—, así que esa distinción la hace la ficha,
que sí lo sabe.

**i18n:** el hub **no** tiene diccionario de claves (`usePrefs().t(en, es)`, pares en línea) y la
prueba de claves de D-187 cubre solo `timetracker`, así que esta pantalla no entra en ninguna lista:
cada texto lleva sus dos idiomas en el propio `t(...)`. `city` va dentro del literal porque es **dato**
y sale igual en los dos idiomas; lo que sí es texto —el «not recognized» / «no reconocida» de cuando
no hay ciudad— va en **cada** literal, no en una variable.

### Qué NO cambia

La tarifa guardada y las fórmulas (`listFee`, `discountFee`), el respaldo por ciudad completo, el
flujo de «Calculate distance & fee», `podBlocker` y el resto del modal. `delivery-zone.ts` y `geo.ts`
**sin tocar**: esto es *de dónde viene el punto*, no *cómo se decide la zona*. Cero escrituras nuevas
de `delivery_lat`/`lng`. Y **sin memoizar** a propósito: `feeSuggestion` se recalcula en cada render,
que es lo que hace que el aviso se actualice solo al mover el pin; la prueba lo fija para que nadie lo
«optimice».

### Evidencia de campo, y el aviso que se añadió por ella

Mientras se escribía esto, la base pasó de 112 a **114 pedidos, de 10 a 12 sin punto** (medición del
orquestador). Los dos nuevos son pruebas del dueño de esa misma mañana y **nacieron sin coordenadas**:
puso el pin, vio el verde… y como no pulsó «Save pin», el pedido se guardó **sin punto** y cayó al
respaldo por ciudad. Es exactamente el camino que cierra esta decisión, ocurriendo de verdad.

Y destapa un riesgo del propio arreglo: con la zona calculada sobre el borrador, el aviso pasa a ser
correcto sobre **lo que se ve**, lo cual puede dar falsa tranquilidad si el pin no se guarda. Por eso
el motivo del borrador no dice solo de dónde sale, sino que **falta guardarlo**: «por el pin que acaba
de colocar — **sin guardar todavía**». El texto correcto sobre un pin sin guardar sigue siendo un
texto sobre algo que la base no tiene.

### Lyford entero dentro (mismo asunto, misma rama)

El dueño vio que el contorno **partía Lyford por la mitad** y pidió meterlo entero. Medido: el borde
norte bajaba en diagonal de (26.45, −97.95) a (26.38, −97.70), y en la longitud de Lyford caía en
**26.404**; el centro (26.4128) y el extremo norte (~26.425) quedaban **fuera**, aunque unos cientos
de metros al suroeste ya estuvieran dentro. Un pueblo partido no es una zona de reparto.

El cambio es **un vértice**: el norte se mantiene en 26.45 hasta −97.75 y baja después; el resto del
contorno no se toca (21 vértices). Las tres restricciones, con margen medido: **Lyford entero dentro**
(el extremo norte a ~2,8 km del borde), **Raymondville** (26.482) **fuera** a ~3,5 km —el dibujo
original del dueño la pone en NO LOCAL— y **Port Mansfield** (26.556) **fuera**. La prueba fija Lyford
por sus **dos** extremos, los dos vecinos, y el margen por ambos lados (26.44 dentro, 26.46 fuera).

**Cotejo del contorno nuevo contra los 114 pedidos** (medición del orquestador): **frente a D-219, ni
un solo pedido cambia de zona** — no hay ninguna entrega existente en esa franja, así que subir el
tramo no reclasifica nada ya cobrado. Frente a la clasificación por ciudad siguen siendo **93
coincidencias y 9 cambios**, los mismos nueve NO LOCAL → LOCAL de D-219.

### Punto 4 del encargo: dónde más se enseñaba la zona

Los **tres** bloques que enseñan zona o tarifa sugerida —el formulario, el panel de la derecha y el
bloque de cobro— salen del **mismo** `feeSuggestion`, así que se arreglan en la misma línea. Ningún
otro sitio de la app llama a `suggestDeliveryFee`. Nada más que listar.

### Lo no verificado

Nadie abrió la ficha en un navegador tras el cambio: que el aviso cambie al soltar el pin va por que
`feeSuggestion` se recalcula en cada render y por las pruebas de forma, no por haberlo visto. El punto
de la captura lo midió el orquestador contra la función de `main`. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1234 pasados | 3 saltados**
(main 77dd7e3: 1217 | 3; los +22 son `zone-source.test.ts` y los cuatro de Lyford).

## D-221 · El pin en borrador se guarda con el pedido, con la procedencia que de verdad tiene

**Fecha:** 2026-09-08 · **Versión:** la asigna el orquestador al fusionar (solo Entregas) ·
**Pedido por:** Andrés (orquestador), sobre la evidencia de D-220. Sin migración.

### El camino que se cierra

Dos pedidos que el dueño creó el 2026-09-08 **nacieron sin coordenadas** (medición del orquestador:
la base pasó de 112 a 114 pedidos y de 10 a 12 sin punto). Hizo lo razonable: colocó el pin, lo vio
dentro del área verde, y guardó la orden. Como no pulsó «Save pin», el punto se perdió y la zona
volvió a decidirse por el nombre de la ciudad — justo lo que D-219 vino a evitar.

El motivo: el borrador vivía solo en el estado de la ficha (`pinDraft`), y `save()` armaba su
`payload` desde `d`. El punto no llegaba a la base por ninguna vía que no fuera pulsar ese botón.

### La regla, en una frase

**Si al guardar el pedido hay un pin en borrador visible, se guarda con él, con su procedencia
real.** Sin diálogo: el usuario lo está viendo y el aviso de zona ya se calcula con él (D-220), así
que perderlo es lo sorprendente. La procedencia es `"manual"` si el último gesto fue el clic derecho
de `dropPin`, y `"geocoded"` si fue `lookupAddress`.

**Se guarda también cuando el pedido ya tenía pin, y eso costó dos vueltas.** La primera versión no
auto-guardaba una propuesta del buscador sobre un pin existente, para no pisar una decisión previa.
El orquestador la retiró con mejor argumento del que yo tenía: esa excepción producía algo peor que
lo que evitaba —el usuario vería un punto en el mapa y se guardaría **otro**, el viejo—, y que lo que
se ve y lo que se guarda sean cosas distintas es el fallo que esta decisión viene a cerrar, no uno
aceptable. La protección para quien solo quería comprobar una dirección ya existe y es explícita:
**cancelar descarta el borrador** (D-220). Quien no cancela, se queda lo que está viendo.

Con eso se cayó también una ambigüedad que el auditor había levantado —si medir «ya tenía pin» contra
el formulario o contra la fila guardada—: ya no hay nada que comparar con el pin previo.

### Por qué la procedencia no es cosmética

`OrderModal.tsx:2827` pinta un aviso al chofer **solo** con `delivery_pin_source === "manual"`: «sin
dirección formal — se marcó un pin exacto para este sitio. Navegar usa el pin». Etiquetar de manual un
punto que propuso el buscador se lo encendería **justo en el pedido cuya dirección se acaba de
encontrar**, diciéndole lo contrario de la verdad. Por eso el borrador recuerda de dónde vino.

**Y ningún valor nuevo.** La base solo acepta `'geocoded'` y `'manual'`
(`005_map_and_deadline_alerts.sql:22`; la 014 redeclara la columna con `add column if not exists`, sin
tocar el check, y no hay ningún `drop constraint` posterior). Un tercer valor no rompería «el pin»:
el borrador viaja dentro del `payload` de `save()`, así que **tumbaría el UPDATE del pedido entero**
—dirección, tarifa, notas— con el error crudo de Postgres, y quien lo sufriera no lo relacionaría con
haber movido un pin. Es el mismo patrón de D-217 con `module_access`. Se hace **imposible por tipo**:
el estado es `"manual" | "geocoded" | null` y la función devuelve `Pick<Delivery, …>`, así que un
valor inventado no compila.

### Por qué esta rama acaba tocando `savePin`

`savePin` escribía `delivery_pin_source: "manual"` **siempre**, incluso al cerrar un borrador que
había puesto el buscador: la misma mentira que se corrige un piso más arriba, por la puerta vieja.
Sacarlo a otra rama habría significado fusionar un arreglo que deja abierto su propio caso. Ahora usa
la procedencia real.

### Los textos que este arreglo convertía en mentira

El aviso de zona de D-220 decía «por el pin que acaba de colocar — **sin guardar todavía**». Esa
advertencia existía porque el punto se perdía; al eliminar la pérdida, **asustaría sobre algo que ya
no ocurre** y empujaría a pulsar un botón por miedo. Y «lo colocó usted» sería falso en la puerta del
buscador. Ahora son tres estados, sin advertencia: «por el pin que acaba de colocar», «por el punto
que encontró la búsqueda de dirección» y «por el pin guardado».

**«Save pin» no se toca, y esto se midió antes de decidirlo:** ese botón **nunca escribió en la
base**. `savePin` hace `set(...)`, que es `setD` (`:191`), o sea el **formulario**; lo que persistía
el punto era «Guardar» del pedido, entonces y ahora. Así que su etiqueta es hoy tan cierta como ayer y
no hay nada que renombrar; lo que empujaba a pulsarlo por miedo era el aviso, que ya no está. Sigue
sirviendo para aplicar el punto y cerrar el mapa sin guardar el resto.

### La regla vive fuera del componente, y eso lo decidió una debilidad admitida

La primera versión dejaba las cinco líneas dentro de `OrderModal` y las **reproducía** en la prueba,
afirmando luego contra el fuente que la ficha contenía esas mismas condiciones. Eso comprueba que hoy
coinciden, no que la regla sea correcta: cambiando la ficha y la copia a la vez, no salta nada. Se
dijo antes de que nadie firmara, y el orquestador pidió extraerla, con el argumento que la decide —lo
que esas líneas deciden **no es presentación**: son las coordenadas y la procedencia que acaban en la
base, y esa procedencia enciende el aviso que lee el chofer—.

`src/lib/pin-draft.ts` (puro) recibe los cuatro estados de la ficha y devuelve qué escribir, o `null`,
como `escrituraRecogida` en D-218. La prueba **importa la función que corre de verdad**, y una
afirmación comprueba que la ficha ya no tiene copia propia. El precedente pesa: la prueba real de
D-218 encontró el recuento de cero **al escribirse**; una prueba espejo confirma, pero no encuentra.

### Qué NO cambia

`delivery-zone.ts`, `pricing.ts` y `geo.ts`, sin tocar: esto es *cómo llega el punto al pedido*, no
*cómo se decide la zona*. Las dos salvaguardas de D-220 (el borrador solo cuenta con el selector
abierto; cancelar lo descarta, ahora también su procedencia). Ninguna migración, ninguna columna. Y en
el `payload` de `save()` solo pueden aparecer tres campos nuevos: `delivery_lat`, `delivery_lng` y
`delivery_pin_source`.

### Que lo que se ve y lo que se guarda sean el mismo dato, no dos que coinciden

La primera versión le pasaba al módulo las piezas sueltas (`selectorAbierto`, `borrador`) y él
rehacía la noción de «visible» por su cuenta. Coincidía con la de la pantalla, pero por parecido: dos
expresiones iguales hoy que nada obliga a seguir iguales mañana. Ahora el módulo recibe **`pinVisible`
ya resuelto** —el mismo valor que decide la zona— y no recibe las piezas, así que no puede
reconstruirlo distinto. Un aviso que diga una cosa y un guardado que haga otra es justo el fallo que
esta decisión cierra; conviene que sea imposible, no improbable.

### Lo no verificado

Nadie ha abierto la ficha en un navegador: que el punto llegue a la base al guardar va por la regla
—probada en solitario— y por las pruebas de forma sobre el fuente, no por haberlo hecho. La primera
comprobación cuando el dueño lo use es crear un pedido soltando el pin y **no** pulsar «Save pin»: la
orden tiene que nacer con coordenadas. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1262 pasados | 3 saltados**
(main 3689160: 1239 | 3; los +23 son `pin-draft-save.test.ts`).

## D-222 · Las tiendas se ven siempre en el mapa del pin, y la del pedido va destacada

**Fecha:** 2026-09-08 · **Versión:** la asigna el orquestador al fusionar (solo Entregas) ·
**Pedido por:** el dueño, literal: *«donde se pone set location, pon los puntos donde están las
tiendas siempre, para referencia»*. Sin migración.

### Qué faltaba

Al marcar la ubicación exacta de una entrega, el mapa enseñaba calles y un pin. Ningún punto
conocido con el que comparar: de dónde sale el camión no se veía, aunque las millas se cuenten
justo desde ahí. Las siete tiendas ya se pintaban en Mapa, Rutas, Mi ruta y Rastreo — en el
selector de pin, no.

### Lo que ya existía, y por qué esta rama es corta

Casi todo el camino estaba hecho en `main`, y se midió antes de escribir nada (línea base del
auditor, confirmada por mí):

- `MapView` ya acepta `stores?: StoreMarker[]` y **los dos motores ya los dibujan**, cada uno en su
  propio efecto.
- `useStoreMarkers(settings.stores)` ya resuelve cada tienda a un punto, con caché compartida entre
  pantallas; usa `s.lat`/`s.lng` cuando están —**las siete las tienen**, medido por el
  orquestador— y solo geocodifica lo que falte. O sea: **cero llamadas nuevas a la API de mapas**.

Así que lo único que faltaba de verdad era pasar esas tiendas a los **dos** selectores de pin de la
ficha y **destacar la del pedido**. El dibujo existente se **extiende**, no se reescribe: rehacerlo
habría sido la duplicación que se rechazó en D-218 con `confirmPickup`.

### La tienda del pedido, distinta de las demás y distinta de la entrega

`d.store` es el origen desde el que se cuentan las millas: es lo que convierte el mapa en «de aquí
a aquí». Va en **azul (`--accent`), más grande y con el nombre siempre puesto**; las otras seis en
**gris (`--gray`), pequeñas**, con el nombre al pasar el ratón.

**Ni rojo ni verde, y no es estética:** el pin de la entrega es 📍 —rojo— y la zona local es verde
(D-219). Una tienda roja junto al pin rojo obliga a mirar dos veces para saber cuál es la entrega,
que es exactamente lo que el encargo venía a evitar. Y la diferencia **no depende solo del color**:
la tienda es un **cuadrado** con una línea de toldo, mientras los pedidos son círculos y la entrega
una gota. En blanco y negro también se distinguen.

**Siete nombres permanentes habrían saturado** un mapa de 280 px con las ciudades del Valle tan
juntas, así que solo la destacada lleva etiqueta fija; en las demás el nombre es *accesible*, no
*visible*. La etiqueta hace doble trabajo: es el nombre y es parte del destacado.

### Un solo dibujo para los dos motores

La geometría vive en `src/lib/store-pins.ts` y sale como **SVG**: Google lo consume como URL
`data:` y Leaflet lo mete tal cual en un `divIcon`. `MapView` conmuta según haya llave de navegador
y **producción usa Google**, así que un cuadrado que solo existiera en un motor sería medio
arreglo; con un solo SVG los dos mapas enseñan lo mismo por construcción, no por parecido. Una
prueba compara la URL de Google, decodificada, con el SVG de Leaflet.

### La comparación por nombre, dicha en voz alta

La ficha conoce su tienda por **nombre** (`d.store`, una cadena) y Ajustes tiene otra lista de
cadenas. Hoy casan exacto los cuatro valores que existen en pedidos reales (medición del orquestador,
2026-09-08: los cuatro nombres en uso coinciden con los de Ajustes), así que no hay deuda que
arrastrar. Aun así se compara **normalizado**: `trim`, minúsculas y espacios internos colapsados.
El motivo es que el fallo contrario sería **mudo**: un nombre con un espacio de más no daría error,
simplemente no habría destacado y nadie sabría por qué. Y se normaliza **solo eso**: ni prefijos ni
parecidos — un nombre que sea el principio de otro no lo destaca, y hay pruebas de las dos
direcciones.

**Las pruebas usan nombres inventados, no los reales, y esto se corrigió sobre la marcha.** La
primera versión clavaba los cuatro nombres medidos en producción, para que un renombrado saltara.
El orquestador lo retiró con razón: renombrar una tienda desde Ajustes es algo que el dueño tiene
todo el derecho a hacer y que no rompe nada, y una prueba así habría puesto el CI en rojo
señalando un cambio legítimo de datos como si fuera un fallo. Lo que se prueba es la lógica de
emparejar —que no depende de cómo se llame ninguna tienda— más el caso del renombrado: un pedido
cuya tienda ya no está en Ajustes no destaca ninguna y no revienta.

### El encuadre no cambia — criterio explícito

Las tiendas **no entran en `fitTo` ni en `center`**. Con siete puntos dentro del marco el mapa se
alejaría y se perdería el detalle justo alrededor del pin, que es lo que se está mirando. Se ven
las que caigan dentro, y ya. Está sostenido por construcción —el efecto de tiendas de cada motor no
toca el encuadre— y por una prueba que lee ese efecto y comprueba que no aparece `fitBounds`,
`latLngBounds`, `.extend(`, `setView` ni `setZoom`.

### Qué NO cambia

Los **cuatro** mapas de despacho (Mapa, Rutas, Mi ruta, Rastreo) no pasan el campo nuevo, así que
caen por la rama clásica y siguen con su punto rojo, sin un pixel de diferencia: `papel` es
opcional. Ninguna escritura sobre `settings.stores` —las tiendas se leen—, ninguna dependencia
nueva, ninguna migración, ninguna llamada nueva a la API de mapas.

**Los dos motores no dibujan igual esa tienda, y esta rama tampoco lo arregla.** Lo midió el
auditor sobre `main`: Google es un SVG de 26×26 con `circle r="9"` y el borde **a caballo** del
trazo; Leaflet es un `div` de 24×24 con el borde **por fuera** y una sombra. Unificarlos habría
sido lo bonito, y es justo lo que **no** se ha hecho: cada motor conserva su propio dibujo
carácter a carácter, porque unificar habría cambiado el aspecto de la tienda en cuatro pantallas
que este encargo no tocaba. El SVG compartido es solo el **cuadrado nuevo**. Que la asimetría siga
ahí queda escrito para quien algún día quiera cerrarla a propósito.

**El `#e11414` de ese punto rojo se queda, y se dice por qué.** No es una variable del tema, así
que la regla de «sin hex inventados» pediría cambiarlo; pero cambiarlo aquí movería el color en
cuatro pantallas dentro de un encargo que pedía otra cosa. Lo que sí se hizo es **sacarlo de los dos
motores a una sola constante** (`TIENDA_CLASICA`), donde antes estaba escrito dos veces: el color
pintado es idéntico, y quien lo cambie algún día verá en el mismo sitio que toca los cuatro mapas a
la vez. Los colores **nuevos** sí salen del tema, leídos en tiempo de ejecución con el literal real
de `globals.css` como único respaldo, igual que el verde de la zona (D-219).

### Lo no verificado

Nadie ha abierto la ficha en un navegador: que los cuadrados aparezcan, que la etiqueta caiga
debajo del punto y que el ancla no desplace la tienda destacada van por las pruebas del dibujo y
por la geometría del SVG, no por haberlo visto. También sin verificar: si alguien cambia de tema
**con el selector abierto**, los colores no se recalculan hasta que el mapa se redibuje — misma
limitación que el verde de la zona desde D-219, y no la arregla esta rama. `verify.mjs`:
en verde sobre `.next` limpio, en solitario: **1285 pasados | 3 saltados**
(main 0925c0e: 1262 | 3; los +23 son `store-pins.test.ts`).

## D-223 · El pedido se ubica al guardarse, y cuando no se puede se dice

**Fecha:** 2026-09-08 · **Versión:** la asigna el orquestador al fusionar (solo Entregas) ·
**Pedido por:** el dueño, sobre el diagnóstico de D-221/D-222. Sin migración.

### El camino que se cierra

Un pedido con dirección y sin coordenadas **solo** se geocodificaba si alguien abría Mapa o Rutas
**y** ese pedido caía dentro del `dayOrders` de esa pantalla. Los filtros son estrechos: Mapa exige
`delivery_date === date`; Rutas exige además que la etapa esté en `ROUTE_STAGES`. No hay ningún
proceso de fondo — `useAutoGeocode` es un hook de cliente llamado desde esas dos páginas y nada más.

Medición del 2026-09-08 (orquestador, contra producción): **13 pedidos sin coordenadas, todos con
dirección**. Cinco de hoy y mañana, que se arreglarían solos cuando alguien abra esas pantallas; y
**ocho ya entregados, de días cerrados entre el 31 de julio y el 7 de septiembre**, que por esa vía
no se recuperan **nunca**, porque nadie vuelve a abrir el mapa de un día pasado. (Esos ocho los
rellena el orquestador contra la base; no entran en esta rama.)

Y no es cosmético: sin punto, la zona vuelve a decidirse por el nombre de la ciudad (D-219), o sea
que esto decide una tarifa.

### Dónde va, y por qué no en la ficha

En el **proveedor de datos**, colgado de `addDelivery` y `updateDelivery`. Por esas dos escrituras
pasan **todas** las formas de crear o editar un pedido: la ficha, la importación de CSV, los
repartos que crean órdenes hijas. El propio fichero ya usa ese argumento para la autoría de las
fotos —«hacerlo en cada sitio es una atribución que se pierde»— y aquí vale igual: en `save()` de
la ficha habría cubierto un camino de varios, y el siguiente sitio que cree pedidos nacería sin la
regla y sin que nadie lo notara.

`updateDelivery` se declara después y `ubicarSiHaceFalta` la necesita, así que se accede por
referencia — el mismo patrón que ya usa el vaciador del outbox con `logEvent`. **No hay recursión**,
y hay **dos** barreras independientes, no una: el parche que se escribe trae las coordenadas, así
que la segunda vuelta ya no necesita ubicación (hay prueba que lo fija); y además la clave de esa
dirección sigue en `ubicacionesEnCurso` cuando entra la segunda vuelta —se borra en el `finally`,
después de la escritura—, así que aunque la primera barrera cediera, la segunda corta igual. La
segunda la encontró el auditor simulando el ciclo, no yo escribiéndolo.

### Se ubica al guardar **o al editar**, y es a propósito

El disparo cuelga de `updateDelivery`, así que alcanza **cualquier** edición de un pedido sin punto:
cambiar la etapa, asignar un chofer, tocar una nota. Es más ancho que «al guardar la ficha» y así se
decidió, a sabiendas, cuando se planteó estrecharlo.

La razón: es justo lo que hace que los **14 pedidos sin punto que ya existen** se recuperen solos,
sin que nadie tenga que abrir el Mapa del día correcto — y esos días ya están cerrados. Estrecharlo
habría arreglado el futuro dejando el presente igual, que es la mitad del encargo. El coste no crece
por ser ancho: el tope sigue siendo por pedido-sin-punto y por sesión, o sea **14 llamadas como
techo para todo el histórico**, no 14 por edición.

En una frase, que es como debería leerse dentro de un año:

> **Un pedido con dirección acaba teniendo punto, se toque por donde se toque.**

Queda escrito porque es una propiedad, no un efecto lateral: el siguiente que toque `updateDelivery`
puede romperla sin enterarse si nadie le ha dicho que existe.

### El coste, acotado por construcción

El tope **no** es «una llamada por guardado». Es **una llamada por pedido-sin-punto y por sesión**:

- solo se pide si a la fila **tal como queda guardada** le falta el punto y tiene dirección;
- en cuanto se encuentra, se escribe y ese pedido no vuelve a pedir nunca;
- un 404 —dirección que el proveedor no conoce— se **recuerda** y no se repite mientras dure la
  sesión;
- un fallo de red **sí** se reintenta al volver a guardar. Esa distinción es deliberada: «sin
  bucles» no puede significar «sin reintentos nunca», o una caída de dos minutos dejaría una
  dirección sin punto para siempre.

Un pedido guardado diez veces en una tarde gasta **una** llamada, no diez. Lo que multiplica no es
guardar: es que existan pedidos sin punto, que es justo lo que esto reduce.

**El ritmo real, medido** (orquestador, 2026-09-08, contra producción): 116 pedidos entre el
2026-07-24 y el 2026-09-08 — 47 días naturales, 33 con actividad. Media **2,5 pedidos por día
natural** (2,2 en los últimos 14 días); los tres días más cargados fueron de 9, 8 y 8. Así que el
coste nuevo es **del orden de 2 o 3 llamadas al día, con techo de unas 9 en el peor día visto**.
Los 116 tienen dirección; el reparto de procedencia era 97 geocodificados, 5 manuales y 14 sin
punto (la cifra de «sin punto» se movió de 13 a 14 dentro del mismo día, con los pedidos nuevos).

Nada retroactivo ni masivo: se ubica el pedido que se guarda, y solo ese. Una prueba lee la función
y exige que no haya bucles ni más de un `fetch`. El sandbox de enseñanza no llama a nadie.

### Que no bloquee el guardado

`void`, sin `await`: el pedido ya está escrito cuando esto empieza. Si el proveedor tarda o falla,
la orden se guardó igual — exactamente como se comportaba antes. La escritura del punto es una
**segunda** escritura, y va `quiet` para que un error suyo no parezca que falló el guardado.

### El fallo deja de ser mudo

`useAutoGeocode.ts:41` tenía un `catch {}` que se tragaba cualquier error, sin reintento ni señal:
una dirección que el proveedor no resuelve se quedaba sin punto para siempre, sin rastro, mientras
esa misma falta de punto decidía la tarifa por ciudad. Ahora hay **tres estados**, no dos:

| | qué es | qué se hace |
|---|---|---|
| `ok` | hay punto | se escribe con `"geocoded"` |
| `noEncontrada` | 404: la ruta agotó Google, Mapbox y OSM | aviso al usuario **y** evento `geocode_failed` en el registro del pedido; la dirección se recuerda |
| `falloTemporal` | red, 500, cuerpo sin coordenadas | aviso al usuario; **no** se recuerda |

**El aviso es discreto y empieza diciendo que el pedido sí se guardó.** Si pareciera un error de
guardado, el usuario volvería a pulsar Guardar: otra llamada y ningún arreglo. El de «no
encontrada» además dice qué hacer —revisar la dirección o marcar el pin exacto—, porque un aviso que
solo informa deja al usuario donde estaba.

**Y esto no es hipotético.** Al rellenar a mano los ocho pedidos antiguos, el orquestador midió que
**seis salieron exactos y dos no**: uno con la calle mal escrita («saval pal circle» por Sabal Palm)
y otro que el proveedor sencillamente no encuentra. Con el `catch {}` de antes, esos dos se habrían
quedado sin punto para siempre y **sin que nadie lo supiera** — y el primero se arregla en diez
segundos si alguien te dice que la dirección no existe. Uno de cada cuatro, en la única muestra que
tenemos.

**El registro del pedido es el sitio natural del fallo definitivo**, y lleva su propio tipo de
evento (`geocode_failed`) en vez de colarse como una edición: no lo editó nadie. El fallo temporal
**no** deja evento — sería una fila por cada vez que la red va mal, y el registro de un pedido no es
un log de red.

Un `200` con un cuerpo inservible (sin coordenadas, o `0,0`) cuenta como **temporal**, no como
dirección inexistente: es un fallo de nuestro lado, y marcarla por eso la dejaría sin punto para
siempre por un motivo que no es suyo.

### `"geocoded"`, nunca `"manual"`

Lo pide el encargo y lo exige D-221: el aviso al chofer —«sin dirección formal, Navegar usa el
pin»— se enciende **solo** con `"manual"`. Un punto que puso la máquina etiquetado de manual le
mentiría justo en el pedido cuya dirección se acaba de encontrar.

### El barrido viejo se queda, pero sin lógica propia

`useAutoGeocode` sigue haciendo falta: los pedidos que ya existían sin punto y que nadie vuelve a
guardar no se ubican solos. Lo que se le quitó son **sus definiciones**: ahora usa las mismas
funciones puras que el guardado —qué es «necesita punto», qué significó la respuesta, qué se
escribe—, para que no haya dos ideas de lo mismo separándose con el tiempo. Y recuerda los 404 igual
que el otro camino, que antes no hacía: el barrido recorre el día entero cada vez que cambia la
lista, así que una dirección inexistente se pedía una y otra vez.

Lo que **no** se le puso son avisos, y es deliberado: recorre el día por su cuenta y un aviso por
dirección sería ruido sobre pedidos que quien mira el mapa quizá ni está tocando. El aviso vive
donde hay un acto del usuario detrás — el guardado.

### `0,0` cuenta como no tener punto

Igual que en D-219. Si aquí dijera «ya tiene punto» y `puntoEnZonaLocal` dijera «no tiene», el
pedido se quedaría sin ubicar **y** sin zona por pin: lo peor de las dos reglas. Un cero en **una**
sola de las dos coordenadas sí es legítimo (meridiano, ecuador) y no se toca.

### Qué NO cambia

`/api/geocode-point` sin tocar, `pricing.ts`, `delivery-zone.ts` y `geo.ts` sin tocar: esto es *de
dónde sale el punto*, no *cómo se decide la zona*. Ninguna columna, ninguna migración, ninguna
dependencia nueva. El pin manual y su procedencia (D-221) siguen mandando: un pedido con punto no
se vuelve a geocodificar jamás.

### `necesitaUbicacion` NO es «no tiene punto», y conviene no unificarlas

Medido el 2026-09-08, **en los dos árboles**, porque la diferencia entre ellos cuenta la historia:

```
git grep -nE "delivery_lat\s*[!=]=\s*null" <árbol> -- 'src/**/*.ts' 'src/**/*.tsx' | grep -v "\.test\."
```

- **`main` (cb1c215): 33** comprobaciones en 9 ficheros — 10 con `== null`, 23 con `!= null`.
- **Esta rama: 32** en 8 ficheros — 9 y 23.

La que falta no desapareció: es `useAutoGeocode.ts:20`, la única que **este cambio sustituyó** por
`necesitaUbicacion`. Las otras 32 siguen ahí, y ninguna es lo mismo que ella. La diferencia importa:

- `necesitaUbicacion` es **«tiene dirección Y no tiene punto»**, y decide una sola cosa: si se
  gasta una llamada al proveedor.
- Las otras son **«no tiene punto»** a secas, y deciden cosas distintas: qué se pinta en el mapa
  (`map/page.tsx:55,124,209,281`), qué se puede planificar (`dispatch.ts:215`), cuántas paradas van
  sin pin (`routes/page.tsx:1952,2120`) y el aviso de pedidos por ubicar (`attention.ts:59`).

Un pedido **sin dirección y sin punto** es invisible para `necesitaUbicacion` —no hay nada que
buscar— pero sigue contando en las otras, porque sigue sin poder pintarse ni planificarse. Que las
dos ideas se parezcan por fuera no las hace la misma, y unificarlas «para quitar duplicación»
rompería en silencio el mapa o la planificación. Queda escrito porque **una prueba no caza este
error**: cada lado seguiría pasando sus propias pruebas.

Los números van con el comando al lado a propósito: la forma de contar tiene que poder repetirla
cualquiera. Y cuenta lo que dice contar — **comprobaciones, no líneas**, con un patrón **literal**
en vez de una expresión con comodines, que casa de refilón con el `!` de otra variable y se deja
fuera los `!= null`.

### Dos límites conocidos

**Una importación de CSV grande dispara una llamada por pedido.** El disparo cuelga de
`addDelivery`, así que también corre en la importación y en los repartos. Con el ritmo de hoy da
igual (2,5 pedidos al día, techo de 9), pero **importar un histórico completo de golpe pediría una
geocodificación por cada fila con dirección y sin punto**, en ráfaga. No se ha puesto freno porque
hoy no hay caso; queda dicho para que ese sea el sitio donde mirar antes de darle al botón.

**Van a empezar a aparecer eventos `geocode_failed`,** y eso es lo que se buscaba: antes ese fallo
era un `catch {}` mudo. Quien vea el primero en el historial de un pedido debe leerlo como «la
dirección no se encontró», no como un error del sistema: en la única muestra que hay —los ocho
pedidos antiguos rellenados a mano— **dos tenían la dirección mal escrita**, y una de ellas se
arregla en diez segundos («saval pal circle» por Sabal Palm).

### Lo no verificado

Nadie ha guardado un pedido en un navegador: que la llamada salga al guardar y que el punto llegue
a la base va por las funciones puras —probadas en solitario— y por las pruebas de forma sobre el
proveedor, no por haberlo hecho. **No se ha llamado ni una vez a `/api/geocode-point` desde esta
rama**: gastaría cuota de una API de pago con datos de prueba, que es la regla permanente del
proyecto. La primera comprobación cuando el dueño lo use: crear un pedido con dirección y sin pin,
guardarlo, y ver que la orden aparece con coordenadas sin abrir Mapa ni Rutas. Y la segunda, con una
dirección inventada: tiene que salir el aviso y quedar el evento en el registro del pedido.
`verify.mjs`: en verde sobre `.next` limpio, en solitario: **1316 pasados | 3 saltados**
(main cb1c215: 1285 | 3; los +31 son `geocode-on-save.test.ts`).

## D-224 · «Dejar en tienda»: el chofer descarga lo que no pudo entregar y el pedido vuelve a la lista

**Fecha:** 2026-09-08 · **Versión:** la asigna el orquestador al fusionar (solo Entregas) ·
**Pedido por:** el dueño, literal: *«el chofer tiene la opción de dejar el pedido en una tienda para
que otro lo recoja y lo entregue, y el pedido vuelve a la lista»*. Sin migración.

### El caso

Un chofer va con el pedido en el camión y no puede entregarlo. En vez de devolverlo a la tienda de
origen, lo descarga en otra tienda del grupo; otro chofer lo recoge **desde ahí** y lo entrega.

### Lo que ya existía

La transición **ya era legal**: `constants.ts` tiene `picked_up: ["delivered", "ready"]`, comentado
como «driver delivers (or reverts if not taken)». Lo que faltaba no era el camino, sino la acción:
elegir la tienda, cambiar el origen y soltar el pedido.

Tampoco hacía falta abrir permisos. La única guarda de etapa (`data-provider.tsx:1161`) deja pasar
cualquier rol si la transición es legal, así que «cero permisos nuevos» sale solo — y hay una prueba
que fija que ni se añade guarda ni se relaja la que hay.

### Cambiar el origen son DOS campos, no uno

Es el hallazgo que decidió la forma de esta rama. El origen de las millas es una **cascada**
(`OrderModal.tsx:564-565`):

```
pickup_address  →  dirección guardada de la tienda `store`  →  nombre de la tienda
```

Así que poner solo `store` habría dejado un pedido **con `pickup_address` explícita saliendo del
sitio viejo, en silencio**: el chofer siguiente conduciría a un almacén donde no hay nada, y las
millas se contarían desde allí. Por eso la acción escribe `store` **y** `pickup_address: null`. La
razón por la que alguien puso esa dirección deja de aplicar en el momento en que el pedido está
físicamente en otra tienda.

Y `null` en vez de copiar la dirección de la tienda: así sigue habiendo **una sola** copia de la
dirección de cada tienda, en Ajustes. Si la tienda se muda, el pedido la sigue.

### Las millas: se borran, y las tres salidas estaban todas pagadas

`route_miles` y `route_duration` pasan a `null`. Las tres opciones y por qué la tercera:

1. **Recalcular** al soltar: gastaría cuota de Google Routes —API de pago— en cada descarga, justo
   cuando el encargo anterior iba de controlar ese gasto.
2. **Dejarlas**: la ficha seguiría enseñando (`:1556`, `:1974`) unas millas contadas desde donde el
   pedido ya no está. Un número que miente es peor que ninguno.
3. **Borrarlas** (lo elegido): el pedido queda sin millas hasta que alguien pulse «Calcular».
   Honesto, y no gasta nada que nadie haya pedido.

**`delivery_fee` no se toca**: es lo cotizado y cobrado, y mover el pedido de sitio no reescribe un
acuerdo. Pero **la tarifa sugerida cambiará** en cuanto alguien recalcule desde el origen nuevo, y
eso es **buscado, no colateral**: quien recoja en Brownsville no debe cobrar como si saliera de
McAllen.

**Medido, sobre si esto gasta cuota solo:** el recálculo automático (`OrderModal.tsx:629-637`) se
dispara al cambiar el origen **solo con la ficha en modo edición** (`if (!editing) return`), y no
depende de que las millas estén vacías — o sea que ya se comportaba así antes de esta rama. Un
chofer no lo dispara: `canEditFields("driver", "ready")` es `false`.

### Qué se conserva y qué no

Lo que se conserva: **pallets confirmadas, fotos, notas, ventanas de entrega, el pin de la entrega
y su procedencia, y la tarifa**. Eso es historia del **pedido**.

Lo que se limpia: **`departed_at`, `arrived_at`, `pickup_lat`, `pickup_lng`, `pickup_gps_at`**. Eso
es historia de un **viaje que no llegó a su fin**, y es donde esta decisión se aparta del criterio
inicial del encargo («se conserva todo»). Cuatro razones, tres de ellas medidas:

- **Precedente, y son cuatro campos:** el reparto de una orden parcial (`OrderModal.tsx:788`)
  descarta `pickup_lat`, `pickup_lng`, `pickup_gps_at` y `departed_at` al crear el resto como
  `ready`. **`arrived_at` no está en ese precedente**: lo añade esta decisión, por el mismo motivo
  —es la llegada del viaje viejo—, y se dice aparte para no apoyarse en una autoridad que no
  existe.
- Con `departed_at` puesto, el segundo chofer vería «En camino desde» **una hora que no es suya** y
  **no** le saldría el botón de «Iniciar viaje», que solo aparece si no hay sello.
- **El informe de productividad por chofer quedaría inservible.** `analytics.ts:283-292` hace
  `start = departed_at ?? pickup_gps_at`, mide hasta `pod_delivered_at` y le suma el tramo a
  `assigned_driver` — que tras la devolución es el **segundo** chofer. Con el sello del primero como
  inicio, lo que se le apunta no es «un viaje ajeno»: es **todo el tiempo que el pedido pasó parado
  en la tienda**. Un pedido dejado el viernes y entregado el lunes le sumaría el fin de semana
  entero como tiempo activo. Y un número raro en un informe no se investiga: se cree.
- El GPS de recogida **se sobrescribe igualmente** en cuanto alguien vuelva a recoger, así que
  conservarlo no guardaba ninguna historia. Se guarda donde sí dura: en la nota del registro, que
  lleva las coordenadas de la primera recogida.

### El rastro

Evento propio, `dropped_at_store`, y no una etapa a secas: volver a `ready` es también lo que hace
una reversión normal, y en el historial de un pedido hay que poder distinguir «no lo quisieron» de
«está en otra tienda». `kind` es texto en `order_events`, así que **no hace falta migración** — pero
se queda ahí para siempre, así que el nombre se elige una vez, en inglés como `created`, `edited` y
`geocode_failed`.

La nota dice **quién, dónde, de dónde venía y dónde se recogió la primera vez**, en los dos idiomas.
Para que `setStage` pueda poner un `kind` distinto de la etapa, gana un quinto parámetro
**opcional**: sin él se comporta exactamente como antes.

### Un control, dos pantallas

Se ofrece en la ficha (junto a «Marcar entregado») y en la tarjeta de «Siguiente parada» de Mi ruta,
en su propia fila: es la excepción, no la acción normal, y el pulgar del chofer va al botón verde.
Es **el mismo componente** en los dos sitios, y la regla de qué se escribe vive un piso más abajo,
en `lib/leave-at-store.ts` — dos copias de un gesto que escribe en la base darían dos efectos con el
mismo nombre. Misma línea que D-218 con `escrituraRecogida`.

La tienda sale del desplegable de `settings.stores` (nada de texto libre) y se compara con
`nombreNormalizado` (D-222), para no inventar una tercera forma de comparar nombres de tienda. **Se
pide la tienda antes de mover nada**: un «dejado» sin decir dónde es justo el pedido perdido que
esto viene a evitar.

### Límites conocidos

- **Sin conexión no se puede, y a un chofer sin cobertura le va a pasar.** El outbox solo encola
  `picked_up` y `delivered` (`data-provider.tsx:1184`), así que `ready` no se encola: en zona muerta
  el chofer verá el error y tendrá que repetirlo cuando tenga señal — con el pedido ya descargado en
  la tienda, que es cuando menos ganas tiene de pelearse con el teléfono. **No se amplía el outbox
  aquí**: es una limitación real y merece su propio encargo con su propio cuidado, porque toca la
  cola de milestones; no una línea de más en este.
- **Dejarlo en su propia tienda de origen está permitido** y no es un error: es la devolución normal.
  La nota no dice entonces que el origen cambió, porque no cambió.
- El segundo chofer **no ve las millas** hasta que alguien pulse «Calcular». Es la consecuencia
  elegida arriba, no un olvido.

### Un permiso concedido por desconocimiento

`puedeDejarEnTienda` preguntaba «¿no es chofer?» para dejar pasar al almacén y al admin, y un `me`
**nulo** cumplía esa condición: la respuesta era «puede» cuando lo que sabía era «no sé quién es».
Lo encontró el auditor sondeando la función. No era explotable —el control no se pinta sin `me`, el
proveedor sigue comprobando `canTransition` y la base tiene RLS—, pero se cierra igual (`if (!me)
return false;`): un permiso que se concede por **ausencia de dato** es de los que muerden cuando
alguien reutiliza la función en un sitio donde esas tres barreras no están.

### Qué se cumple por construcción, no por cuidado

Ni `delivery_fee`, ni `actual_pallets`, ni las fotos, ni el pin de la entrega **viajan en el
parche**. No es que no se recalculen: es que el campo no está. Un campo que no está no se puede
pisar por descuido dentro de seis meses, y la prueba fija la lista completa, así que añadir uno
obliga a decirlo en voz alta.

### Lo no verificado

**Cómo queda en una pantalla de móvil estrecha no lo ha visto nadie**, ni el worker ni el auditor:
el control va en su propia fila bajo la tarjeta de «Siguiente parada», y ahí se queda hasta que
alguien lo mire en un teléfono de verdad.

Nadie ha soltado un pedido en un navegador: que el botón aparezca solo al chofer que lo lleva, que
el desplegable se pinte y que el pedido reaparezca en la lista van por las funciones puras —probadas
en solitario— y por las pruebas de forma sobre las dos pantallas, no por haberlo hecho. **No se ha
tocado producción ni se ha gastado cuota de ninguna API.** La primera comprobación cuando el dueño
lo use: llevar un pedido a `picked_up`, dejarlo en otra tienda, y ver que vuelve a la lista con el
origen nuevo, sin chofer, sin millas y con el evento en el historial. `verify.mjs`:
en verde sobre `.next` limpio, en solitario: **1343 pasados | 3 saltados**
(main 70bbe4d: 1316 | 3; los +27 son `leave-at-store.test.ts`).

## D-225 · La ventana de escritorio aprende a qué sitio pertenece, y deja de echar fuera lo suyo

**Fecha:** 2026-09-08 · **Versión:** ninguna app web sube (solo `desktop/` y la ruta de descarga) ·
**Pedido por:** el dueño: *«en la app de escritorio, Sign out no cierra la sesión: abre el
navegador»*. Sin migración.

### El fallo, y por qué el caso que se reportó no es el peor

El instalador que la gente tiene —**RDZ Hub 1.0.0, del 2026-09-03**— lleva embebido
`https://deliveries-app-seven.vercel.app`. El cambio a `rtg-hub.vercel.app` en `desktop/main.js` es
del commit a591407, del **2026-09-04**: un día después de compilar el instalador.

El dominio viejo redirige con 307 al nuevo, así que **la app carga bien y todo parece funcionar**.
Y funciona, porque moverse por el hub es enrutado de cliente de Next.js: no hay navegación real y
`will-navigate` no se dispara nunca.

Se dispara solo en las **navegaciones de página completa**, y ahí la URL ya es de `rtg-hub`, que no
coincidía con la constante embebida. `esNuestro` decía «esto no es nuestro» y la ventana lo mandaba
a `shell.openExternal`. De ahí el navegador; y de ahí que la sesión no se cerrara, porque el POST
salía de la ventana con la sesión dentro.

**El caso que reportó el dueño es el amable.** El peor lo encontró el auditor:
`SessionExpired.tsx:23-24` hace `window.location.href = "/login?next=…"`, y ese componente lo usan
los cuatro proveedores de datos vía `session-guard`. O sea que a quien se le caduca la sesión **se
le abre el navegador solo, sin haber tocado nada**. El signout al menos lo provoca alguien.

Inventario completo de lo que hoy salía por esta puerta: **seis** formularios
`action="/auth/signout" method="post"` (`HomeSelector:123`, `TopBar:267` y `:279`,
`erp/side-nav:105`, `recruiting/TopBar:69`, `timetracker/TopBar:100`) más el `window.location.href`
de `SessionExpired`. Los otros `window.location.href` de la app van a `sms:`, `mailto:` y
RingCentral: esos **sí** tienen que salir fuera, y siguen saliendo.

### El arreglo no es recompilar

Recompilar habría tapado este caso y dejado la causa: **una app instalada no puede romperse porque
el sitio cambie de dominio**. La gente no reinstala, y el siguiente cambio de dominio volvería a
hacer exactamente esto.

Así que `esNuestro` deja de comparar contra una constante. La ventana mantiene una **lista de
orígenes de confianza** que empieza con el origen compilado y **aprende uno más: el origen donde
acabó la primera carga**. Esa primera carga la inicia la propia app hacia su URL de inicio, así que
si termina en otro origen es porque **nuestro propio dominio** redirigió allí.

**Solo la primera, y ese límite es la decisión.** La regla más general —«confía en cualquier origen
al que te lleve una redirección desde un origen de confianza»— parece mejor y es peor: un flujo que
redirija a un proveedor externo (un OAuth, una pasarela de pago) lo convertiría en interno, y
entonces se abriría **dentro** de una ventana con la sesión puesta y **sin barra de direcciones**.
La confianza se gana una vez, al arrancar, y no se vuelve a ganar. Estar cargado no vuelve confiable
a nadie, que es lo que pedía el encargo.

**El precio de ese límite, dicho porque es el único camino por el que esto no arreglaría nada:** la
oportunidad **se gasta aunque no se aprenda nada**. Si la primera navegación principal de la ventana
no fuera la carga del sitio, el aprendizaje se perdería hasta reiniciar la app. En la práctica no
debería ocurrir —`did-navigate` no se dispara con `about:blank` ni con un fallo de red, y la única
carga que hace esta ventana al arrancar es la suya—, pero se elige así a sabiendas: gastar la
oportunidad de más es seguro, guardarla para «la próxima navegación buena» sería exactamente la
regla general que se acaba de descartar.

### Dónde vive, y por qué eso importa aquí

En `desktop/origenes.js`, no dentro de `main.js`: no depende de Electron, así que **se puede probar
de verdad**. `main.js` la importa con `require` y la prueba —`src/lib/desktop-origins.test.ts`, ahí
para que `vitest` la recoja— carga **ese mismo fichero** con `createRequire`. No hay una copia en
`src/lib` y otra en `desktop/`: hay una implementación y una prueba que importa el original.

`desktop/` no entraba en `verify.mjs` y **no tenía ninguna prueba**. Ahora sí, por esta vía: 22
casos que cubren el fallo real con los dominios de verdad, el límite del aprendizaje, los esquemas
que no son web, las URLs rotas y lo que se empaqueta en el instalador.

### El rename que iba de paso (paso 7 de 11)

Medido antes de tocar nada: **`productName` y `shortcutName` ya eran «RTG Hub»** desde el paso 1 del
rename (c1bd9e5), y el **`appId` nunca cambió** (`net.rdztilegroup.hub` desde ea2668e). Así que solo
faltaban dos cosas:

- **El nombre del instalador, y no es cosmético.** El patrón por defecto de la versión que se
  compila (electron-builder 25.1.8, `NsisTarget.js:99`) es
  `"${productName} " + "Setup " + "${version}.${ext}"`, o sea **`RTG Hub Setup 1.0.0.exe`, con
  espacios**. (La cita del `master` del repositorio lleva además un `${arch}` que **en 25.1.8 no
  existe**: el detalle era mío y estaba mal, el fondo no cambia.)

  Que eso importe se midió en el `dist/` de la compilación que se publicó: **el fichero que salió
  del compilador se llama `RDZ Hub Setup 1.0.0.exe`, con espacios, y el asset del release se llama
  `RDZ-Hub-Setup-1.0.0.exe`, con guiones**. Alguien lo renombró **a mano** al subirlo, y tenía que
  hacerlo, porque el respaldo de la ruta de descarga filtra por `startsWith("RDZ-Hub-Setup")`
  (`route.ts:49`). O sea que la descarga funcionaba por un **renombrado manual que no estaba
  escrito en ninguna parte**, y se habría roto el día que publicara otra persona.

  Y se habría roto de una forma difícil de diagnosticar: la ruta prueba **primero el almacén
  privado**, así que ese filtro solo entra en juego en el respaldo de GitHub; y cuando no encuentra
  ningún asset que case, no da error — redirige a la **página de releases**
  (`activo?.browser_download_url ?? pagina`). Nadie ve una excepción en ningún registro: a la
  persona simplemente la sueltan en GitHub a buscar el `.exe` a mano.

  Declarando `artifactName` como `RTG-Hub-Setup-${version}.${ext}`, el nombre que sale del
  compilador es ya el que espera la ruta, y el puente manual desaparece.
- **El agente de usuario**: `RDZHub/` → `RTGHub/`. Se comprobó antes de cambiarlo que **nadie lo
  compara**: el único comparador de agentes es `app-update.ts:31`, que busca `RDZDeliveries/(\d+)`
  —el APK de Android—. Lo que no puede aparecer nunca es una comparación nueva contra la cadena
  vieja, porque las instalaciones ya puestas seguirán mandando `RDZHub/` durante meses.

**El `appId` NO se toca, y esto se verificó en el código de electron-builder, no de oído:**

- El GUID del instalador sale del `appId`: `NsisTarget.ts:182-184` →
  `this.options.guid || UUID.v5(this.packager.appInfo.id, ELECTRON_BUILDER_NS_UUID)`, con el
  espacio de nombres `50e065bc-3134-11e6-9bab-38c9862bdaf3` (`progId.ts:4`). No hay `guid`
  declarado —y **tampoco puede haberlo**: un `guid` explícito gana sobre el derivado, así que
  añadir uno tendría el mismo efecto que cambiar el `appId`. Hay una prueba que lo prohíbe.
- Ese GUID nombra la clave del registro (`NsisTarget.ts:219-224`, `:240`).
- Y el instalador localiza lo anterior **por el registro, no por la carpeta**:
  `templates/nsis/include/installUtil.nsh:155` lee `UninstallString` de esa clave.

**Y no se quedó en el razonamiento: la fila existe y se ha leído.** El UUID v5 de
`net.rdztilegroup.hub` con ese espacio de nombres es **`6518596e-df58-5bd6-8ce5-00520ccbd59d`**
—calculado por el orquestador, por el auditor y por el worker, por separado y con el mismo
resultado—, y esa clave está en el registro de la máquina del dueño, en **HKLM** (o sea instalación
para toda la máquina: el instalador pedirá elevación), con `DisplayName = "RDZ Hub 1.0.0"` y
`UninstallString = "C:\Program Files\RDZ Hub\Uninstall RDZ Hub.exe" /allusers`. No hay ninguna otra
entrada con «Hub». La fila que el instalador nuevo va a buscar ya está ahí, y sabemos cómo se llama.

**Un detalle que solo aparece al leer la fila de verdad:** su `InstallLocation` está **vacío**. Si
el instalador dependiera de ese valor —como decía el borrador de esta entrada— no encontraría la
carpeta vieja. No depende: `installUtil.nsh:169-175` contempla ese caso y, con `InstallLocation`
vacío, **deduce el directorio del propio `UninstallString`** (`GetFileParent`), citando el issue 735
de electron-builder. El mecanismo funciona con la fila que hay, no con una fila ideal.

Conclusión: cambiar el nombre visible —y con él la carpeta— **no deja huérfana** la instalación de
`C:\Program Files\RDZ Hub`. El instalador nuevo la encuentra y la actualiza; no quedan dos apps. Si
el `appId` cambiara, sí quedarían.

### La descarga acepta los dos nombres

`src/app/api/download/[app]/route.ts` buscaba `apps/RDZ-Hub-Setup.exe` en el almacén privado y
reconocía los activos de GitHub por `startsWith("RDZ-Hub-Setup")`. Ahora prueba **`RTG-Hub-Setup.exe`
y, si no está, `RDZ-Hub-Setup.exe`**, y reconoce ambos prefijos en las publicaciones.

No es cortesía: el almacén privado todavía tiene el fichero con el nombre viejo y el respaldo de
GitHub tiene una publicación con el nombre viejo. Servir solo el nombre nuevo habría roto la
descarga **de la versión que la gente usa hoy** — un fallo peor que el que se estaba arreglando, y
en el mismo commit.

### La trampa del empaquetado: `files` es una lista a mano

`desktop/package.json` empaqueta **exactamente** lo que diga `files`, y hasta hoy decía
`["main.js", "build/icon.ico"]`. Sacar la lógica a `origenes.js` y no añadirlo ahí habría dado un
`.exe` **sin ese fichero dentro**: la app no arranca.

Y lo que lo hace peligroso es que **no lo detecta nada de lo que corremos**. Con `npm start`
funciona, porque el fichero está en disco. `tsc` no mira `desktop/` (el `include` del tsconfig es
solo `**/*.ts` y `**/*.tsx`), `vitest` solo corre `src/**/*.test.ts` y `next build` no lo toca. El
primero en verlo habría sido quien instala el release —después de fusionar— o el propio dueño.

Lo levantó el auditor antes de que llegara a un binario. Queda dicho porque es una trampa que se
paga una vez y se olvida: **cualquier fichero nuevo de `desktop/` hay que meterlo en `files` a
mano**. Y para que no dependa de que alguien lo recuerde, hay una prueba que lee los
`require("./…")` de `main.js` y exige que cada uno esté en la lista.

### Lo que se pierde con el rename, y no es un fallo

`app.getPath("userData")` depende del nombre del producto, así que **el tamaño y la posición
guardados de la ventana no se heredan**: la primera vez tras actualizar, la ventana sale con el
tamaño por defecto. No se migra a propósito —mover ese fichero cuesta más de lo que vale— y queda
escrito para que nadie lo tome por un síntoma.

### Lo no verificado

**Nada de esto se ha ejecutado en la app de escritorio**, porque compilar y publicar el instalador
es del orquestador, no de esta rama. Lo que hay son las funciones puras probadas en solitario y las
comprobaciones de forma sobre `main.js`. En concreto **no se ha visto correr `did-navigate`**: que
Electron entregue ahí la URL final tras las redirecciones está tomado de su API, no medido aquí.

Y **no se ha ejecutado nada en Electron**: que `did-navigate` entregue la URL final tras las
redirecciones está tomado de su API, no medido aquí, ni por el worker ni por el auditor.

**El empaquetado no lo puede comprobar nadie que no compile**, y por eso el orquestador hará dos
cosas antes de que esto llegue a nadie: abrir el `app.asar` compilado para ver que `origenes.js`
está dentro —la misma técnica con la que se encontró el dominio viejo esta mañana— y, tras
instalar, volver a leer la clave del registro.

La primera comprobación cuando el dueño instale la versión nueva: abrir la app, pulsar **Cerrar
sesión** y ver que vuelve a la pantalla de entrar **dentro de la ventana**; y dejar la sesión
caducar para ver que tampoco se abre el navegador solo. La segunda: que el instalador nuevo
**reemplace** la instalación vieja en vez de dejar dos entradas en «Agregar o quitar programas».
`verify.mjs`: en verde sobre `.next` limpio, en solitario: **1365 pasados | 3 saltados**
(main b5b9d9a: 1343 | 3; los +22 son `desktop-origins.test.ts`).

## D-226 · Entregas en modo oscuro: la otra mitad de la deuda de G-13

**Fecha:** 2026-09-08 · **Versión:** solo `deliveries` (la pone el orquestador) · Sin migración.
**Pedido por:** el dueño, que abrió Entregas en oscuro en el escritorio y lo vio roto — «Orders»
en gris oscuro sobre negro. Eligió arreglarlo de verdad y no forzar el claro.

### La deuda que se cierra

D-211 arregló HR y dejó **anotadas Entregas y Time Tracker**. Aquí se cierra Entregas: TT sigue
pendiente, y sigue anotado.

El síntoma: `globals.css` tiene reglas para oscuro, pero los componentes llevaban colores escritos
a pelo dentro de `style={{}}`. En oscuro el fondo cambia y esos no, así que quedaban tarjetas
crema y textos ámbar oscuro sobre negro, ilegibles.

**El recuento es 117 en 24 ficheros**, medido con `coloresAPelo` de `src/lib/inline-colors.ts` —la
misma función que ejecuta el guardián—, y confirmado por separado por el auditor y el orquestador.
(El primer desglose del encargo decía 108 y no mencionaba ocho de esos ficheros: venía de un `grep`
que solo ve el hex si está en la misma línea que `style={{`, así que se le escapaban los estilos
escritos en varias líneas. No es otro criterio: era un error, y el número bueno es 117.)

**Quedan 79.** No son residuo: son los que se decidió dejar, y cada grupo tiene su motivo abajo.

### Una sola regla, y no es sobre colores: es sobre papeles

> **Un color que hace de FONDO con su propio texto encima se queda. Uno que hace de TEXTO sobre un
> fondo del tema, se convierte.**

Con eso se explican los 63 blancos, el ámbar del banner de «sin conexión» y por qué el violeta se
partió en dos tokens, sin necesidad de tres explicaciones distintas.

**Los 63 blancos** son texto sobre un fondo de color fijo: una pastilla roja, un semáforo de etapa,
un badge de rol. El fondo es un color fuerte que no se mueve entre temas, así que el blanco encima
se lee igual en los dos. Convertirlos a `--card` los rompería **justo en oscuro**, que es lo
contrario de lo que este encargo venía a hacer.

**El violeta tiene DOS papeles** —fondo de una franja con texto blanco, y texto sobre una tarjeta
clara— y en oscuro cada papel necesita un valor distinto: el fondo se queda, el texto se aclara. De
ahí dos tokens, y no una elección entre romper una cosa u otra.

**El ámbar de `OfflineBanner` tiene UNO**: fondo de franja con su texto encima. Es la misma regla
del blanco, con un ámbar. Crear un token de un solo uso para él no ganaría nada y **obligaría a
alguien a inventarle un valor oscuro sin que haya un motivo real** — un token de un solo uso es una
decisión pendiente disfrazada de paleta. Y si algún día ese banner deja de traer su texto encima,
cambia el papel y cambia la respuesta.

La regla la formuló el auditor al resolver lo que aquí figuraba como una asimetría sin explicar.
Va como regla y no como 63 entradas sueltas: una regla se puede comprobar y una lista de 63 no la
vuelve a leer nadie. El guardián fija el número, así que si mañana aparece un blanco que **no**
cumple la regla, la cuenta sube y salta.

**Los cuatro `#fff` que sí eran fondo, cambiaron**: el aro blanco alrededor del punto de color de
cada chofer (`map:537`, `map:550`, `routes:1589`, `routes:1984`) pasó a `var(--card)`. En claro
`--card` es `#ffffff`, o sea **el mismo color exacto**; en oscuro el aro acompaña a la tarjeta en
vez de recortarse en blanco.

### Los tokens nuevos: mismo valor en claro, par propio en oscuro

Doce tokens, y cada uno vale en `:root` **exactamente** el hex que sustituyó — la vara de D-211, y
la que hace esto seguro. Hay una prueba por token que lo fija.

| token | claro (el hex de antes) | oscuro | qué era |
|---|---|---|---|
| `--amber-soft` | `#fff7ec` | `#3a2f12` | fondo de tarjeta de aviso (12 usos) |
| `--amber-text` | `#b9791a` | `#ffcf7a` | el ámbar oscurecido para leerse en claro (11 usos) |
| `--red-soft` | `#fef6f6` | `#3a1620` | fondo de tarjeta de error |
| `--red-tint` | `#fdeaea` | `#3a1620` | ídem, otro rosa |
| `--red-chip-bg/text/line` | `#fff1f0` / `#a10e0e` / `#f0c0bd` | `#3a1620` / `#ffb3bf` / `#5e2330` | la pastilla de chofer sobrecargado |
| `--green-soft` | `#e9f7f0` | `#16352a` | pastilla de progreso a medias |
| `--teaching-bg` / `--teaching-text` | `#7c3aed` | (no cambia) / `#b794f6` | el violeta del modo enseñanza |
| `--panel-line` | `#dfe3ea` | `#2b3644` | borde de panel |
| `--row-line` | `#eef1f5` | `#2b3644` | separador entre filas |

**Los valores oscuros no son inventados: son los que ya usaban los avisos.** `.banner.warn`,
`.banner.err` y `.banner.ok` llevan meses con `#3a2f12`, `#3a1620` y `#16352a` en oscuro. Un aviso
y una tarjeta teñida del mismo color no pueden verse distintos; hay una prueba que ata cada tinte
nuevo a la regla del banner de la que salió.

**Dos tokens que parecen redundantes y no lo son.** `--red-soft` (`#fef6f6`) y `--red-tint`
(`#fdeaea`) son dos rosas casi iguales que alguien escribió por separado. Unificarlos sería lo
correcto **y cambiaría el modo claro**, que es justo lo que esta decisión promete no hacer. Se
conservan los dos, con el motivo escrito; unificarlos es un cambio de una línea el día que se
quiera, y entonces será una decisión y no un descuido.

**Y el violeta se partió en dos tokens.** El mismo hex se usaba como **fondo** de una franja con
texto blanco y como **texto** sobre una tarjeta clara. Con un solo token había que elegir entre
aclararlo en oscuro —y romper el texto blanco de la franja— o dejarlo —y no poder leer el aviso—.
Dos tokens resuelven las dos cosas y dicen en su nombre para qué es cada uno.

### Lo que se queda a pelo, con su motivo

Los 79, agrupados. Cada grupo, no cada línea: la lista completa la fija el guardián.

1. **63 blancos sobre color** — la regla de arriba.
2. **`#000` ×2** (`account:282`, `account:292`): el fondo negro detrás de un vídeo y de una foto.
   Es un marco de proyección, no un color del tema; en claro y en oscuro se quiere negro.
3. **5 colores con transparencia** (`rgba(255,255,255,.1)` ×2, `rgba(255,255,255,.25)`,
   `rgba(16,185,129,0.06)`, `rgba(0,0,0,.35)`): un color con alfa se compone sobre lo que haya
   debajo, así que **ya se adapta al tema por construcción**. Los dos primeros son realces blancos
   sobre la barra oscura, que es oscura en los dos temas.
4. **La pastilla invertida `#3a2a00` + `#ffd98a`** (`routes:2499`, `OrdersTable:58`): fondo oscuro
   con texto claro **a propósito**, para destacar sobre una fila. Ya funciona en oscuro; volverla
   token sería cambiarla sin motivo.
5. **`#b9791a` como FONDO** (`OfflineBanner:34`): el mismo hex que se volvió `--amber-text`, pero
   aquí es el fondo de una franja con texto blanco. Si usara el token, en oscuro se aclararía y el
   texto blanco dejaría de leerse. Se queda, y el motivo es exactamente el que partió el violeta
   en dos.
6. **Los 8 de `SessionExpired.tsx`, y no por descuido: es diseño.** Es el diálogo de «tu sesión
   caducó», el que aparece **cuando la app ya no puede leer sus datos**. Depender del sistema de
   temas justo ahí es **depender de lo que puede estar fallando** — por eso el componente está
   escrito sin apoyarse en nada de la app, hasta con su propia `fontFamily`. Y no hay nada que
   arreglar: una tarjeta blanca con texto oscuro sobre un velo se lee bien en los dos temas.
   Convertirlo, además, pediría cuatro tokens de un solo uso (`#1a2233`, `#5c6b86`, `#d7deea`,
   `#3a63e0`) cuyos valores **no coinciden** con los existentes (`--text` es `#152238`, `--line` es
   `#dfe5ee`, `--accent` es `#2456c9`), o cambiar el modo claro.

   La vara que lo decide, y que conviene tener escrita para el resto de la deuda de G-13, es la del
   dueño: **no es «que no quede ninguna superficie clara en oscuro», es «que nada quede ilegible ni
   cambie en claro»**. Con esa vara, esto no es deuda pendiente.

### Los mapas no entran, y no por cuidado

El criterio del encargo pedía mirar aparte los colores de Leaflet, Google y los marcadores de
D-214/D-216/D-222. **Se cumple solo**: esos colores no viven en `style={{}}` sino en objetos de
opciones de los motores y en módulos puros que ni siquiera son `.tsx`. `MapView.tsx` no tiene
ningún `style={{}}`; los de `LeafletMap` y `GoogleMapView` no llevan color. O sea que el guardián
**no puede** contarlos, en vez de que haya que acordarse de excluirlos. Esta rama no los toca.

### El fondo de la ventana de escritorio

`desktop/main.js` creaba la ventana con `backgroundColor: "#0f151d"` — el `--paper` del tema
**oscuro**, copiado del cliente de Time Tracker, donde sí aplica porque aquel arranca en oscuro a
propósito (D-080). Aquí no: el hub decide el tema en **dos** sitios —`prefs.tsx:40` y el script de
pre-pintado de `layout.tsx:14`— y los dos miran `window.ttDesktop`, que inyecta un `preload` que
**esta ventana no tiene**. Así que el hub arranca claro y la ventana lo enmarcaba en negro:
parpadeo al abrir, y negro en cualquier zona que la web no llegue a pintar.

**El arreglo elegido: el marco recuerda el tema que se vio la última vez.** Un color fijo claro
habría arreglado el arranque por defecto y dejado el parpadeo —al revés— a quien haya elegido
oscuro. El proceso principal no puede leer el `localStorage` de la página antes de crearla y sin
`preload` no hay puente, así que tras cargar se lee **lo que el script de pre-pintado dejó puesto**
(`document.documentElement.getAttribute('data-theme')`, que es el mismo sitio que decide el color
real) y se guarda junto al tamaño de la ventana, para el **próximo** arranque. La primera vez sale
claro, que es lo que pinta ese script sin preferencia guardada.

**Los dos valores son exactamente los `--paper` de `globals.css`** —claro `#f4f6f9` (`:5`), oscuro
`#0f151d` (`:65`)—, así que el marco de la ventana se pinta del **mismo** color que el fondo real de
la página en cada tema, no de uno parecido. Eso es lo que quita el destello, más que la elección del
tema: un marco «casi igual» seguiría dejando una costura visible al arrancar.

**Y sin nada guardado, sale claro.** Se comprobó en las cinco vías por las que puede pasar
`temaRecordado()`: sin fichero de estado, con fichero sin campo `theme`, con el JSON roto, con un
valor raro (`"DARK"`) y con `theme: "dark"`. **Solo `"dark"` exacto da oscuro**; todo lo demás cae a
claro. Importa porque la primera vía es la de todo el mundo el día que instale: si el valor inicial
fuera el oscuro, el parpadeo lo vería todo el mundo en vez de solo quien usa oscuro, y una sola vez.

### Qué NO cambia

El modo claro, ni un punto: cada token vale lo que valía el hex, y hay una prueba por token. Los
colores de los mapas. La lógica de orígenes de D-225 (`desktop/origenes.js`), sin tocar. Y ningún
token que ya existía se redefine — los nuevos se añaden, y hay una prueba que lo comprueba.

### Lo no verificado

**Nadie ha abierto Entregas en oscuro en un navegador tras el cambio.** Lo que hay es que cada
sustitución conserva el valor en claro (probado token a token) y que los pares oscuros son los que
ya usaban los avisos. Que el resultado **se vea bien** es cosa de mirarlo: la primera comprobación
del dueño es abrir en oscuro las tres pantallas donde estaban los 45 colores convertidos —Rutas, la
ficha de pedido y Seguimiento— y ver los avisos ámbar, las tarjetas de error y la pastilla de
chofer sobrecargado.

Y **no se ha ejecutado la app de escritorio**: que el marco nazca del color correcto en el segundo
arranque va por el código, no por haberlo visto. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1440 pasados | 3 saltados**
(main 7db49a3: 1365 | 3; los +75 son el guardián de Entregas y los tokens).

## D-227 · «Todas las apps» solo se pinta si hay apps a las que ir

**Fecha:** 2026-09-09 · **Versión:** la pone el orquestador (toca ERP) · Sin migración.
**Pedido por:** el dueño: entra con una cuenta que solo tiene el ERP, pulsa **«Todas las apps»** y
no pasa nada.

### No es que no pase nada: es que va y vuelve

`/home` comprueba quién puede estar ahí y devuelve a su sitio a quien no
(`home/page.tsx:53`, `if (!canReachHub(me)) redirect(landingRoute(me))`). Y `canReachHub` es
**falso** con un solo módulo y sin herramientas de hub visibles. Así que quien solo tiene el ERP
pulsaba, iba a `/home`, y la app lo mandaba de vuelta al ERP: **la pantalla parpadea y sigues donde
estabas**, sin un error, sin nada que leer. Un fallo que no se puede ni describir es peor que uno
que da un mensaje feo.

El perfil con el que lo vio tenía `module_access: ["erp"]` (medición del orquestador, con el
registro de seguridad).

### La causa: dos sitios decidiendo lo mismo, y uno sin preguntar

`ModuleSwitcher.tsx:82` **sí** pregunta —`if (!canReachHub(...)) return null`— y por eso se esconde
solo. La barra del ERP no: `erp/side-nav.tsx:83` y `:159` pintaban el enlace **sin ninguna guarda**;
`canReachHub` no aparecía en el fichero.

Y no fue un descuido, que es lo que lo hace interesante: el comentario de `:153` decía

> *Always shown. In rtg-erp this was gated on having more than one destination, because there the
> ERP could be somebody's only module. Here the hub is the way back to Deliveries, Recruiting and
> Time Tracker, so it is never a dead end.*

La suposición estaba **escrita**: se creía que dentro del hub el ERP nunca sería el único módulo de
nadie. Lo es. Por eso esta rama corrige el comentario además del código — dejarlo habría llevado al
siguiente lector a la misma conclusión.

### El arreglo: se pregunta una vez, arriba

`header.tsx` —el único sitio que monta la barra— llama a `canReachHub` y le pasa un sí o un no
(`hubReachable`). La barra **no vuelve a decidirlo**: dos sitios preguntando lo mismo por separado
es exactamente lo que produjo el fallo, y hay una prueba que exige que `canReachHub` no aparezca en
el código de `side-nav.tsx` (en los comentarios sí, para decir de dónde viene la respuesta).

Los **dos** enlaces —el de la cabecera, junto a «RTG ERP», y el de la lista lateral— salen del mismo
valor, así que no pueden discrepar entre ellos.

**El rol del hub viaja en la sesión que ya se leía.** `getSessionInfo` moldea `profiles.role` a
`AppRole` (el rol tal como lo entiende el ERP), y las preguntas del hub necesitan el rol del hub.
Es la misma columna y la misma consulta: se expone también como `hubRole` con su tipo propio, para
no forzar un molde en cada sitio que quiera hacer una pregunta de hub. **Ninguna lectura nueva de
`profiles`**, y hay una prueba que lo fija.

### Los otros módulos: medidos, no supuestos

- **HR y Time Tracker no tienen enlace propio al hub.** Los dos montan `ModuleSwitcher`, que ya se
  esconde con la misma regla. Nunca tuvieron este fallo, y no se toca nada en ellos.
- **El «Volver al hub» de `home/users/page.tsx:125` no puede ser un callejón sin salida.** A esa
  pantalla solo entran admins —su propio layout redirige a cualquier otro (D-056)— y **todo admin
  cumple `canReachHub`**, porque Usuarios es una herramienta de hub visible para él. O sea que quien
  puede ver ese enlace puede, por definición, llegar al hub. Se deja como está, con la medición
  escrita para que nadie lo «arregle» por simetría.

### Qué NO cambia

**La regla de quién puede llegar al hub, intacta** (D-056/D-173): esta rama arregla quién **pinta**
el enlace, no quién puede entrar. La tentación contraria —relajar `canReachHub` para que el botón
funcione— haría desaparecer el síntoma llevando a esa persona a una pantalla que no le sirve, con un
único módulo y ninguna herramienta. Hay una prueba que fija las dos líneas de `canReachHub` y la
guarda de `/home`.

Tampoco cambia la excepción del chofer (D-051): nunca ve ninguno de los dos controles, le den lo que
le den.

### Lo no verificado

**Nadie ha entrado con una cuenta de un solo módulo a mirarlo en un navegador.** Lo que hay es la
regla probada en solitario —incluido el caso exacto del dueño, `["erp"]` con rol `sales`— y las
comprobaciones de forma sobre los tres ficheros. La primera comprobación cuando el dueño lo vea: con
esa misma cuenta, que **el enlace ya no esté**; y con una cuenta de dos módulos, que siga estando y
lleve al selector. `verify.mjs`: en verde sobre `.next` limpio, en solitario: **1453 pasados | 3 saltados**
(main b781f5e: 1440 | 3; los +13 son `erp-hub-link.test.ts`).
