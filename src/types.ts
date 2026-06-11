export type UserRole = 'admin';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  created_at: string;
}

export interface Employee {
  id: string;
  name: string;
  employee_id: string;
  department?: string;
  phone?: string;
  email?: string;
  photo_url?: string;
  face_descriptor?: string; // JSON stringified Float32Array
  is_active: number;
  created_at: string;
}

export interface AttendanceRecord {
  id: string;
  employee_id: string;
  checked_in_at: string;
  checked_out_at?: string | null;
  date: string;
  method: 'face' | 'manual';
  confidence?: number;
  employee_name?: string;
  employee_emp_id?: string;
  department?: string;
  photo_url?: string;
}

// Express augmentation
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
        email: string;
        name: string;
      };
    }
  }
}
