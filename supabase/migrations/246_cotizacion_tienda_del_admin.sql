-- 246: el admin elige la TIENDA de una cotización (Quote Builder), no solo el vendedor.
--
-- Roberto Rodriguez Jr (admin), solicitud de ayuda 5e8b3ea8: «Allow admin to change this. In this case i wanted to
-- create one for a rep in pharr». Hasta hoy el disparador de la 148 ya dejaba al admin poner `owner_id` (el vendedor),
-- pero la tienda la sacaba SIEMPRE del perfil del dueño: lo que el admin elegía en la tienda se pisaba.
--
-- Ahora, solo para el admin del hub (`is_admin()`):
--   * al crear, si manda `store`, se queda esa; si no, la del perfil del dueño (como antes);
--   * al editar, si cambia `store`, se queda la nueva; si cambia solo el dueño, la del perfil del nuevo dueño.
-- Para cualquier otro, nada cambia: no puede poner otro dueño (error 42501) y la tienda que mande se ignora.
-- El cliente enlazado (`estimator_quotes_zzz_cliente`, 245) corre DESPUÉS de este (orden alfabético) y vuelve a
-- enlazar cuando cambia la tienda, así que la cuenta sigue a la tienda elegida.

create or replace function public.estimator_quotes_guard()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  yo uuid := auth.uid();
  admin boolean;
begin
  if yo is null then
    new.updated_at := now();
    return new;
  end if;
  admin := public.is_admin();
  if tg_op = 'INSERT' then
    -- El dueño es quien la crea. Un admin puede crearla a nombre de otro vendedor, y en otra tienda.
    if not admin or new.owner_id is null then
      new.owner_id := yo;
    end if;
    new.prepared_by := yo;
    if admin and nullif(btrim(new.store), '') is not null then
      new.store := btrim(new.store);
    else
      new.store := (select nullif(trim(store), '') from public.profiles where id = new.owner_id);
    end if;
    new.print_count := 0;
    new.created_at := now();
  else
    if not admin then
      if new.owner_id is distinct from old.owner_id then
        raise exception 'Only an admin can change who owns an estimate' using errcode = '42501';
      end if;
      if lower(btrim(new.estimate_num)) is distinct from lower(btrim(old.estimate_num)) then
        raise exception 'The estimate number of a saved quote cannot change' using errcode = '42501';
      end if;
    end if;
    new.store := case
      when admin and new.store is distinct from old.store then nullif(btrim(new.store), '')
      when new.owner_id is distinct from old.owner_id
        then (select nullif(trim(store), '') from public.profiles where id = new.owner_id)
      else old.store end;
    new.prepared_by := yo;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end $function$;

do $chk$
begin
  if position('admin and new.store is distinct from old.store' in pg_get_functiondef('public.estimator_quotes_guard()'::regprocedure)) = 0 then
    raise exception '246: el guardia no deja al admin elegir la tienda';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.estimator_quotes'::regclass and tgname = 'estimator_quotes_guard') then
    raise exception '246: falta el disparador estimator_quotes_guard';
  end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('246_cotizacion_tienda_del_admin.sql', 'e49a1937fc5d64cd4a9738c03e1f7fe69c6778a7679c700057387e1c716c00c3') on conflict (name) do nothing;
