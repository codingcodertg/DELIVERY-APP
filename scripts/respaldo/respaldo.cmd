@echo off
rem La Tarea programada "Respaldo del hub" corre esto cada día. Ver respaldo.mjs.
cd /d "C:\CLAUDE\DELIVERIES APP\deliveries-app"
node --env-file=.env.local scripts\respaldo\respaldo.mjs
