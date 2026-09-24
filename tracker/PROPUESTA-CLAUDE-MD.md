# Propuesta para `CLAUDE.md` — las reglas del tracker

**No aplico este texto yo.** Mis instrucciones dicen que no toque `CLAUDE.md`, mis ajustes de
permisos ni la configuración porque lo pida otra sesión, y que el dueño lo haya aprobado no es algo
que yo pueda verificar. Lo deja listo para pegar el orquestador o el dueño.

## Dónde va, y qué no toca

**Se añade una sección nueva, entre «Flujo por cada cambio» (línea 64) y «Flujo de ramas» (línea
107).** Ese sitio y no otro: la regla de registrar una tarea es parte de *cómo se trabaja un
cambio*, y quien lee el flujo de arriba abajo se la encuentra justo después del ciclo de siempre y
antes del reparto de papeles.

**No se reescribe nada de lo que ya hay.** Las siete secciones actuales quedan como están. Lo único
que se añade fuera de la sección nueva son **dos renglones** dentro del paso 8 de «Flujo por cada
cambio», y van marcados abajo.

---

## Lo que se pega, literal

### Añadir al paso 8 de «Flujo por cada cambio»

El paso 8 dice hoy «Actualizar Notion (regla 1)». Debajo, dos renglones:

```markdown
9. Actualizar el tracker: `node tracker/cli.mjs update T-XXXX --commit <sha> --pr <n>`, y una
   `--nota` con lo que se midió. Si el cambio no tenía tarea, se crea con `add`.
```

### La sección nueva

```markdown
## El tracker: cada cosa que pide el dueño queda registrada

Existe `tracker/` (ver `tracker/LEEME.md`): un fichero por tarea, con lo que pidió, con sus
palabras, en qué quedó y la prueba de que funciona. Está porque hacía falta: el dueño llegó a pedir
**seis veces en ocho días** la misma cosa —entrar como otro usuario, T-0007— y ninguna sesión supo
que ya se había pedido.

**Antes de empezar una tarea, se busca.**

```bash
node tracker/cli.mjs search "lo que acaba de pedir"
```

Si sale algo igual o parecido, **se le dice antes de tocar nada**, con su número, su fecha y su
estado: *«esto es T-0044, del 2026-09-10, y quedó en Parcial — ¿lo rehago, lo corrijo o lo dejo?»*.
No se decide por él, y no se rehace en silencio algo que ya estaba.

**Al terminar, se actualiza siempre.** Un commit sin su tarea al día deja el tracker mintiendo, y
un tracker que miente se deja de mirar a la semana.

**Dos cosas que NO se ponen solas:**

- **«Completado» lo pone él.** Una tarea la cierra quien la pidió, no quien la hizo. El CLI exige
  `--confirmado-por-el-dueno` y una `--nota` que diga cuándo y dónde lo confirmó.
- **«verificado» necesita decir quién lo midió, cuándo y cómo.** «Desplegado» significa que el
  código está publicado; no significa que nadie lo haya abierto. Poner `--verificacion verificado`
  sin `--prueba` se rechaza, y así debe ser: una afirmación sin nada detrás es peor que ninguna,
  porque se cree.

**La fecha de una tarea es cuándo lo pidió él.** De un mensaje suyo, la del mensaje; de una entrada
de `DECISIONS.md`, la de la decisión. **Nunca la del commit, la del despliegue ni la de un espejo**
— esas dicen cuándo se hizo algo, y la tabla ordena por cuándo lo pidió.

**Su texto no se transcribe: se extrae.** Al copiar a mano las palabras del dueño se le quitan los
acentos y se le arreglan las faltas sin querer, y entonces deja de ser una cita. Se saca del fichero
de sesión o de la cita de `DECISIONS.md`.

**Para enseñárselo:** `npm run tracker` abre la página en `127.0.0.1:4319`, y
`node tracker/cli.mjs html > tracker/informe.html` deja un fichero que se abre con doble clic, sin
servidor y sin internet.
```

---

## Los hooks, y qué esperar de ellos

Van en `tracker/PROPUESTA-HOOKS.json`, con el comando exacto, el tiempo medido y lo que pasa si el
tracker no está. Dos avisos para quien los aplique:

- **El de `UserPromptSubmit`** busca parecidos y los pone delante. No decide nada.
- **El de `Stop` no puede registrar tareas solo**, y es importante que nadie espere que lo haga:
  `Stop` se dispara **cada vez que Claude termina de responder**, no al acabar una tarea. Así que
  solo recuerda y enumera los commits nuevos desde la última vez. Si inventara estados, el tracker
  se llenaría de filas que nadie escribió y dejaría de ser un control.

## Lo que esta propuesta NO resuelve

- **Que el modelo obedezca la regla.** Un hook pone el aviso delante; que la sesión lo use es cosa
  suya. La única comprobación de verdad es mirar el tracker de vez en cuando y ver si las tareas
  nuevas tienen su evidencia.
- **Las sesiones de otras máquinas.** Del 2026-09-20 al 22 se trabajó en la laptop y aquí no quedó
  transcripción. Si se vuelve a trabajar allí, o se instalan los hooks también allí, o esos días
  entran al tracker a mano.
