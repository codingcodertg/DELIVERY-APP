# Plan — 142 · Almacén solo lo suyo, la ventana de fechas vuelve, y la vista de recepción

**Estado:** RESUELTO el 2026-09-23 — ver la entrada **D-NEXT** de `DECISIONS.md`, que es lo que
manda. Este plan se deja entero porque es de donde salieron las mediciones, pero **construido no
está todo lo que hay aquí**:

- Se construyó: el corte de almacén por tienda, la vista de Recepción, ventas solo lo suyo, y la
  vuelta de la ventana de fechas.
- **Se descartó entero lo de la base: §5, §7 y §8, y NO hay migración 142.** Una ventana en la
  política de lectura cortaría la búsqueda por factura (que es el camino al historial), las
  lecturas de planificación de rutas, y dejaría la casilla de Usuarios sin significado. La base
  decide **si** puedes leer una orden; la pantalla, **en qué lista sale**.
- La ventana elegida es la de **D-239** (`withinRetention`: suelo, sin techo), no la de «Reciente».

Lo de abajo queda como estaba el día que se escribió. **No se edita para que cuadre**: si algo de
aquí contradice a D-NEXT, manda D-NEXT.

---

**Fecha:** 2026-09-23 · **Rama:** `visibilidad-almacen-y-ventana` desde `b7182e21`.
**Molde:** `docs/PLAN-A-2a-profiles-rls.md`.
**Prerrequisito:** respaldo antes de aplicar (CLAUDE.md). Aquí la reversión es una política, así que
lo que de verdad hace falta es **la definición literal de la política de hoy**, guardada antes de
tocarla — está copiada en §9, leída del repo, y hay que **confirmarla contra `pg_policies`** antes
de aplicar.

---

## 0. Qué medí, qué NO pude medir, y una cosa que hay que preguntarle al dueño

Todo lo de aquí sale de **leer el código de `b7182e21`**: las migraciones, `src/lib` y las pantallas.
Cada afirmación lleva `fichero:línea`.

**Lo que NO puedo medir desde una rama, y es tuyo:** cuántas órdenes reales hay hoy en cada caso.
Ninguna cifra de producción de este documento la he contado yo — **no hay ninguna**, y donde hace
falta una, va el SQL para que la corras. Una rama no toca producción ni para leer.

> ### La pregunta que decide el dueño, y no yo
>
> El dueño dijo *«ayer, hoy y mañana y atrasadas»*. **Eso NO es la ventana de D-239**, que es
> «desde ayer, **sin techo**» (`withinRetention`, `utils.ts:359-365`: solo hay suelo). Es el chip
> **«Reciente»** de D-350/D-351 (`withinRecent`, `utils.ts:411-416`), que sí tiene techo en mañana.
>
> **Consecuencia:** un vendedor que crea hoy una orden para el lunes que viene **deja de verla en
> cuanto la guarda**. No se pierde —sigue en la base, sale buscando, y reaparece el domingo— pero
> desaparece de su lista, y quien la creó no lo espera.
>
> **La cuenta que hace falta antes de decidir**, para saber si eso son dos órdenes o doscientas:
>
> ```sql
> select count(*) filter (where stage not in ('delivered','canceled'))              as vivas_mas_alla_de_manana,
>        count(*) filter (where stage not in ('delivered','canceled') and delivery_date > (now() at time zone 'America/Chicago')::date + 7) as vivas_a_mas_de_una_semana,
>        min(delivery_date), max(delivery_date)
>   from public.deliveries
>  where delivery_date > (now() at time zone 'America/Chicago')::date + 1;
> ```
>
> **Tres salidas, y la elección es del dueño:**
> 1. **Literal**: ayer, hoy, mañana y atrasadas. Lo que pidió, con la consecuencia de arriba.
> 2. **Con suelo y sin techo** (lo de D-239): de ayer en adelante. Cumple «no ver historial viejo»,
>    que es de lo que se quejaba, y **no esconde nada futuro**.
> 3. **Literal, más las propias**: la ventana de (1), y además **siempre tus propias órdenes**
>    (`orderOwner`), tengan la fecha que tengan. Quien la creó no la pierde nunca; nadie ve más de
>    otro. Cuesta una cláusula más en la política.
>
> **Mi recomendación es la 3**, y la razón es la queja concreta: lo que molesta es *«veo entregadas
> de agosto»*, no *«veo lo que yo programé para el lunes»*. La 2 no arregla del todo eso —una
> entregada de ayer sigue estando— y la 1 esconde trabajo propio, que es el fallo que D-351 ya vino
> a corregir una vez («una vencida sin entregar es trabajo vivo, y esconderla es perderla»).

