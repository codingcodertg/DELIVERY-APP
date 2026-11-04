-- 238: los teléfonos ya guardados, en la forma única del hub «(956) 340-5910» (D-850).
--
-- El dueño: «usa el formato (956) 340-5910 en todo». Hasta aquí RR. HH. guardaba «956-555-0123» (D-432,
-- `telefonoDeFicha`), y Leads y el Estimador también; Entregas, Clientes y candidatos ya usaban «(956) 340-5910»
-- (D-610/D-630/D-635). Desde D-850 todo pasa por `telefonoEstandar` (src/lib/recruiting/formato.ts): lo nuevo ya se
-- guarda así y TODA pantalla, exportación y correo lo enseña así aunque la fila venga de antes. Esta migración NO hace
-- falta para que se vea bien; deja lo guardado igual que lo que se ve, y cierra un hueco: `company_assets` tiene
-- `unique (kind, value)`, y con un número viejo «956-555-0123» guardado, dar de alta «(956) 555-0123» no chocaría.
--
-- La regla es la de `telefonoEstandar`, escrita en SQL (`pg_temp.tel_estandar`): vacío o con letras («ext. 12», «- Viya,
-- A/P») no se toca; 10 dígitos, u 11 empezando por 1, pasan a «(956) 340-5910»; lo demás (dos números juntos, uno corto)
-- se deja como está. Idempotente: correrla dos veces no cambia nada la segunda.
--
-- Medido en producción el 2026-11-04 (solo lectura, solo conteos), filas que cambia:
--   recruiting.employee_files.phone            4   (de 32 con teléfono; 28 ya iban en la forma única)
--   recruiting.employee_files.personal_phone  39   (de 39)
--   recruiting.employee_files.previous_phone   6   (de 6)
--   recruiting.employee_files.emergency_phone  0   (vacía)
--   recruiting.company_assets.value (phone)   30   (de 30; 0 choques con la unique tras el formato)
--   public.leads.owner_phone                 192   (de 676)
--   public.leads.tenant_phone                 62   (de 99)
--   public.leads.design_firm_phone           120   (de 383)
--   public.estimator_quotes.customer->phone    2   (de 2; su guard, sin sesión, solo mueve `updated_at`)
--   public.settings.help_phone                 1   (de 1)
--   deliveries, erp.customers, candidatos, encuestas: 0 (ya en la forma única, o no es un número completo).
-- El historial de RR. HH. (`recruiting.hr_history`) NO se toca: cuenta lo que pasó, y no tiene ningún teléfono escrito.
-- Un re-import de leads (`scripts/leads/importa-leads.mjs`) vuelve a escribir lo que traiga el Excel; la pantalla lo enseña
-- en la forma única igual.
--
-- Sin begin/commit: quien aplica envuelve el fichero. **Sin aplicar** cuando se escribió: la aplica el orquestador tras
-- fusionar, con `migrate-status` antes y después.

create or replace function pg_temp.tel_estandar(t text) returns text language sql immutable as $$
  select case
    when t is null or btrim(t) = '' then t
    when btrim(t) ~ '[[:alpha:]]' then t
    when length(regexp_replace(t, '[^0-9]', '', 'g')) = 10
      or (length(regexp_replace(t, '[^0-9]', '', 'g')) = 11 and regexp_replace(t, '[^0-9]', '', 'g') like '1%')
      then '(' || substr(right(regexp_replace(t, '[^0-9]', '', 'g'), 10), 1, 3) || ') '
            || substr(right(regexp_replace(t, '[^0-9]', '', 'g'), 10), 4, 3) || '-'
            || substr(right(regexp_replace(t, '[^0-9]', '', 'g'), 10), 7, 4)
    else t
  end
$$;

update recruiting.employee_files set
  phone           = pg_temp.tel_estandar(phone),
  personal_phone  = pg_temp.tel_estandar(personal_phone),
  previous_phone  = pg_temp.tel_estandar(previous_phone),
  emergency_phone = pg_temp.tel_estandar(emergency_phone)
where phone           is distinct from pg_temp.tel_estandar(phone)
   or personal_phone  is distinct from pg_temp.tel_estandar(personal_phone)
   or previous_phone  is distinct from pg_temp.tel_estandar(previous_phone)
   or emergency_phone is distinct from pg_temp.tel_estandar(emergency_phone);

update recruiting.company_assets set value = pg_temp.tel_estandar(value)
where kind = 'phone' and value is distinct from pg_temp.tel_estandar(value);

update public.leads set
  owner_phone       = pg_temp.tel_estandar(owner_phone),
  tenant_phone      = pg_temp.tel_estandar(tenant_phone),
  design_firm_phone = pg_temp.tel_estandar(design_firm_phone)
where owner_phone       is distinct from pg_temp.tel_estandar(owner_phone)
   or tenant_phone      is distinct from pg_temp.tel_estandar(tenant_phone)
   or design_firm_phone is distinct from pg_temp.tel_estandar(design_firm_phone);

update public.estimator_quotes
set customer = jsonb_set(customer, '{phone}', to_jsonb(pg_temp.tel_estandar(customer->>'phone')))
where jsonb_typeof(customer) = 'object' and jsonb_typeof(customer->'phone') = 'string'
  and customer->>'phone' is distinct from pg_temp.tel_estandar(customer->>'phone');

update public.settings set help_phone = pg_temp.tel_estandar(help_phone)
where help_phone is distinct from pg_temp.tel_estandar(help_phone);

-- Comprobación: no queda ningún teléfono que la regla cambiaría.
do $chk$
declare n int;
begin
  select (select count(*) from recruiting.employee_files
            where phone is distinct from pg_temp.tel_estandar(phone)
               or personal_phone is distinct from pg_temp.tel_estandar(personal_phone)
               or previous_phone is distinct from pg_temp.tel_estandar(previous_phone)
               or emergency_phone is distinct from pg_temp.tel_estandar(emergency_phone))
       + (select count(*) from recruiting.company_assets where kind = 'phone' and value is distinct from pg_temp.tel_estandar(value))
       + (select count(*) from public.leads
            where owner_phone is distinct from pg_temp.tel_estandar(owner_phone)
               or tenant_phone is distinct from pg_temp.tel_estandar(tenant_phone)
               or design_firm_phone is distinct from pg_temp.tel_estandar(design_firm_phone))
       + (select count(*) from public.estimator_quotes
            where jsonb_typeof(customer) = 'object' and jsonb_typeof(customer->'phone') = 'string'
              and customer->>'phone' is distinct from pg_temp.tel_estandar(customer->>'phone'))
       + (select count(*) from public.settings where help_phone is distinct from pg_temp.tel_estandar(help_phone))
    into n;
  if n > 0 then
    raise exception '238: quedan % filas con un teléfono fuera de la forma única', n;
  end if;
end $chk$;

-- @ledger-below
insert into public.schema_migrations (name, checksum)
  values ('238_telefono_formato_unico.sql', '6e3591e94e7c4bca589411f6186394251dad70f95beaf02035fb44748e8a7265') on conflict (name) do nothing;
