import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';
import { requestMeta, rwfString } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { SmsService } from '../sms/sms.service';
import { CompaniesService, type CompanyInfo } from '../tenancy/companies.service';
import { MoneyService } from './money.service';

const loanCode = new ZodPipe(z.string().regex(/^LN-\d{4}-\d{4}$/, 'Not a loan reference'));
const requestSchema = z.object({ amount: rwfString });
const momoCallback = z
  .object({ referenceId: z.string().min(8).max(80).optional(), externalId: z.string().optional() })
  .passthrough();
const atReport = z
  .object({
    id: z.string().min(1),
    status: z.string().min(1),
    failureReason: z.string().optional(),
  })
  .passthrough();

@Controller()
export class MoneyController {
  constructor(
    private readonly money: MoneyService,
    private readonly sms: SmsService,
    private readonly companies: CompaniesService,
  ) {}

  /** Staff ask the borrower to approve a repayment on their phone. */
  @Post('loans/:code/momo-request')
  @HttpCode(202)
  request(
    @Param('code', loanCode) code: string,
    @Body(new ZodPipe(requestSchema)) body: z.infer<typeof requestSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.money.requestPayment(code, body.amount, { staffId: user.id }, requestMeta(req));
  }

  /** Staff check on a pending request right away instead of waiting for the poller. */
  @Post('payments/:id/check')
  @HttpCode(200)
  async check(@Param('id', new ZodPipe(z.uuid())) id: string) {
    return { status: await this.money.settlePayment(id) };
  }

  @Post('disbursements/:id/check')
  @HttpCode(200)
  async checkDisbursement(@Param('id', new ZodPipe(z.uuid())) id: string) {
    return { status: await this.money.settleDisbursement(id) };
  }

  /**
   * MoMo callbacks. Each company has its own secret in its webhook URLs: it
   * stops strangers posting here and says which company the callback is for.
   * The body is only used to learn which request to re-check with MTN.
   */
  @Public()
  @Post('webhooks/momo/:product/:token')
  @HttpCode(200)
  async momoWebhook(
    @Param('token') token: string,
    @Body(new ZodPipe(momoCallback)) body: z.infer<typeof momoCallback>,
    @Req() req: Request,
  ) {
    const company = await this.companyFor(token);
    const reference = body.referenceId ?? req.get('X-Reference-Id');
    if (reference) await this.companies.runAs(company, () => this.money.handleCallback(reference));
    return { received: true };
  }

  /** Africa's Talking delivery reports. */
  @Public()
  @Post('webhooks/sms/delivery/:token')
  @HttpCode(200)
  async smsDelivery(
    @Param('token') token: string,
    @Body(new ZodPipe(atReport)) body: z.infer<typeof atReport>,
  ) {
    const company = await this.companyFor(token);
    await this.companies.runAs(company, () =>
      this.sms.deliveryReport(body.id, body.status, body.failureReason),
    );
    return { received: true };
  }

  private async companyFor(token: string): Promise<CompanyInfo> {
    const company = await this.companies.byWebhookToken(token);
    if (!company || company.status !== 'ACTIVE') throw new UnauthorizedException();
    return company;
  }
}
