import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import {
  COMPONENTS,
  FEE_TIMINGS,
  FREQUENCIES,
  INTEREST_METHODS,
  OVERPAYMENT_RULES,
  PAYOFF_INTEREST_RULES,
  PENALTY_METHODS,
  RATE_PERIODS,
  ROUNDING_UNITS,
  RW_DEFAULT_TERMS,
  type LoanTerms,
} from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import {
  createProductSchema,
  quoteSchema,
  updateProductSchema,
  type CreateProductInput,
  type UpdateProductInput,
} from './products.schemas';
import { ProductsService } from './products.service';

const productCode = new ZodPipe(z.string().trim().min(1).max(20));

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  /** Published products, for anyone taking applications. */
  @Get()
  list() {
    return this.products.published();
  }

  /** The loan catalogue for the public website: published products only, no sign-in. */
  @Public()
  @Get('catalogue')
  @Header('Cache-Control', 'public, max-age=60')
  catalogue() {
    return this.products.catalogue();
  }

  /** Every product with its terms, for the products screen. */
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @Get('manage')
  all() {
    return this.products.all();
  }

  /** Rwanda's starting terms and every option the engine offers, for the editor. */
  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @Get('options')
  options() {
    return {
      defaults: RW_DEFAULT_TERMS,
      interestMethods: INTEREST_METHODS,
      frequencies: FREQUENCIES,
      ratePeriods: RATE_PERIODS,
      feeTimings: FEE_TIMINGS,
      penaltyMethods: PENALTY_METHODS,
      components: COMPONENTS,
      overpaymentRules: OVERPAYMENT_RULES,
      payoffInterestRules: PAYOFF_INTEREST_RULES,
      roundingUnits: ROUNDING_UNITS,
    };
  }

  /** A sample schedule under some terms, without saving anything. */
  @Post('quote')
  @HttpCode(200)
  quote(@Body(new ZodPipe(quoteSchema)) body: z.infer<typeof quoteSchema>) {
    return this.products.quote({ ...body, terms: body.terms as LoanTerms });
  }

  @Roles('ADMIN', 'MANAGER', 'AUDITOR')
  @Get(':code')
  detail(@Param('code', productCode) code: string) {
    return this.products.detail(code);
  }

  @Roles('ADMIN')
  @Post()
  create(
    @Body(new ZodPipe(createProductSchema)) body: CreateProductInput,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.products.create(body, user.id, requestMeta(req));
  }

  @Roles('ADMIN')
  @Put(':code')
  update(
    @Param('code', productCode) code: string,
    @Body(new ZodPipe(updateProductSchema)) body: UpdateProductInput,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.products.update(code, body, user.id, requestMeta(req));
  }

  @Roles('ADMIN')
  @Post(':code/publish')
  @HttpCode(200)
  publish(
    @Param('code', productCode) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.products.setStatus(code, 'PUBLISHED', user.id, requestMeta(req));
  }

  @Roles('ADMIN')
  @Post(':code/retire')
  @HttpCode(200)
  retire(
    @Param('code', productCode) code: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.products.setStatus(code, 'RETIRED', user.id, requestMeta(req));
  }
}
