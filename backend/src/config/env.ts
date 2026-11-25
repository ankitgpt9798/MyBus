import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const str = (name: string, fallback = '') => process.env[name] ?? fallback;
const num = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && process.env[name] !== '' ? n : fallback;
};

export const env = {
  port: num('PORT', 4000),
  nodeEnv: str('NODE_ENV', 'development'),
  mongoUri: str('MONGODB_URI', 'mongodb://127.0.0.1:27017/mybus'),
  frontendUrl: str('FRONTEND_URL', 'http://localhost:4200').replace(/\/$/, ''),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:4200')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: required('JWT_SECRET'),
  // Uploaded files (community photos go into <dir>/community). Default: backend/uploads (git-ignored).
  uploadsDir: path.resolve(str('UPLOADS_DIR', path.resolve(__dirname, '../../uploads'))),
  jwtExpiresIn: str('JWT_EXPIRES_IN', '7d'),
  admin: {
    email: str('ADMIN_EMAIL', 'admin@mybus.local').toLowerCase(),
    password: str('ADMIN_PASSWORD', 'Admin@12345'),
    name: str('ADMIN_NAME', 'MyBus Admin'),
  },
  smtp: {
    host: str('SMTP_HOST'),
    port: num('SMTP_PORT', 587),
    secure: str('SMTP_SECURE', 'false') === 'true',
    user: str('SMTP_USER'),
    pass: str('SMTP_PASS'),
    from: str('MAIL_FROM', 'MyBus <no-reply@mybus.local>'),
  },
  seatHoldMinutes: num('SEAT_HOLD_MINUTES', 10),
  // Web push (VAPID). If the keys are not set, they are generated once and kept in backend/.vapid-keys.json.
  vapid: {
    publicKey: str('VAPID_PUBLIC_KEY'),
    privateKey: str('VAPID_PRIVATE_KEY'),
    subject: str('VAPID_SUBJECT'),
  },
  notifications: {
    // Wait after the 1st, 2nd, 3rd failed attempt (1 min, 5 min, 15 min). Tests may compress this, e.g. "2000,4000,6000".
    retryDelaysMs: str('NOTIFY_RETRY_DELAYS_MS', '60000,300000,900000')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0),
    retryIntervalMs: num('NOTIFY_RETRY_INTERVAL_MS', 30_000),
    // Live stream heartbeat; clients reconnect if they hear nothing for ~2.5 heartbeats.
    streamHeartbeatMs: num('NOTIFY_STREAM_HEARTBEAT_MS', 15_000),
  },
  reminders: {
    // How long before departure each reminder is sent: ~24 h and ~2 h. Tests may compress this, e.g. "120000,40000".
    leadsMs: str('REMINDER_LEADS_MS', '86400000,7200000').split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0),
    intervalMs: num('REMINDER_INTERVAL_MS', 60_000),
  },
};
