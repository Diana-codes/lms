import { Controller, Get } from '@nestjs/common';
import { maskPhone } from '@kora/core';
import { Roles } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff directory. Managers and administrators only. */
  @Roles('ADMIN', 'MANAGER')
  @Get()
  async list() {
    const users = await this.prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { firstName: 'asc' }],
      include: { branch: { select: { name: true } } },
    });
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      branch: u.branch?.name ?? null,
      phone: maskPhone(u.phone),
      isActive: u.isActive,
      twoFactorEnabled: u.totpEnabledAt != null,
      lastLoginAt: u.lastLoginAt,
    }));
  }
}
