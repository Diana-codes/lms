/** Server-side only: where the API lives. The browser uses /api instead. */
export const API_URL = process.env.API_URL ?? 'http://localhost:4000';

export const ACCESS_COOKIE = 'kl_access';
export const REFRESH_COOKIE = 'kl_refresh';
