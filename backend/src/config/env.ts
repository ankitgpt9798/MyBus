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
};
