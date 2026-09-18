# PLAN 133 — Las tablas de plan, el borrador y «Publicar ruta»

> Plan en papel **antes** de escribir el `.sql` y la ruta de servidor, como pide `CLAUDE.md`. **Nada de esto
> está escrito todavía**: es lo que se propone, para aprobar. Fecha: 2026-09-18, sobre `main` = 404ea02.
> Diseño: `docs/route-algorithm-design.md`, §6.3 y §7. Es el incremento 4.

## 1. Qué se pide

Que «Planificar el día» guarde un plan **en borrador** —que no toca ninguna orden ni avisa a nadie— y que
«Publicar ruta» lo escriba en las órdenes y mande **un aviso por chofer**. Y que el plan quede guardado entero,
con su entrada, porque sin eso no hay comparación posible contra la hoja del despachador.

## 2. Lo medido, y lo que condiciona el diseño

- **Quién escribe en `deliveries` hoy** (vigente: la 131, que partió la antigua política `ALL`):
  `deliveries update` = `has_deliveries_access()`, y encima el guard. **Vigente el guard de la 127.** Logística
  no tiene ninguna transición de etapa; sí edita en misma etapa en `draft…ready` (`125:160`, que la 127 conserva)
  — justo las etapas ruteables (`routes/page.tsx:59`: pending, approved, fulfilling, ready). El admin se salta
  los permisos del guard. **Publican admin y logística** (§11, decisión 13): los dos pueden escribir
  `assigned_driver`, `route_seq`, `load_no` y `load_auto` sin mover la etapa. No hace falta tocar el guard.
- **Un UPDATE solo alcanza las filas que quien escribe puede VER.** Desde la 131 la lectura se acota por tienda
  (`tiendas_visibles()`, `131:207-235`). Si quien publica tuviera tiendas marcadas, las órdenes de otras tiendas
  no se actualizarían y **PostgREST volvería limpio, con cero filas** (D-310 ya tropezó con eso). Por eso
  publicar **cuenta las filas** de cada escritura y, si alguna orden del plan no se escribió, **no da el plan por
  publicado** y dice cuáles.
- **El aviso por asignación vive dentro de `updateDelivery`**, en el cliente (`data-provider.tsx:1017`). Publicar
  por ese camino serían 14 avisos. Publicar va por **una ruta de servidor propia**, que no pasa por ahí.
- **`notifications`**: leer = las propias; insertar = cualquiera con sesión (`001`). Un `INSERT … RETURNING` de
  una fila ajena falla (D-308): el id se genera antes y no se pide la fila de vuelta.
- **`/api/push`** lee la notificación por id con la llave de servicio y empuja a los dispositivos del
  destinatario: sirve tal cual para un `kind` nuevo.
- **`assigned_driver` es el nombre** y no se toca (D-316). El plan guarda `driver_id` y `driver_name`.

## 3. Las tablas (migración 133)

**`route_plans`** — una fila por corrida (o, más adelante, por hoja importada).

| Columna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `plan_date` | date | |
| `status` | text | `draft` · `published` · `superseded` · `discarded` |
| `version` | int | 1, 2, 3… dentro de la fecha; lo pone la base |
| `source` | text | `engine` · `manual_edit` · `manual_import` |
| `algorithm_version` | text | |
| `params` | jsonb | pesos, ventanas duras, tope, topes de cómputo: **copia** de los de Ajustes en ese momento |
| `input` | jsonb | la foto de la entrada: órdenes (con su `updated_at`), choferes, **matriz y `porHora`** |
| `result` | jsonb | el desglose del coste, lo sin asignar con su motivo, las explicaciones |
| `provider`, `traffic`, `converged` | text, bool, bool | con qué tiempos se hizo y si terminó |
| `total_minutes`, `total_miles`, `late_minutes`, `unassigned_count` | | lo que se compara lado a lado |
| `parent_plan_id` | uuid | de qué borrador salió |
| `created_by`, `created_at`, `published_by`, `published_at` | | los pone la base |

Restricción: **un solo `published` por fecha** (índice único parcial). Publicar otro pasa el anterior a
`superseded` **en la misma sentencia**, dentro de una función.

