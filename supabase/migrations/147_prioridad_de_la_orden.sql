-- 147 - Prioridad por orden: baja, normal, alta, critica
-- ===========================================================================
-- El dueno, comparando con OptimoRoute (2026-09-26), pidio prioridad por orden ("las 3 haz"). OptimoRoute
-- tiene cuatro niveles (L / M / H / C: baja, media, alta, critica; docs/research-route-optimization.md).
--
-- Plan en papel: docs/PLAN-147-prioridad.md. ESCRITA Y NO APLICADA: aplicarla es del orquestador, despues
-- del merge, con respaldo hecho y migrate-status antes y despues.
--
-- Que trae, y SOLO esto:
--   Una columna nueva, public.deliveries.priority: text NOT NULL DEFAULT 'normal', con una restriccion que
--   admite solo 'low', 'normal', 'high' y 'critical' (deliveries_priority_allowed).
--   NO toca guard_delivery_stage (la 145 sigue siendo su ultima definicion), ni guard_factura_obligatoria
--   (146), ni politicas, ni grants, ni ninguna fila mas alla de que el defecto las lea como 'normal'.
--
-- Tres decisiones, con su motivo:
--   1. TEXTO CON CHECK, no un entero. La lee quien mira la base a mano (el orquestador, un pg_dump, el
--      rastro jsonb de deliveries_borradas) y 'critical' se entiende sin tabla de traduccion; un 3 no. El
--      orden (critica > alta > normal > baja) lo pone la app en un solo sitio (src/lib/prioridad.ts), que es
--      donde se ordena y se reparte; la base no ordena por esto. Anadir un nivel es cambiar el check.
--   2. NOT NULL con defecto 'normal'. En Postgres 11+ anadir una columna con defecto constante no reescribe
--      la tabla: las filas que ya estan LEEN 'normal' sin que nadie las actualice (no hay UPDATE aqui). Un
--      null seria un cuarto estado ("sin decir") que la app tendria que leer como normal en todas partes.
--   3. QUIEN LA CAMBIA: las mismas reglas que cualquier otro campo de la orden. El guard de etapas no mira
--      columnas en "misma etapa": deja editar a ventas y al chofer en draft/pending/rejected; a office y al
--      gerente en cualquier etapa; a almacen de approved a delivered; a logistica de draft a ready; al admin
--      todo. La prioridad sigue esas reglas sin tocar el guard. Los dos permisos estrechos de ventas en una
--      orden ya hecha (125 poner la factura, 138 agregar material) comparan la fila entera con una copia:
--      cambiar la prioridad ahi NO pasa, igual que cambiar cualquier otro campo. Es lo que se quiere.
--
-- El disparador de la 146 (deliveries_guard_invoice) no se entera: solo mira etapa, tipo y factura. Un UPDATE
-- que solo cambia la prioridad sale por su salida "sin cambio de etapa ni tipo" (o por la de "con factura").
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit
-- de dentro cerraria la de fuera (paso con la 124).
-- ===========================================================================

alter table public.deliveries
  add column if not exists priority text not null default 'normal';

alter table public.deliveries drop constraint if exists deliveries_priority_allowed;
alter table public.deliveries
  add constraint deliveries_priority_allowed
  check (priority in ('low', 'normal', 'high', 'critical'));

comment on column public.deliveries.priority is
  'low | normal | high | critical (147). Por defecto normal. Auto-asignar reparte primero critical y high; el orden lo define src/lib/prioridad.ts.';