---

## 1. Qué ve cada rol HOY, y dónde se decide

| Rol | Corte por **tienda** | Corte por **rol/etapa** | Corte por **fecha** |
|---|---|---|---|
| **admin** | ninguno (`tiendas_visibles()` → null, `131:138`) | ninguno | ninguno |
| **logistics** | `visible_stores` si se la marcaron | ninguno | ninguno |
| **manager / accounting** | `visible_stores` si se la marcaron | ninguno | ninguno |
| **sales** | `visible_stores` si se la marcaron | **solo en pantalla**: `ventasVeLaOrden` + nunca anuladas (`ordenes-visibles.ts:49-59`) | ninguno |
| **warehouse** | **ninguno en la base** (`131:138` lo exime) · sí en **su cola** (`warehouse/page.tsx:47-57`) | etapas ≥ `approved`, en la base (`131:215`) y en pantalla (`ordenes-visibles.ts:60`) | ninguno |
| **driver** | ninguno | propias o asignadas, en la base (`131:213-214`) | sí, en su pantalla (`driver/page.tsx:59`) |

**La ventana de fechas no existe hoy para nadie.** No es que esté relajada: **está muerta**. D-356
le dio la capacidad `history` a **los siete roles** en `ROLE_CAPS` (`constants.ts:830-843`), y
`seesAllHistory` devuelve `true` en cuanto el rol la tiene (`utils.ts:398-402`). Así que:

- `pasaLaVentana` sale por `veTodoElHistorial` y nunca llega a `withinRetention` (`ordenes-visibles.ts:77`);
- y en la cola de almacén, la línea que filtra por fecha (`warehouse/page.tsx:92`) **no filtra nunca**.

**Y hay un hueco que conviene ver de frente:** el corte de ventas (`ventasVeLaOrden`) **vive solo en
la pantalla**. La base no lo conoce. Un vendedor que llame a PostgREST directamente recibe las
órdenes de sus compañeros, acotadas solo por `visible_stores` si se la marcaron. Eso ya era así
antes de este encargo; lo digo porque la petición de hoy **cambia lo que ventas ve** y es el momento
de decidir si ese corte baja a la base o se queda arriba (§2).

---

## 2. Las cuatro reglas nuevas, y dónde tiene que vivir cada una

| # | Regla | Dónde | Por qué ahí |
|---|---|---|---|
| 1 | **Ventana de fechas** para todos menos admin y logística | **BASE** + pantalla | Es lo que el dueño llama «la regla». En la base se cumple para cualquiera que pida datos; en la pantalla, para que las cuentas y los chips digan lo mismo que la tabla |
| 2 | **Almacén, solo su tienda** (y su grupo, D-293) | **BASE** + pantalla | Hoy la base no lo acota **nada**: es el cambio que más superficie cierra |
| 3 | **Ventas: solo lo suyo, en cualquier tienda** | **pantalla** (y ver abajo) | Ya vive ahí y funciona; bajarlo a la base exige leer `settings.order_type_rules` por fila, que es lo que la 080 vino a quitar |
| 4 | **Vista de recepción** de almacén | **pantalla** | Es un reparto de lo que ya se ve en dos listas, no un permiso nuevo |

