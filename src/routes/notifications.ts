import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../database';
import { authenticate } from '../middleware/auth';

const router = Router();

// ─── Helper ───────────────────────────────────────────────────────────────────
function todayAt(hhmm: string, dateStr: string): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  const d = new Date(dateStr + 'T00:00:00');
  d.setHours(hh, mm, 0, 0);
  return d;
}

// ─── POST /api/notifications/generate ────────────────────────────────────────
router.post('/generate', authenticate, async (_req: Request, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const nowMs = Date.now();
  let created = 0;

  // ── 1. Late check-in alerts ───────────────────────────────────────────────
  const { data: lateCheckins } = await supabase
    .from('attendance')
    .select(`
      employee_id,
      checked_in_at,
      employees!inner ( name ),
      employees!inner ( employee_shifts ( shifts ( name, start_time, grace_minutes ) ) )
    `)
    .eq('date', today);

  // Simpler approach: fetch attendance + join manually
  const { data: attendanceToday } = await supabase
    .from('attendance')
    .select('employee_id, checked_in_at')
    .eq('date', today);

  const { data: shiftsInfo } = await supabase
    .from('employee_shifts')
    .select('employee_id, shifts ( name, start_time, end_time, grace_minutes ), employees ( name )');

  const shiftMap = new Map((shiftsInfo || []).map((s: any) => [s.employee_id, s]));

  for (const att of attendanceToday || []) {
    const info = shiftMap.get(att.employee_id);
    if (!info?.shifts) continue;

    const shiftStart = todayAt(info.shifts.start_time, today);
    const deadline = new Date(shiftStart.getTime() + info.shifts.grace_minutes * 60_000);
    const actualIn = new Date(att.checked_in_at);

    if (actualIn > deadline) {
      const lateMin = Math.round((actualIn.getTime() - shiftStart.getTime()) / 60_000);

      const { data: exists } = await supabase
        .from('notifications')
        .select('id')
        .eq('type', 'late_checkin')
        .eq('employee_id', att.employee_id)
        .gte('created_at', today + 'T00:00:00')
        .maybeSingle();

      if (!exists) {
        await supabase.from('notifications').insert({
          id: uuidv4(),
          type: 'late_checkin',
          title: `Late Check-in: ${info.employees?.name}`,
          message: `${info.employees?.name} checked in ${lateMin} minute${lateMin !== 1 ? 's' : ''} late for ${info.shifts.name} shift (expected ${info.shifts.start_time}).`,
          employee_id: att.employee_id,
        });
        created++;
      }
    }
  }

  // ── 2. Absent alerts ──────────────────────────────────────────────────────
  const checkedInToday = new Set((attendanceToday || []).map((a: any) => a.employee_id));

  for (const [empId, info] of shiftMap.entries()) {
    if (checkedInToday.has(empId)) continue;
    if (!(info as any).shifts) continue;

    const shiftStart = todayAt((info as any).shifts.start_time, today);
    const alertAfter = new Date(shiftStart.getTime() + 60 * 60_000);

    if (nowMs >= alertAfter.getTime()) {
      const { data: exists } = await supabase
        .from('notifications')
        .select('id')
        .eq('type', 'absent')
        .eq('employee_id', empId)
        .gte('created_at', today + 'T00:00:00')
        .maybeSingle();

      if (!exists) {
        await supabase.from('notifications').insert({
          id: uuidv4(),
          type: 'absent',
          title: `Absent: ${(info as any).employees?.name}`,
          message: `${(info as any).employees?.name} has not checked in for ${(info as any).shifts.name} shift (started ${(info as any).shifts.start_time}).`,
          employee_id: empId,
        });
        created++;
      }
    }
  }

  // ── 3. Early departure alerts ─────────────────────────────────────────────
  const { data: checkouts } = await supabase
    .from('attendance')
    .select('employee_id, checked_in_at, checked_out_at')
    .eq('date', today)
    .not('checked_out_at', 'is', null);

  for (const att of checkouts || []) {
    const info = shiftMap.get(att.employee_id);
    if (!info?.shifts) continue;

    const shiftEnd = todayAt((info as any).shifts.end_time, today);
    const actualOut = new Date(att.checked_out_at);

    if (actualOut < new Date(shiftEnd.getTime() - 15 * 60_000)) {
      const earlyMin = Math.round((shiftEnd.getTime() - actualOut.getTime()) / 60_000);

      const { data: exists } = await supabase
        .from('notifications')
        .select('id')
        .eq('type', 'early_departure')
        .eq('employee_id', att.employee_id)
        .gte('created_at', today + 'T00:00:00')
        .maybeSingle();

      if (!exists) {
        await supabase.from('notifications').insert({
          id: uuidv4(),
          type: 'early_departure',
          title: `Early Departure: ${(info as any).employees?.name}`,
          message: `${(info as any).employees?.name} left ${earlyMin} minute${earlyMin !== 1 ? 's' : ''} early from ${(info as any).shifts.name} shift (expected until ${(info as any).shifts.end_time}).`,
          employee_id: att.employee_id,
        });
        created++;
      }
    }
  }

  res.json({ generated: created });
});

// ─── GET /api/notifications ───────────────────────────────────────────────────
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { unread_only } = req.query;

  let query = supabase
    .from('notifications')
    .select('*, employees ( name, department )')
    .order('created_at', { ascending: false })
    .limit(100);

  if (unread_only === 'true') query = query.eq('is_read', false);

  const { data: notifications, error } = await query;
  if (error) { res.status(500).json({ error: error.message }); return; }

  const { count: unreadCount } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('is_read', false);

  const flat = (notifications || []).map((n: any) => ({
    ...n,
    employee_name: n.employees?.name,
    department: n.employees?.department,
    employees: undefined,
  }));

  res.json({ notifications: flat, unread_count: unreadCount || 0 });
});

// ─── PATCH /api/notifications/:id/read ───────────────────────────────────────
router.patch('/:id/read', authenticate, async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Marked as read' });
});

// ─── PATCH /api/notifications/read-all ───────────────────────────────────────
router.patch('/read-all', authenticate, async (_req: Request, res: Response) => {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('is_read', false);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'All notifications marked as read' });
});

// ─── DELETE /api/notifications/clear ─────────────────────────────────────────
router.delete('/clear', authenticate, async (_req: Request, res: Response) => {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('is_read', true);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Read notifications cleared' });
});

export default router;
