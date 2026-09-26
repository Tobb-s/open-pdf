import { NextResponse, type NextRequest } from 'next/server';
import { accountsAvailable, getAuth } from '@/lib/account/auth';

export async function proxy(request: NextRequest) {
  if (!accountsAvailable()) {
    if (request.nextUrl.pathname.startsWith('/auth/')) {
      return NextResponse.redirect(new URL('/es/account', request.url));
    }
    return NextResponse.next();
  }
  return getAuth().middleware(request);
}
export const config = {
  matcher: ['/auth/:path*', '/api/account/:path*', '/api/translate', '/api/translation-review', '/es/account', '/en/account'],
};
