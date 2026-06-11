import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../database';
import { authenticate } from '../middleware/auth';

const router = Router();

// ─── Helper ───────────────────────────────────────────────────────────────────
async function getTodayRecord(employee_id: string, today: string) {
  const { data } = await supabase
    .from('attendance')
    .select('id, checked_in_at, checked_out_at')
    .eq('employee_id', employee_id)
    .eq('date', today)
    .order('checked_in_at', { ascending: false })
    .limit(1)
    .single();
  return data as { id: string; checked_in_at: string; checked_out_at: string | null } | null;
}

// ─── POST /api/attendance/checkin ─────────────────────────────────────────────
router.post('/checkin', async (req: Request, res: Response) => {
  const { employee_id, confidence, method } = req.body;

  if (!employee_id) {
    res.status(400).json({ error: 'employee_id required' });
    return;
  }

  const { data: emp } = await supabase
    .from('employees')
    .select('id, name, employee_id, is_active')
    .eq('id', employee_id)
    .single();

  if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }
  if (!emp.is_active) { res.status(403).json({ error: 'Employee is inactive' }); return; }

  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const existing = await getTodayRecord(employee_id, today);

  if (existing && !existing.checked_out_at) {
    const diffMinutes = (Date.now() - new Date(existing.checked_in_at).getTime()) / 60000;

    if (diffMinutes < 0.083) {
      res.status(429).json({
        error: 'Already checked in recently',
        employee_name: emp.name,
        last_checkin: existing.checked_in_at,
      });
      return;
    }

    res.status(409).json({
      error: 'Already checked in — please check out first',
      status: 'checked_in',
      employee_name: emp.name,
      employee_emp_id: emp.employee_id,
      checked_in_at: existing.checked_in_at,
    });
    return;
  }

  const { error } = await supabase.from('attendance').insert({
    id: uuidv4(),
    employee_id,
    date: today,
    checked_in_at: now,
    method: method || 'face',
    confidence: confidence || null,
  });

  if (error) { res.status(500).json({ error: error.message }); return; }

  res.status(201).json({
    action: 'checkin',
    message: 'Check-in recorded',
    employee_name: emp.name,
    employee_emp_id: emp.employee_id,
    checked_in_at: now,
  });
});

// ─── POST /api/attendance/checkout ───────────────────────────────────────────
router.post('/checkout', async (req: Request, res: Response) => {
  const { employee_id, confidence, method } = req.body;

  if (!employee_id) {
    res.status(400).json({ error: 'employee_id required' });
    return;
  }

  const { data: emp } = await supabase
    .from('employees')
    .select('id, name, employee_id, is_active')
    .eq('id', employee_id)
    .single();

  if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }
  if (!emp.is_active) { res.status(403).json({ error: 'Employee is inactive' }); return; }

  const today = new Date().toISOString().split('T')[0];
  const now = new Date().toISOString();

  const existing = await getTodayRecord(employee_id, today);

  if (!existing) {
    res.status(409).json({
      error: 'Not checked in today',
      status: 'not_checked_in',
      employee_name: emp.name,
      employee_emp_id: emp.employee_id,
    });
    return;
  }

  if (existing.checked_out_at) {
    const diffMinutes = (Date.now() - new Date(existing.checked_out_at).getTime()) / 60000;
    if (diffMinutes < 0.083) {
      res.status(429).json({
        error: 'Already checked out recently',
        employee_name: emp.name,
        last_checkout: existing.checked_out_at,
      });
      return;
    }
    res.status(409).json({
      error: 'Already checked out',
      status: 'checked_out',
      employee_name: emp.name,
      employee_emp_id: emp.employee_id,
      checked_out_at: existing.checked_out_at,
    });
    return;
  }

  const updates: Record<string, unknown> = { checked_out_at: now };
  if (confidence) updates.confidence = confidence;
  if (method) updates.method = method;

  const { error } = await supabase
    .from('attendance')
    .update(updates)
    .eq('id', existing.id);

  if (error) { res.status(500).json({ error: error.message }); return; }

  const durationMs = new Date(now).getTime() - new Date(existing.checked_in_at).getTime();
  const durationHrs = Math.floor(durationMs / 3600000);
  const durationMins = Math.floor((durationMs % 3600000) / 60000);

  res.status(200).json({
    action: 'checkout',
    message: 'Check-out recorded',
    employee_name: emp.name,
    employee_emp_id: emp.employee_id,
    checked_in_at: existing.checked_in_at,
    checked_out_at: now,
    duration: `${durationHrs}h ${durationMins}m`,
  });
});

// ─── GET /api/attendance/status/:employee_id ──────────────────────────────────
router.get('/status/:employee_id', async (req: Request, res: Response) => {
  const today = new Date().toISOString().split('T')[0];
  const record = await getTodayRecord(req.params.employee_id as string, today);

  if (!record) { res.json({ status: 'not_checked_in' }); return; }
  if (!record.checked_out_at) {
    res.json({ status: 'checked_in', checked_in_at: record.checked_in_at });
    return;
  }
  res.json({ status: 'checked_out', checked_in_at: record.checked_in_at, checked_out_at: record.checked_out_at });
});