**La 3, dicha entera para que se decida a sabiendas.** El dueño pide que ventas vea **solo sus
propias órdenes** y **en cualquier tienda**. Eso es más estrecho por un lado (adiós a las de los
compañeros) y más ancho por otro (adiós al límite de tienda). En la base:

- lo **ancho** es fácil: quitarle a `sales` el filtro de `visible_stores` es una rama más en
  `tiendas_visibles()`;
- lo **estrecho** —«solo las suyas»— necesitaría `created_by = auth.uid() or assigned_sales_rep = …`,
  **más** la excepción de los borradores (D-286) y la de tienda-a-tienda (D-309), y esta última
  depende del **tipo de orden**, que vive en un `jsonb` de `settings`. Leerlo por fila en la tabla
  más leída de la app es exactamente lo que la 080 vino a quitar, y el comentario de `131:237-243`
  lo dice con todas las letras.

**Propuesta:** en la base, a `sales` se le **quita** el filtro de tienda (queda como el admin en esa
cláusula) y el corte de «solo las suyas» **sigue en la pantalla**, donde ya está probado. Es un
techo más ancho que la app, que es el único error que la 131 se permite —«enseñar de más» arriba y
que el corte de la app siga decidiendo—. **Si el dueño quiere que la base también lo cierre**, es
otro encargo: hay que sacar `storeToStore` del jsonb a una columna, y eso es una migración de datos.

---

## 3. «Lo que almacén tiene a su cargo», con datos

Hoy su cola ya contesta a esa pregunta, y la respuesta es **más ancha de lo que suena**
(`warehouse/page.tsx:67-79`): una orden es suya si **cualquiera** de las tres tiendas de la orden es
la suya o la de su grupo (`tiendasDeLaOrden`, D-309), **o** si la dirección de recogida es la de su
tienda.

O sea que hoy ve, en la misma lista: lo que **sale** de su tienda, lo que **entra** a su tienda, y
lo que se **recoge físicamente** allí aunque se venda desde otra.

**Lo que el dueño pide es partir eso en dos**, no estrecharlo: lo que sale se queda en su lista, y
lo que entra se va a «Recepción». Así que *«lo que tiene a su cargo»* = **lo que sale de su tienda**
= `store` o `pickup_name` es la suya (o la dirección de recogida). Y lo que entra —`delivery_name`
es la suya— es la otra lista.

**Lo que NO cambia y conviene decirlo:** el corte de etapas. Almacén sigue sin ver nada anterior a
`approved` (`131:215`), porque una orden sin aprobar no es trabajo suyo.

---

## 4. La vista de recepción: qué campo NO miente

El dueño lo dijo por la cuenta: *«if account in intertienda is my store then put that under
receiving»*. Medido, **la cuenta es una copia del destino, no el destino**:

- `order-sites.ts:110` — en un tipo tienda-a-tienda, `account = delivery_name`. Por construcción,
  desde D-312, **coinciden**.
- Pero la cuenta es **texto libre que la persona puede teclear encima** (`OrderModal.tsx:1873`), y
  nada la devuelve a `delivery_name` salvo que se vuelva a elegir el destino.
- Y las órdenes **anteriores a D-312** venían del modelo de D-302, donde `store` era la tienda que
  **recibía**; ahí la cuenta puede decir cualquier otra cosa.

**Conclusión: el campo que manda es `delivery_name`.** La cuenta es lo que el dueño *ve* y por eso
lo dijo así, pero el que implementa esa frase sin mentir es el destino. Es la misma elección que ya
hizo la 131 al mirar las tres columnas y no solo `store`.

**La cuenta que hace falta para confirmarlo** —y esto también es tuyo, no mío:

```sql
select count(*)                                                          as intertiendas,
       count(*) filter (where lower(btrim(coalesce(account,''))) = lower(btrim(coalesce(delivery_name,'')))) as cuenta_igual_destino,
       count(*) filter (where btrim(coalesce(delivery_name,'')) = '')     as sin_destino
  from public.deliveries
 where order_type = 'Intertienda';
```

