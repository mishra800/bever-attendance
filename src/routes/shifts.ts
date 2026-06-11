import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from '../database';
import { authenticate } from '../middleware/auth';

const router = Router();

// ─── GET /api/shifts ──────────────────────────────────────────────────────────
router.get('/', authenticate, async (_req: Request, res: Response) => {
  const { data: shifts, error } = await supabase
    .from('shifts')
    .select('*, employee_shifts(count)')
    .order('start_time', { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }

  // Flatten employee_count
  const result = (shifts || []).map((s: any) => ({
    ...s,
    employee_count: s.employee_shifts?.[0]?.count ?? 0,
    employee_shifts: undefined,
  }));
  res.json(result);
});

// ─── GET /api/shifts/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const { data: shift, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error || !shift) { res.status(404).json({ error: 'Shift not found' }); return; }

  const { data: employees } = await supabase
    .from('employee_shifts')
    .select('employees ( id, name, employee_id, department, photo_url )')
    .eq('shift_id', req.params.id);

  const empList = (employees || []).map((e: any) => e.employees).filter(Boolean);
  res.json({ ...shift, employees: empList });
});

// ─── POST /api/shifts ─────────────────────────────────────────────────────────
router.post('/', authenticate, async (req: Request, res: Response) => {
  const { name, start_time, end_time, grace_minutes = 15 } = req.body;

  if (!name || !start_time || !end_time) {
    res.status(400).json({ error: 'name, start_time and end_time are required' });
    return;
  }

  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(start_time) || !timeRegex.test(end_time)) {
    res.status(400).json({ error: 'Times must be in HH:MM format' });
    return;
  }

  const { data, error } = await supabase
    .from('shifts')
    .insert({ id: uuidv4(), name, start_time, end_time, grace_minutes: Number(grace_minutes) })
    .select('*')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// ─── PUT /api/shifts/:id ──────────────────────────────────────────────────────
router.put('/:id', authenticate, async (req: Request, res: Response) => {
  const { name, start_time, end_time, grace_minutes } = req.body;

  const { data: existing } = await supabase
    .from('shifts')
    .select('id')
    .eq('id', req.params.id)
    .single();

  if (!existing) { res.status(404).json({ error: 'Shift not found' }); return; }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (start_time !== undefined) updates.start_time = start_time;
  if (end_time !== undefined) updates.end_time = end_time;
  if (grace_minutes !== undefined) updates.grace_minutes = Number(grace_minutes);

  const { data, error } = await supabase
    .from('shifts')
    .update(updates)
    .eq('id', req.params.id)
    .select('*')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// ─── DELETE /api/shifts/:id ───────────────────────────────────────────────────
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const { error } = await supabase.from('shifts').delete().eq('id', req.params.id);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Shift deleted' });
});

// ─── POST /api/shifts/:id/assign ──────────────────────────────────────────────
router.post('/:id/assign', authenticate, async (req: Request, res: Response) => {
  const { employee_id } = req.body;
  if (!employee_id) { res.status(400).json({ error: 'employee_id required' }); return; }

  const { data: shift } = await supabase.from('shifts').select('id').eq('id', req.params.id).single();
  if (!shift) { res.status(404).json({ error: 'Shift not found' }); return; }

  const { data: emp } = await supabase.from('employees').select('id').eq('id', employee_id).single();
  if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }

  // Upsert — one shift per employee
  const { error } = await supabase
    .from('employee_shifts')
    .upsert(
      { id: uuidv4(), employee_id, shift_id: req.params.id },
      { onConflict: 'employee_id' }
    );

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Employee assigned to shift' });
});

// ─── DELETE /api/shifts/unassign/:employee_id ─────────────────────────────────
router.delete('/unassign/:employee_id', authenticate, async (req: Request, res: Response) => {
  const { error } = await supabase
    .from('employee_shifts')
    .delete()
    .eq('employee_id', req.params.employee_id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ message: 'Employee unassigned from shift' });
});

// ─── GET /api/shifts/employee/:employee_id ────────────────────────────────────
router.get('/employee/:employee_id', authenticate, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('employee_shifts')
    .select('shifts(*)')
    .eq('employee_id', req.params.employee_id)
    .single();

  if (error || !data) { res.status(404).json({ error: 'No shift assigned' }); return; }
  res.json((data as any).shifts);
});

export default router;
