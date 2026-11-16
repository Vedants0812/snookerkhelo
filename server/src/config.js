import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const env = process.env;

export const config = {
  port: Number(env.PORT) || 5000,
  isProd: env.NODE_ENV === 'production',
  mongoUri: env.MONGO_URI || '',
  jwtSecret: env.JWT_SECRET || '',
  admin: {
    username: (env.ADMIN_USERNAME || 'admin').toLowerCase().trim(),
    password: env.ADMIN_PASSWORD || '',
    name: env.ADMIN_NAME || 'Owner',
  },
};

if (!config.jwtSecret || config.jwtSecret.length < 24) {
  throw new Error('JWT_SECRET is missing or too short. Set it in server/.env (see .env.example).');
}
if (config.isProd && !config.mongoUri) {
  throw new Error('MONGO_URI is required in production.');
}
