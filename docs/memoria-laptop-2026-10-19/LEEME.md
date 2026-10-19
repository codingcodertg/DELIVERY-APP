# Memoria de la laptop · copia del 2026-10-11

Estos ficheros son la **memoria de Claude Code de la laptop** (`LAPTOP-QKUGV7QN`, proyecto en
`C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\deliveries-app`). Claude no los lee de aquí: los lee de
`~/.claude/projects/<ruta-del-proyecto>/memory/`, fuera del repo. Están en el repo solo para que viajen a la
PC con un `git pull`, porque la memoria es por máquina y no se sincroniza sola (ver `trabajo-en-la-laptop.md`).

## Cómo instalarlos en la PC

En la PC el repo está en `D:\CLAUDE\DELIVERIES APP\deliveries-app`, así que la carpeta es
`%USERPROFILE%\.claude\projects\D--CLAUDE-DELIVERIES-APP-deliveries-app\memory\`.

```powershell
$destino = "$env:USERPROFILE\.claude\projects\D--CLAUDE-DELIVERIES-APP-deliveries-app\memory"
New-Item -ItemType Directory -Force $destino | Out-Null
# 1) Copiar todo MENOS el índice y este LEEME:
Get-ChildItem "docs\memoria-laptop-2026-10-11\*.md" | Where-Object { $_.Name -notin @("MEMORY.md","LEEME.md") } |
  Copy-Item -Destination $destino -Force
# 2) El índice se FUNDE, no se pisa: añadir al MEMORY.md de la PC las líneas que le falten, por nombre de fichero.
```

## Qué cambió desde la copia de la PC del 2026-10-09 (medido con `diff` tras `tr -d '\r'`)

**Nuevas (5)** — sus líneas hay que añadirlas al `MEMORY.md` de la PC:
- `ancla-de-texto-sobrevive-al-mutante.md`
- `linea-base-implausible.md`
- `permisos-los-instala-el-dueno.md`
- `registro-de-windows-como-medida.md`
- `tsc-despues-de-la-prueba.md`

**Cambiadas (4 + el índice)** — gana esta copia, salvo que la PC haya aprendido algo después:
- `laptop-estado-y-limites.md` — ahora dice que se trabaja en la PC desde el 2026-10-11.
- `d-next-tambien-en-el-codigo.md`
- `premisa-heredada-no-es-medicion.md`
- `MEMORY.md` — fundir, no copiar.

Las otras 77 son idénticas a la copia del 2026-10-09.
