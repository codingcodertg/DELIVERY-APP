-- 251: el aviso de una solicitud de alta se titula «Solicitud de cliente nuevo» (no ayuda).
--
-- El dueno: las solicitudes de cliente nuevo le llegaban como «Solicitud de ayuda». La causa estaba en la app (el alta
-- tambien mandaba una solicitud de ayuda por /api/help); eso se quita en el codigo. Aqui solo se ajusta el texto en
-- espanol del aviso de la campana: «Nueva solicitud de cliente» pasa a «Solicitud de cliente nuevo», igual que el
-- ingles «New customer request».
--
-- Se parte de la funcion tal como la deja la 250 (que le anadio las asociaciones) y se cambia SOLO ese texto, con
-- replace sobre su definicion: las ramas de asociacion, edicion y decisiones quedan identicas.
-- Tambien se renombran los avisos ya escritos (solo el texto en espanol de las altas).
-- Vuelta atras: el mismo replace al reves.

do $re$
declare
  def text;
begin
  if to_regprocedure('erp.avisa_solicitud_de_cliente()') is null then raise exception '251: aplica primero la 243'; end if;
  def := pg_get_functiondef('erp.avisa_solicitud_de_cliente()'::regprocedure);
  if position('''asociacion''' in def) = 0 then raise exception '251: aplica primero la 250 (asociaciones)'; end if;
  if position('Solicitud de cliente nuevo' in def) = 0 then
    if position('else ''📝 Nueva solicitud de cliente: '' end' in def) = 0 then
      raise exception '251: el aviso no tiene el texto esperado de la 243';
    end if;
    execute replace(def, 'else ''📝 Nueva solicitud de cliente: '' end', 'else ''📝 Solicitud de cliente nuevo: '' end');
  end if;
end $re$;

revoke all on function erp.avisa_solicitud_de_cliente() from public, anon, authenticated;

update public.notifications
   set message_es = replace(message_es, '📝 Nueva solicitud de cliente: ', '📝 Solicitud de cliente nuevo: ')
 where kind = 'cliente_solicitud_nueva' and message_es like '📝 Nueva solicitud de cliente: %';

do $chk$
declare
  def text := pg_get_functiondef('erp.avisa_solicitud_de_cliente()'::regprocedure);
begin
  if not (select prosecdef from pg_proc where oid = 'erp.avisa_solicitud_de_cliente()'::regprocedure) then raise exception '251: el aviso no es security definer'; end if;
  if position('📝 Solicitud de cliente nuevo: ' in def) = 0 then raise exception '251: el aviso no dice Solicitud de cliente nuevo'; end if;
  if position('📝 Nueva solicitud de cliente: ' in def) > 0 then raise exception '251: queda el texto viejo'; end if;
  if position('''asociacion''' in def) = 0 then raise exception '251: se perdieron las asociaciones de la 250'; end if;
  if has_function_privilege('anon', 'erp.avisa_solicitud_de_cliente()', 'execute') then raise exception '251: anon ejecuta el aviso'; end if;
end $chk$;
-- @ledger-below
insert into public.schema_migrations (name, checksum) values ('251_aviso_solicitud_de_cliente_nuevo.sql', 'd9a54a160916ab93e0cca927d795043691254c0b376b917b2709f198e9ef119f') on conflict (name) do nothing;
