# RTG PROMOS — cargar una ronda desde un Excel

Esto sustituye a la pantalla de subir ficheros, que el dueño quitó: *«eso de cargar files no,
quita eso: yo te doy la información y tú la subes y punto»*. **Las rondas las carga quien
administra el sistema, con este script.**

Está escrito para que **cualquier sesión futura pueda usarlo leyendo solo esto**.

---

## Lo primero: mirar sin tocar nada

```bash
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
     scripts/promos/cargar.mjs "C:/ruta/al/libro.xlsx"
```

**No escribe nada y no necesita ninguna llave.** Enseña cuántos productos y sugerencias trae el
libro, las columnas de existencias que encuentra, y —lo importante— **los avisos**: todo lo que el
lector decidió no meter y por qué.

Sin llave no puede leer Ajustes, así que no sabe de qué grupo es cada hoja y **las hojas de tienda
se leen como catálogo**; eso hace que cada producto salga como repetido. No es un problema del
libro: es que no se sabe de quién es cada hoja. El propio script lo dice cuando pasa. Para mirar
con los grupos sin usar la llave:

```bash
… scripts/promos/cargar.mjs "libro.xlsx" --grupos=UNO,DOS,TRES
```

`--grupos` es **solo para mirar**: con `--escribir` se rechaza a propósito. Al escribir, los grupos
salen de Ajustes y de ningún otro sitio — una lista escrita a mano metería sugerencias de grupos
que en la base no existen.

## Cargarla de verdad

```bash
node --env-file=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
     scripts/promos/cargar.mjs "C:/ruta/al/libro.xlsx" --etiqueta="9.25.26 Promo" --escribir
```

- `--env-file=.env.local` trae `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`. **Ese
  fichero no está en los worktrees, a propósito** (ver CLAUDE.md): esto se corre desde el checkout
  principal.
- `--etiqueta` es el nombre de la ronda. Si no se pone, el del fichero sin extensión.
- **Sin `--escribir` no escribe.** La bandera es la única forma.

### Qué comprueba antes de escribir

1. que el fichero exista y no pase del tope de tamaño;
2. que el libro se pueda leer como `.xlsx`;
3. que traiga **al menos un producto**, y no más del tope;
4. que ningún código ni grupo pase de los largos que admite la migración 140 — si uno se pasara,
   el `insert` entero fallaría y no diría cuál es la fila mala;
5. y **cruza los grupos con Ajustes**: cuáles tienen hoja, cuáles no, y **qué hojas de productos
   entraron como catálogo**. Esa última línea es la que caza una tienda nueva: si una hoja que
   debería ser de una tienda aparece ahí, es que a esa tienda **le falta su grupo de promociones en
   Datos → Tiendas**.

## Por qué sale un aviso de Node, y por qué no se arregla «de verdad»

`MODULE_TYPELESS_PACKAGE_JSON` sale porque el `package.json` del proyecto no dice
`"type": "module"`. **No se le pone**: eso cambiaría la resolución de módulos de toda la app por un
script. Se apaga con `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`, que silencia **ese** y no los
demás — un `--no-warnings` a secas taparía avisos que sí importan.

El script es `.mjs` y no `.ts` para poder comprobar la versión de Node **antes** de que nada se
parsee: en un Node viejo, un `.ts` revienta con un error de sintaxis que no dice cuál es el
problema. Hace falta **Node 22.6 o más nuevo** (22.6–23.5 quieren además `--experimental-strip-types`;
desde 23.6 va solo).

**No hace falta ninguna dependencia nueva.** Los módulos de verdad —el lector del libro y las
funciones puras— son los `.ts` de `src/lib/promos`, importados tal cual: el script **no reescribe el
lector**, que es lo único que garantiza que no se separen. Funciona sin `tsx` porque esos tres
módulos no tienen ni un import de runtime con el alias `@/`.

---

## NO HAY TRANSACCIÓN. Qué se hace en su lugar

`supabase-js` no ofrece transacciones, así que una carga son varias llamadas. Si el proceso muere a
mitad —red caída, Ctrl-C, la máquina— no hay nada que deshaga lo escrito. Lo que hay:

- **la ronda nace CERRADA** (`closed_at`), que en la migración 140 significa «esta ronda no se
  decide»: el disparador rechaza toda escritura de decisión mientras lo esté. Así que una carga
  interrumpida deja **una ronda cerrada con el catálogo a medias**, sobre la que nadie puede
  aprobar ni rechazar — en vez de una ronda abierta con la mitad de los productos y gente decidiendo
  sobre lo que hay;
- al final **se cuentan** las filas escritas contra las que se mandaron, y **solo si cuadran se
  abre**. O sea que «ronda abierta» quiere decir «el script contó sus filas y salieron»;
- y si falla un paso, **borra la ronda** él mismo: productos y sugerencias cuelgan de ella con
  `on delete cascade`.

No se ha inventado ninguna columna para esto: `closed_at` ya existía y se usa con su significado.
Distinguir «cerrada por el admin» de «carga a medias» **sí** sería una columna nueva, y no está.

### Cómo se ve una ronda coja

Una ronda que quedó a medias **se ve cerrada** en `/promos`, igual que una que un admin cerró a
propósito. Se distinguen por el recuento:

```sql
select r.id, r.label, r.closed_at,
       (select count(*) from public.promo_products    p where p.round_id = r.id) as productos,
       (select count(*) from public.promo_suggestions s where s.round_id = r.id) as sugerencias
  from public.promo_rounds r
 order by r.uploaded_at desc;
```

Compara esos números con los que imprimió el script al leer el libro (o vuelve a correrlo **sin**
`--escribir`, que los dice sin tocar nada). Si no cuadran, la carga se interrumpió.

### Cómo se borra

```sql
delete from public.promo_rounds where id = '<el uuid>';
```

La cascada se lleva sus productos, sus sugerencias **y sus decisiones**. Por eso esto solo se hace
con una ronda recién cargada: si alguien ya decidió sobre ella, se pierde ese trabajo.

---

## Lo que el script deja en el registro de seguridad

Una línea `promo_round_uploaded` con la etiqueta, cuántos productos y sugerencias, el fichero y el
id de la ronda. `actor_id` va **nulo**: quien corre el script no tiene sesión de la app, y esa
columna solo admite un usuario de verdad. Si esa línea no se puede escribir, el script **avisa pero
no deshace nada**: una línea que falta es un problema más pequeño que una ronda a medio cargar.
