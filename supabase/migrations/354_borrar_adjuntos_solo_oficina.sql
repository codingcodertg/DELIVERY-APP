-- ---------------------------------------------------------------------------
-- 354 · Adjuntos de la orden: solo los borra la oficina, el admin o quien los subió (auditoría 2026-11-27, D-1205)
-- ---------------------------------------------------------------------------
-- POR QUÉ. El ataque simulado lo confirmó por código: cualquier empleado que puede VER una orden podía BORRAR sus
-- adjuntos. Las dos políticas vivas (copiadas de la base el 27 nov) solo pedían que la orden existiera y fuera visible:
--   public.delivery_files   «delivery files delete»:        exists (deliveries d where d.id = delivery_id)
--   storage.objects         «delivery files bucket delete»: bucket_id = 'delivery-files' and exists (deliveries d
--                                                           where d.id::text = (storage.foldername(name))[1])
--
-- QUÉ CAMBIA. Las dos conservan su condición de hoy Y además piden una de estas:
--   · quien lo subió (delivery_files.created_by / storage.objects.owner_id = auth.uid());
--   · admin (public.is_admin());
--   · oficina: rol manager, logistics o accounting (public.current_user_role(), la misma lista que ya usa la 140).
-- Choferes, almacén y ventas ya no borran adjuntos ajenos; los suyos sí.
--
-- Las fotos del POD (bucket delivery-photos) NO tienen política de borrado en la base: nadie con sesión puede
-- borrarlas. No se toca.
--
-- Leer y subir no cambian. Sin begin/commit propios. Idempotente (drop + create).
-- SIN APLICAR hasta que el dueño dé el OK.
--
-- Para deshacer (vuelve lo de antes):
--   drop policy "delivery files delete" on public.delivery_files;
--   create policy "delivery files delete" on public.delivery_files for delete to authenticated
--     using (exists (select 1 from public.deliveries d where d.id = delivery_id));
--   drop policy "delivery files bucket delete" on storage.objects;
--   create policy "delivery files bucket delete" on storage.objects for delete to authenticated
--     using (bucket_id = 'delivery-files' and exists (select 1 from public.deliveries d where d.id::text = (storage.foldername(name))[1]));
--   delete from public.schema_migrations where name = '354_borrar_adjuntos_solo_oficina.sql';
-- ---------------------------------------------------------------------------

drop policy if exists "delivery files delete" on public.delivery_files;
create policy "delivery files delete" on public.delivery_files for delete to authenticated
  using (
    exists (select 1 from public.deliveries d where d.id = delivery_id)
    and (
      created_by = (select auth.uid())
      or (select public.is_admin())
      or (select public.current_user_role()) in ('manager', 'logistics', 'accounting')
    )
  );

drop policy if exists "delivery files bucket delete" on storage.objects;
create policy "delivery files bucket delete" on storage.objects for delete to authenticated
  using (
    bucket_id = 'delivery-files'
    and exists (select 1 from public.deliveries d where d.id::text = (storage.foldername(name))[1])
    and (
      owner_id = (select auth.uid())::text
      or (select public.is_admin())
      or (select public.current_user_role()) in ('manager', 'logistics', 'accounting')
    )
  );

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'delivery_files'
                 and policyname = 'delivery files delete' and qual like '%created_by%') then
    raise exception 'La 354 no cerró el borrado en delivery_files';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'delivery files bucket delete' and qual like '%owner_id%') then
    raise exception 'La 354 no cerró el borrado en el cubo delivery-files';
  end if;
end $$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('354_borrar_adjuntos_solo_oficina.sql', 'caeeb3628952dc36d72965a28917d9ae6515697f5766203a22e49f276cb130a8') on conflict (name) do nothing;
