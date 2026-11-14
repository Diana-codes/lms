import { maskPhone, type StaffRole } from '@kora/core';

/** How someone proves it is them after their password. */
export type TwoFactorMethod = 'app' | 'sms';

/** The method in use: an authenticator app if set up, otherwise a verified phone. */
export function twoFactorMethod(account: {
  totpEnabledAt: Date | null;
  phone: string | null;
  phoneVerifiedAt: Date | null;
}): TwoFactorMethod | null {
  if (account.totpEnabledAt) return 'app';
  if (account.phone && account.phoneVerifiedAt) return 'sms';
  return null;
}

/** The parts of an account's two-factor setup that are safe to show. */
export function twoFactorView(account: {
  totpEnabledAt: Date | null;
  phone: string | null;
  phoneVerifiedAt: Date | null;
}) {
  const method = twoFactorMethod(account);
  return {
    twoFactorEnabled: method != null,
    twoFactorMethod: method,
    /** The verified number codes go to, masked. Kept when an app is the method, as a fallback. */
    verifiedPhone: account.phone && account.phoneVerifiedAt ? maskPhone(account.phone) : null,
  };
}

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
  /** Two-factor is required: until it is set up, the user can only set it up. */
  twoFactorEnabled: boolean;
  twoFactorMethod: TwoFactorMethod | null;
  verifiedPhone: string | null;
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
  /** Which kind of code the second step expects. */
  m: TwoFactorMethod;
}

export const ACCESS_COOKIE = 'kl_access';
export const REFRESH_COOKIE = 'kl_refresh';
