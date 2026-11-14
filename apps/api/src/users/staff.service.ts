import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { maskPhone, normaliseRwPhone, type StaffRole } from '@kora/core';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../auth/auth.service';
import type { AuthUser } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface NewStaff {
  email: string;
  firstName: string;
  lastName: string;
  role: StaffRole;
  branchId?: string | null;
  phone?: string | null;
  /** A temporary password; the person must change it at first sign-in. */
  password: string;
}

export interface StaffChanges {
  firstName?: string;
  lastName?: string;
  role?: StaffRole;
  branchId?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

/**
 * The company's staff accounts, managed by its administrators. Row-level
 * security keeps every query inside the administrator's own company.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { firstName: 'asc' }],
      include: { branch: { select: { id: true, name: true } } },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      branchId: u.branch?.id ?? null,
      branch: u.branch?.name ?? null,
      phone: maskPhone(u.phone),
      isActive: u.isActive,
      twoFactorEnabled: u.totpEnabledAt != null,
      mustChangePassword: u.mustChangePassword,
      lockedUntil: u.lockedUntil && u.lockedUntil > new Date() ? u.lockedUntil : null,
      lastLoginAt: u.lastLoginAt,
    }));
  }

  async create(input: NewStaff, actor: AuthUser, meta: RequestMeta) {
    await this.assertBranch(input.branchId);
    const email = input.email.trim().toLowerCase();
    try {
      const user = await this.prisma.user.create({
        data: {
          email,
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          role: input.role,
          branchId: input.branchId ?? null,
          phone: this.phone(input.phone),
          passwordHash: await hashPassword(input.password),
          mustChangePassword: true,
        },
      });
      await this.audit.record({
        action: 'staff.create',
        actorId: actor.id,
        entityType: 'User',
        entityId: user.id,
        metadata: { role: user.role },
        ...meta,
      });
      return { id: user.id, email: user.email };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Someone at this company already uses that email');
      }
      throw err;
    }
  }

  async update(id: string, changes: StaffChanges, actor: AuthUser, meta: RequestMeta) {
    const user = await this.find(id);
    if (id === actor.id) {
      if (changes.isActive === false)
        throw new BadRequestException('You cannot deactivate yourself');
      if (changes.role && changes.role !== user.role) {
        throw new BadRequestException('Ask another administrator to change your role');
      }
    }
    const losesAdmin =
      user.role === 'ADMIN' &&
      user.isActive &&
      ((changes.role && changes.role !== 'ADMIN') || changes.isActive === false);
    if (losesAdmin && (await this.activeAdmins()) <= 1) {
      throw new BadRequestException('The company needs at least one active administrator');
    }
    if (changes.branchId !== undefined) await this.assertBranch(changes.branchId);

    await this.prisma.user.update({
      where: { id },
      data: {
        firstName: changes.firstName?.trim(),
        lastName: changes.lastName?.trim(),
        role: changes.role,
        branchId: changes.branchId,
        phone: changes.phone === undefined ? undefined : this.phone(changes.phone),
        isActive: changes.isActive,
      },
    });
    // Deactivation and role changes take effect at once: end their sessions.
    if (changes.isActive === false || (changes.role && changes.role !== user.role)) {
      await this.endSessions(id);
    }
    await this.audit.record({
      action: changes.isActive === false ? 'staff.deactivate' : 'staff.update',
      actorId: actor.id,
      entityType: 'User',
      entityId: id,
      metadata: {
        changes: Object.keys(changes),
        ...(changes.role && changes.role !== user.role
          ? { from: user.role, to: changes.role }
          : {}),
      },
      ...meta,
    });
  }

  /** Set a temporary password. The person must change it at their next sign-in. */
  async resetPassword(id: string, password: string, actor: AuthUser, meta: RequestMeta) {
    await this.find(id);
    await this.prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword(password),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.endSessions(id);
    await this.audit.record({
      action: 'staff.password_reset',
      actorId: actor.id,
      entityType: 'User',
      entityId: id,
      ...meta,
    });
  }

  /** For a lost phone: turn two-factor off so the person can set it up again. */
  async resetTwoFactor(id: string, actor: AuthUser, meta: RequestMeta) {
    await this.find(id);
    await this.prisma.user.update({
      where: { id },
      data: { totpEnabledAt: null, totpSecretEnc: null, totpLastStep: null },
    });
    await this.endSessions(id);
    await this.audit.record({
      action: 'staff.2fa_reset',
      actorId: actor.id,
      entityType: 'User',
      entityId: id,
      ...meta,
    });
  }

  branches() {
    return this.prisma.branch.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, district: true },
    });
  }

  async createBranch(
    input: { code: string; name: string; district: string },
    actor: AuthUser,
    meta: RequestMeta,
  ) {
    try {
      const branch = await this.prisma.branch.create({
        data: {
          code: input.code.trim().toUpperCase(),
          name: input.name.trim(),
          district: input.district.trim(),
        },
        select: { id: true, code: true, name: true, district: true },
      });
      await this.audit.record({
        action: 'branch.create',
        actorId: actor.id,
        entityType: 'Branch',
        entityId: branch.id,
        ...meta,
      });
      return branch;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A branch already uses that code');
      }
      throw err;
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async find(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('No such staff member');
    return user;
  }

  private activeAdmins(): Promise<number> {
    return this.prisma.user.count({ where: { role: 'ADMIN', isActive: true } });
  }

  private async assertBranch(branchId: string | null | undefined) {
    if (!branchId) return;
    if (!(await this.prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } }))) {
      throw new BadRequestException('No such branch');
    }
  }

  private phone(input: string | null | undefined): string | null {
    if (!input?.trim()) return null;
    const phone = normaliseRwPhone(input);
    if (!phone) throw new BadRequestException('Enter a Rwandan mobile number, e.g. 078 812 3412');
    return phone;
  }

  private endSessions(userId: string) {
    return this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
