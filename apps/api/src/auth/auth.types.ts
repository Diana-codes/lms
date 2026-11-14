import type { StaffRole } from '@kora/core';

/** The signed-in staff member, attached to each request by JwtAuthGuard. */
export interface AuthUser {
  id: string;
  companyId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  branchId: string | null;
  sessionId: string;
  twoFactorEnabled: boolean;
  /** An administrator set the password; the user must choose a new one first. */
  mustChangePassword: boolean;
}

export interface AccessTokenClaims {
  sub: string;
  sid: string;
  /** The company the session belongs to. Must match the company of the request. */
  cid: string;
  role: StaffRole;
  typ: 'access';
}

export interface TwoFactorChallengeClaims {
  sub: string;
  cid: string;
  typ: '2fa';
}

export const ACCESS_COOKIE = 'kl_access';
export const REFRESH_COOKIE = 'kl_refresh';
