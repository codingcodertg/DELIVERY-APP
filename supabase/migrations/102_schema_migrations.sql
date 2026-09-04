-- 102 · Registro de migraciones — public.schema_migrations. D-184.
--
-- Hasta hoy los .sql de supabase/migrations/ se aplicaban a mano y NADA en la base decia cuales
-- habian corrido: el desfase era cuestion de tiempo. Esta tabla es el registro. El paso 1 de
-- D-184 midio el desfase (repo vs objetos reales en produccion) y confirmo CERO: las 101
-- migraciones estaban aplicadas. Este backfill las inscribe todas.
--
-- Checksum: sha256 del fichero con saltos normalizados a LF, tomando SOLO lo anterior al marcador
-- '-- @ledger-below' (asi el propio bloque de registro no se auto-referencia). Igual en
-- scripts/db/migrate-status.mjs. Escritura de la tabla: solo service-role o la propia migracion
-- (postgres) — ambos saltan RLS; un cliente autenticado no puede escribirla.

create table if not exists public.schema_migrations (
  name        text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text not null default current_user
);

alter table public.schema_migrations enable row level security;

-- SELECT solo para admin de Deliveries (is_admin(), D-179).
drop policy if exists "schema_migrations select admin" on public.schema_migrations;
create policy "schema_migrations select admin" on public.schema_migrations
  for select to authenticated using (public.is_admin());
-- Sin politica de INSERT/UPDATE/DELETE a proposito: la escritura va por service-role o por la
-- migracion (postgres), que saltan RLS.

