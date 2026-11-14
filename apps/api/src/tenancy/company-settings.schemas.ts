import { z } from 'zod';
import { SETTABLE_SECRETS } from './company-secrets.service';

/** Shared by the company admin and platform admin settings routes. */
export const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #0E3B2E');
export const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

/** A logo must be an https address, so the console never loads it over plain http. */
export const logoUrl = z
  .url()
  .max(500)
  .refine((v) => v.startsWith('https://'), 'Use an https:// address');

/** Provider settings: each value is set, or removed with null; absent ones stay as they are. */
export const secretsSchema = z
  .object(
    Object.fromEntries(
      Object.keys(SETTABLE_SECRETS).map((k) => [
        k,
        z.string().trim().max(200).nullable().optional(),
      ]),
    ) as Record<keyof typeof SETTABLE_SECRETS, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
  )
  .strict();
