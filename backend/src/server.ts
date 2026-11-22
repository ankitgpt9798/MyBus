import { createApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { env } from './config/env';
import { startJobs, stopJobs } from './jobs';
import { registerNotificationListeners } from './services/notification.listeners';
import { smtpConfigured } from './services/mail.service';

async function main() {
  await connectDb();
  registerNotificationListeners();
  const server = createApp().listen(env.port, () => {
    console.log(`[api] MyBus API listening on http://localhost:${env.port}/api`);
    if (!smtpConfigured()) console.log('[mail] SMTP not configured: emails and verification links are printed here');
  });
  startJobs();

  const shutdown = async () => {
    stopJobs();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[api] failed to start', err);
  process.exit(1);
});
