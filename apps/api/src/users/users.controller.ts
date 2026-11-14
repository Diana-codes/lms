import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import { STAFF_ROLES } from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { MIN_PASSWORD_LENGTH } from '../auth/password';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { StaffService } from './staff.service';

const userId = new ZodPipe(z.uuid());
const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(200);
const name = z.string().trim().min(1).max(60);
const role = z.enum(STAFF_ROLES);

const createSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)),
  firstName: name,
  lastName: name,
  role,
  branchId: z.uuid().nullable().optional(),
  phone: z.string().trim().max(20).nullable().optional(),
  password,
});

const updateSchema = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    role: role.optional(),
    branchId: z.uuid().nullable().optional(),
    phone: z.string().trim().max(20).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

const resetSchema = z.object({ password });

const branchSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{2,12}$/, 'Use 2–12 letters, digits or hyphens'),
  name: z.string().trim().min(2).max(80),
  district: z.string().trim().min(2).max(60),
});

/** Staff and branches. Administrators manage them; managers can see them. */
@Controller()
export class UsersController {
  constructor(private readonly staff: StaffService) {}

  @Roles('ADMIN', 'MANAGER')
  @Get('users')
  list() {
    return this.staff.list();
  }

  @Roles('ADMIN')
  @Post('users')
  create(
    @Body(new ZodPipe(createSchema)) body: z.infer<typeof createSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.staff.create(body, user, requestMeta(req));
  }

  @Roles('ADMIN')
  @Patch('users/:id')
  @HttpCode(204)
  async update(
    @Param('id', userId) id: string,
    @Body(new ZodPipe(updateSchema)) body: z.infer<typeof updateSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    await this.staff.update(id, body, user, requestMeta(req));
  }

  @Roles('ADMIN')
  @Post('users/:id/reset-password')
  @HttpCode(204)
  async resetPassword(
    @Param('id', userId) id: string,
    @Body(new ZodPipe(resetSchema)) body: z.infer<typeof resetSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    await this.staff.resetPassword(id, body.password, user, requestMeta(req));
  }

  @Roles('ADMIN')
  @Post('users/:id/reset-two-factor')
  @HttpCode(204)
  async resetTwoFactor(
    @Param('id', userId) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    await this.staff.resetTwoFactor(id, user, requestMeta(req));
  }

  @Get('branches')
  branches() {
    return this.staff.branches();
  }

  @Roles('ADMIN')
  @Post('branches')
  createBranch(
    @Body(new ZodPipe(branchSchema)) body: z.infer<typeof branchSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.staff.createBranch(body, user, requestMeta(req));
  }
}
