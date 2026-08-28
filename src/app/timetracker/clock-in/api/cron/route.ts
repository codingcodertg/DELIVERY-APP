import { NextResponse } from "next/server";
import { notifyText, sendToSub, type Sub } from "@/lib/clockin/notify";
import { scoreWeek } from "@/lib/clockin/scorecard";
import { centralShiftMs } from "@/lib/clockin/tz";
import { clockinRestHeaders } from "@/lib/clockin/rest";
import { cronAuthorized } from "@/lib/clockin/cronAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, string | null>;

function creds() {
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL!, key: process.env.SUPABASE_SERVICE_ROLE_KEY! };
}
async function q(path: string): Promise<Row[]> {
  const { url, key } = creds();
  const r = await fetch(`${url}/rest/v1/${path}`, { headers: clockinRestHeaders(key), cache: "no-store" });
  return r.ok ? await r.json() : [];
}
async function del(path: string) {
  const { url, key } = creds();
  await fetch(`${url}/rest/v1/${path}`, { method: "DELETE", headers: clockinRestHeaders(key, { Prefer: "return=minimal" }) });
}
async function patch(path: string, body: unknown) {
  const { url, key } = creds();
  await fetch(`${url}/rest/v1/${path}`, {
    method: "PATCH",
    headers: clockinRestHeaders(key, { Prefer: "return=minimal" }),
    body: JSON.stringify(body),
  });
}
async function record(companyId: string, employeeId: string, type: string, message: string) {
  const { url, key } = creds();
  await fetch(`${url}/rest/v1/notifications`, {
    method: "POST",
    headers: clockinRestHeaders(key, { Prefer: "return=minimal" }),
    body: JSON.stringify({ company_id: companyId, employee_id: employeeId, type, message }),
  });
}
function parseHM(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function centralMin(iso: string) {
  const t = new Date(iso);
  const d = new Date(t.getTime() - centralShiftMs(t));
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export async function GET(req: Request) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const shift = centralShiftMs(new Date(now));
  const local = new Date(now - shift);
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const today = local.toISOString().slice(0, 10);
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const todayStartIso = new Date(dayStart + shift).toISOString();
  // Overtime is measured over the PAY week (Friday → Thursday), so alerts match payroll.
  const sinceFriday = (local.getUTCDay() - 5 + 7) % 7;
  const weekStartIso = new Date(dayStart - sinceFriday * 86400000 + shift).toISOString();

  const [emps, shifts, todayEntries, weekEntries, leaves, subsRaw, sentRaw, weekLunch] = await Promise.all([
    q("profiles?select=id,full_name,company_id,language,role&active=eq.true"),
    q(`scheduled_shifts?select=id,employee_id,company_id,start_time,end_time,lunch_start_time&shift_date=eq.${today}`),
    q(`time_entries?select=employee_id,clock_in_at,status&clock_in_at=gte.${todayStartIso}`),
    q(`time_entries?select=employee_id,clock_in_at,clock_out_at&clock_in_at=gte.${weekStartIso}`),
    q(`exceptions?select=employee_id,company_id,expected_return_at&type=eq.leaving_while_clocked_in&returned_at=is.null&expected_return_at=not.is.null`),
    q("push_subscriptions?select=id,employee_id,endpoint,p256dh,auth"),
    q(`notifications?select=employee_id,type&created_at=gte.${todayStartIso}`),
    q(`exceptions?select=employee_id,left_at,returned_at&reason=eq.lunch&left_at=gte.${weekStartIso}`),
  ]);

  const emp = new Map(emps.map((e) => [e.id!, e]));
  const lang = (id: string) => (emp.get(id)?.language === "es" ? "es" : "en") as "en" | "es";
  const name = (id: string) => emp.get(id)?.full_name ?? "Someone";

  const subsByEmp = new Map<string, Sub[]>();
  for (const s of subsRaw) {
    const arr = subsByEmp.get(s.employee_id!) ?? [];
    arr.push({ id: s.id!, endpoint: s.endpoint!, p256dh: s.p256dh!, auth: s.auth! });
    subsByEmp.set(s.employee_id!, arr);
  }
  const mgrsByCompany = new Map<string, string[]>();
  for (const e of emps) {
    if (e.role === "manager" || e.role === "owner") {
      const arr = mgrsByCompany.get(e.company_id!) ?? [];
      arr.push(e.id!);
      mgrsByCompany.set(e.company_id!, arr);
    }
  }
  // per-shift coverage: the central-minute of each of the employee's clock-ins today
  const clockInMins = new Map<string, number[]>();
  const openByEmp = new Set<string>();
  for (const e of todayEntries) {
    const arr = clockInMins.get(e.employee_id!) ?? [];
    arr.push(centralMin(e.clock_in_at!));
    clockInMins.set(e.employee_id!, arr);
    if (e.status === "open") openByEmp.add(e.employee_id!);
  }
  // Punched lunch minutes per employee this week (unpaid — excluded from OT math).
  const lunchMinByEmp = new Map<string, number>();
  for (const l of weekLunch) {
    if (!l.left_at || !l.returned_at) continue;
    const mins = (new Date(l.returned_at).getTime() - new Date(l.left_at).getTime()) / 60000;
    if (mins > 0) lunchMinByEmp.set(l.employee_id!, (lunchMinByEmp.get(l.employee_id!) ?? 0) + mins);
  }
  const workedMin = new Map<string, number>();
  for (const e of weekEntries) {
    const start = new Date(e.clock_in_at!).getTime();
    const end = e.clock_out_at ? new Date(e.clock_out_at).getTime() : now;
    workedMin.set(e.employee_id!, (workedMin.get(e.employee_id!) ?? 0) + Math.max(0, (end - start) / 60000));
  }
  // Subtract each person's weekly punched-lunch total from their worked minutes.
  for (const [id, lunch] of lunchMinByEmp) {
    workedMin.set(id, Math.max(0, (workedMin.get(id) ?? 0) - lunch));
  }
  const already = new Set(sentRaw.map((n) => `${n.employee_id}|${n.type}`));

  let fired = 0;
  async function send(subs: Sub[], recipientId: string, companyId: string, dedupKey: string, body: string) {
    for (const s of subs) {
      const r = await sendToSub(s, { title: "RTG Clock-In", body, url: "/timetracker/clock-in/clock", tag: dedupKey });
      if (r.gone && s.id) await del(`push_subscriptions?id=eq.${s.id}`);
    }
    await record(companyId, recipientId, dedupKey, body);
    already.add(`${recipientId}|${dedupKey}`);
    fired++;
  }
  async function fireEmp(id: string, companyId: string, msgType: string, dedupKey: string, params: Record<string, string | number> = {}) {
    if (already.has(`${id}|${dedupKey}`)) return;
    const body = notifyText(msgType, lang(id), params);
    if (!body) return;
    await send(subsByEmp.get(id) ?? [], id, companyId, dedupKey, body);
  }
  async function alertManagers(companyId: string, msgType: string, dedupSubject: string, params: Record<string, string | number>) {
    const dk = `${msgType}:${dedupSubject}`;
    for (const mId of mgrsByCompany.get(companyId) ?? []) {
      if (already.has(`${mId}|${dk}`)) continue;
      const body = notifyText(msgType, lang(mId), params);
      if (!body) continue;
      await send(subsByEmp.get(mId) ?? [], mId, companyId, dk, body);
    }
  }

  // per-shift rules (an employee can have multiple shifts a day)
  for (const sh of shifts) {
    const id = sh.employee_id!;
    const c = sh.company_id!;
    const s = parseHM(sh.start_time!);
    const e = parseHM(sh.end_time!);
    const sid = sh.id!;
    const mins = clockInMins.get(id) ?? [];
    const coveredForShift = mins.some((m) => m >= s - 20 && m <= e); // clocked in for THIS shift
    const isOpen = openByEmp.has(id);

    if (!coveredForShift && s - nowMin > 28 && s - nowMin <= 31) {
      await fireEmp(id, c, "shift_reminder", `shift_reminder:${sid}`, { n: s - nowMin });
    }
    // Right at start (before "late" kicks in at +6): a gentle "clock in now" nudge.
    if (!coveredForShift && !isOpen && nowMin >= s && nowMin <= s + 5) {
      await fireEmp(id, c, "shift_now", `shift_now:${sid}`);
    }
    if (!coveredForShift && !isOpen && nowMin > s + 6 && nowMin <= e) {
      const late = nowMin - s;
      await fireEmp(id, c, "not_clocked_in", `not_clocked_in:${sid}`, { n: late });
      await alertManagers(c, "mgr_late", `${id}:${sid}`, { name: name(id), n: late });
    }
    if (isOpen && e - nowMin > 0 && e - nowMin <= 15) {
      await fireEmp(id, c, "shift_ending", `shift_ending:${sid}`, { n: e - nowMin });
    }
    // Lunch reminder: ~5 min before a scheduled lunch start, if they're clocked in.
    if (isOpen && sh.lunch_start_time) {
      const l = parseHM(sh.lunch_start_time);
      if (l - nowMin > 2 && l - nowMin <= 5) {
        await fireEmp(id, c, "lunch_reminder", `lunch_reminder:${sid}`, { n: l - nowMin });
      }
    }
    if (isOpen && nowMin > e + 30) {
      await fireEmp(id, c, "forgot_clockout", `forgot_clockout:${sid}`);
      await alertManagers(c, "mgr_forgot_clockout", `${id}:${sid}`, { name: name(id) });
    }
  }

  // overtime — anyone currently clocked in
  for (const id of openByEmp) {
    const c = emp.get(id)?.company_id;
    if (!c) continue;
    const wh = (workedMin.get(id) ?? 0) / 60;
    if (wh >= 40) await fireEmp(id, c, "overtime", "overtime");
    else if (wh >= 36) await fireEmp(id, c, "approaching_ot", "approaching_ot");
  }

  // Payroll close — the pay week ends Thursday (Central).
  if (local.getUTCDay() === 4) {
    // 9:00am — remind every employee to double-check their punches for the week.
    if (nowMin >= 9 * 60 && nowMin <= 9 * 60 + 3) {
      for (const e of emps) {
        if (e.role === "owner" || e.role === "manager") continue;
        await fireEmp(e.id!, e.company_id!, "payroll_verify", "payroll_verify");
      }
    }
    // 2:00pm — remind managers + owner to review timestamps and approve hours.
    if (nowMin >= 14 * 60 && nowMin <= 14 * 60 + 3) {
      for (const c of new Set(emps.map((e) => e.company_id!))) {
        await alertManagers(c, "mgr_payroll_approve", "payroll_approve", {});
      }
    }
  }

  // weekly praise — Sunday around noon Central, celebrate a clean week
  if (local.getUTCDay() === 0 && nowMin >= 12 * 60 && nowMin <= 12 * 60 + 3) {
    const weekStartDate = new Date(dayStart - ((local.getUTCDay() + 6) % 7) * 86400000)
      .toISOString()
      .slice(0, 10);
    const weekShifts = await q(
      `scheduled_shifts?select=employee_id,shift_date,start_time,end_time,lunch_minutes&shift_date=gte.${weekStartDate}&shift_date=lte.${today}`,
    );
    const scores = scoreWeek(
      weekShifts.map((s) => ({
        employee_id: s.employee_id!,
        shift_date: s.shift_date!,
        start_time: s.start_time!,
        end_time: s.end_time!,
        lunch_minutes: Number(s.lunch_minutes ?? 0),
      })),
      weekEntries.map((e) => ({
        employee_id: e.employee_id!,
        clock_in_at: e.clock_in_at!,
        clock_out_at: e.clock_out_at,
      })),
    );
    for (const sc of scores.values()) {
      if (sc.scheduledMins > 0 && sc.lateCount === 0 && sc.missed === 0 && sc.onTimeDays >= 3) {
        const c = emp.get(sc.employeeId)?.company_id;
        if (c) await fireEmp(sc.employeeId, c, "great_week", "great_week", { n: sc.onTimeDays });
      }
    }
  }

  // away past expected return
  for (const lv of leaves) {
    if (!lv.expected_return_at) continue;
    if (now > new Date(lv.expected_return_at).getTime() + 5 * 60000) {
      const id = lv.employee_id!;
      const c = lv.company_id!;
      await fireEmp(id, c, "away_overdue", "away_overdue");
      await alertManagers(c, "mgr_away_overdue", `${id}`, { name: name(id) });
    }
  }

  // --- 8:00 PM automatic clock-out ---------------------------------------
  // Nobody should still be on the clock at 8 PM. At 7:55 we push "Still
  // working?"; tapping it in the app stamps still_working_at and buys another
  // hour (then it asks again). No answer = the shift is closed AT 8:00 PM
  // sharp, so payroll shows a clean number instead of "whenever cron ran".
  const CUTOFF_MIN = 20 * 60; // 8:00 PM Central
  const WARN_MIN = 5; // prompt this many minutes before the deadline
  const GRACE_MIN = 60; // "still working" buys this much more time
  // Runs on EVERY tick, not just in the evening. Each entry carries its own
  // deadline now, so a shift left open since Monday is closed on the next run
  // instead of waiting for tonight — which is what let one sit open for 49h.
  {
    const openEntries = await q(
      "time_entries?select=id,employee_id,company_id,clock_in_at,still_working_at&status=eq.open",
    );
    for (const en of openEntries) {
      const id = en.employee_id!;
      const c = en.company_id!;

      // The 8 PM belongs to the day the shift STARTED — not to today. A shift
      // left open since Monday must be closed at MONDAY's 8 PM. Using tonight's
      // would stamp a 60-hour day into payroll, which is far worse than the open
      // entry we're trying to clean up.
      const inCentral = new Date(Date.parse(en.clock_in_at!) - shift);
      const entryDayStart = Date.UTC(inCentral.getUTCFullYear(), inCentral.getUTCMonth(), inCentral.getUTCDate());
      const entryCutoffMs = entryDayStart + CUTOFF_MIN * 60000 + shift;

      // Someone who clocked in AFTER their own day's cutoff (a late evening
      // shift) isn't who this rule is for — closing them instantly is nonsense.
      if (Date.parse(en.clock_in_at!) >= entryCutoffMs) continue;

      // A stale ack from an earlier day must not push the deadline around.
      const ackMs = en.still_working_at ? new Date(en.still_working_at).getTime() : 0;
      const freshAck = ackMs > entryCutoffMs - GRACE_MIN * 60000 ? ackMs : 0;
      const deadline = Math.max(entryCutoffMs, freshAck + GRACE_MIN * 60000);
      // Slot label keeps the dedup key unique per extension round.
      const slot = new Date(deadline - shift).toISOString().slice(11, 16);

      if (now >= deadline - WARN_MIN * 60000 && now < deadline) {
        await fireEmp(id, c, "still_working", `still_working:${slot}`);
        continue;
      }
      if (now < deadline) continue;

      // Close it at the deadline itself, and mark it as the system's doing.
      await patch(`time_entries?id=eq.${en.id}&status=eq.open`, {
        clock_out_at: new Date(deadline).toISOString(),
        status: "closed",
        auto_closed: true,
        edit_note: "Automatically clocked out at 8:00 PM (no response to the still-working prompt)",
      });

      // The shift is closed, so an open run is nonsense — close it too. We can't
      // know the ending odometer, so it's left null and clearly labelled: a gap a
      // manager can see beats a run that stays open forever.
      const deadlineIso = new Date(deadline).toISOString();
      const [openTrip] = await q(
        `vehicle_trips?select=id,paused_at,paused_minutes,note&employee_id=eq.${id}&ended_at=is.null&limit=1`,
      );
      if (openTrip) {
        // An un-punched stop gets closed at the deadline as well. That departure
        // time is a system guess, not something she tapped, so it says so.
        const [openStop] = await q(
          `trip_stops?select=id,note&trip_id=eq.${openTrip.id}&departed_at=is.null&limit=1`,
        );
        if (openStop) {
          await patch(`trip_stops?id=eq.${openStop.id}`, {
            departed_at: deadlineIso,
            note: [openStop.note, "Departure not punched — closed automatically at 8:00 PM."].filter(Boolean).join(" · "),
          });
        }
        const banked =
          Number(openTrip.paused_minutes ?? 0) +
          (openTrip.paused_at
            ? Math.max(0, Math.round((deadline - Date.parse(openTrip.paused_at)) / 60000))
            : 0);
        await patch(`vehicle_trips?id=eq.${openTrip.id}&ended_at=is.null`, {
          ended_at: deadlineIso,
          paused_at: null,
          paused_minutes: banked,
          note: [openTrip.note, "Run closed automatically at 8:00 PM — no ending odometer."].filter(Boolean).join(" · "),
        });
      }
      await fireEmp(id, c, "auto_clocked_out", `auto_clocked_out:${today}`);
      await alertManagers(c, "mgr_auto_clocked_out", `${id}:${today}`, { name: name(id) });
    }
  }

  return NextResponse.json({ ok: true, fired });
}
