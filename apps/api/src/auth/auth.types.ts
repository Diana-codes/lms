import type { StaffRole } from '@kora/core';

/** The signed-in staff member, attached to each request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  branchId: string | null;
  sessionId: string;
  twoFactorEnabled: boolean;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  role: StaffRole;
  typ: 'access';
}

export interface TwoFactorChallengeClaims {
  sub: string;
  typ: '2fa';
}

export const ACCESS_COOKIE = 'kl_access';
export const REFRESH_COOKIE = 'kl_refresh';
