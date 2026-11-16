import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { config } from './config.js';

let memoryServer = null;

export async function connectDb() {
  let uri = config.mongoUri;
  if (!uri) {
    // Development convenience: no MongoDB installed -> run a real mongod from
    // mongodb-memory-server with its data kept on disk in server/.data
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const dbPath = fileURLToPath(new URL('../.data/db', import.meta.url));
    mkdirSync(dbPath, { recursive: true });
    memoryServer = await MongoMemoryServer.create({
      instance: { dbPath, storageEngine: 'wiredTiger', dbName: 'snooker' },
    });
    uri = memoryServer.getUri('snooker');
    console.log('[db] MONGO_URI not set - using local dev database in server/.data');
  }
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  console.log('[db] connected');
}

export async function closeDb() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop({ doCleanup: false });
}