-- ===========================================================================
-- Se comprueba a si misma
-- ===========================================================================
-- Lo de las funciones se mira sobre el CODIGO, sin las lineas de comentario (leccion de la 144): se quitan
-- las lineas que EMPIEZAN por `--` y los espacios se colapsan a uno.
do $chk$
declare
  guard   text := regexp_replace(regexp_replace(pg_get_functiondef('public.guard_delivery_stage()'::regprocedure),
                                                '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
  -- La 146 puede no estar aplicada todavia (su plan espera aprobacion): entonces no hay nada suyo que mirar.
  f146    regprocedure := to_regprocedure('public.guard_factura_obligatoria()');
  factura text;
  def     text;
  raras   int;
begin
  -- La columna: texto, sin nulos, con 'normal' por defecto.
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'deliveries' and column_name = 'priority'
                    and data_type = 'text' and is_nullable = 'NO'
                    and column_default like '''normal''%') then
    raise exception '147: deliveries.priority no quedo como text not null default normal';
  end if;
  -- La restriccion, con los cuatro valores y ninguno mas.
  select pg_get_constraintdef(c.oid) into def
    from pg_constraint c
   where c.conrelid = 'public.deliveries'::regclass and c.conname = 'deliveries_priority_allowed' and c.contype = 'c';
  if def is null then
    raise exception '147: falta la restriccion deliveries_priority_allowed';
  end if;
  if position('''low''' in def) = 0 or position('''normal''' in def) = 0
     or position('''high''' in def) = 0 or position('''critical''' in def) = 0
     or (length(def) - length(replace(def, '::text', ''))) / length('::text') <> 4 then
    raise exception '147: la restriccion no admite exactamente low, normal, high y critical: %', def;
  end if;
  -- Ninguna fila fuera de los cuatro (el defecto las deja todas en normal; esto es por si se re-aplica).
  select count(*) into raras from public.deliveries where priority not in ('low', 'normal', 'high', 'critical');
  if raras > 0 then
    raise exception '147: % ordenes con una prioridad fuera de los cuatro valores', raras;
  end if;
  -- El guard de etapas sigue siendo el de la 145 y no mira la prioridad: las reglas de quien edita valen igual.
  if position('if r = ''manager'' and ((old_stage = ''approved'' and new_stage = ''fulfilling'')' in guard) = 0 then
    raise exception '147: guard_delivery_stage no es el de la 145; revisar el orden de migraciones';
  end if;
  if position('priority' in guard) > 0 then
    raise exception '147: guard_delivery_stage menciona priority; esta migracion supone que no';
  end if;
  -- El guard de etapas sigue colgado de la tabla.
  if not exists (select 1 from pg_trigger where tgrelid = 'public.deliveries'::regclass and not tgisinternal
                  and tgname = 'deliveries_guard_stage') then
    raise exception '147: falta el disparador deliveries_guard_stage';
  end if;
  -- El de la 146, si esta, tampoco mira la prioridad.
  if f146 is null then
    raise notice '147: la 146 no esta aplicada; no hay guard_factura_obligatoria que mirar';
  else
    factura := regexp_replace(regexp_replace(pg_get_functiondef(f146), '^[ \t]*--.*$', '', 'gn'), '\s+', ' ', 'g');
    if position('priority' in factura) > 0 then
      raise exception '147: guard_factura_obligatoria menciona priority; esta migracion supone que no';
    end if;
  end if;
end $chk$;

-- ===========================================================================
-- Ensayo por rol, con ROLLBACK
-- ===========================================================================
-- La matriz esta en el plan (docs/PLAN-147-prioridad.md, seccion 6). Se pega en una transaccion abierta a
-- mano y se cierra con ROLLBACK. Este fichero no la lleva ejecutable a proposito: cualquier sentencia de aqui
-- abajo corre al aplicar la migracion.

-- ===========================================================================
-- Reversion (para pegar A MANO, en una transaccion propia)
-- ===========================================================================
--   alter table public.deliveries drop constraint if exists deliveries_priority_allowed;
--   alter table public.deliveries drop column if exists priority;
--   delete from public.schema_migrations where name = '147_prioridad_de_la_orden.sql';
--   -- Comprobacion: ninguna fila.
--   select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deliveries' and column_name = 'priority';
-- Se pierde la prioridad que se haya puesto (no hay otra copia, salvo el rastro de deliveries_borradas). La
-- app no se rompe: sin la columna deja de mandar el campo y lee todas como normal (src/lib/prioridad.ts,
-- laBaseTienePrioridad). Para quitar tambien la pantalla, revertir el commit.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('147_prioridad_de_la_orden.sql', 'cdc1038a4664bb5cb7e2f3af9e6f654d27ca40cae7ac83ca3312792f92bc443a') on conflict (name) do nothing;