Si `cuenta_igual_destino` es el total, las dos frases dicen lo mismo y se usa `delivery_name` con
tranquilidad. **Si no**, las que difieren son justo las que hay que mirar a mano antes de decidir:
puede que la cuenta esté bien y el destino vacío, y entonces la vista de recepción se las perdería.

---

## 5. Las políticas (literales), partiendo de la VIGENTE

La definición de hoy está en `131:207-248` y se copia entera abajo con **dos cláusulas nuevas**. Lo
de arriba no se toca.

### 5a · Los dos helpers nuevos

```sql
-- Las tiendas cuya cola prepara un almacenista: la suya y las de su grupo de trabajo (D-293).
-- Devuelve el ARRAY y no un si-o-no por fila, por la razón de `tiendas_visibles()`: `deliveries` es
-- la tabla más leída y un helper por fila es lo que la 080 vino a quitar. Null = sin acotar.
create or replace function public.tiendas_de_almacen()
  returns text[] language sql stable security definer set search_path = public as $$
  select case when p.role <> 'warehouse' or btrim(coalesce(p.store, '')) = '' then null
         else (select array_agg(distinct lower(btrim(s->>'name')))
                 from public.settings cfg
                 cross join lateral jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) as s
                where cfg.id = 1
                  and ( lower(btrim(s->>'name')) = lower(btrim(p.store))
                        or ( nullif(btrim(s->>'group'), '') is not null
                             and lower(btrim(s->>'group')) = (
                               select lower(btrim(s2->>'group'))
                                 from jsonb_array_elements(coalesce(cfg.stores, '[]'::jsonb)) as s2
                                where lower(btrim(s2->>'name')) = lower(btrim(p.store)) limit 1) ) ) )
         end
    from public.profiles p where p.id = (select auth.uid());
$$;
revoke execute on function public.tiendas_de_almacen() from public, anon;
grant  execute on function public.tiendas_de_almacen() to authenticated;

-- Quién queda FUERA de la ventana de fechas. Espejo de `seesAllHistory` (utils.ts:398), pero con la
-- lista de D-239 y NO con `ROLE_CAPS`: la capacidad `history` es de la pantalla y un admin la puede
-- marcar; la ventana de la base es una regla del dueño, no una casilla.
create or replace function public.ve_todo_el_historial()
  returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin','logistics') from public.profiles where id = auth.uid()), false);
$$;
revoke execute on function public.ve_todo_el_historial() from public, anon;
grant  execute on function public.ve_todo_el_historial() to authenticated;
```

### 5b · La política, con las dos cláusulas nuevas al final

