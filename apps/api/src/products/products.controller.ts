import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return products.map((p) => ({
      code: p.code,
      name: p.name,
      shortName: p.shortName,
      kind: p.kind,
      annualRateBps: p.annualRateBps,
      minTermMonths: p.minTermMonths,
      maxTermMonths: p.maxTermMonths,
      minAmount: p.minAmount,
      maxAmount: p.maxAmount,
      affordabilityBps: p.affordabilityBps,
      secondApprovalAbove: p.secondApprovalAbove,
    }));
  }
}
