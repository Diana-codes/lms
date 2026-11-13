import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { StaffRole } from '@kora/core';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'kora:isPublic';
export const ROLES = 'kora:roles';

/** Opt a route out of authentication. Everything else needs a signed-in user. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restrict a route (or controller) to these roles. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ user?: AuthUser }>().user;
});
