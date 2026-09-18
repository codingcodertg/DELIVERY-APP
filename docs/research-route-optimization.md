# Cómo resuelven el ruteo las plataformas de última milla — investigación para RTG

Fecha de consulta de todas las fuentes: **2026-09-18**. Solo páginas públicas, sin registro ni claves.

**Cómo leer las marcas de confianza**
- Sin marca: texto leído en la página citada (a través del resumidor de WebFetch, pidiendo cita literal).
- **[snippet]**: solo visto en el fragmento del buscador; la página no se pudo abrir (`support.onfleet.com`, `help.optimoroute.com` y `kb.samsara.com` devuelven 403 a la herramienta).
- **[NV]**: no verificado. **ND**: no documentado públicamente.
- Ninguna cita se comprobó byte a byte contra el HTML. Antes de construir sobre una afirmación crítica, abrir la URL.

Contexto RTG: ~5 tiendas, 4-8 choferes, decenas de órdenes/día, carga en pallets decimales, problema PDPTW multi-vehículo.

---

## 1. Plataformas comerciales

### 1.1 Onfleet
1. **Inicio/fin.** La API de optimización exige `routeStart` o `routeEnd`: «At least one required, formatted as `teams://DEFAULT`, `workers://ROUTING_ADDRESS`, or `hub://`» — https://docs.onfleet.com/reference/initialize-route-optimization.md . [snippet] Fin posible en hub, casa del conductor o «Anywhere» (última tarea); «A route cannot both start 'Anywhere' and end 'Anywhere'» — https://support.onfleet.com/hc/en-us/articles/360023910371-Route-Optimization-Setup
2. **Pickup–delivery.** Array `dependencies`: «the Pickup has to complete prior to starting the Dropoff»; equivale a «Linked Tasks» del panel — https://docs.onfleet.com/reference/dependencies.md . Cómo se pinta el par en la secuencia: ND.
3. **Tiempos.** `serviceTime` en minutos por tarea; `maxViolationTime` («Max allowed delay time»); coste `costPerUnitLateTime` → ventanas blandas penalizadas — https://docs.onfleet.com/reference/route-optimization-cost-parameters.md . Tráfico: [snippet] «historical traffic data, and road speeds/restrictions». Predictivo por hora: [NV].
4. **Prioridad.** Solo en ROv3: número 0-499, «Smaller the number, earlier it is in the route»; campo `Group` fuerza misma ruta — https://docs.onfleet.com/reference/additional-configurable-fields-for-rov3.md
5. **Capacidad.** Una sola dimensión: `capacity` del vehículo contra `quantity` de la tarea. Tipos: walking, bicycle, motorcycle, car, truck — https://docs.onfleet.com/reference/initialize-vehicle-based-route-optimization.md . Decimales: ND.
6. **Ajuste manual.** [snippet] Arrastrar el pin de la tarea sobre el conductor (al final) o a una posición concreta. Flujo API Schedule → Start → Apply — https://docs.onfleet.com/reference/route-optimization . Bloquear parada / advertencias: ND.
7. **Interfaz.** Mapa + barra lateral + vista de tabla; [snippet] columnas que se añaden, quitan y reordenan — https://support.onfleet.com/hc/en-us/articles/360027522312-Table-view . La respuesta de la API trae `issues`. Línea de tiempo y motivo por tarea: [NV].
8. **Algoritmo.** No nombrado. Lo público es el modelo de costes configurable. La optimización es función del plan Enterprise.

### 1.2 Routific (Engine API)
1. **Inicio/fin.** `start_location` obligatorio; «The end-location is optional and may be omitted» (ruta abierta o fin distinto); `shift_start`/`shift_end`, `breaks` — https://docs.routific.com/reference/fleet.md
2. **Pickup–delivery.** Endpoint `pdp`: cada orden tiene objeto pickup y dropoff (location, start, end, duration). «An item can only be dropped off after it has been picked up by the same driver». En la salida «each visit contains a `type`». Limitación: «priority parameter is not supported on the pdp endpoints» — https://docs.routific.com/reference/defining-orders.md
3. **Tiempos.** Hasta dos ventanas por visita; `duration` en minutos — https://docs.routific.com/reference/input.md . **Tráfico no predictivo**: factor global `traffic` (faster…very slow) y `speed` por vehículo; `max_visit_lateness` y `max_vehicle_overtime` ablandan — https://docs.routific.com/reference/options.md
4. **Prioridad.** low/regular/high o número 1-10 000 (mayor = más prioridad). No en PDP.
5. **Capacidad.** `load`/`capacity`: «Number (any unit) or Object» → multidimensional. Decimales plausibles, sin cita explícita [NV]. `type` casa visita con vehículo.
6. **Ajuste manual.** Arrastrar en línea de tiempo o mapa; al mover a otra ruta «Routific will automatically slot it into the most optimal spot»; bloqueo de rutas [snippet] — https://academy.routific.com/en/articles/1317935-how-to-make-changes-to-your-routes . API `/fix` y `/fix-pdp`: «does not optimize the entire problem again, but finds the best place to insert a new visit(s)» — https://docs.routific.com/reference/re-optimize-solution.md
7. **Interfaz.** Mapa + línea de tiempo. No servidas: array `unserved` «with a message indicating what constraint was preventing the order».
8. **Algoritmo.** Solo prensa de 2016: «Bees Algorithm» — https://www.prnewswire.com/news-releases/routifics-breakthrough-algorithms-inspired-by-honey-bee-optimization-590410061.html . La doc dice «proprietary algorithms».

