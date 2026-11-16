import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public, Roles } from '../auth/decorators';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { CompaniesService } from './companies.service';
import { currentCompanyId } from './company-context';
import {
  creditClassProfile,
  hexColour,
  logoUrl,
  optionalText,
  secretsSchema,
} from './company-settings.schemas';
import { CompanySettingsService } from './company-settings.service';

const brandingSchema = z
  .object({
    brandName: optionalText(60),
    brandColor: hexColour.nullable().optional(),
    accentColor: hexColour.nullable().optional(),
    logoUrl: logoUrl.nullable().optional(),
    defaultLanguage: z.enum(['EN', 'RW', 'FR']).optional(),
    supportPhone: optionalText(30),
    supportEmail: z.email().max(254).nullable().optional(),
    address: optionalText(200),
    creditClassProfile: creditClassProfile.optional(),
    staffTwoFactor: z.boolean().optional(),
    borrowerOtp: z.boolean().optional(),
    strictSegregation: z.boolean().optional(),
  })
  .strict();

@Controller('company')
export class CompanyController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly settings: CompanySettingsService,
  ) {}

  /** The company the request is for (from its subdomain): name and branding. */
  @Public()
  @Get()
  async profile() {
    const id = currentCompanyId();
    const profile = id ? await this.companies.publicProfile(id) : null;
    if (!profile) throw new NotFoundException('Unknown company');
    return profile;
  }

  /** The company's settings, for its administrators. Secrets only say whether they are set. */
  @Roles('ADMIN')
  @Get('settings')
  getSettings() {
    return this.settings.get();
  }

  @Roles('ADMIN')
  @Patch('settings')
  updateSettings(
    @Body(new ZodPipe(brandingSchema)) body: z.infer<typeof brandingSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.settings.updateBranding(body, user.id, requestMeta(req));
  }

  /** The company's own MoMo and Africa's Talking accounts. Write-only. */
  @Roles('ADMIN')
  @Put('settings/secrets')
  setSecrets(
    @Body(new ZodPipe(secretsSchema)) body: z.infer<typeof secretsSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.settings.setSecrets(body, user.id, requestMeta(req));
  }

  @Roles('ADMIN')
  @Post('settings/webhook-token')
  @HttpCode(200)
  rotateWebhook(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.settings.rotateWebhookToken(user.id, requestMeta(req));
  }
}
