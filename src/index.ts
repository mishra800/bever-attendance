import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initializeDatabase } from './database';

import authRoutes from './routes/auth';
import employeeRoutes from './routes/employees';
import attendanceRoutes from './routes/attendance';
import shiftRoutes from './routes/shifts';
import notificationRoutes from './routes/notifications';

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware — allow dev + production Netlify origin
const allowedOrigins = [
  'http://localhost:5173',
  'https://attendance12.netlify.app',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Capacitor)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded face photos
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/shifts', shiftRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', (_, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server after DB connection is verified
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Face Attendance API running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to connect to Supabase:', err.message);
  process.exit(1);
});

export default app;
