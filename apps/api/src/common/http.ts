import type { Request } from 'express';
import { z } from 'zod';

/** Who and where a request came from, for the audit log. */
export const requestMeta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent') });

/** A whole RWF amount on the wire: a string of digits, never a JSON number. */
export const rwfString = z
  .string()
  .trim()
  .transform((v) => v.replace(/^RWF\s*/i, '').replace(/[,\s]/g, ''))
  .pipe(z.string().regex(/^\d{1,15}$/, 'Enter a whole amount in RWF'))
  .transform((v) => BigInt(v))
  .refine((v) => v > 0n, 'Amount must be more than zero');

export const isoDateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const pageQuery = z.coerce.number().int().min(1).max(10_000).default(1);

/** Escape % and _ so user text is matched literally in ILIKE. */
export const escapeLike = (text: string) => text.replace(/[\\%_]/g, '\\$&');
export const likePattern = (text: string) => `%${escapeLike(text)}%`;
