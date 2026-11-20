-- ===========================================================================
-- 335 - Leads: TELÉFONO A MANO. Un vendedor añade (o corrige) el teléfono de un lead que el Excel no trae.
-- ===========================================================================
-- Pedido del dueño (2026-11-19): en el STXP Pool hay leads sin teléfono (el Excel de permisos no lo trae). Con la 328
-- ya nadie toma un lead: quien lo ve anota. Ahora también puede guardar el teléfono, para que quede, lo vea todo el
-- equipo y sobreviva al próximo import.
--
-- QUE TRAE:
--   1. Columnas nuevas, por lado (contratista = owner_*, propietario = tenant_*): el teléfono a mano, el nombre de
--      contacto (opcional), quién lo puso y cuándo. Los imports NO las tocan (ni `leads_import_rows` ni el guion del
--      STXP: ninguno las nombra). El de mano manda sobre el del Excel en la pantalla; el Excel no se borra.
--   2. El historial acepta un tipo de evento nuevo: `phone` (un teléfono añadido o quitado). Su nota dice cuál.
--   3. lead_set_phone(lead, quien, telefono, extension, contacto): pone o quita (telefono null) el teléfono a mano.
--      Misma puerta que la nota (328): tiene el módulo Leads y PUEDE VERLO (leads_puede_ver_fila). Valida en el servidor
--      (10 dígitos de EE. UU., extensión de hasta 6, contacto de hasta 80) y deja la nota en el historial.
--
-- LO QUE NO TOCA:
--   · Ningún dato del Excel se cambia. Ninguna etapa, estado, dueño ni nota. Ninguna política (RLS).
--   · lead_note, leads_registra_nota, leads_import_rows y las demás: igual que la 328.
--
-- Sin begin/commit propios: quien aplica envuelve el fichero en una transacción.
-- Vuelta atrás: ver el final del fichero.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Columnas nuevas. El contratista (owner_*) y el propietario (tenant_*).
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists owner_phone_manual text;
alter table public.leads add column if not exists owner_phone_manual_contact text;
alter table public.leads add column if not exists owner_phone_manual_by uuid;
alter table public.leads add column if not exists owner_phone_manual_by_name text;
alter table public.leads add column if not exists owner_phone_manual_at timestamptz;
alter table public.leads add column if not exists tenant_phone_manual text;
alter table public.leads add column if not exists tenant_phone_manual_contact text;
alter table public.leads add column if not exists tenant_phone_manual_by uuid;
alter table public.leads add column if not exists tenant_phone_manual_by_name text;
alter table public.leads add column if not exists tenant_phone_manual_at timestamptz;

alter table public.leads drop constraint if exists leads_phone_manual_largo;
alter table public.leads add constraint leads_phone_manual_largo check (
  (owner_phone_manual is null or length(owner_phone_manual) <= 40)
  and (tenant_phone_manual is null or length(tenant_phone_manual) <= 40)
  and (owner_phone_manual_contact is null or length(owner_phone_manual_contact) <= 80)
  and (tenant_phone_manual_contact is null or length(tenant_phone_manual_contact) <= 80)
);

-- ---------------------------------------------------------------------------
-- 2. El historial acepta el tipo «phone» (el de la 162 más este).
-- ---------------------------------------------------------------------------
alter table public.lead_events drop constraint if exists lead_events_kind;
alter table public.lead_events add constraint lead_events_kind check (
  kind in ('imported', 'taken', 'progress', 'closed', 'released', 'assigned', 'archived', 'phone')
);

-- ---------------------------------------------------------------------------
-- 3. Poner o quitar el teléfono a mano. Definer: escribe como dueño, y su puerta es la misma que la de lead_note.
--    p_quien: 'owner' (contratista) o 'tenant' (propietario). p_telefono null o vacío = quitarlo.
--    La forma guardada es la del hub: «(956) 555-0123», con « ext. N» si hay extensión. Igual que telefonos.ts.
-- ---------------------------------------------------------------------------
create or replace function public.lead_set_phone(p_lead uuid, p_quien text, p_telefono text, p_ext text, p_contacto text)
  returns public.leads language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_uid      uuid := auth.uid();
  v_name     text;
  v_digitos  text;
  v_tel      text;
  v_ext      text := nullif(btrim(coalesce(p_ext, '')), '');
  v_contacto text := nullif(btrim(coalesce(p_contacto, '')), '');
  v_etiqueta text;
  v_nota     text;
  v_row      public.leads;
