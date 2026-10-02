import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STARTED_AT = Date.now();

export async function GET() {
  let db = 'down';
  try {
    const conn = await connectDB();
    if (conn?.connection?.db) {
      const res = await conn.connection.db.admin().ping();
      db = res?.ok === 1 ? 'up' : 'down';
    }
  } catch {
    db = 'down';
  }

  const health =
    db === 'up'
      ? NextResponse.json(
          { ok: true, status: 'healthy', db, uptime: process.uptime(), startedAt: STARTED_AT, time: Date.now() },
          { status: 200 }
        )
      : NextResponse.json(
          { ok: false, status: 'unhealthy', db, uptime: process.uptime(), startedAt: STARTED_AT, time: Date.now() },
          { status: 503 }
        );
  return health;
}