### 1.3 OptimoRoute
1. **Inicio/fin.** Depósito por defecto; cambiable por conductor vía API («this new location will be used for all future optimizations») — https://optimoroute.com/api/ . [snippet] Casa o depósito secundario. Retorno opcional: [NV].
2. **Pickup–delivery.** `relatedOrderNo`/`relatedId`: «Used to link pickups and deliveries in situations where goods are transported directly from one customer location to another». [snippet] mismo conductor y pickup antes. Tipos de orden D/P/T.
3. **Tiempos.** `twFrom`/`twTo`: «if the driver arrives too early, they will be forced to wait»; `duration` en minutos. **No usa tráfico al planificar**: «during planning, OptimoRoute does not consider traffic to determine the best sequence» — https://optimoroute.com/faq/
4. **Prioridad.** L / M / H / C (Critical).
5. **Capacidad.** Cuatro dimensiones `load1`…`load4`; skills y `vehicleFeatures`. Tipo decimal: [NV].
6. **Ajuste manual.** Arrastre en línea de tiempo y mapa; «Best fit»: soltar sobre el nombre del conductor «will be automatically dropped into the optimal position» — https://optimoroute.com/drag-and-drop/ . API: `startWith` EMPTY/CURRENT, `lockType` ROUTES/RESOURCES; [snippet] rutas bloqueadas excluidas de la replanificación. `depotTrips` para recargas.
7. **Interfaz.** Línea de tiempo con una fila por conductor + mapa; [snippet] pestaña «Not Scheduled» con el motivo por orden.
8. **Algoritmo.** ND.

### 1.4 Route4Me
1. **Inicio/fin.** [snippet] «End Route At Any Address», «…At Departure Address (Round Trip)», «…At Last Address» — https://support.route4me.com/planning-a-route-on-the-web/ . API `RT` y `LockLast` — https://github.com/route4me/route4me-go-sdk/blob/master/routing/parameters.go
2. **Pickup–delivery.** Modo «Joint»: «Each drop-off address will always be visited immediately following its corresponding pick-up address» (sin encadenar pickups) — https://support.route4me.com/joint-pickup-and-dropoff-route-optimization/ . Modo con capacidad: columna Address Type PICKUP/DELIVERY — https://support.route4me.com/pickup-and-delivery-route-optimization-with-vehicle-capacity/
3. **Tiempos.** Ventanas y tiempo de servicio en segundos — https://route4me.io/docs/ . Complemento «Predictive Traffic» existe; mecanismo [NV]. Ponderación distancia/tiempo/espera por porcentaje [snippet].
4. **Prioridad.** «"1" being the highest priority and "65,535" the lowest» — https://support.route4me.com/priority-constraint-advanced-constraint-add-on/
5. **Capacidad.** Peso, volumen y piezas combinables; en el SDK `VehicleCapacity` es float64 (decimales). Dimensiones de camión.
6. **Ajuste manual.** Arrastrar para reordenar; `DisableOptimization`; «Re-Optimize This Route» — https://support.route4me.com/disable-optimization/ . Bloqueo de parada / advertencias: ND.
7. **Interfaz.** Comparación de rutas lado a lado; [snippet] línea de tiempo para comparar cargas; columnas con engranaje — https://support.route4me.com/multiple-routes-map/ ; [snippet] ruta «Unrouted Destinations». Motivo por parada: ND.
8. **Algoritmo.** Solo taxonomía `algorithm_type`: TSP, VRP, CVRP_TW_SD, CVRP_TW_MD, TSP_TW, TSP_TW_CR, BBCVRP.