**`route_plan_stops`** — una fila por parada: `plan_id`, `driver_id`, `driver_name`, `seq`, `kind` (`P`/`D`),
`delivery_id`, `label` (P1, D1…), `visit`, punto (`place`, `lat`, `lng`), ventana y `is_hard`, `eta`, `etd`,
`wait_min`, `service_min`, `late_min`, `load_after numeric`, `leg_minutes`, `leg_miles`, `pinned`, y
`actual_arrival_at` / `actual_departure_at` vacías (las llenará la calibración).

**Sin tabla aparte para lo sin asignar:** va en `route_plans.result`. Son pocas filas, nunca se consultan
sueltas, y una tabla más es una política más que ensayar.

## 4. Quién lee y quién escribe

| | Lee | Escribe |
|---|---|---|
| admin, logística | todos los planes | crean, editan borradores, publican, descartan |
| gerente, office | todos los planes | no |
| almacén | **solo los publicados** (§11, decisión 12) | no |
| chofer | **nada, en este incremento** | no |
| ventas | nada | no |

El chofer sigue viendo su día por `deliveries`, como hoy (D-021): publicar escribe ahí lo mismo que escribe el
Gestor. La lectura de **sus** paradas del plan publicado se le abre en el incremento 5, con su propio ensayo.

Políticas: una por comando, **ninguna `FOR ALL`**; `revoke all` antes del `grant`; todas piden
`has_deliveries_access()`. **Un plan publicado no se edita ni se borra:** ni política ni permiso para ello, y un
disparador que lo rechaza también a la llave de servicio, con una sola excepción — pasar de `published` a
`superseded`. Un borrador sí se edita y se descarta.

## 5. Publicar: qué escribe, en qué orden, y cómo se evita el medio publicado

> **Reescrito.** La primera versión de esta sección publicaba con varias llamadas a PostgREST y **deshacía a
> mano** si algo fallaba, porque la única alternativa que veía —una función `security definer`— se saltaba la
> RLS y el guard de quien publica. El orquestador propuso la tercera vía, que es la que se hizo: una función
> plpgsql **`SECURITY INVOKER`**. Corre con los permisos de quien llama —valen su RLS y `guard_delivery_stage`—
> y es una sola transacción: o entra todo o no entra nada. El deshacer a mano desaparece.

La ruta `/api/route-plan/publish`, con **la sesión de quien publica** (nunca la llave de servicio), hace dos
cosas: decide **a quién se avisa** —compara parada a parada con el plan publicado que este sustituye— y llama
a `publish_route_plan(p_plan, p_avisos)` por `rpc`. No escribe nada por su cuenta. La función, en orden:

1. **Rol:** admin o logística con acceso a Entregas. Si no, `ROUTE_PLAN_FORBIDDEN`.
2. **Bloquea** (`for update`) el plan y el publicado vigente de esa fecha. El plan tiene que existir
   (`NOT_FOUND`) y ser un borrador (`NOT_DRAFT`).
3. **Valida los avisos ANTES de escribir nada:** cada chofer tiene que ser de este plan o del que se
   sustituye, y el texto medir entre 1 y 300. Si no, `BAD_NOTICE`. La función es la que inserta en
   `notifications`, así que no se fía de lo que le pasen.
4. **No está viejo.** Compara cada orden con la foto guardada en `input->'ordenes'`: `no_esta`,
   `fuera_de_etapa` o `cambio`. Si hay alguna, `ROUTE_PLAN_STALE` con la lista, y no publica.
5. **Escribe cada orden de `writes`**, y solo `assigned_driver` (el **nombre**), `route_seq`, `load_no` y
   `load_auto`. Cuenta filas con `get diagnostics`: si el UPDATE alcanzó menos órdenes de las que tenía que
   escribir —un UPDATE solo llega a lo que quien publica puede LEER (131)—, `ROUTE_PLAN_UNSEEN`, y la
   transacción entera se deshace.
6. **Marca** el vigente `superseded` y este `published`. El disparador `guard_route_plan` solo deja pasar a
   `published` desde dentro de esta función (bandera `app.route_publishing`, local a la transacción).
