# Memoria de la laptop · copia del 2026-09-23

Estos 53 ficheros son la **memoria de Claude Code de la laptop** (`LAPTOP-QKUGV7QN`). No viven aquí:
viven en `~/.claude/projects/<ruta-del-proyecto>/memory/`, fuera del repo, y **Claude los lee de
ahí, no de aquí**. Están en el repo por una sola razón: que viajen a la otra PC con un `git pull`,
porque la memoria es por máquina y no se sincroniza sola.

## Cómo instalarlos en la otra PC

```powershell
Copy-Item "docs\memoria-laptop-2026-09-23\*.md" `
  "$env:USERPROFILE\.claude\projects\C--Users-andre-Documents-CLAUDE-DELIVERIES-APP-deliveries-app\memory\" -Force
```

Ojo con dos cosas antes de copiar:

1. **`MEMORY.md` es el índice** y se sobrescribe entero. Si la otra PC tiene memorias propias que la
   laptop no tiene, sus líneas del índice se pierden. Mirar primero qué hay allá; si hay algo que no
   está en esta copia, fundir los dos índices a mano en vez de pisar.
2. **`-Force` pisa los ficheros con el mismo nombre.** Una memoria con el mismo nombre pero distinto
   contenido en la otra PC desaparece.

## Qué son

Una lección por fichero, escrita cuando algo salió mal y costó tiempo: cómo se caza una prueba que no
puede fallar, por qué un `grep` de una línea no ve lo repartido en varias, qué esconde un `Math.round`,
por qué una tubería tapó un CI en rojo. `MEMORY.md` las lista con una línea cada una.

**Esta copia envejece.** Es del 2026-09-23; la memoria viva sigue siendo la de `~/.claude` de cada
máquina. Si dentro de un mes esto y la de la máquina no dicen lo mismo, **gana la de la máquina**.
Si se vuelve a traspasar, se hace una copia nueva en vez de confiar en esta.
