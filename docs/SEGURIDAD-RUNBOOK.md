# Runbook de seguridad: la primera hora de un incidente

Para el dueño y los admins de RTG Hub. Lo que sigue es el orden de trabajo cuando salta una alerta de Seguridad, un
correo o un SMS de «seguridad 4/5» o «5/5», o cuando alguien reporta que una cuenta no es suya.

La regla de fondo: **primero contener, después entender**. Cerrar una sesión o bloquear una IP se deshace en un clic.
Borrar evidencia o cambiar contraseñas a ciegas, no.

---

## Quién hace qué

| Quién | Qué hace |
|---|---|
| **Dueño** | Decide si hay que parar algo grande (apagar el acceso de una tienda, cambiar llaves). Recibe el SMS de 5/5. |
| **Admin de guardia** | Triage, contención y registro. Es quien tiene la sesión en Seguridad. |
| **Segundo admin** | Revisa lo que hizo el primero y verifica en Supabase y Vercel. Si solo hay un admin, lo hace el dueño. |

Un admin **no** se cierra desde una alerta: la acción «Cerrar sus sesiones» está apagada para cuentas admin, y el
servidor lo vuelve a comprobar. Si una cuenta admin está comprometida, se hace a mano: cambiar su contraseña en
Supabase Auth y revisar `security_events`.

---

## T+0 a T+5: triage

1. Abrir **Seguridad → Alertas** (la primera sección del panel, con el número de abiertas en la barra de arriba).
2. Leer la severidad y el detector. Una tabla de lo que significan:

| Detector | Qué significa | Sev. | Acción automática |
|---|---|---|---|
| Fallos de entrada a una misma cuenta | ≥10 fallos contra la misma cuenta en 10 min. No se sabe cuál (solo un hash). | 4 | Ninguna |
| Fallos de entrada desde una misma IP | ≥20 fallos desde una IP en 10 min. | 4 | **Bloqueo de la IP 30 min**, salvo que entrara un admin desde ahí o que sea una red compartida |
| Entrada desde un país nuevo | La cuenta entró desde un país que no usaba en 30 días. | 3 | Ninguna |
| Exportación grande / muchas exportaciones | >500 filas o >5 exportaciones en una hora. | 4 | Ninguna |
| Nuevo admin | Un cambio de rol dejó a una cuenta como admin. | 5 | Ninguna |
| Entrar como otra persona fuera de horario | «Entrar como» fuera de 6:00–21:00 hora de Texas. | 4 | Ninguna |
| Peticiones denegadas | >30 en 10 min de una misma persona (o IP). | 3 | Ninguna |
| Límite de peticiones | ≥50 rechazos del límite desde una IP en 10 min. | 3 | Ninguna |
| Se detuvo el cron del Time Tracker | No hay latido en 15 min. | 3 | Ninguna |

3. Preguntarse: **¿es una persona real haciendo algo raro, o es un robot?** Un robot tiene muchos fallos seguidos, sin
   entradas buenas, y de una IP que no es de ninguna tienda.

## T+5 a T+15: contener

Solo lo necesario, y en este orden:

1. **Si la IP es sospechosa**: en la alerta, «Bloquear IP 24 h». Se puede quitar después en la sección **Bloqueos
   activos** («Quitar»).
2. **Si una cuenta es sospechosa** (una persona de la empresa, no admin): «Cerrar sus sesiones». Esa persona vuelve a
   entrar con su contraseña; si la contraseña también era de otro, sigue con el paso 3.
3. **Si la contraseña se filtró**: restablecerla desde Usuarios (el admin la cambia y la persona la cambia al entrar).
4. **Si una cuenta quedó como admin sin pedirlo** (detector «Nuevo admin»): quitarle el rol en Usuarios de inmediato y
   revisar qué hizo esa cuenta con su tiempo como admin (Eventos, filtro «Cambio de admin»).
5. **Si todo apunta a un problema de la propia app o de una llave**: ir a «Cómo rotar llaves» más abajo, sin esperar.

Marca la alerta como **vista** («Marcar vista») mientras la investigas, y **cerrada** solo cuando quedó resuelta.

## T+15 a T+30: alcance

Qué más se tocó. En **Seguridad → Eventos**, filtrar por tipo:

- **Entrada** (`auth`): de qué IPs y países entró esa cuenta, y en qué horas.
- **Exportación** (`export`): qué reportes salieron y cuántas filas. Un reporte grande fuera de horario es lo primero
  que mirar si sospechas de robo de datos.
- **Cambio de admin** (`admin`) e **Entrar como** (`impersonation`): quién cambió permisos y cuándo.
- **Petición denegada** (`api_denied`): si una cuenta intentó cosas a las que no tiene acceso.

Para lo que el panel no muestra, revisar en la base (Supabase → SQL, solo lectura):

```sql
-- Qué pasó desde una IP, últimas 24 h
select ts, categoria, usuario_id, rol, metodo, ruta, estado, filas
from public.sec_events
where ip = '203.0.113.7' and ts > now() - interval '24 hours'
order by ts desc;
```

Y en **Vercel → Logs** de la app (filtrar por `[seguridad]` o `[cron seguridad]`) para ver si el monitoreo mismo tuvo
errores.

## T+30 a T+45: recuperar