begin
  if v_uid is null or not public.has_leads_access() then
    raise exception 'leads: you do not have the Leads module' using errcode = '42501';
  end if;
  if p_quien is null or p_quien not in ('owner', 'tenant') then
    raise exception 'leads: the phone must belong to the contractor or the owner' using errcode = '22023';
  end if;
  if v_contacto is not null and length(v_contacto) > 80 then
    raise exception 'leads: the contact name is too long' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_telefono, '')), '') is null then
    v_tel := null;
  else
    -- Lo que va después de «ext» en el número es la extensión, si el campo de extensión está vacío.
    if v_ext is null and position('ext' in lower(p_telefono)) > 0 then
      v_ext := nullif(btrim(substring(p_telefono from '(?i)ext\.?\s*(.*)$')), '');
    end if;
    v_digitos := regexp_replace(split_part(lower(p_telefono) || ' ', ' ext', 1), '\D', '', 'g');
    if length(v_digitos) = 11 and left(v_digitos, 1) = '1' then
      v_digitos := substr(v_digitos, 2);
    end if;
    if length(v_digitos) <> 10 then
      raise exception 'leads: the phone must have 10 US digits' using errcode = '22023';
    end if;
    if v_ext is not null and v_ext !~ '^[0-9]{1,6}$' then
      raise exception 'leads: the extension must be up to 6 digits' using errcode = '22023';
    end if;
    v_tel := '(' || substr(v_digitos, 1, 3) || ') ' || substr(v_digitos, 4, 3) || '-' || substr(v_digitos, 7, 4)
             || case when v_ext is null then '' else ' ext. ' || v_ext end;
  end if;

  -- Uno que no ve (o que no existe, o está archivado) se responde igual: no se dice si existe.
  if not public.leads_puede_ver_fila(p_lead) then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;
  perform 1 from public.leads l where l.id = p_lead and l.status <> 'archived' for update;
  if not found then
    raise exception 'leads: no lead with that id' using errcode = 'P0002';
  end if;

  v_name := public.lead_person_name(v_uid);
  v_etiqueta := case when p_quien = 'owner' then 'Contratista' else 'Propietario' end;
  v_nota := v_etiqueta || ': ' || coalesce(v_tel || case when v_contacto is null then '' else ' · ' || v_contacto end, 'quitado');

  if p_quien = 'owner' then
    update public.leads l
       set owner_phone_manual         = v_tel,
           owner_phone_manual_contact = case when v_tel is null then null else v_contacto end,
           owner_phone_manual_by      = case when v_tel is null then null else v_uid end,
           owner_phone_manual_by_name = case when v_tel is null then null else v_name end,
           owner_phone_manual_at      = case when v_tel is null then null else now() end,
           updated_at                 = now()
     where l.id = p_lead
    returning * into v_row;
  else
    update public.leads l
       set tenant_phone_manual         = v_tel,
           tenant_phone_manual_contact = case when v_tel is null then null else v_contacto end,
           tenant_phone_manual_by      = case when v_tel is null then null else v_uid end,
           tenant_phone_manual_by_name = case when v_tel is null then null else v_name end,
           tenant_phone_manual_at      = case when v_tel is null then null else now() end,
           updated_at                  = now()
     where l.id = p_lead
    returning * into v_row;
  end if;

  insert into public.lead_events (lead_id, kind, note, actor, actor_name, subject, subject_name)
    values (p_lead, 'phone', v_nota, v_uid, v_name, v_uid, v_name);
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Permisos. Como lead_note: lo ejecuta quien tiene sesión; nadie anónimo.
-- ---------------------------------------------------------------------------
revoke execute on function public.lead_set_phone(uuid, text, text, text, text) from public, anon;
grant  execute on function public.lead_set_phone(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Comprobaciones: si algo no cuadra, la transacción se deshace entera.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lead_events_kind' and pg_get_constraintdef(oid) like '%phone%') then
    raise exception '335: el historial no acepta el tipo phone';
  end if;
  if not exists (select 1 from pg_proc where proname = 'lead_set_phone') then
    raise exception '335: falta lead_set_phone';
  end if;
end $$;

notify pgrst, 'reload schema';

-- Vuelta atrás: drop function lead_set_phone(uuid, text, text, text, text); volver a poner la restricción lead_events_kind
-- sin 'phone' (los eventos 'phone' que ya existan lo impedirían: borrarlos antes, si se deshace); drop las diez columnas
-- *_phone_manual* y la restricción leads_phone_manual_largo. Los teléfonos a mano que se pusieron se pierden con ellas.

-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('335_leads_telefono_a_mano.sql', '3087fd9801301e2ca301ed8d94cf1b8149c97117eb74ddcb58f78962dd43d5b0') on conflict (name) do nothing;
