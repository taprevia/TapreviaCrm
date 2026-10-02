import { jwtVerify } from 'jose';
import { requireJwtSecret } from './env';

const JWT_SECRET = new TextEncoder().encode(requireJwtSecret());

export async function verifyTokenEdge(token: string): Promise<{ userId: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return { userId: payload.userId as string, role: payload.role as string };
  } catch {
    return null;
  }
}
