import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@kora/core';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'kora:isPublic';
export const ROLES = 'kora:roles';

/** Opt a route out of authentication. Everything else needs a signed-in user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route (or controller) to these roles. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES, roles);

export const ALLOW_WHILE_PASSWORD_CHANGE = 'kora:allowWhilePasswordChange';

/**
 * Routes a user may use while they must still choose a new password (after
 * an administrator set it): seeing who they are, signing out, changing it.
 */
export const AllowWhilePasswordChange = () => SetMetadata(ALLOW_WHILE_PASSWORD_CHANGE, true);

export const ALLOW_WITHOUT_TWO_FACTOR = 'kora:allowWithoutTwoFactor';

/**
 * Routes a user may use before they have set up two-factor sign-in, which
 * is required: seeing who they are, signing out, and setting it up.
 */
export const AllowWithoutTwoFactor = () => SetMetadata(ALLOW_WITHOUT_TWO_FACTOR, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
});