-- @ledger-below — lo que sigue NO cuenta para el checksum (es el propio registro).
insert into public.schema_migrations (name, checksum, applied_by) values
  ('001_notifications.sql', '18ceecec1868568154a85c9b7dd184686f8b9138ad2fce305e8b6522f409e868', 'backfill (D-184)'),
  ('002_actual_pallets.sql', '09cf6a8001cce1c70503d349c809a003a3a2137962dbb6fd69503400c8b0f9b0', 'backfill (D-184)'),
  ('003_location_settings.sql', 'a462db63d9ad81e294b576024918f5582117490d63421db0666f3d9dee7fa0bc', 'backfill (D-184)'),
  ('004_driver_and_redelivery.sql', '73e47def6f8804af6068839feae6d682daaec06f083f8fc3df6d9a5ded98fed6', 'backfill (D-184)'),
  ('005_map_and_deadline_alerts.sql', 'b2471fe7a70ff4264526d735558d27f1855e98f0bdf82e71c14c9339ed7831ce', 'backfill (D-184)'),
  ('006_saved_accounts.sql', 'c5dbdde1d9e66082c5bf6cecd49952b4f8582356cf4e218f7e45702334aa55c1', 'backfill (D-184)'),
  ('007_sales_columns.sql', '654813cded6604a366f2778201c1470cf905e7286f89807f552df134b76d5e79', 'backfill (D-184)'),
  ('008_assigned_sales_rep.sql', 'bba9e346eb4caea353b2f52ba5afbd203516a4948f016e4c4ad3416e2544ec2a', 'backfill (D-184)'),
  ('009_routes.sql', '0440cc0d68dfdc1b36ec4e2105af0e6e3e469260290f53f4182f67fd19511e9a', 'backfill (D-184)'),
  ('010_driver_capacity.sql', 'e844cac1b0fc0e266b7d93637cf3ec59089f5a6ce0fcdcfeae99b8f680bbf82c', 'backfill (D-184)'),
  ('011_driver_visibility.sql', '972da39acf467713ee3d7b8872adb7439a42f4e9a2d51a5edf1df96e3a078d51', 'backfill (D-184)'),
  ('012_split_loads.sql', 'cdbda3e4fe1c2d925ceb6d13853bfffc54e3e7957a6ee74faad70b184c1371f5', 'backfill (D-184)'),
  ('013_single_session.sql', 'c8098d3dbcc1229896c5c9b48635930aedeea216c53a5c52ac659ad4997e7017', 'backfill (D-184)'),
  ('014_sync_delivery_columns.sql', '20e6479b6dc7411d76fa39ad96b4edc9f1cf93543c1c9b7afb9d84f58e6652d8', 'backfill (D-184)'),
  ('015_warehouse_visibility.sql', '519c3bad55c11d0fb411441eb37ef3fe3fcb7aa7cf33da81179920227ae6cebf', 'backfill (D-184)'),
  ('016_teaching_mode.sql', '90375e141ef9fe65b1d1cc9a3e538388a41abd70069ad267628be1aa3b948925', 'backfill (D-184)'),
  ('017_manager_can_create.sql', 'c38eb1d12028becc0b6dfe0d11733fed657d6a02869d131158908abefd431543', 'backfill (D-184)'),
  ('018_teaching_open_sandbox.sql', '5348e365afc5af27a1e6315c43a80c75ab257deb6bdcf2d344a8dc5fc5b4755c', 'backfill (D-184)'),
  ('019_manager_create_approved.sql', '69b98e79a06fa40cc96cee2720c6fe44d58ea33c5bf3518b187e182f4782969a', 'backfill (D-184)'),
  ('020_store_auto_approve.sql', 'e0efe9b3ce7a070dabdf05c26ef667abbca5468fb766858ef872c3994c46364a', 'backfill (D-184)'),
  ('021_cost_model_and_csat.sql', '870a4a468ab3ac13410066a0ed1805b5e1dab4bbd60b598f84c3a4a43afba83e', 'backfill (D-184)'),
  ('022_driver_availability.sql', 'dba8c5b3315dca9a91496d07932af37c0de16e13d096475133f857b526dc5dd3', 'backfill (D-184)'),
  ('023_prospect_status.sql', 'e9f8feb85b213b439a6241e027516472809ac684942c4190263d79c2903e528a', 'backfill (D-184)'),
  ('024_driver_shifts.sql', '34ece765e67ebff1414bc827c35cde1aa2592d0008a60ebd2c1e0ca115efce53', 'backfill (D-184)'),
  ('025_departed_at.sql', '2bdd8c27f3d21fca75897c1c14484acf98662e328ec7879a34df6a89b3738272', 'backfill (D-184)'),
  ('026_arrived_at.sql', '1271c55f5d76774b809a2afca39edb13336102eaebe9b6c4a462d117f93bdc55', 'backfill (D-184)'),
  ('027_order_type_rules.sql', '1539fd5d4c6acb06aeeb4054a4353403449f1e60e0c6e64c209815d49afd8b85', 'backfill (D-184)'),
  ('028_rename_historical_order_types.sql', '5f4c587cde2cf2fadd4c94a95566938354fd889a56ef073d229fb30fef8aff49', 'backfill (D-184)'),
  ('029_estimate_num.sql', '64d734f9d613238695746ac9c73b368d126856edaf9f4ad15703dd5ff4a4dc6b', 'backfill (D-184)'),
  ('030_help_contact.sql', '609df955e83cca1f03cd5a87208422adf19d3d1ba5c3b1e2819ce352a1b842bb', 'backfill (D-184)'),
  ('031_order_code.sql', 'eb65d81fed14454dfc455f6abf2e6e78eec32c5c7b55fb0312e8cb5445e87a89', 'backfill (D-184)'),
  ('032_drop_status_fields.sql', 'de10a6c226b1ade37427e8f097009d661b03707813822f0354b1c24fefb79d36', 'backfill (D-184)'),
  ('033_load_no.sql', 'e5c887fb3e1235a2dc9ddc9394edd580262d949755156fb9be3489b7e34438c9', 'backfill (D-184)'),
  ('034_settings_columns.sql', '85900ab610f14d47c3120c7da116473a09d2ab556395daf63615ae6856d66a89', 'backfill (D-184)'),
  ('035_role_notes.sql', '8f6d2f79bcc0f0487fd47d49a550220b91bc5deacd108354d9b666eeb2546899', 'backfill (D-184)'),
  ('036_local_zone_pricing.sql', 'ea53f058dd40b8f8e9bcfe15169ef6f07df42b31baabd6982a04f09cb1f43092', 'backfill (D-184)'),
  ('037_tutorials.sql', '2ebd1ce269b85af03a4e0dd1620016f52ad94ca192d9ea9ebb5e9297c9749e9a', 'backfill (D-184)'),
  ('038_delivered_address.sql', '8d9f8867e8e3add8ca252c162d5e7977057c3a8359ddc22d507f3e8c97f07bf7', 'backfill (D-184)'),
  ('039_same_day_surcharge.sql', '0523bfe262d3ce55423593d574a4b25ce93fc3e7241bc5b554e939dd704f44b1', 'backfill (D-184)'),
  ('040_morning_priority.sql', '61977a1d281fa01a0225751dd9d2985ce14e45538e990853ab7629aa6a7c4c6d', 'backfill (D-184)'),
  ('041_driver_incidents.sql', 'f84a5e3490bb13b4ef2402296a81681d54412faf7a147ff9b191d6c0ca7ff6d0', 'backfill (D-184)'),
  ('042_logistics_edit_preapproval.sql', 'dafad611752dd8ebe9c58ccedb42ab4b8f3f0b71988d156850ef20ca9ac87601', 'backfill (D-184)'),
  ('043_driver_locations.sql', '08f533f21f5907e1431c948f86d23e61580def5c871ae40b26672a41483e5525', 'backfill (D-184)'),
  ('044_signature_toggle.sql', '7b9de79de9266e75caa7f14a1abe2c056388130d46d094d4b686cd5937509134', 'backfill (D-184)'),
  ('045_load_auto.sql', '14c498decce525c5a4890feadead8ab351c4aedc99b7accffbfd77e3680c91b7', 'backfill (D-184)'),
  ('046_signature_off_by_default.sql', '4bac88e4297a82c6197a5e0c156a136bae7b4b21c45b625c05c862cbf74ff5df', 'backfill (D-184)'),
  ('047_proof_not_required.sql', 'f9ceb9936fc32da238685670c794c2304cc6ca627901473a7d564432db6fb4f8', 'backfill (D-184)'),
  ('048_driver_late_gps.sql', '286cb6d1966e46d40602cabf9071bff50f9a1ed1165dc060a8d56b8410979b4b', 'backfill (D-184)'),
  ('049_device_tokens.sql', '876f9ca12f6bef785278a31cc3dcb3815bc51c216960d328a54558d207bdc49e', 'backfill (D-184)'),
  ('050_shift_device.sql', 'b293e198b87054348a0051dcfc034009fd5a417a3b22834a944d5b0c4172cbf5', 'backfill (D-184)'),
  ('051_username.sql', '03d430850b38914ce943da2039b9ecdd28a942c977c80d8b8f2b8aaccdc0dc6e', 'backfill (D-184)'),
  ('052_profile_permissions.sql', '989b33e9cb27476437d14cc7ce768ec3c52826b8cc49c02c1d5948a1c10aa5de', 'backfill (D-184)'),
  ('053_security_events.sql', '4c62ec54c5f1c9fb90104edc23a75045fafea295bfd65601f4d176b362f6e125', 'backfill (D-184)'),
  ('054_photo_meta.sql', '7067f2b00283316eb99d995cfabd8b1c027a551bf54c8cad1a7f4b64d4be1db1', 'backfill (D-184)'),
  ('055_recruiting_access.sql', '3334b34c4b573099ff1bd6b8075d3ed08bbc5033792807887a4e5c907af7e4a4', 'backfill (D-184)'),
  ('056_recruiting_module.sql', 'd510204d4d6322bfeb0fc294a5c17511fd9aa18d6bd9e2b4f5dbd04744fba649', 'backfill (D-184)'),
  ('057_recruiting_rls.sql', 'd3cd4eb5daa0515c63f91891e55b739a87179f5acb7f91dd6d9a55771c6cdcb4', 'backfill (D-184)'),
  ('058_timetracker_access.sql', '97b6c703a69e8f1801cac7c716600e4caacfbe2bab5ac3860d020fdb97aeac94', 'backfill (D-184)'),
  ('059_timetracker_module.sql', '399050ca48bc9b980274e9d3908f190b6977445dbd8f799d27345ae6f2c834f8', 'backfill (D-184)'),
  ('060_timetracker_rls.sql', '3254fd105bc3be50dfb17f501e0bfae0328919cf6a08dd0d5b92df264c4408bd', 'backfill (D-184)'),
  ('061_timetracker_grants.sql', 'eda94c7ce2545e5fe88688ca265c7a8087945547d8e7a50fb6a51333c37e35c0', 'backfill (D-184)'),
  ('062_erp_access.sql', 'f5124e53ead035501e1da3317b070febf1d19a105aeae4bcf9a2799a0221917f', 'backfill (D-184)'),
  ('063_erp_module.sql', 'f9ffd455a00dd524bc154b74da9b3cc1fc3e8073d5374639be7707649dbd0f6c', 'backfill (D-184)'),
  ('064_erp_functions.sql', 'd17ad68907aa49fd865db1b76563c41986bba7ac15d0e8283a752fa87a30f6e6', 'backfill (D-184)'),
  ('065_erp_views.sql', '5b098b7981bc0a076dc036e17354d4a4f21bfe88944308d2c179a82b61228409', 'backfill (D-184)'),
  ('066_erp_rls.sql', '201d5b086bcd4fe42d7d1bae51ec219aabf1ea848c852f32692c1a426ce25e59', 'backfill (D-184)'),
  ('067_erp_grants.sql', 'cd3fd16d7b2074c09684d0cfde2545e7a30924224f5f82d9d632679a3d88c0c2', 'backfill (D-184)'),
  ('068_erp_views_security_invoker.sql', '90fad800de421f6ae6c8cf96ab6694c975d7a13c95af0b319647f387fbc0d78f', 'backfill (D-184)'),
  ('069_erp_base_read_policies.sql', '7366bfa1f51673a5ee315d2ba1ac562fe9267e21421daf33bcc4c874d424c51d', 'backfill (D-184)'),
  ('070_erp_policy_initplan.sql', 'f4b51f0f44b77923fbe3e20e3f608a03d01b4853055f7e12dec4ebfe611308e5', 'backfill (D-184)'),
  ('071_clockin_access.sql', '5d4bca599e8f7660ae9e2bae3018aa9bfd2e6e0af3a1c97321b0fb1b5c98873c', 'backfill (D-184)'),
  ('072_clockin_module.sql', '774d912d702805138feb44d342571086257f467aaf3c6b8bbd6a6e8b7ccc6afb', 'backfill (D-184)'),
  ('073_clockin_functions.sql', 'd00f93746996e915226ce127757f61ed653a56bbac44f302b0a2f6a2e16b4ec7', 'backfill (D-184)'),
  ('074_clockin_rls.sql', 'b91a4039971d8dd70a0814fef904098d090055976f1f689d156fa431d1ae0aa0', 'backfill (D-184)'),
  ('075_clockin_grants.sql', '8fe779c0dd1eb15ce996d11902df6831798862f3b323ca0d76ce460d37a67f95', 'backfill (D-184)'),
  ('076_clockin_extensions.sql', 'd9a79024ddb918bad3b667e337fac24c09dc5122c333eb939a04a914ff29ef56', 'backfill (D-184)'),
  ('077_clockin_profiles_view.sql', '4f78b8d1ca551f7b7f501ea2ea79db9f199a87690cf057492fc1caaa02669cf1', 'backfill (D-184)'),
  ('078_clockin_settings_on_grant.sql', 'bb274b40f5bff9980a985ce5dd3875806d4fb526ff88a1754a0c20776f819e7f', 'backfill (D-184)'),
  ('079_clockin_admin_is_manager.sql', 'dc4fa0924f969cc1d2bb66f2b368d3da6271ca9ed919ec37e7a4b0533aaf5ed0', 'backfill (D-184)'),
  ('080_initplan_all_modules.sql', 'b7c688f8bc3c18200d4e71831fd26fb5b2bcb737aef6625b1928b1d902720117', 'backfill (D-184)'),
  ('081_revoke_anon.sql', 'df204844c413dc4c6ff48565385b4434b359e984b8e495ed9cb40ffcfc44d67c', 'backfill (D-184)'),
  ('082_no_overlapping_time.sql', '0c85141d53e3c85eda9460b42b3a6a4ca98e7230b1da165e3444ab4307bb2f73', 'backfill (D-184)'),
  ('083_deliveries_access.sql', '73536024631f361f71df4b9aaadd734cb98a2be77f50b89a2f9b8da67091cbc3', 'backfill (D-184)'),
  ('084_merge_phase1_roles.sql', 'be25720d5c588618485f5e9ea4992c1f0b2b292e8c39c16097d26af05a0de47d', 'backfill (D-184)'),
  ('085_no_overlapping_punches.sql', 'a4f53870755ab02cfc2b21eaced2b1967d25357e27403734b18baff0bff11c69', 'backfill (D-184)'),
  ('086_period_hours.sql', 'c3243d184dca72609ff6680ad3380c6a7fe9cc7cf315004508dc68ba064ff94d', 'backfill (D-184)'),
  ('087_drop_clockin_role.sql', 'c8ae22ef9c0974b56447d833c9b0aa749e5e2cdb55e92690a464d4073f38af04', 'backfill (D-184)'),
  ('088_clockin_not_a_module.sql', '124d5c801a8a73d62f3a9f10798dda9ec770794bc2abdba1296b096297257570', 'backfill (D-184)'),
  ('089_store_manager.sql', 'e271793120ccf26dc8d78b73f240c64630766c3980badc2c884a36f5ecbf3e60', 'backfill (D-184)'),
  ('090_store_manager_writes.sql', 'd45e924a567dadc9d33c03e0dd92d901e87a39826656d6a24351670b795028b7', 'backfill (D-184)'),
  ('091_import_clockin_backlog.sql', '5d1903e0942bed00089e8a22b6727bb6572ad61757d296b91b83764cfc993589', 'backfill (D-184)'),
  ('092_one_live_session.sql', '9f7b97c85be82f69d53a54c3d642126c72ae97323987513bd95e729bcc78377a', 'backfill (D-184)'),
  ('093_hr_employee_files.sql', '04e63e3c2c774255e41ff93a95819dd483996e30f3a3b66559fcd3a263290e97', 'backfill (D-184)'),
  ('094_hr_files_manager_only.sql', '374e5cee9d32eff72a1ff9ae81966767228ff619559e60a0208b05f3cd10d970', 'backfill (D-184)'),
  ('095_clockin_word_removal.sql', '92ab00ec75c97d38eb955b8d11f9cd85d185aeed5e3e6f5913e588049d708de1', 'backfill (D-184)'),
  ('096_hr_docs_bucket.sql', '7e921cc638e246881185b21f8e81c35a712be64b8ad3bda92a2b983a33d3ddda', 'backfill (D-184)'),
  ('097_exception_photos_policies.sql', '8332bf87e5032dbc033b40f49c7a60efdeec8183acb983721643a315ce553f80', 'backfill (D-184)'),
  ('098_exception_multiple_reasons.sql', 'aff5f06d2a93678648e58f63f205f162ba651839256f3db04bda9f33f8f698b1', 'backfill (D-184)'),
  ('099_profiles_row_rls.sql', 'f20df1bf90c66dd897a14434f38e3b505d3614a37a17d439d2e28286fbe9ae6c', 'backfill (D-184)'),
  ('100_settings_events_rls.sql', 'd1a42e431bc98facf7c76e7f9af4b2ce465191ede6d2a278e3444c62d6b74927', 'backfill (D-184)'),
  ('101_erp_role_and_cost.sql', '7f3b30da9b1581a3e206c412ce973ee3f8fcc65637f4b49f32c217fb7eb2a4e6', 'backfill (D-184)'),
  ('102_schema_migrations.sql', '7ab8c8968fb05f8ae288ba98e8e3d459a4fca228f36a608128fbd60fb9bdff69', 'backfill (D-184)')
on conflict (name) do nothing;
