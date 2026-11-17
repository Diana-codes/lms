import { NextResponse, type NextRequest } from 'next/server';

const locales = ['en', 'rw'];
const defaultLocale = 'en';

/** Pick Kinyarwanda when the browser prefers it, otherwise English. */
function preferredLocale(request: NextRequest) {
  const header = request.headers.get('accept-language') ?? '';
  const first = header.split(',')[0]?.trim().toLowerCase() ?? '';
  return first.startsWith('rw') ? 'rw' : defaultLocale;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasLocale = locales.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`));
  if (hasLocale) return;

  request.nextUrl.pathname = `/${preferredLocale(request)}${pathname === '/' ? '' : pathname}`;
  return NextResponse.redirect(request.nextUrl);
}

export const config = {
  // Skip Next internals, API routes and files with an extension (images, favicon…)
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
