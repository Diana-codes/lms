import { type NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  API_URL,
  COMPANY_HEADER,
  companyHeaders,
  companySlugFromHost,
  isPlatformHost,
  PLATFORM_COOKIE,
  REFRESH_COOKIE,
} from './lib/config';

/**
 * Runs before every console page and every /api call.
 *
 * /api calls are forwarded to the API with the company named by the address
 * the console was opened at (multi-company only), replacing anything the
 * browser sent. The API checks that the session belongs to that company.
 *
 * admin.<domain> is the platform admin console and serves nothing else;
 * company addresses never serve it.
 *
 * For company pages it only decides where to send people:
 *  - a live session carries on;
 *  - an expired access token is renewed with the refresh token, then the
 *    same page is requested again with the new cookies;
 *  - anyone else goes to the sign-in page.
 * The API still checks every request itself. This is routing, not security.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const host = request.headers.get('host');
  const { pathname, search } = request.nextUrl;

  if (pathname.startsWith('/api/')) {
    const forwarded = new Headers(request.headers);
    forwarded.delete(COMPANY_HEADER);
    const slug = companySlugFromHost(host);
    if (slug) forwarded.set(COMPANY_HEADER, slug);
    return NextResponse.next({ request: { headers: forwarded } });
  }

  if (isPlatformHost(host)) {
    if (!pathname.startsWith('/platform')) {
      return NextResponse.redirect(new URL('/platform', request.url));
    }
    if (pathname === '/platform/login' || request.cookies.has(PLATFORM_COOKIE)) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL('/platform/login', request.url));
  }
  if (pathname.startsWith('/platform')) {
    return new NextResponse('Not found', { status: 404 });
  }

  // The borrower web app is the same app as on phones (apps/mobile), at /app.
  // Older /portal links (the website's Apply button, SMS) open it.
  if (pathname === '/portal' || pathname.startsWith('/portal/')) {
    return NextResponse.redirect(new URL(`/app${search}`, request.url));
  }
  // The borrower app uses its own Bearer tokens in the browser, not staff cookies.
  if (pathname === '/login' || pathname === '/app' || pathname.startsWith('/app/')) {
    return NextResponse.next();
  }
  if (request.cookies.has(ACCESS_COOKIE)) return NextResponse.next();

  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);

  if (!request.cookies.has(REFRESH_COOKIE)) return NextResponse.redirect(login);

  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: request.headers.get('cookie') ?? '', ...companyHeaders(host) },
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
  // Everything except Next's own assets and static files.
  matcher: ['/((?!_next/|favicon\\.ico|.*\\.(?:svg|png|ico|txt|webmanifest)$).*)'],
};
