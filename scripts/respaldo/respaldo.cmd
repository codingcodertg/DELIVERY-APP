@echo off
rem La Tarea programada "Respaldo del hub" corre esto cada día. Ver respaldo.mjs.
rem Con --revisa (al iniciar sesión) solo avisa si el último respaldo bueno tiene más de 26 h (D-1205).
cd /d "C:\CLAUDE\DELIVERIES APP\deliveries-app"
node --env-file=.env.local scripts\respaldo\respaldo.mjs %*