### 1.5 Spoke Dispatch (antes Circuit for Teams)
1. **Inicio/fin.** Por conductor en la API (`routeOverrides.startAddress`/`endAddress`: «where the driver must always begin/end at», `startTime`, `endTime`, `maxStops`, `drivingSpeed`, `deliverySpeed`) — https://developer.dispatch.spoke.com/docs/models/driver . Roundtrip [snippet] — https://help.spoke.com/en/articles/6664550-how-to-manage-depots
2. **Pickup–delivery.** `activity` = delivery | pickup — https://developer.dispatch.spoke.com/docs/models/stop . Pares enlazados: ajuste «maximum straight-line distance allowed between a linked pickup and its drop-off» — https://help.spoke.com/en/articles/7185774-how-to-change-global-account-settings . Cómo se muestran: ND.
3. **Tiempos.** `earliestAttemptTime`, `latestAttemptTime`, `estimatedAttemptDuration`; ETA como intervalo (`estimatedEarliestArrivalAt`/`estimatedLatestArrivalAt`). Tráfico: solo marketing; predictivo ND.
4. **Prioridad.** `optimizationOrder`: first | last | default. Sin niveles numéricos.
5. **Capacidad.** Solo peso por tipo de vehículo. [snippet] La capacidad «does not reflect pick-ups later in the route». Decimales ND.
6. **Ajuste manual.** Orden relativo: «order stops before/directly before/directly after/after other stops» — https://help.spoke.com/en/articles/7228612-how-to-manually-order-and-make-changes-to-stops . Bloqueo y advertencias: ND.
7. **Interfaz.** Lista de paradas sin asignar, selección con lazo en el mapa — https://help.spoke.com/en/articles/7213916-how-to-create-a-route . Resto ND.
8. **Algoritmo.** ND. Tres preferencias: «Equalize workload», «Balance workload and efficiency», «Maximize efficiency».

### 1.6 Samsara
1. **Inicio/fin.** [snippet] El optimizador clásico reordena «while keeping the Start Location and last stop fixed» — https://kb.samsara.com/hc/en-us/articles/360043043512-Route-Optimization . API: ruta = «A planned sequence of 2 or more stops…» — https://developers.samsara.com/docs/routing-guide
2. **Pickup–delivery.** ND.
3. **Tiempos.** Llegada/salida programada y real por parada. [snippet] Duración de parada = media del informe Time on Site, o 30 min por defecto. Planificador nuevo: «time windows, service durations, vehicle capacities, driver skills», «real-time traffic conditions» — https://www.samsara.com/blog/behind-the-build-routing-and-navigation-at-samsara
4. **Prioridad.** ND.
5. **Capacidad.** Solo la mención anterior.
6. **Ajuste manual.** [NV] (KB bloqueada).
7. **Interfaz.** [snippet] Rutas sin asignar que el conductor reclama desde la app.
8. **Algoritmo.** ND.
- Idea útil: **tiempo de servicio calibrado con el tiempo real en sitio** (única plataforma que lo documenta, y solo por snippet).

### 1.7 Bringg
Fuente base: https://help.bringg.com/docs/optimization-settings-overview
1. **Inicio/fin.** «Specify the starting point and/or the final destination of any route»; incluye «Driver's home address»; recargas entre rutas.
2. **Pickup–delivery.** Tipos de parada Pickup / Dropoff. Enlace y visualización: ND.
3. **Tiempos.** Ventanas, «time on site», tiempo de carga del vehículo. Tráfico: «predicted and real time traffic patterns» (opcional) — https://help.bringg.com/docs/about-route-optimization-in-bringg
4. **Prioridad.** «High ranked orders must be delivered as a matter of priority».
5. **Capacidad.** «length (meters/feet), weight (kg/lbs), or handling units»; tipos de vehículo y skills. Decimales ND.
6. **Ajuste manual.** «Select an order in the timeline and drag it to a different route or position»; aviso: «a red clock icon… indicates that your change caused it to move outside of its time window»; reoptimizar ruta existente o añadirle órdenes — https://help.bringg.com/docs/adjust-routes-for-planned-orders-with-the-route-planner
7. **Interfaz.** Línea de tiempo + mapa con no asignadas; KPIs por ruta tras cada cambio; «select the column icon and choose which details to display in the order table». Motivo de no asignación al pasar el cursor: [NV].
8. **Algoritmo.** ND.

### 1.8 Descartes
Solo marketing; sin manuales públicos — https://www.descartes.com/solutions/routing-mobile-and-telematics/daily-route-planning-software
- Ventanas: «honoring time windows». Tráfico: «plan routes around predicted and current traffic conditions» (histórico + actual).
- Capacidad: «basic cube or weight constraints». Ajuste: «Manual adjustments and drag and drop: Ability to add, remove and re-sequence orders». Motor «works continuously in the background».
- Inicio/fin, pickup–delivery, prioridad de órdenes, bloqueo, Gantt, algoritmo: ND. Orientado a flotas mucho mayores que RTG.

### 1.9 Shipday
Marketing — https://www.shipday.com/route-planning
- «Pickup-and-dropoff pairing for same-day routes»; «Time windows and service time at every stop»; «Stop priority for VIP or fragile orders»; «Vehicle capacity and weight limits»; «Drag-and-drop manual edits»; mapa Google en vivo.
- Inicio = fin en el local: [snippet, NV]. Unidades, decimales, bloqueo, no asignadas, algoritmo: ND.

