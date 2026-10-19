// Traspaso ERP §5.1(b), aprobado por el dueño el 2026-10-18: aprobar los borradores (product_requests
// pending / type new) cuyo producto tiene categoría Y proveedor. Los demás quedan para revisión.
//
//   node --env-file=.env.local scripts/erp-handoff/aprueba-borradores.mjs            # en seco: solo cuenta
//   node --env-file=.env.local scripts/erp-handoff/aprueba-borradores.mjs --ensayo   # escribe y hace ROLLBACK
//   node --env-file=.env.local scripts/erp-handoff/aprueba-borradores.mjs --escribe  # de verdad (COMMIT)
//   --actor=<uuid>   otro admin del ERP como firmante (por defecto, ANDRES UGARTE)
//
// Mecanismo (el de la app, no UPDATEs crudos): por cada solicitud, erp.decide_request(id, true, nota)
// —cierra la solicitud: status='approved', decided_by=auth.uid()— y, si el producto sigue en borrador,
// erp.publish_product(product_id) —record_status='published', approved_by=auth.uid(), approved_at=now().
// Las dos son SECURITY DEFINER y exigen erp.current_app_role()='admin' (profiles.erp_role del auth.uid()),
// así que la sesión se firma con set_config('request.jwt.claims') del admin. Los triggers de la 174
// (audit_products, audit_product_requests) dejan el antes/después con ese actor en erp.audit_log.
//
// Idempotente: solo toca solicitudes pending; un producto ya publicado no se vuelve a publicar.
// Excluye AMC100DUP (marcador de duplicado de AMC100, no un producto; §5.1).
import { conecta, actuaComo, adminActor, flags } from "./_db.mjs";

const SKUS_EXCLUIDOS = ["AMC100DUP"];
const NOTA = "Aprobación en lote del traspaso ERP §5.1(b) (dueño, 2026-10-18): borrador con categoría y proveedor";

const argv = process.argv.slice(2);
const f = flags(argv);
const ensayo = argv.includes("--ensayo");
const modo = f.escribe ? "ESCRIBE" : ensayo ? "ENSAYO (rollback)" : "EN SECO";

const c = await conecta();
try {
  await c.query("begin");
  const actor = await adminActor(c, f.actor);
  await actuaComo(c, actor.id);
  const quien = await c.query("select auth.uid() uid, erp.current_app_role() r");
  if (quien.rows[0].uid !== actor.id || quien.rows[0].r !== "admin") throw new Error("La sesión no quedó firmada como admin");

  const { rows: pend } = await c.query(`
    select r.id, r.product_id, p.sku, p.record_status,
           (p.category_id is not null) has_cat, (p.vendor_id is not null) has_vendor
      from erp.product_requests r join erp.products p on p.id = r.product_id
     where r.status = 'pending' and r.type = 'new' and r.requester_status = 'ready'
     order by r.id`);
  const excl = pend.filter((r) => SKUS_EXCLUIDOS.includes(r.sku));
  const elegibles = pend.filter((r) => r.has_cat && r.has_vendor && !SKUS_EXCLUIDOS.includes(r.sku));
  const quedan = pend.length - elegibles.length - excl.length;
  console.log(`[${modo}] actor ${actor.full_name} (${actor.id})`);
  console.log(`pendientes new/ready: ${pend.length} · elegibles (cat+vendor): ${elegibles.length} · excluidas: ${excl.map((r) => r.sku).join(",") || 0} · quedan para revisión: ${quedan}`);
  console.log(`  sin categoría: ${pend.filter((r) => !r.has_cat).length} · sin proveedor: ${pend.filter((r) => !r.has_vendor).length} · sin ninguno: ${pend.filter((r) => !r.has_cat && !r.has_vendor).length}`);

  if (!f.escribe && !ensayo) { await c.query("rollback"); process.exit(0); }

  let aprobadas = 0, publicadas = 0, yaPublicadas = 0;
  for (const r of elegibles) {
    await c.query("select erp.decide_request($1, true, $2)", [r.id, NOTA]);
    aprobadas++;
    if (r.record_status === "draft") { await c.query("select erp.publish_product($1)", [r.product_id]); publicadas++; }
    else yaPublicadas++;
  }
  const { rows: [post] } = await c.query(`
    select (select count(*) from erp.product_requests where status='pending' and type='new') pend,
           (select count(*) from erp.products where record_status='draft') drafts,
           (select count(*) from erp.products where approved_by=$1 and approved_at > now() - interval '5 minutes') firmados,
           (select count(*) from erp.audit_log where actor=$1 and at > now() - interval '5 minutes') auditados`, [actor.id]);
  console.log(`aprobadas: ${aprobadas} · publicadas: ${publicadas} · ya estaban publicadas: ${yaPublicadas}`);
  console.log(`después: pendientes ${post.pend} · borradores ${post.drafts} · firmados por el actor ${post.firmados} · filas de auditoría del actor ${post.auditados}`);
  await c.query(f.escribe ? "commit" : "rollback");
  console.log(f.escribe ? "COMMIT" : "ROLLBACK");
} catch (e) {
  await c.query("rollback").catch(() => {});
  console.error("ERROR, nada escrito:", e.message);
  process.exitCode = 1;
} finally {
  await c.end();
}
