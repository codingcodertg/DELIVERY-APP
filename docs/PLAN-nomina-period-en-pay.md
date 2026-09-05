# Plan — Nómina: "Period" desaparece como pestaña y vive dentro de "Pay"

**Fecha:** 2026-09-04 · **Pedido por:** Andrés · **Estado:** plan en papel,
pendiente de aprobación · **Decisión:** `D-NEXT` al fusionar

**Petición literal:** *"en time tracker, period y pay dan diferentes datos entonces
quiero que elimines period y prácticamente si tenía diferente info a pay que lo
merge"*.

## 1. Por qué dan datos distintos (medido, con archivo:línea)

Son **dos cosas a la vez**: dos definiciones distintas a propósito, y encima varios
bugs. Separarlas importa, porque borrar la pestaña no arregla los bugs y sí pierde
lo que Period hacía bien.

**A propósito (D-102, D-117, D-118):**
- Period muestra **horas** de las dos vías (fichaje y sesiones cronometradas) lado a
  lado, sin sumarlas, y marca a quien tiene las dos (`revisar`): es *el sitio donde
  se decide por cuál vía se paga*. Fuente única: la vista SQL
  `timetracker.period_hours` (migración 086).
- Pay muestra **dinero y estados** (aprobar, cerrar periodo, pagar), en dos
  secciones plegables: En sitio (`PayrollTimesheets`) y Remoto (`ManagerReports`).

**Bugs / incoherencias que hacen que "no cuadre":**

| # | Qué | Dónde | Efecto |
|---|---|---|---|
| 1 | La sección Remoto de Pay **no lee `?period=`**: tiene su propio calendario en estado interno y `PayrollTabs` ni le pasa la prop | `ManagerReports.tsx:60`, `PayrollTabs.tsx:64` | Navegas a otra semana y Remoto se queda en la actual. D-164 lo dejó así a conciencia como deuda |
| 2 | `settings.payPeriod` puede ser quincenal o mensual; Period siempre es semanal | `helpers.ts:190-195` | 14 días contra 7: nunca cuadra |
| 3 | Sesiones: Period usa `start_ms` en Chicago; Remoto usa la columna `date` escrita en Tegucigalpa | `086:61` vs `page.tsx:566` | Sesiones de 23:00-00:00 caen en días distintos |
| 4 | En sitio usa una ventana fija de 7×86400000 ms (no respeta el cambio de horario); Period usa `at time zone` | `reports.ts:273-274` vs `086:39` | En las semanas de DST un fichaje aparece en una y no en la otra |
| 5 | En sitio filtra `active = true` y por tienda visible; Period no filtra | `reports.ts:280-288` vs `086:82-84` | **Un empleado desactivado con fichajes sale en Period y no en Pay** — el caso más probable hoy |
| 6 | Sesiones abiertas: Period exige duración > 0; Remoto suma las `is_live` parciales | `086:65` vs `ManagerReports` | Remoto va por delante durante el día |
| 7 | Redondeo por fila en SQL (Period) contra minutos sumados y redondeo final (Pay) | `086:77`, `payroll.ts:90` | centésimas |

Y dos hallazgos aparte: Period **no está traducida** y su pie enlaza a
`/timetracker/reports`, que redirige a la propia pantalla. Y la prueba
`period.test.ts` **reimplementa** la función en vez de importarla: no protege nada.

## 2. Lo que se perdería borrando Period a lo bruto

La comparación lado a lado, la marca `revisar` calculada con datos reales del
periodo (en Pay solo hay una aproximación por `worker_type`), el tipo deducido
`guessed` con su aviso, el total "Everyone", los subtotales por vía, la navegación
por URL (`?period=`, la única enlazable), y la visibilidad de inactivos. Todo eso
existe para cumplir D-102: decidir por cuál vía se paga a quien tiene las dos.

## 3. Diseño: Period pasa a ser la cabecera de Pay

Una sola pestaña. Encima de las dos secciones plegables, **una tira de totales**
(fichaje · proyecto · Everyone) más los dos avisos (`revisar`, `guessed`), siempre
visible, con el mismo `period_hours` ya montado en servidor. Y la marca de doble
conteo por persona en la sección En sitio pasa a leer `period_hours.revisar`, que
es el dato real.

**Condición previa, en su propio commit, antes de fusionar nada:** la sección
Remoto pasa a leer `?period=` como fuente única (prop desde `PayrollTabs`) y su
selector interno desaparece. Sin esto, quitar Period deja dos calendarios
descoordinados y ningún sitio para compararlos: exactamente lo que D-117 y D-164
decían resolver. D-164 avisó de que cambiar la fuente de la fecha en la misma
tanda que la mudanza "es como se rompe una nómina": por eso va aparte y primero.

## 4. Alcance

- **Sí:** `PayrollTabs.tsx`, `payroll/page.tsx` (la cabecera), `PayrollTimesheets.tsx`
  (marca `revisar`), `ManagerReports.tsx` (recibir `period`, quitar su selector),
  traducción de lo que era Period, quitar el enlace circular del pie, y que
  `period.test.ts` importe la función real.
- **No:** la aritmética. `period_hours` y `lib/clockin/payroll.ts` no se tocan
  (D-117: no crear "una segunda aritmética de nómina"). Los bugs 2, 3 y 4 son
  **de cálculo y afectan a lo que se paga**: no se arreglan "de paso" en una rama
  de interfaz; van en su propia rama con plan y pruebas. Quedan anotados.
- **No:** ninguna migración, ninguna escritura nueva.

## 5. Verificación

`verify.mjs`; que el auditor compruebe que la cabecera reproduce los mismos números
que daba Period para el mismo `?period=` (misma vista SQL, misma consulta); que la
sección Remoto cambia de semana al cambiar la URL; que no queda ni un `t()` sin
clave (la prueba de D-187 lo hace cumplir). **Nada dibuja pantallas en este repo:**
la prueba real es el dueño abriendo Nómina en dos semanas distintas.

## 6. Decisión (`D-NEXT`)

Qué se pidió, por qué difería (tabla de arriba), qué se decidió conservar y por
qué (D-102), la condición previa del calendario y por qué va aparte (D-164), y los
tres bugs de cálculo que quedan abiertos con su archivo:línea.
