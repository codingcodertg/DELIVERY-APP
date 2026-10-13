# Plan — 170 · Talones de pago de Time Tracker (`timetracker.pay_rates`, `timetracker.paystubs`)

**Estado:** PLAN EN PAPEL. Migración escrita y commiteada en la rama `talones-de-pago`; **no aplicada
en ninguna base.** La aplica el orquestador tras el merge, con respaldo (`pg_dump`) reciente.
**Fecha:** 2026-10-13 · **Origen:** pedido del dueño, «haz los paystubs para el time tracker app».
**Decisión:** la entrada `D-538` de `DECISIONS.md` (talones de pago).

---

## Qué crea

Dos tablas nuevas en `timetracker`. **No toca ninguna tabla, política, función ni grant existente.**

| Tabla | Qué guarda | Clave |
|---|---|---|
| `timetracker.pay_rates` | La tarifa por hora de cada persona (presencial): `hourly_rate`, `ot_multiplier` (1.5 por defecto), `ot_weekly_hours` (40 por defecto). | `employee_uid` (PK, FK a `public.profiles` con `on delete cascade`) |
| `timetracker.paystubs` | La foto de cada talón pagado: horas, tarifa, líneas por proyecto (remoto), bruto, ajustes, neto. Inmutable por diseño (la app no la actualiza nunca; solo inserta, y borra la de un lote remoto que se reabre). | `id`; únicos parciales `(employee_uid, period_start) where kind='onsite'` y `(payroll_id) where payroll_id is not null` |

**Cambio respecto al diseño inicial:** se pedía `unique (employee_uid, kind, period_start)`. Para el
remoto no vale: un remoto puede cobrar dos lotes en la misma semana (cada lote es un «Pago» propio en
Nómina › Remoto) y el segundo talón chocaría. Se parte en dos índices únicos parciales.

---

## 1. Inventario de LECTURAS

| Quién | Dónde | Qué | Rol |
|---|---|---|---|
| `payRates()` | `timetracker-data-provider.tsx` | `pay_rates` entera (4 columnas) | admin TT, desde Nómina › Presencial |
| `paystubsForPeriod(periodStart)` | idem | `paystubs` de un periodo | admin TT, Nómina › Presencial y Remoto |
| `paystubsForYear(year, uids)` | idem | `paystubs` de esas personas en el año (acumulado) | admin TT |

Nadie más lee. El empleado no tiene pantalla que las pida (D-489: el empleado no ve dinero).

## 2. Inventario de ESCRITURAS

| Quién | Qué | Cuándo |
|---|---|---|
| `savePayRate` | `upsert` en `pay_rates` | el admin edita «Tarifa/h» de una persona |
| `insertPaystubs` | `insert` en `paystubs`, uno a uno; el `23505` (ya existe) se ignora | «🧾 Talones de la semana» (presencial), «Marcar pagado» y «🧾 Talón» (remoto) |
| `removePaystubOfPayroll` | `delete` en `paystubs` por `payroll_id` | «Reabrir» un lote remoto |
| `on delete set null` | `paystubs.payroll_id` | si se borra un `payrolls` por otra vía |

En **modo capacitación** (D-490) las tres escrituras están clasificadas como `bloqueada` en
`capacitacion-datos.ts`: no llegan a la base.

## 3. Políticas, literales

```sql
create policy "tt pay_rates admin" on timetracker.pay_rates
  for all to authenticated
  using ((select public.is_timetracker_admin()))
  with check ((select public.is_timetracker_admin()));

create policy "tt paystubs admin" on timetracker.paystubs
  for all to authenticated
  using ((select public.is_timetracker_admin()))
  with check ((select public.is_timetracker_admin()));
```

Una sola política por tabla, FOR ALL. No hay otra permisiva que se sume con OR (la migración lo
comprueba: `pg_policies` da exactamente 1 por tabla). `is_timetracker_admin()` es la de la 058
(`security definer`, devuelve `false` y nunca `NULL`).

Grants: `select, insert, update, delete` a `authenticated`, `all` a `service_role`, nada a `anon`
(el reparto de la 061 menos lo que retiró la 081).

## 4. Qué no debe romperse

- Nómina › Remoto: el cálculo de líneas (`calcLinesFor`) se movió a `lineasDeNomina` sin cambiarlo;
  sus pruebas de fuente (`total-de-nomina.test.ts`, `tienda-y-puesto.test.ts`) siguen verdes.