### 1.10 Google Route Optimization API (antes Cloud Fleet Routing)
Fuentes: https://developers.google.com/maps/documentation/route-optimization/overview · https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/ShipmentModel · https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/projects/optimizeTours · https://developers.google.com/maps/documentation/route-optimization/reference/rest/v1/SkippedShipment
1. **Inicio/fin.** Por vehículo `startLocation`, `endLocation` (independientes), `startTimeWindows`, `endTimeWindows`, `routeDurationLimit`, `breakRule`, `fixedCost`, `costPerHour`.
2. **Pickup–delivery.** Nativo: cada `Shipment` tiene `pickups[]` y `deliveries[]` (con alternativas). Reglas de precedencia y `shipmentTypeIncompatibilities`.
3. **Tiempos.** Ventanas duras (`startTime`/`endTime`) y blandas (`softStartTime`/`softEndTime` con coste); `VisitRequest.duration`. `considerRoadTraffic` aplica estimación de tráfico a tiempos y costes y marca `hasTrafficInfeasibilities`. También acepta `durationDistanceMatrices` propias.
4. **Prioridad.** Vía `penaltyCost` por shipment: sin penalización «it is considered infinite, i.e. the shipment must be completed».
5. **Capacidad.** `loadDemands` / `loadLimits` por tipo con nombre libre (p. ej. `pallets`), multidimensional, `softMaxLoad`. **Las cantidades son int64 → los pallets decimales hay que escalarlos (×100).**
6. **Ajuste manual (por API).** `injectedFirstSolutionRoutes` (partir de una solución), `injectedSolutionConstraint` («freeze portions of routes»), `refreshDetailsRoutes` (recalcular tiempos sin cambiar la secuencia — sirve para evaluar la ruta manual del despachador).
7. **Interfaz.** No tiene; es API. `skippedShipments` con motivos codificados: DEMAND_EXCEEDS_VEHICLE_CAPACITY, CANNOT_BE_PERFORMED_WITHIN_VEHICLE_TIME_WINDOWS, …_DURATION_LIMIT, …_DISTANCE_LIMIT, VEHICLE_NOT_ALLOWED, etc.
8. **Algoritmo.** No documentado en la API. `searchMode` RETURN_FAST / CONSUME_ALL_AVAILABLE_TIME y `timeout`. Determinismo: ND.
- **Precio**: se factura **por shipment**. SKU Single Vehicle (1 vehículo): 5 000 gratis/mes, luego $10 por 1 000. SKU Fleet Routing (≥2 vehículos): 1 000 gratis/mes, luego $30 por 1 000, bajando a $14 / $6 / $2.40 / $2.10 por volumen. No se cobran peticiones `VALIDATE_ONLY` ni shipments infactibles — https://developers.google.com/maps/documentation/route-optimization/usage-and-billing y https://developers.google.com/maps/billing-and-pricing/pricing (consultado 2026-09-18).
- Para RTG (estimación propia): 40 órdenes × 22 días = 880 shipments/mes con una corrida diaria → dentro de la franja gratuita; cada reoptimización completa extra cuesta ~$1.20.

---

## 2. Sección técnica

