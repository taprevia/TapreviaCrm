import mongoose from 'mongoose';
import { getEnv } from './env';
import '@/models';

const MONGODB_URI = getEnv()?.MONGODB_URI ?? 'mongodb://localhost:27017/nfc-crm';

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  // eslint-disable-next-line no-var
  var mongoose: MongooseCache | undefined;
}

const cached: MongooseCache = global.mongoose || { conn: null, promise: null };

if (!global.mongoose) {
  global.mongoose = cached;
}

export async function connectDB() {
  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    // Small pools keep many serverless lambdas (each caching its own
    // connection) well under Atlas M0's connection budget.
    const opts = {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 30000,
      connectTimeoutMS: 10000,
    };
    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongooseInstance) => mongooseInstance);
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    throw e;
  }

  return cached.conn;
}