- Quitar los bloqueos que ya no hagan falta (**Bloqueos activos**). Un bloqueo automático de 30 min se va solo.
- Si hubo sesiones robadas: las cuentas afectadas ya salieron; confirmar que vuelven a entrar desde sus dispositivos
  reconocidos (Dispositivos).
- Si una llave se usó indebidamente, rotarla (sección siguiente) y comprobar que la app sigue funcionando.
- Dejar la alerta **cerrada** con una nota de lo que se hizo (el campo de acciones queda en el registro).

## T+45 a T+60: comunicar

- **Al dueño**: qué pasó, qué datos pudieron verse, qué se contuvo, qué falta. Sin adornos. Si hay datos personales de
  clientes o empleados, el dueño decide si hay que avisar a alguien fuera de la empresa.
- **A las personas afectadas**: un aviso corto, sin culpar a nadie, con lo que tienen que hacer (cambiar contraseña,
  revisar sus dispositivos).
- Escribir el resumen en **docs/** (o en el canal del equipo) con: línea de tiempo, alertas involucradas, decisiones y
  qué se cambió para que no vuelva a pasar.

---

## Dónde se hace cada cosa en el panel

- **Seguridad → Alertas**: lista de alertas (solo abiertas por defecto; «Solo abiertas» para ver todas), con
  «Marcar vista», «Cerrar», «Bloquear IP 24 h» y «Cerrar sus sesiones».
- **Seguridad → Bloqueos activos**: las IPs bloqueadas ahora mismo, de quién vino el bloqueo (automático o admin) y
  hasta cuándo. «Quitar» lo deshace.
- **Seguridad → Eventos**: los últimos 200 eventos, con filtro por tipo.
- **Seguridad → Usuarios / Dispositivos**: las pantallas de siempre: quién tiene qué, aprobar o revocar un dispositivo,
  cerrar la web para un rol.
- **Salud del sistema** (enlace en la barra de arriba): Disk IO, escrituras y publicaciones, por si el incidente es
  de carga y no de seguridad.

---

## Cómo rotar llaves

Hacerlo en este orden para no dejar la app rota a mitad:

1. **Llave de servicio de Supabase** (`SUPABASE_SECRET_KEY`): en Supabase → Project Settings → API Keys, crear la nueva
   «secret key»; luego en **Vercel → Project → Settings → Environment Variables** actualizar `SUPABASE_SECRET_KEY` para
   Production (y Preview si se usa); redesplegar; después revocar la anterior en Supabase. Si la clave vieja también
   estaba en `SUPABASE_SERVICE_ROLE_KEY`, actualizarla igual o quitarla.
2. **Secreto de los cron** (`CRON_SECRET`): cambiar el valor en Vercel y en los secretos de GitHub Actions (el workflow
   `tt-cron` lo usa). Si se cambia en uno y no en el otro, el cron empieza a dar 401 y el latido avisa en 15 min.
3. **Llave de Resend** (`RESEND_API_KEY`): crear otra en Resend, actualizar en Vercel, revocar la anterior.
4. **RingCentral** (`RINGCENTRAL_CLIENT_SECRET` y `RINGCENTRAL_JWT`): regenerar en el portal de RingCentral y
   actualizar en Vercel.
5. **Contraseñas de usuarios**: no se rotan en bloque. Cerrar las sesiones de quien corresponda y forzar cambio.

Después de cualquier rotación: abrir la app, entrar con una cuenta de prueba, y confirmar que llegan los correos y el
cron tiene latido (sección de Alertas, o `/api/cron/seguridad?verify=1` con el secreto).

---

## Qué revisar en Supabase y Vercel

**Supabase**
- *Logs de Auth*: intentos fallidos y de dónde vienen. Coincide con las alertas de fallos de entrada.
- *Logs de API / Postgres*: errores de permisos o de RLS que aparezcan de golpe (puede ser un ataque o un cambio mal hecho).
- *Advisors* (Security): avisos de tablas sin RLS o funciones con permisos de más.
- *Disk IO* (Reports): un pico sin explicación puede ser un robot consultando sin parar.

**Vercel**
- *Logs de la función* con `[seguridad]`: fallos al escribir eventos o alertas.
- *Logs de `/api/cron/seguridad`*: cada 5 min deben aparecer con `eventos=…`. Si no aparecen, el monitoreo está ciego.
- *Deployments*: qué se publicó justo antes del incidente.

---

## Variables de entorno del monitoreo

| Variable | Para qué | Si falta |
|---|---|---|
| `SEGURIDAD_ALERTA_EMAILS` | Correos de las alertas (separados por coma). | Se usan los correos de los admins activos. |
| `SEGURIDAD_ALERTA_TELEFONOS` | SMS para alertas de 5/5 (separados por coma, formato US). | No se mandan SMS; la alerta sigue en el panel y en el correo. |
| `RESEND_API_KEY` + `RESEND_EMAIL_DOMAIN` (o `NOTIFY_FROM_EMAIL`) | Envío de correos. | No hay correos; las alertas quedan en el panel. |
| `RINGCENTRAL_*` | SMS. | Igual que arriba. |
| `CRON_SECRET` | Puerta de `/api/cron/seguridad` y del cron del Time Tracker. | Falla cerrado: nadie corre el cron. |

Si `SEGURIDAD_ALERTA_EMAILS` no existe y no hay admins con correo, las alertas de 4/5 no llegan a nadie por correo:
revisar el panel cada mañana hasta que se arregle.