// ─── GET /api/attendance/today ────────────────────────────────────────────────
router.get('/today', async (_req: Request, res: Response) => {
  const today = new Date().toISOString().split('T')[0];

  const { data: records, error } = await supabase
    .from('attendance')
    .select(`
      id, checked_in_at, checked_out_at, method, confidence,
      employee_id,
      employees!inner (
        id, name, employee_id, department, photo_url,
        employee_shifts (
          shifts ( name, start_time, end_time, grace_minutes )
        )
      )
    `)
    .eq('date', today)
    .order('checked_in_at', { ascending: false });

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Flatten for compatibility with frontend
  const flat = (records || []).map((r: any) => {
    const emp = r.employees;
    const shift = emp?.employee_shifts?.[0]?.shifts;
    return {
      id: r.id,
      checked_in_at: r.checked_in_at,
      checked_out_at: r.checked_out_at,
      method: r.method,
      confidence: r.confidence,
      employee_db_id: emp?.id,
      employee_name: emp?.name,
      employee_emp_id: emp?.employee_id,
      department: emp?.department,
      photo_url: emp?.photo_url,
      shift_name: shift?.name,
      shift_start: shift?.start_time,
      shift_end: shift?.end_time,
      grace_minutes: shift?.grace_minutes,
    };
  });

  // Present count = distinct employees with no checkout
  const { count: presentCount } = await supabase
    .from('attendance')
    .select('employee_id', { count: 'exact', head: true })
    .eq('date', today)
    .is('checked_out_at', null);

  const { count: totalEmployees } = await supabase
    .from('employees')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true);

  res.json({
    date: today,
    records: flat,
    present_count: presentCount || 0,
    total_employees: totalEmployees || 0,
  });
});

// ─── GET /api/attendance ──────────────────────────────────────────────────────
router.get('/', authenticate, async (req: Request, res: Response) => {
  const { date, employee_id, from, to, page = '1', limit = '50' } = req.query;
  const pageNum = parseInt(page as string);
  const limitNum = parseInt(limit as string);
  const offset = (pageNum - 1) * limitNum;

  let query = supabase
    .from('attendance')
    .select(`
      id, employee_id, date, checked_in_at, checked_out_at, method, confidence,
      employees!inner ( name, employee_id, department, photo_url )
    `, { count: 'exact' })
    .order('checked_in_at', { ascending: false })
    .range(offset, offset + limitNum - 1);

  if (date) query = query.eq('date', date as string);
  if (from) query = query.gte('date', from as string);
  if (to) query = query.lte('date', to as string);
  if (employee_id) query = query.eq('employee_id', employee_id as string);

  const { data, error, count } = await query;

  if (error) { res.status(500).json({ error: error.message }); return; }

  const flat = (data || []).map((r: any) => ({
    id: r.id,
    employee_id: r.employee_id,
    date: r.date,
    checked_in_at: r.checked_in_at,
    checked_out_at: r.checked_out_at,
    method: r.method,
    confidence: r.confidence,
    employee_name: r.employees?.name,
    employee_emp_id: r.employees?.employee_id,
    department: r.employees?.department,
    photo_url: r.employees?.photo_url,
  }));

  res.json({ records: flat, total: count || 0 });
});

// ─── GET /api/attendance/report ───────────────────────────────────────────────
router.get('/report', authenticate, async (req: Request, res: Response) => {
  const { from, to } = req.query;
  const fromDate = (from as string) || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const toDate = (to as string) || new Date().toISOString().split('T')[0];

  // Per-employee summary — fetch raw data and compute in JS
  const { data: empList } = await supabase
    .from('employees')
    .select(`
      id, name, employee_id, department,
      employee_shifts ( shifts ( name, start_time, end_time, grace_minutes ) )
    `)
    .eq('is_active', true)
    .order('name');

  const { data: attData } = await supabase
    .from('attendance')
    .select('employee_id, date, checked_in_at, checked_out_at')
    .gte('date', fromDate)
    .lte('date', toDate);

  // Group attendance by employee
  const attByEmp = new Map<string, typeof attData>();
  for (const rec of attData || []) {
    if (!attByEmp.has(rec.employee_id)) attByEmp.set(rec.employee_id, []);
    attByEmp.get(rec.employee_id)!.push(rec);
  }

  const summary = (empList || []).map((e: any) => {
    const recs = attByEmp.get(e.id) || [];
    const uniqueDays = new Set(recs.map((r: any) => r.date)).size;
    const totalHours = recs.reduce((sum: number, r: any) => {
      if (r.checked_out_at) {
        return sum + (new Date(r.checked_out_at).getTime() - new Date(r.checked_in_at).getTime()) / 3600000;
      }
      return sum;
    }, 0);
    const completedRecs = recs.filter((r: any) => r.checked_out_at);
    const avgHours = completedRecs.length ? totalHours / completedRecs.length : null;
    const shift = e.employee_shifts?.[0]?.shifts;

    return {
      id: e.id,
      name: e.name,
      emp_id: e.employee_id,
      department: e.department,
      days_present: uniqueDays,
      first_seen: recs.length ? recs.reduce((a: any, b: any) => a.checked_in_at < b.checked_in_at ? a : b).checked_in_at : null,
      last_seen: recs.length ? recs.reduce((a: any, b: any) => a.checked_in_at > b.checked_in_at ? a : b).checked_in_at : null,
      total_hours: Math.round(totalHours * 100) / 100,
      avg_hours: avgHours !== null ? Math.round(avgHours * 100) / 100 : null,
      shift_name: shift?.name || null,
      shift_start: shift?.start_time || null,
      shift_end: shift?.end_time || null,
      grace_minutes: shift?.grace_minutes || null,
    };
  });

  // Daily counts
  const dailyMap = new Map<string, Set<string>>();
  for (const rec of attData || []) {
    if (!dailyMap.has(rec.date)) dailyMap.set(rec.date, new Set());
    dailyMap.get(rec.date)!.add(rec.employee_id);
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, empSet]) => ({ date, present_count: empSet.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  res.json({ summary, daily, from: fromDate, to: toDate });
});

// ─── DELETE /api/attendance/:id ───────────────────────────────────────────────
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('attendance')
    .delete()
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Record deleted' });
});

export default router;