7. **Avisa: una notificación por chofer**, `kind = 'route_published'`, con el id generado en una variable
   (sin `RETURNING`: D-308). Devuelve `{plan_id, written, notifications}`; el push lo lanza el cliente con
   esos ids, por `/api/push`, como el aviso de asignación. Al **re-publicar**, solo a quien le cambió la lista
   o el orden, y a quien se quedó sin ninguna parada.

**Las órdenes sin asignar del plan no se tocan:** conservan lo que tuvieran. Se dice antes de confirmar.

**Una orden repartida en varias cargas se publica como UNA fila**, con el chofer y la posición de su primera
entrega. Partirla en filas reales (a/b/c) es un incremento propio, al final. La pantalla lo dice.

**La asignación a mano, fuera de publicar, sigue avisando como hoy.** D-032 no se retira.

## 6. Qué NO debe romperse

- «Mi ruta», el mapa, la ruta del día de almacén y el manifiesto: leen `assigned_driver`, `route_seq`, `load_no`.
  Publicar escribe exactamente eso, con el mismo significado.
- El aviso por asignación a mano (D-032/D-308).
- El Gestor de Rutas de hoy: **sigue ahí entero.** «Planificar el día» se añade al lado.
- Que un chofer solo vea lo suyo (131).

## 7. Matriz de ensayo por rol, con `ROLLBACK`

| | Caso | Resultado |
|---|---|---|
| A | admin / logística: crean un borrador, le añaden paradas, lo editan, lo descartan | PERMITIDO |
| A | publicar (la función): el borrador pasa a `published`, el publicado anterior a `superseded`, en una sentencia | PERMITIDO; nunca dos `published` para una fecha |
| A | editar o borrar un plan `published`; editar sus paradas | BLOQUEADO (permiso y disparador) |
| B | gerente / office: leen todo; crear, editar, publicar | leen; BLOQUEADO |
| C | almacén: lee un publicado; lee un borrador; escribe | lo ve; 0 filas; BLOQUEADO |
| D | chofer y ventas: leen | 0 filas |
| E | service role: editar un plan publicado | BLOQUEADO (disparador) |
| F | `created_by`, `version`, `published_by/at` mandados por el cliente | los pisa la base |

## 8. Reversión

`drop` de las dos tablas y de las funciones. **Borra los planes guardados.** Lo que publicar escribió en
`deliveries` se queda: son asignaciones válidas, las mismas que habría hecho el Gestor.

## 9. Lo que este diseño NO cubre, dicho

- **Nada de esto ha corrido contra una base.** La rama no tiene cómo. Tres cosas concretas que el ensayo con
  `ROLLBACK` tiene que mirar, porque las sostiene solo la lectura: que un `authenticated` pueda hacer
  `set_config('app.route_publishing', …, true)` dentro de la función y que el disparador la lea; que el
  `for update` pase con la política de SELECT de `route_plans`; y que `guard_delivery_stage` (127) deje a
  logística escribir esas cuatro columnas en las etapas ruteables.
- **Dos personas publicando a la vez.** Ya no deja nada a medias: el `for update` pone a la segunda en cola, y
  cuando entra su borrador sigue siendo borrador pero el «vigente» es el de la primera; publica encima y la
  sustituye. Gana la última. Es coherente; puede no ser lo que querían.
- **Las horas del plan publicado son las de cuando se planificó.** Publicar no vuelve a pedir tráfico.
- **Quien publica con tiendas marcadas.** Leído en la 131 (`:134-147`): `tiendas_visibles()` devuelve `null`
  —sin acotar— para **admin** siempre, y para cualquier otro rol **mientras no le marquen tiendas**
  (`profiles.visible_stores`). O sea: a una persona de **logística** con tiendas marcadas le quedarían órdenes
  fuera de la vista, y un UPDATE no las alcanzaría. El paso 5 lo detecta (`ROUTE_PLAN_UNSEEN`) y no publica nada, pero esa
  persona no podría publicar ese día. Dos salidas, a elegir: no marcarle tiendas a quien publica (barato, es
  una norma), o que planificar ya le enseñe solo lo que ve y publique solo eso (coherente, y entonces dos
  despachadores con tiendas distintas publican cada uno lo suyo — que es otro diseño). **Propongo lo primero**,
  y que la pantalla lo diga si detecta que quien entra tiene tiendas marcadas.
