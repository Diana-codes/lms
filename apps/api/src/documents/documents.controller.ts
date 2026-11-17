import { createReadStream } from 'node:fs';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { MAX_REJECTION_REASON } from '@kora/core';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { DocumentsService } from './documents.service';

const codeParam = new ZodPipe(z.string().regex(/^BR-\d{5,9}$/, 'Not a borrower reference'));
const idParam = new ZodPipe(z.uuid());
const rejectSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Tell the borrower what to fix')
    .max(MAX_REJECTION_REASON, `Keep the reason under ${MAX_REJECTION_REASON} characters`),
});

/**
 * KYC documents in the console. Identity papers are sensitive, so only
 * people who decide on loans can open or review them: not collections.
 */
@Roles('LOAN_OFFICER', 'MANAGER', 'ADMIN')
@Controller('borrowers/:code/documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get(':id/file')
  async file(
    @Param('code', codeParam) code: string,
    @Param('id', idParam) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const f = await this.documents.file(code, id, user, requestMeta(req));
    res.set({
      'Content-Type': f.mimeType,
      'Content-Disposition': `inline; filename="${f.fileName}"`,
      // Never cached by the browser or anything in between, and never run as a page.
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    // Photos are locked down completely. PDFs skip `sandbox`, which stops the
    // browser's PDF viewer; their first bytes were checked to be a real PDF.
    if (f.mimeType !== 'application/pdf') {
      res.set('Content-Security-Policy', "default-src 'none'; img-src 'self'; sandbox");
    }
    return new StreamableFile(createReadStream(f.path));
  }

  @Post(':id/verify')
  @HttpCode(200)
  verify(
    @Param('code', codeParam) code: string,
    @Param('id', idParam) id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.documents.review(code, id, { verify: true }, user, requestMeta(req));
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('code', codeParam) code: string,
    @Param('id', idParam) id: string,
    @Body(new ZodPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.documents.review(
      code,
      id,
      { verify: false, reason: body.reason },
      user,
      requestMeta(req),
    );
  }
}
