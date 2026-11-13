import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { pageQuery, requestMeta } from '../common/http';
import { ZodPipe } from '../common/zod.pipe';
import { BorrowersService } from './borrowers.service';

const codeParam = new ZodPipe(z.string().regex(/^BR-\d{5,9}$/, 'Not a borrower reference'));
const listSchema = z.object({
  q: z.string().trim().max(80).optional(),
  mine: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  page: pageQuery,
});
const noteSchema = z.object({ body: z.string().trim().min(1, 'Write something first').max(2000) });

@Controller('borrowers')
export class BorrowersController {
  constructor(private readonly borrowers: BorrowersService) {}

  @Get()
  list(
    @Query(new ZodPipe(listSchema)) query: z.infer<typeof listSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.borrowers.list(query, user);
  }

  @Get(':code')
  profile(@Param('code', codeParam) code: string) {
    return this.borrowers.profile(code);
  }

  @Post(':code/notes')
  addNote(
    @Param('code', codeParam) code: string,
    @Body(new ZodPipe(noteSchema)) body: z.infer<typeof noteSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.borrowers.addNote(code, body.body, user, requestMeta(req));
  }
}
