import bcrypt from 'bcryptjs';
import { config } from './config.js';
import { connectDb, closeDb } from './db.js';
import { createApp } from './app.js';
import { User, getSettings } from './models.js';

async function bootstrap() {
  await getSettings();
  if (!(await User.exists({}))) {
    if (!config.admin.password || config.admin.password.length < 6) {
      throw new Error('No users yet: set ADMIN_PASSWORD (min 6 chars) in server/.env to create the owner login.');
    }
    await User.create({
      name: config.admin.name, username: config.admin.username, role: 'admin',
      passwordHash: await bcrypt.hash(config.admin.password, 10),
    });
    console.log(`[setup] owner login created: "${config.admin.username}" (password from server/.env)`);
  }
}

await connectDb();
await bootstrap();
const server = createApp().listen(config.port, () => console.log(`[api] http://localhost:${config.port}`));

async function shutdown() {
  server.close();
  await closeDb().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