```sql
alter policy "auth read deliveries" on public.deliveries
  using (
    (select public.has_deliveries_access())
    and ( is_training
      or case (select p.role from public.profiles p where p.id = (select auth.uid()))
           when 'driver' then (created_by = (select auth.uid())
                               or assigned_driver = (select p.full_name from public.profiles p where p.id = (select auth.uid())))
           when 'warehouse' then (stage = any (array['approved','fulfilling','ready','picked_up','delivered']))
           else true
         end )
    and ( is_training
      or (select public.tiendas_visibles()) is null
      or btrim(coalesce(store, '')) = ''
      or lower(btrim(coalesce(store, '')))          = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(pickup_name, '')))    = any ((select public.tiendas_visibles())::text[])
      or lower(btrim(coalesce(delivery_name, '')))  = any ((select public.tiendas_visibles())::text[]) )

    -- NUEVA 1 · Almacén, solo sus tiendas. Las TRES columnas, como la cláusula de arriba: una
    -- Intertienda que su tienda recibe también es suya (va a «Recepción», pero la tiene que ver).
    and ( is_training
      or (select public.tiendas_de_almacen()) is null
      or lower(btrim(coalesce(store, '')))         = any ((select public.tiendas_de_almacen())::text[])
      or lower(btrim(coalesce(pickup_name, '')))   = any ((select public.tiendas_de_almacen())::text[])
      or lower(btrim(coalesce(delivery_name, ''))) = any ((select public.tiendas_de_almacen())::text[]) )

    -- NUEVA 2 · La ventana de fechas. `delivery_date` es `date` (014:27), así que se compara con
    -- fechas y no con texto. El día se calcula en America/Chicago, como hace la 086 y como hace
    -- `todayISO()` en el cliente: con `current_date` a secas, durante varias horas al día el
    -- servidor y la pantalla no dirían el mismo «hoy».
    and ( is_training
      or (select public.ve_todo_el_historial())
      or delivery_date is null                                   -- sin fecha: se está programando
      or (stage not in ('delivered','canceled')
          and delivery_date < (now() at time zone 'America/Chicago')::date)   -- atrasada y viva
      or (delivery_date >= (now() at time zone 'America/Chicago')::date - 1
          and delivery_date <= (now() at time zone 'America/Chicago')::date + 1)
      -- SI EL DUEÑO ELIGE LA OPCIÓN 3 de §0, aquí va una línea más:
      -- or created_by = (select auth.uid()) or assigned_sales_rep = (select auth.uid())
    )
  );
```

**Y `tiendas_visibles()` gana una rama** para que a ventas deje de acotarla la tienda (§2, regla 3):

```sql
-- `sales` se suma a los que no se filtran por tienda: el dueño quiere que vea LO SUYO en cualquier
-- tienda. Lo de «solo lo suyo» sigue en la pantalla (`ventasVeLaOrden`), y el porqué está en §2.
when p.role in ('admin', 'driver', 'warehouse', 'sales') then null
```

---

## 6. Lo que NO debe romperse

| Cosa | Cómo funciona | Contra el plan |
|---|---|---|
| El chip «Reciente» (D-350/D-351) | `withinRecent` en la pantalla | La cláusula nueva 2 **es** esa regla. Si se elige la opción 1 de §0, «Reciente» y «Todas» pasan a enseñar lo mismo para casi todos — hay que decirlo, o el chip miente |
| «Ver todas las órdenes» en Usuarios (D-350) | capacidad `history` por persona | **Deja de poder abrir la ventana**: la base no la mira. O se quita de Usuarios, o se explica que solo afecta a la pantalla. **Pregunta para el dueño** |
| D-356 | dio `history` a los siete roles | Se **revierte en parte**: hay que quitarla de `ROLE_CAPS` salvo admin y logística, o la pantalla seguirá enseñando lo que la base ya no manda, y la tabla saldría vacía sin explicación |
| La cola de almacén | ya acota por tienda en pantalla | La base pasa a hacer lo mismo. **Ojo**: hoy su `lockedToOwnStore` se salta para un admin previsualizando; la base **no** distingue eso — un admin viendo «como almacén» sigue siendo admin en la base, así que verá más que el almacenista. Es lo que ya pasa y conviene tenerlo escrito |
| El buscador como vía al historial | «buscar no tiene retención» (`ordenes-visibles.ts:79`) | **SE ROMPE.** Con la ventana en la base, buscar una factura vieja ya no la trae: la fila no llega. **Es el efecto secundario más grande de este encargo** y hay que decidirlo — ver §8 |
| Chofer | su propia rama, y su pantalla ya filtra | La ventana nueva es **más estrecha** que su `withinRetention`: un chofer dejaría de ver una parada de pasado mañana. Hay que decidir si el chofer entra en la ventana o no |
| `route_plan`, mapa, rastreo | leen `deliveries` | Todos heredan la ventana. Un plan de ruta para el lunes **no se podría leer** el viernes salvo por admin/logística. **Esto solo lo aguanta la opción 2 o la 3 de §0** |

