import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { migrationTemplateCsv } from '@kora/core';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Roles } from '../auth/decorators';
import { isoDateString, requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { MigrationService } from './migration.service';

const checkSchema = z.object({ asOf: isoDateString.optional() });
const idParam = new ZodPipe(z.uuid());

/** PRD §6.14: the existing loan book, imported from spreadsheets. */
@Controller('migration')
export class MigrationController {
  constructor(private readonly migration: MigrationService) {}

  @Get('template.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="loan-book-template.csv"')
  template() {
    return migrationTemplateCsv();
  }

  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR')
  @Get('batches')
  list() {
    return this.migration.list();
  }

  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR')
  @Get('batches/:id')
  get(@Param('id', idParam) id: string) {
    return this.migration.get(id);
  }

  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT', 'AUDITOR')
  @Get('batches/:id/reconciliation')
  reconciliation(@Param('id', idParam) id: string) {
    return this.migration.reconciliation(id);
  }

  /** Multipart: `file` (.xlsx or .csv) and optional `asOf` (the cut-over date). */
  @Roles('ADMIN', 'MANAGER')
  @Post('batches')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  check(
    @UploadedFile() file: { originalname: string; size: number; buffer: Buffer } | undefined,
    @Body(new ZodPipe(checkSchema)) body: z.infer<typeof checkSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!file) throw new BadRequestException('Attach the spreadsheet');
    return this.migration.check(
      { fileName: file.originalname, buffer: file.buffer, asOf: body.asOf },
      user,
      requestMeta(req),
    );
  }

  @Roles('ADMIN', 'MANAGER')
  @Post('batches/:id/import')
  @HttpCode(200)
  import(@Param('id', idParam) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.migration.import(id, user, requestMeta(req));
  }

  /** The Finance Manager's sign-off: someone other than the importer. */
  @Roles('ADMIN', 'MANAGER', 'ACCOUNTANT')
  @Post('batches/:id/sign-off')
  @HttpCode(200)
  signOff(@Param('id', idParam) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.migration.signOff(id, user, requestMeta(req));
  }
}
