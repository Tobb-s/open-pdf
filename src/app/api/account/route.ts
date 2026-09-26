import { accountsAvailable, accountOwnerId, getAuth } from '@/lib/account/auth';
import { listProviders } from '@/lib/account/store';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
export async function GET() {
  if (!accountsAvailable()) return Response.json({ available: false, user: null, providers: [] }, { headers });
  try {
    const session = await getAuth().getSession();
    if (!session?.user?.sub) return Response.json({ available: true, user: null, providers: [] }, { headers });
    const { sub, name, email } = session.user;
    return Response.json({ available: true, user: { name: name ?? email ?? 'OpenPDF', email },
      providers: await listProviders(accountOwnerId(sub)) }, { headers });
  } catch {
    return Response.json({ error: 'account_unavailable' }, { status: 503, headers });
  }
}
