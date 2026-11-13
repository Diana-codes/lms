import { type NextRequest, NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from './lib/config';

/**
 * Runs before every console page. It only decides where to send people:
 *  - a live session carries on;
 *  - an expired access token is renewed with the refresh token, then the
 *    same page is requested again with the new cookies;
 *  - anyone else goes to the sign-in page.
 * The API still checks every request itself. This is routing, not security.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  if (request.cookies.has(ACCESS_COOKIE)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);

  if (!request.cookies.has(REFRESH_COOKIE)) return NextResponse.redirect(login);

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    if (res.ok) {
      const again = NextResponse.redirect(request.nextUrl);
      for (const cookie of res.headers.getSetCookie()) again.headers.append('set-cookie', cookie);
      return again;
    }
  } catch {
    // API unreachable: fall through to the sign-in page, which says so.
  }
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the API proxy, Next's own assets, static files and sign-in.
  matcher: ['/((?!api/|_next/|login|favicon\\.ico|.*\\.(?:svg|png|ico|txt|webmanifest)$).*)'],
};
