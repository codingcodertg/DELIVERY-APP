-- ===========================================================================
-- 308 - Ventas perdidas en el Quote Builder: lo que se pidio y no habia en la tienda
-- ===========================================================================
-- ESCRITA Y NO APLICADA: aplicarla es del dueno, con respaldo hecho y migrate-status antes y despues.
--
-- El dueno (pedido via solicitud de ayuda desde el Quote Builder): «they want to add a tab where they can record
-- the items that they lost a sale on because we didn't have stock». Una pestana nueva, «Ventas perdidas», donde el
-- vendedor anota lo que el cliente quiso comprar y no habia: el producto, cuanto, la tienda, la fecha, el motivo y,
-- si lo sabe, cuanto dinero se fue.
--
-- QUE TRAE:
--   1. public.estimator_lost_sales: una fila por venta perdida. Sin cotizacion: es un registro de demanda no
--      atendida, no un documento del cliente. Por eso no va atada a estimator_quotes.
--   2. Un disparador que pone created_by = auth.uid() (nadie lo puede falsear desde el navegador) y el nombre de
--      quien la anota, copiado de profiles (la lista tiene que decir quien la anoto aunque cambie su perfil).
--   3. RLS: VE todo quien tenga el modulo (has_estimator_access(), la misma regla que el Estimador) y no esta
--      borrada; ANOTA quien tenga el modulo, a su nombre; CORRIGE o BORRA (borrado logico: deleted_at) quien la
--      anoto o el admin. Sin DELETE fisico para nadie: asi la cifra de un periodo no desaparece en silencio.
--
-- LO QUE NO TOCA: ninguna tabla ni politica existente. Ningun dato.
--
-- Sin begin/commit propios, a proposito: quien aplica envuelve el fichero en una transaccion, y un commit de dentro
-- cerraria la de fuera (paso con la 124).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabla.
-- ---------------------------------------------------------------------------
create table if not exists public.estimator_lost_sales (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  -- Quien la anoto. Lo pone el disparador con auth.uid(); el default solo es la red de seguridad.
  created_by      uuid default auth.uid() references public.profiles(id) on delete set null,
  created_by_name text,
  -- La tienda donde se perdio la venta (texto libre, como estimator_quotes.store; el formulario la ofrece).
  store           text,
  -- La fecha de la venta perdida, en hora de Texas (no en UTC: una venta de las 8 pm no es del dia siguiente).
  sale_date       date not null default ((now() at time zone 'America/Chicago')::date),
  -- Que queria el cliente: nombre, SKU o descripcion, como lo diga el vendedor.
  item            text not null,
  quantity        numeric(12,2),
  unit            text,
  -- Cuanto dinero se fue, estimado por el vendedor. Opcional.
  est_value       numeric(12,2),
  reason          text not null default 'out_of_stock',
  customer        text,
  notes           text,
  -- Borrado logico: quien la anoto o el admin la quita sin perder la cifra de su periodo.
  deleted_at      timestamptz,
  constraint estimator_lost_sales_articulo check (length(btrim(item)) between 1 and 200),
  constraint estimator_lost_sales_cantidad check (quantity is null or quantity >= 0),
  constraint estimator_lost_sales_unidad check (unit is null or unit in ('SF','boxes','pieces','bags','other')),
  constraint estimator_lost_sales_valor check (est_value is null or est_value >= 0),
  constraint estimator_lost_sales_motivo check (reason in ('out_of_stock','not_enough_stock','discontinued','other')),
  constraint estimator_lost_sales_cliente check (customer is null or length(customer) <= 120),
  constraint estimator_lost_sales_tienda check (store is null or length(store) <= 80),
  constraint estimator_lost_sales_notas check (notes is null or length(notes) <= 500)
);

-- La lista va por fecha y por tienda (filtros de la pestana).
create index if not exists estimator_lost_sales_fecha_idx on public.estimator_lost_sales (sale_date desc, store);

-- ---------------------------------------------------------------------------
-- 2. Lo que no decide el navegador: quien la anota y su nombre.
-- ---------------------------------------------------------------------------
create or replace function public.estimator_lost_sales_guard()
  returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Al editar (o al quitar), el autor, su nombre y la fecha no cambian: nadie se apropia de una fila ni la atribuye a otro.
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_by_name := old.created_by_name;
    new.created_at := old.created_at;
    return new;
  end if;
  -- Si hay sesion, la fila es de quien la inserta, sin importar lo que mande el navegador.
  if auth.uid() is not null then
    new.created_by := auth.uid();
  end if;
  new.created_by_name := (select nullif(trim(full_name), '') from public.profiles where id = new.created_by);
  new.created_at := now();
  return new;
end $$;

drop trigger if exists estimator_lost_sales_guard on public.estimator_lost_sales;
create trigger estimator_lost_sales_guard before insert or update on public.estimator_lost_sales
  for each row execute function public.estimator_lost_sales_guard();

-- ---------------------------------------------------------------------------
-- 3. Privilegios y RLS. Una tabla nueva nace con todo concedido a anon y authenticated (medido al ensayar la 126):
--    se revoca y se concede lo justo. Sin DELETE: el borrado es logico (deleted_at).
-- ---------------------------------------------------------------------------
revoke all on public.estimator_lost_sales from anon, authenticated;
grant select, insert, update on public.estimator_lost_sales to authenticated;

alter table public.estimator_lost_sales enable row level security;

drop policy if exists "estimator_lost_sales select" on public.estimator_lost_sales;
drop policy if exists "estimator_lost_sales insert" on public.estimator_lost_sales;
drop policy if exists "estimator_lost_sales update" on public.estimator_lost_sales;

-- Ver: todo quien tiene el modulo, todas las tiendas, lo que no esta borrado.
create policy "estimator_lost_sales select" on public.estimator_lost_sales for select to authenticated
  using ((select public.has_estimator_access()) and deleted_at is null);

-- Anotar: quien tiene el modulo, y a su propio nombre.
create policy "estimator_lost_sales insert" on public.estimator_lost_sales for insert to authenticated
  with check ((select public.has_estimator_access()) and created_by = (select auth.uid()));

-- Corregir o borrar (logico): quien la anoto o el admin.
create policy "estimator_lost_sales update" on public.estimator_lost_sales for update to authenticated
  using ((select public.has_estimator_access()) and ((select public.is_admin()) or created_by = (select auth.uid())))
  with check ((select public.is_admin()) or created_by = (select auth.uid()));
