-- 295: Almacén RECHAZA una orden que no puede preparar (2026-11-11).
--
-- Ayuda de Antonio Ruiz (almacén, Entregas · Almacén): «necesito opción de rechazar porque lo estoy poniendo entregado
-- para que se quite». Almacén no tenía forma de devolver una orden que no puede preparar, así que la marcaba
-- «entregada» para sacarla de su lista: entregas falsas en los reportes.
--
-- Ahora la rama de almacén de `guard_delivery_stage` acepta `approved -> rejected` y `fulfilling -> rejected`:
--   · solo en órdenes de SUS tiendas (`orden_de_mis_tiendas`, la misma regla que su «deshacer un paso», 142);
--   · con motivo obligatorio (`rejected_reason`), que es lo que lee ventas en la orden.
-- La orden vuelve a ventas como «Rechazada» (la misma etapa que da quien aprueba), que la corrige y la reenvía.
--
-- Nada más del guard cambia: se reescribe la función desde su definición actual insertando SOLO este bloque antes del
-- último `raise` de la rama de almacén, y la migración comprueba que la inserción ocurrió una vez.
-- Additive. 237/238/239 intactas.

do $m$
declare
  f text;
  ancla constant text := 'raise exception ''Warehouse cannot move an order from % to %'', old_stage, new_stage;';
  bloque constant text := '-- 295: almacen RECHAZA lo que no puede preparar, en sus tiendas y con motivo; vuelve a ventas.
    if old_stage in (''approved'',''fulfilling'') and new_stage = ''rejected'' then
      if coalesce(btrim(NEW.rejected_reason), '''') = '''' then
        raise exception ''A rejected order needs a reason'';
      end if;
      if public.orden_de_mis_tiendas(OLD.store, OLD.pickup_name, OLD.delivery_name, OLD.pickup_address) then
        return NEW;
      end if;
      raise exception ''Warehouse can only reject orders of its own store'';
    end if;
    ';
  n int;
begin
  f := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  n := (length(f) - length(replace(f, ancla, ''))) / length(ancla);
  if n <> 1 then
    raise exception '295: esperaba 1 ancla en guard_delivery_stage, encontre %', n;
  end if;
  if position('295: almacen RECHAZA' in f) > 0 then
    raise exception '295: el bloque ya estaba';
  end if;
  execute replace(f, ancla, bloque || ancla);
end $m$;

-- ===========================================================================
-- Autocomprobacion
-- ===========================================================================
do $chk$
declare f text;
begin
  f := pg_get_functiondef('public.guard_delivery_stage()'::regprocedure);
  if position('295: almacen RECHAZA' in f) = 0 then
    raise exception '295: falta el bloque de rechazo de almacen';
  end if;
  if position('A rejected order needs a reason' in f) = 0 then
    raise exception '295: el rechazo de almacen debe exigir motivo';
  end if;
  if position('Warehouse can only reject orders of its own store' in f) = 0 then
    raise exception '295: el rechazo de almacen debe limitarse a sus tiendas';
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('295_almacen_rechaza.sql', '217d546c001254a0a42cd0d184070e3ed1ed7780465b30fc6e366a3656eda05e') on conflict (name) do nothing;
