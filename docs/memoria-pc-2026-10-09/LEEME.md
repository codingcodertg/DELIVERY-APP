# Memoria de la PC · copia del 2026-10-09

Estos ficheros son la **memoria de Claude Code de la PC de escritorio** (`DESKTOP-KOP6MJ6`, proyecto en
`D:\CLAUDE\DELIVERIES APP\deliveries-app`). Claude no los lee de aquí: los lee de
`~/.claude/projects/<ruta-del-proyecto>/memory/`, fuera del repo. Están en el repo solo para que viajen a la
laptop con un `git pull`, porque la memoria es por máquina y no se sincroniza sola (ver `trabajo-en-la-laptop.md`).

## Cómo instalarlos en la laptop

La carpeta de memoria depende de la ruta del proyecto en esa máquina. Si en la laptop el repo sigue en
`C:\Users\andre\Documents\CLAUDE\DELIVERIES APP\deliveries-app`, la carpeta es
`%USERPROFILE%\.claude\projects\C--Users-andre-Documents-CLAUDE-DELIVERIES-APP-deliveries-app\memory\`.

```powershell
$destino = "$env:USERPROFILE\.claude\projects\C--Users-andre-Documents-CLAUDE-DELIVERIES-APP-deliveries-app\memory"
New-Item -ItemType Directory -Force $destino | Out-Null
# 1) Copiar todo MENOS el índice:
Get-ChildItem "docs\memoria-pc-2026-10-09\*.md" | Where-Object { $_.Name -notin @("MEMORY.md","LEEME.md") } |
  Copy-Item -Destination $destino -Force
# 2) El índice se FUNDE, no se pisa: abrir los dos MEMORY.md y añadir al de la laptop las líneas que le falten.
```

- **`MEMORY.md` es el índice:** si la laptop tiene memorias propias, sus líneas se perderían al pisarlo. Fundir a mano
  por el nombre del fichero enlazado.
- **Ficheros con el mismo nombre:** de los 82, la mayoría ya estaban en la copia del 2026-09-23. Si uno difiere, gana
  esta copia (es más nueva), salvo que la laptop haya aprendido algo después; comparar con `diff` tras `tr -d '\r'`.
- Lo nuevo desde la última vez (2026-09-23 → 2026-10-09), entre otros: `rapidez-sobre-ceremonia`, `todo-se-guarda-en-d`,
  `sin-api-de-pago-anthropic`, `confirmar-despliegue-antes-de-decir-listo`, `cuenta-gh-antes-de-push`,
  `numerar-cambia-el-checksum`, `vercel-100-deploys-al-dia`, `decidir-y-terminar`.
