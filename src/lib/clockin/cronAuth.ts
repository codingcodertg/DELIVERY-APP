/**
 * Shared gate for clock-in's three scheduled routes.
 *
 * Upstream they only accepted `?key=<CRON_SECRET>`, because an external scheduler calls them —
 * that is also why they were never Vercel crons. The query string still works, so whatever is
 * calling them today keeps calling them, but a secret in a URL is a secret in every access log,
 * proxy and Referer along the way. `Authorization: Bearer <CRON_SECRET>` is accepted too, which is
 * both the better habit and exactly what Vercel Cron sends if these are ever scheduled here.
 *
 * Fails closed when CRON_SECRET is unset: no secret configured means nobody is authorised, not
 * everybody. Worth stating because the inverse is a classic — `if (secret && key !== secret)` reads
 * almost the same and opens the route wide the moment the variable is missing.
 */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return new URL(req.url).searchParams.get("key") === secret;
}
