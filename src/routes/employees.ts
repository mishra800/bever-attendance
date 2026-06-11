import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { supabase } from '../database';
import { authenticate } from '../middleware/auth';

const router = Router();

// Configure multer for photo uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'faces');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// GET /api/employees
router.get('/', authenticate, async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, employee_id, department, phone, email, photo_url, face_descriptor, is_active, created_at')
    .order('name', { ascending: true });

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// GET /api/employees/active-descriptors
router.get('/active-descriptors', async (_req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, employee_id, face_descriptor, photo_url, department')
    .eq('is_active', true)
    .not('face_descriptor', 'is', null);

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// GET /api/employees/:id
router.get('/:id', authenticate, async (req: Request, res: Response) => {
  const { data, error } = await supabase
    .from('employees')
    .select('id, name, employee_id, department, phone, email, photo_url, face_descriptor, is_active, created_at')
    .eq('id', req.params.id)
    .single();

  if (error || !data) { res.status(404).json({ error: 'Employee not found' }); return; }
  res.json(data);
});

// POST /api/employees
router.post('/', authenticate, upload.single('photo'), async (req: Request, res: Response) => {
  const { name, employee_id, department, phone, email, face_descriptor } = req.body;

  if (!name || !employee_id) {
    res.status(400).json({ error: 'name and employee_id are required' });
    return;
  }

  // Check duplicate employee_id
  const { data: existing } = await supabase
    .from('employees')
    .select('id')
    .eq('employee_id', employee_id)
    .single();

  if (existing) {
    res.status(409).json({ error: 'Employee ID already exists' });
    return;
  }

  const id = uuidv4();
  const photo_url = req.file ? `/uploads/faces/${req.file.filename}` : null;

  const { data, error } = await supabase
    .from('employees')
    .insert({
      id,
      name,
      employee_id,
      department: department || null,
      phone: phone || null,
      email: email || null,
      photo_url,
      face_descriptor: face_descriptor || null,
    })
    .select('id, name, employee_id, department, phone, email, photo_url, is_active, created_at')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json(data);
});

// PUT /api/employees/:id
router.put('/:id', authenticate, upload.single('photo'), async (req: Request, res: Response) => {
  const { name, department, phone, email, is_active, face_descriptor } = req.body;

  const { data: emp } = await supabase
    .from('employees')
    .select('id, photo_url')
    .eq('id', req.params.id)
    .single();

  if (!emp) { res.status(404).json({ error: 'Employee not found' }); return; }

  // Handle photo replacement
  let photo_url: string | undefined = undefined;
  if (req.file) {
    photo_url = `/uploads/faces/${req.file.filename}`;
    const old = emp as { photo_url?: string };
    if (old.photo_url) {
      const oldPath = path.join(__dirname, '..', '..', old.photo_url);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
  }

  // Build update object — only include defined fields
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (department !== undefined) updates.department = department;
  if (phone !== undefined) updates.phone = phone;
  if (email !== undefined) updates.email = email;
  if (is_active !== undefined) updates.is_active = is_active === 'true' || is_active === true || is_active === 1;
  if (photo_url !== undefined) updates.photo_url = photo_url;
  if (face_descriptor !== undefined) updates.face_descriptor = face_descriptor;

  const { data, error } = await supabase
    .from('employees')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, name, employee_id, department, phone, email, photo_url, face_descriptor, is_active, created_at')
    .single();

  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json(data);
});

// DELETE /api/employees/:id — soft delete
router.delete('/:id', authenticate, async (req: Request, res: Response) => {
  const { error, count } = await supabase
    .from('employees')
    .update({ is_active: false })
    .eq('id', req.params.id);

  if (error) { res.status(500).json({ error: error.message }); return; }
  if (count === 0) { res.status(404).json({ error: 'Employee not found' }); return; }
  res.json({ message: 'Employee deactivated' });
});

export default router;
