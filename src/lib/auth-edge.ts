import { jwtVerify } from 'jose';
import { requireJwtSecret } from './env';


export async function verifyTokenEdge(token: string): Promise<{ userId: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(requireJwtSecret()));
    return { userId: payload.userId as string, role: payload.role as string };
  } catch {
    return null;
  }
}