- «Marcar pagado»: si guardar el talón falla (p. ej. la 170 aún no está aplicada), **el pago se
  hace igual** — el fallo se traga con un `console.warn` y el talón se construye al imprimirlo.
- «Reabrir»: con la 170 sin aplicar, el `delete` de `removePaystubOfPayroll` vuelve con «la tabla no
  existe» (`42P01` / `PGRST205`) y eso se ignora: no hay talón que borrar. Cualquier otro error sí
  para el reabrir (con su alerta de siempre), para no dejar un talón huérfano que sumaría en el
  acumulado. No medido contra una base real: los dos códigos salen de la documentación de
  PostgREST/Postgres, no de una prueba.
- Nómina › Presencial: sin la 170, `payRates()` falla; la pantalla sigue y enseña el aviso
  «No se pudieron leer las tarifas…». Aprobar, editar y cerrar periodo no dependen de esto.
- `summarize` (fichaje) gana un parámetro opcional; los llamadores existentes no lo pasan y siguen
  con 40 h (probado en `talon-de-pago.test.ts`, «1 · summarize con umbral»).

## 5. Matriz de pruebas por rol (a mano, dentro de `begin; … rollback;`)

Preparación, dentro de la transacción: elegir cuatro perfiles reales por su rol, sin escribir sus
nombres en ningún sitio, y suplantarlos con
`set local role authenticated; set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';`.

| # | Rol | Acción | Esperado |
|---|---|---|---|
| R1 | admin TT (`timetracker_role='admin'`) | `insert into timetracker.pay_rates (employee_uid, hourly_rate) values ('<empleado>', 20)` | pasa; `ot_multiplier` = 1.50, `ot_weekly_hours` = 40.00 |
| R2 | admin TT | `select * from timetracker.pay_rates` | ve la fila de R1 |
| R3 | admin TT | `insert into timetracker.paystubs (employee_uid, kind, period_start, period_end, pay_date, gross, net) values ('<empleado>','onsite','2026-10-02','2026-10-08','2026-10-09',800,800)` | pasa |
| R4 | admin TT | repetir R3 | `23505` (índice `paystubs_onsite_unico`) |
| R5 | admin TT | dos `remote` del mismo empleado y periodo con `payroll_id` distintos | pasan los dos |
| R6 | admin TT | `remote` con un `payroll_id` ya usado | `23505` (`paystubs_lote_unico`) |
| R7 | admin TT | `insert … hourly_rate = -1` / `ot_multiplier = 0.5` / `kind = 'x'` | rechazado por `check` |
| E1 | empleado TT (`timetracker_role='employee'`) | `select * from timetracker.pay_rates` / `paystubs` | **0 filas** (aunque R1/R3 sean suyas) |
| E2 | empleado TT | `insert into timetracker.pay_rates …` (su propia fila) | rechazado: `new row violates row-level security policy` |
| E3 | empleado TT | `update timetracker.paystubs set net = 9999` | 0 filas afectadas |
| M1 | gerente de fichaje sin `timetracker_role` admin | igual que E1–E3 | igual que el empleado |
| N1 | sin acceso a TT (`timetracker_role is null`) | igual que E1–E3 | igual que el empleado |
| A1 | `anon` (`set local role anon`) | `select * from timetracker.paystubs` | `permission denied` (sin grant ni usage) |

Contar filas con `select count(*)` y no con lo que pinta un cliente. Al final, `rollback;`.

## 6. Reversión

```sql
drop table if exists timetracker.paystubs;
drop table if exists timetracker.pay_rates;
delete from public.schema_migrations where name = '170_talones_de_pago.sql';
```

Borrar `paystubs` pierde los talones ya emitidos: antes de revertir en producción,
`copy (select * from timetracker.paystubs) to …` o un `pg_dump -t timetracker.paystubs`.

## 7. Aplicación (orquestador, tras el merge)

1. `pg_dump` reciente guardado en `D:\CLAUDE`.
2. `node scripts/db/migrate-status.mjs` → la 170 sale PENDIENTE.
3. Aplicar el `.sql` (sin `begin/commit` propios: el bloque `do $chk$` revienta si falta algo).
4. `node scripts/db/migrate-status.mjs` → la 170 OK con checksum
   `947b87f48132340a65d812a1b4bb934224d7780b8b49b7cb8be28d8f89ad8ac1` (no lleva `D-NEXT` dentro, así
   que numerar la decisión no cambia este checksum).