### 2.1 Técnicas estándar VRPTW / PDPTW
| Familia | Técnica | Nota |
|---|---|---|
| Construcción | Savings (Clarke & Wright 1964), Sweep, inserción más barata, inserción I1 de Solomon (1987), regret-k | Dan una primera solución en milisegundos |
| Mejora intra-ruta | 2-opt (Croes 1958), Or-opt (Or 1976), Lin-Kernighan | Con PDP hay que respetar la precedencia del par |
| Mejora inter-ruta | relocate, exchange, cross, CROSS-exchange (Taillard 1997); en PDP se mueve **el par** (relocate pair) | |
| Metaheurísticas | Guided Local Search (Voudouris & Tsang 1999), tabú, recocido simulado, late acceptance | |
| Destruir y reparar | LNS (Shaw 1998, https://link.springer.com/chapter/10.1007/3-540-49481-2_30); **ALNS para PDPTW** (Ropke & Pisinger 2006, https://pubsonline.informs.org/doi/10.1287/trsc.1050.0135) | Referencia de facto para PDPTW |
| Poblacionales | HGS (Vidal 2022, https://arxiv.org/pdf/2012.10384, código https://github.com/vidalt/HGS-CVRP) | Estado del arte en CVRP; el código abierto no cubre PDPTW |
| Exactos / CP | Programación por restricciones, branch-and-price | A tamaño RTG (≈40 órdenes) una heurística con 10-30 s basta |

Las referencias de Solomon, Clarke-Wright, Croes, Or, Savelsbergh, Taillard y Voudouris se citan de memoria [NV].

### 2.2 OR-Tools por dentro
Fuentes: https://developers.google.com/optimization/routing/routing_options · https://developers.google.com/optimization/routing/pickup_delivery · https://developers.google.com/optimization/routing/penalties · https://developers.google.com/optimization/routing/vrptw · https://developers.google.com/optimization/routing/dimensions · https://raw.githubusercontent.com/google/or-tools/stable/ortools/constraint_solver/routing_parameters.proto · https://raw.githubusercontent.com/google/or-tools/stable/ortools/constraint_solver/routing.h
- Motor: solver de **programación por restricciones** + búsqueda local.
- **First solution strategies**: AUTOMATIC, PATH_CHEAPEST_ARC, PATH_MOST_CONSTRAINED_ARC, EVALUATOR_STRATEGY, SAVINGS, SWEEP, CHRISTOFIDES, BEST_INSERTION, PARALLEL_CHEAPEST_INSERTION, LOCAL_CHEAPEST_INSERTION, GLOBAL_CHEAPEST_ARC, LOCAL_CHEAPEST_ARC, FIRST_UNBOUND_MIN_VALUE, ALL_UNPERFORMED. Para PDPTW lo habitual es PARALLEL_CHEAPEST_INSERTION (práctica común, no cita).
- **Metaheurísticas**: GREEDY_DESCENT, GUIDED_LOCAL_SEARCH («Generally the most efficient metaheuristic for vehicle routing»), SIMULATED_ANNEALING, TABU_SEARCH, GENERIC_TABU_SEARCH.
- **Operadores** (proto): relocate, relocate_pair, exchange, cross, two_opt, or_opt, lin_kernighan, tsp_opt, make_active/inactive, swap_active, path_lns, full_path_lns, inactive_lns e inserciones LNS (ruin-recreate). `use_cross_exchange` figura como «Not implemented yet.»
- **Dimensiones**: `AddDimensionWithVehicleCapacity` (capacidad), `AddDimension` de tiempo con slack = espera (`slack(i) = cumul(j) - cumul(i) - transit(i,j)`), `CumulVar(i).SetRange(a,b)` para ventanas duras, `SetCumulVarSoftUpperBound` para blandas. **Todo es int64**: pallets ×100, tiempo en segundos o minutos — https://github.com/google/or-tools/issues/1266
- **Pickup–delivery**: `AddPickupAndDelivery(p,d)` + restricciones explícitas `VehicleVar(p)==VehicleVar(d)` y `CumulVar(p) <= CumulVar(d)`.
- **Órdenes opcionales**: `AddDisjunction([nodo], penalización)`; la penalización se suma al objetivo si se descarta → es también el mecanismo de **prioridad** (penalización mayor = más importante).
- **Inicio ≠ fin por vehículo**: `RoutingIndexManager(n, vehículos, starts[], ends[])`; retorno opcional = nodo final ficticio con coste 0 (técnica de modelado, https://developers.google.com/optimization/routing/routing_tasks).
- **Ajuste manual**: `ApplyLocks`/`ApplyLocksToAllVehicles` (fijar prefijo de ruta), `ReadAssignmentFromRoutes` (partir de la ruta del despachador), `SetFixedCostOfVehicle`.
- **Límites**: `time_limit`, `solution_limit`, `lns_time_limit`. El límite de tiempo puede no respetarse durante la primera solución — https://github.com/google/or-tools/issues/2212
- **Determinismo**: sin garantía oficial. Un issue reporta comportamiento determinista (https://github.com/google/or-tools/issues/1821); con `time_limit` el corte depende de la máquina, con `solution_limit` corta por conteo. [NV — hay que medirlo]
- No explica por qué descarta una orden: la explicabilidad hay que construirla encima.

### 2.3 Alternativas abiertas
| Motor | PDPTW | Capacidad | No asignadas | Algoritmo | Licencia |
|---|---|---|---|---|---|
| **VROOM** (https://github.com/VROOM-Project/vroom/blob/master/docs/API.md) | Sí (`shipments`) | Array de **enteros**, multidimensional | Lista sin motivo | No documentado; gap medio +1,25 % en Li&Lim PDPTW (wiki Benchmarks) | BSD-2 |
| **jsprit** 2.0 (https://www.graphhopper.com/blog/2026/03/30/jsprit-2-0-released/) | Sí (shipments) | Multidimensional int [NV] | — | Ruin & recreate, regret-k | Apache-2.0; 6 años sin release mayor |
| **Timefold** (https://docs.timefold.ai/timefold-solver/latest/optimization-algorithms/overview) | A modelar; el modelo PDP es comercial | Libre (Java) | — | FFD/cheapest insertion + late acceptance/tabú | Community Apache-2.0; Score Analysis figura como Enterprise en *latest* [NV] |

- VROOM: start/end opcionales («as long as at least one of them is present»), `priority` 0-100, `setup` + `service`, skills, matrices propias, modo plan con `steps` fijados que devuelve `violations`. Es JSON sobre HTTP; encaja con un stack Node.
- Timefold: `@PlanningPinToIndex` fija el prefijo ya ejecutado de una ruta.

### 2.4 Google Routes API
Fuentes: https://developers.google.com/maps/documentation/routes/reference/rest/v2/TopLevel/computeRouteMatrix · https://developers.google.com/maps/documentation/routes/config_trade_offs · https://developers.google.com/maps/documentation/routes/usage-and-billing · https://developers.google.com/maps/documentation/routes/compute_route_matrix
- **`routingPreference`**: TRAFFIC_UNAWARE (por defecto, más rápido, promedios históricos), TRAFFIC_AWARE (tráfico actual con optimizaciones de latencia), TRAFFIC_AWARE_OPTIMAL (sin optimizaciones, máxima calidad, mayor latencia). Las respuestas con tráfico traen `duration` y `staticDuration`.
- **`departureTime`**: por defecto, la hora de la petición; en el pasado solo con TRANSIT. «Use this property only for traffic aware requests where the departure time needs to be in the future»; cuanto más lejos, más pesa el histórico.
- **`trafficModel`** (BEST_GUESS, PESSIMISTIC, OPTIMISTIC): «only available for requests that have set RoutingPreference to TRAFFIC_AWARE_OPTIMAL and RouteTravelMode to DRIVE».
- **Límites de matriz**: orígenes × destinos ≤ **625**; ≤ **100** con TRAFFIC_AWARE_OPTIMAL (o TRANSIT); ≤ 50 orígenes+destinos dados por dirección o placeId.
- **Facturación**: matriz **por elemento**; rutas por petición. Essentials = funciones básicas y ≤10 waypoints intermedios; Pro = TRAFFIC_AWARE / TRAFFIC_AWARE_OPTIMAL; Enterprise = p. ej. dos ruedas.

**Precios por 1 000 (consultados 2026-09-18, https://developers.google.com/maps/billing-and-pricing/pricing)** — iguales para Compute Routes y Compute Route Matrix:

| SKU | Gratis/mes | hasta 100k | 100k-500k | 500k-1M | 1M-5M | 5M+ |
|---|---|---|---|---|---|---|
| Essentials | 10 000 | $5.00 | $4.00 | $3.00 | $1.50 | $0.38 |
| Pro (tráfico) | 5 000 | $10.00 | $8.00 | $6.00 | $3.00 | $0.75 |
| Enterprise | 1 000 | $15.00 | $12.00 | $9.00 | $4.50 | $1.14 |
| Route Optimization Single Vehicle | 5 000 | $10.00 | $4.00 | $2.00 | $0.80 | $0.70 |
| Route Optimization Fleet | 1 000 | $30.00 | $14.00 | $6.00 | $2.40 | $2.10 |
| Distance Matrix (legacy) Essentials | — | $5.00 | $4.00 | | | |
| Distance Matrix (legacy) Advanced | — | $10.00 | $8.00 | | | |

**Cuenta para RTG (estimación propia):** 45 nodos → 2 025 elementos por matriz completa. Con tráfico (Pro), una matriz diaria × 22 días ≈ 44 500 elementos ≈ **$395/mes**; si se pide por franjas horarias, se multiplica. Con TRAFFIC_AWARE_OPTIMAL además hay que trocear en bloques de 100 elementos (≥21 peticiones). Sin tráfico (Essentials) ≈ $173/mes. Conclusión: **no pedir la matriz completa con tráfico**; ver recomendaciones.

**Distance Matrix API clásica**: en estado **Legacy** («This API is now in legacy mode. Use Compute Route Matrix instead») — https://developers.google.com/maps/documentation/distance-matrix/overview . Parámetros `departure_time` (epoch) y `traffic_model` best_guess/pessimistic/optimistic; `duration_in_traffic` solo con driving + departure_time; máx. 25 orígenes o destinos y 100 elementos con `departure_time` — https://developers.google.com/maps/documentation/distance-matrix/distance-matrix . No empezar nada nuevo sobre ella.

### 2.5 OSRM / Valhalla autoalojados
- **OSRM** (https://project-osrm.org/docs/v5.24.0/api/): `table` (matriz de duración/distancia, sin coste por elemento), `route`, `trip` (TSP simple, sin ventanas ni capacidad), `match`. Tráfico: solo un CSV propio de velocidad por segmento, **sin perfiles por hora** — https://github.com/Project-OSRM/osrm-backend/wiki/Traffic . RAM para Texas: estimado 4-5 GB al preparar, ~2 GB en ejecución [NV, extrapolado de https://github.com/Project-OSRM/osrm-backend/wiki/Disk-and-Memory-Requirements].
- **Valhalla** (https://valhalla.github.io/valhalla/api/matrix/): `sources_to_targets`, `route`, `optimized_route` (TSP). Admite `date_time` y tráfico histórico en 2 016 cubetas semanales, **pero los datos los carga uno mismo** — https://valhalla.github.io/valhalla/concepts/historical-traffic/ . Sin datos propios: velocidades de OSM.
- **Lo que dan**: matrices ilimitadas y gratis, geometría, tiempos de flujo libre consistentes. **Lo que no**: tráfico en vivo ni predictivo, cierres, geocodificación. Los tiempos salen optimistas en hora punta → corregir con un factor calibrado con los tiempos reales.

---

## 3. Tabla comparativa
[s] = snippet del buscador.

| Plataforma | 1 Inicio/fin | 2 Pickup–delivery | 3 Ventanas/servicio/tráfico | 4 Prioridad | 5 Capacidad | 6 Ajuste manual | 7 Interfaz | 8 Algoritmo |
|---|---|---|---|---|---|---|---|---|
| Onfleet | Hub/casa/anywhere | `dependencies` | Blandas con coste; tráfico histórico [s] | 0-499 (ROv3) | 1 dim; decimales ND | Arrastre [s]; bloqueo ND | Mapa+tabla, columnas [s] | ND |
| Routific | End opcional | Endpoint `pdp`, `type` en salida | 2 ventanas; factor de tráfico global | 1-10 000 (no en PDP) | Multi-dim, Number | Arrastre, bloqueo de ruta, `/fix` | Mapa+timeline; unserved con motivo | «Bees» (prensa) |
| OptimoRoute | Por conductor | `relatedOrderNo` | Duras; **sin tráfico al planificar** | L/M/H/C | 4 dims | Arrastre, best fit, lock rutas | Timeline+mapa; Not Scheduled con motivo [s] | ND |
| Route4Me | Any/round trip/last | Joint (inmediato) o por tipo | Segundos; add-on predictivo [NV] | 1-65 535 | Peso/volumen/piezas, float | Arrastre, re-optimize | Comparación lado a lado, columnas | Solo taxonomía |
| Spoke | Por conductor (API) | `activity` + pares enlazados | ETA en intervalo; tráfico ND | first/last | Solo peso; ignora pickups posteriores [s] | Orden relativo | Lista + lazo en mapa | ND |
| Samsara | Inicio y última fijos [s] | ND | Servicio = media real en sitio [s] | ND | Mencionada | NV | NV | ND |
| Bringg | Inicio/fin/casa | Tipos de parada | Tráfico predictivo+real opcional | Rank | Longitud/peso/unidades | Arrastre + **reloj rojo** | Timeline+mapa, KPIs, columnas | ND |
| Descartes | ND | ND | Tráfico histórico+actual | ND | Cubo/peso | Arrastre | Mapa | «continuo», ND |
| Shipday | Mismo sitio [NV] | Emparejado (marketing) | Ventanas+servicio | VIP | Capacidad+peso | Arrastre | Mapa Google | ND |
| Google Route Opt. | start≠end por vehículo | Nativo en `Shipment` | Duras+blandas; `considerRoadTraffic` | `penaltyCost` | Multi-dim **int64** | Inyectar/congelar/refrescar | — (motivos codificados) | ND |
| OR-Tools | starts[]/ends[] | `AddPickupAndDelivery` | Dimensión de tiempo; matriz propia | Penalización de disjunction | Multi-dim **int64** | ApplyLocks, solución inicial | — | CP + LS + GLS (documentado) |
| VROOM | start/end opcionales | `shipments` | Múltiples ventanas, setup+service | 0-100 | Multi-dim **enteros** | `steps` fijados + violations | — (sin motivo) | ND |

---

## 4. Recomendaciones para RTG

**Copiar**
- Inicio y fin **por vehículo e independientes**, con retorno opcional (Routific, Spoke, Google). Encaja con choferes que salen de tiendas distintas.
- Par pickup–delivery como objeto único (Google `Shipment`, Routific `pdp`), no dos paradas sueltas enlazadas.
- Ventanas duras + blandas con coste de retraso (Onfleet, Google) en vez de factible/infactible a secas.
- «Best fit» al soltar sobre un chofer (OptimoRoute, Routific): inserción más barata del par; barata de implementar y muy visible.
- Aviso visual inmediato al romper una ventana (reloj rojo de Bringg) y KPIs de la ruta recalculados tras cada arrastre.
- Panel de no asignadas **con motivo** (OptimoRoute, Routific, códigos de Google). Los códigos de `SkippedShipment` son un buen vocabulario inicial.
- Bloqueo de ruta / prefijo ejecutado y reoptimizar el resto (OptimoRoute `lockType`, Google `injectedSolutionConstraint`, OR-Tools `ApplyLocks`).
- Columnas configurables y línea de tiempo por chofer (Bringg, OptimoRoute).

**No aplica a su tamaño**
- Clustering territorial, planificación multi-día, optimización continua en segundo plano (Descartes), turnos complejos.
- Matriz completa con tráfico de Google a diario (~$400/mes): desproporcionado para 40 órdenes.
- Metaheurísticas de última generación (HGS): con ~40 pares, inserción + LNS/GLS en 10-30 s es suficiente.

**Arquitectura sugerida**
- Motor: **OR-Tools** (el mejor documentado; PDPTW + disjunctions + locks) o **VROOM** (más simple, HTTP/JSON, PDPTW nativo). En ambos **escalar pallets ×100 a enteros**. Alternativa sin mantener motor: Google Route Optimization, que a este volumen cae en la franja gratuita (≈880 shipments/mes < 1 000), también con enteros.
- Tiempos: matriz base de OSRM/Valhalla (gratis) o Essentials, y **tráfico solo donde importa**: `computeRoutes` TRAFFIC_AWARE por ruta final (≤8 peticiones por corrida) con `departureTime` futuro.

**Ideas que darían ventaja (ninguna plataforma las documenta)**
- **Secuencia etiquetada P1/D1 emparejada**: ninguna plataforma documenta cómo muestra el par; es un hueco real.
- **Explicabilidad por decisión**: por qué esta orden va con este chofer, cuánto costaría moverla, qué restricción la dejó fuera. Solo se encuentran motivos de no asignación, nunca de asignación.
- **Comparación contra la ruta manual del despachador**: evaluar su secuencia con el mismo modelo (equivalente a `refreshDetailsRoutes`) y mostrar km, horas y retrasos lado a lado. Genera confianza y datos.
- **Tiempos de servicio calibrados** con los tiempos reales que la app ya registra, por cliente / tipo de carga / pallets (Samsara solo usa una media por sitio).
- **Tráfico proyectado en cascada**: pedir cada tramo con `departureTime` = hora estimada de salida de la parada anterior; iterar una o dos veces. Coste: tantas llamadas como tramos, no una matriz.
- Capacidad que **sí cuente los pickups posteriores** (Spoke declara que no lo hace): en PDP la carga sube y baja a lo largo de la ruta.
- Guardar cada corrida (entrada, límites, salida) para reproducibilidad, dado que el determinismo de los motores no está garantizado.

---

## 5. Afirmaciones que no pude verificar
1. Todo lo marcado [snippet] de Onfleet, OptimoRoute y Samsara (centros de ayuda con 403).
2. Soporte de **decimales en capacidad** en Onfleet, Routific, OptimoRoute, Spoke, Bringg, Descartes y Shipday. Verificado solo: Route4Me float64 (SDK), y enteros en Google Route Optimization, OR-Tools y VROOM.
3. Cómo muestra cada plataforma el par pickup–delivery en la secuencia (ninguna lo documenta).
4. Bloqueo de una **parada individual** y advertencias al romper restricciones (solo Bringg documenta el reloj rojo; hay una frase contradictoria sobre si permite soltar fuera de ventana).
5. Si el tráfico es realmente predictivo por hora en Onfleet, Spoke, Samsara, Shipday y en el add-on de Route4Me.
6. Algoritmos de todas las plataformas comerciales; el «Bees Algorithm» de Routific es prensa de 2016; los internos de VROOM no figuran en su doc.
7. Determinismo de OR-Tools y de Google Route Optimization (sin garantía documentada).
8. Texto literal de `SetCumulVarSoftUpperBound`; tipo exacto `int` de capacidad en jsprit; edición de Timefold que incluye Score Analysis.
9. RAM de OSRM/Valhalla para Texas (extrapolada) y licencias de OSRM, Valhalla y OR-Tools (de memoria).
10. Referencias bibliográficas clásicas (Solomon, Clarke-Wright, Croes, Or, Savelsbergh, Taillard, Voudouris) citadas de memoria.
11. Umbral exacto Essentials/Pro por número de waypoints intermedios (la página dice máx. 10 en Essentials; el tope superior no se leyó).
12. Las estimaciones de coste mensual para RTG son cálculo propio sobre los precios publicados, no cifras de Google.
13. Descartes (sin manuales públicos, PDF ilegible) y Shipday (casi todo marketing) quedan muy poco documentados.
14. La descripción de Route4Me sacada de route4me.io/docs puede estar contaminada: el resumidor repitió parte de mi pregunta; los enums sí se confirmaron en el SDK de Go.
