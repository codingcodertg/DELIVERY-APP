---
name: registro-de-windows-como-medida
description: "cuando algo «se apaga solo» en Windows, el registro de sucesos fecha la causa; se cruza con las filas de la base por hora"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 82a444c4-d068-486f-a40b-3e73b61f92ca
  modified: 2026-10-10T20:56:53.070Z
---

«El time tracker se me apaga solo» se resolvió cruzando dos relojes: las filas de
`timetracker.sessions` y `Get-WinEvent`. Los cortes coincidían **al segundo** con un bloqueo de
Windows de **9 y 6 segundos** precedido de `Critical Battery Trigger Met`. Sin eso, la hipótesis
habría sido «un bug del latido» y el arreglo habría ido al sitio equivocado.

Lo que sirvió:

- `Get-WinEvent -FilterHashtable @{LogName='System'; Id=1,42,107,506,507; StartTime=...}` — sueño,
  despertar y standby.
- `Microsoft-Windows-Winlogon/Operational` — bloqueo (evento 4) y desbloqueo (evento 5): la
  **duración** del bloqueo es lo que delata un parpadeo frente a «se fue del escritorio».
- `Kernel-Power` Id **524** (`Critical Battery Trigger Met`) y **105** (`Power source change`): 14
  de los segundos en tres horas fue lo que señaló avería de hardware, no de software.
- Recorrer **todos** los logs en una ventana de minutos descartó el tercer corte: no había nada, y
  eso también es un dato («no medido» en vez de inventarle una causa).

**Cómo aplicarlo:** primero fijar el desfase de reloj con un hecho conocido de los dos lados (aquí,
el arranque del proceso contra la primera fila: local = Chicago − 1 h). Alinear sin eso produce
coincidencias falsas. Y mirar el servidor antes de creerse la pantalla,
[[comprobar-la-capa-que-manda]].