> **El punto 5 y el 7 son la razón por la que este plan no se aplica sin respuesta del dueño.** Una
> ventana en la base no es «lo mismo pero más seguro»: **corta también el buscador y la planificación
> de rutas**, que hoy son las dos válvulas por las que se llega a lo que no está en la ventana.

---

## 7. Matriz de pruebas — se corre ANTES de aplicar, con `ROLLBACK`

Contra producción, en `begin … rollback`, haciéndose pasar por cada rol, como D-053/D-057/D-179.
**Ninguna prueba dispara efectos de terceros.** La corre el **orquestador**.

Leyenda: ✅ la ve · ⛔ no la ve.

| Orden \ Rol | admin | logistics | manager | accounting | sales (suya) | sales (de otro) | warehouse (su tienda) | warehouse (otra) | driver |
|---|---|---|---|---|---|---|---|---|---|
| hoy, su tienda | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ⛔ | según asignación |
| ayer, entregada | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ⛔ | — |
| **anteayer, entregada** | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **anteayer, SIN entregar** (atrasada) | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ⛔ | — |
| **mañana** | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ⛔ | — |
| **pasado mañana** | ✅ | ✅ | ⛔ | ⛔ | ⛔ *(✅ con la opción 3)* | ⛔ | ⛔ | ⛔ | ⛔ |
| **sin fecha** | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ✅ | ⛔ | — |
| Intertienda que su tienda **recibe** | ✅ | ✅ | ✅ | ✅ | — | — | ✅ (va a Recepción) | ⛔ | — |
| Intertienda de **otras dos** tiendas | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ | — |
| **sales con `visible_stores` marcadas**, orden suya de otra tienda | — | — | — | — | ✅ (ya no le acota la tienda) | — | — | — | — |
| pendiente de aprobar, su tienda | ✅ | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ (etapa) | ⛔ | — |

**Y las tres que prueban lo que el plan rompe**, que son las que hay que enseñarle al dueño:

| Caso | Hoy | Con el plan |
|---|---|---|
| buscar por factura una entregada de hace un mes, siendo office | la encuentra | **no llega la fila** |
| un plan de ruta del lunes, leído el viernes por un gerente | lo ve | **no lo ve** |
| «Ver todas las órdenes» marcada en Usuarios a un vendedor | abre la ventana | **no hace nada** |

---

## 8. Reversión

Todo es **una política y dos funciones nuevas**. Deshacerlo devuelve la política a su forma de hoy —
la de `131:207-248`, que hay que **confirmar contra `pg_policies` antes de tocar nada** y pegar aquí
tal cual salga.

```sql
begin;
-- 1. La politica, EXACTAMENTE como la dejo la 131 (confirmar contra pg_policies antes).
alter policy "auth read deliveries" on public.deliveries using ( … la de 131:207-248 … );
-- 2. `tiendas_visibles()` sin la rama de sales.
create or replace function public.tiendas_visibles() … ( … la de 131:134-147 … );
-- 3. Las dos funciones nuevas.
drop function if exists public.tiendas_de_almacen();
drop function if exists public.ve_todo_el_historial();
delete from public.schema_migrations where name = '142_visibilidad.sql';
commit;
```
Y en el código: devolver `history` a `ROLE_CAPS` para los cinco roles a los que D-356 se la dio.

---

## 9. Lo que hace falta ANTES de escribir una línea de SQL

1. **La respuesta del dueño a §0** (literal / con techo / literal + las propias). Sin eso, la
   cláusula de fechas no se puede escribir.
2. **Las dos cuentas de producción** (§0 y §4), que las corres tú.
3. **Decidir qué pasa con el buscador y con los planes de ruta** (§6): son los dos sitios donde la
   ventana en la base **quita algo que hoy funciona**.
4. **Decidir si el chofer entra en la ventana.** Hoy tiene la suya, más ancha.
5. **Confirmar la definición vigente de `auth read deliveries` contra `pg_policies`.** Lo de §5 está
   copiado del repo, y entre el repo y la base cabe un desfase.
