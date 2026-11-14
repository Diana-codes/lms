import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { ENV, type Env } from '../config/env';
import { companyFeatures } from '../tenancy/company-context';

export class AiUnavailableError extends Error {}

export interface StructuredRequest<T extends z.ZodType> {
  schema: T;
  system: string;
  user: string;
  effort?: 'low' | 'medium' | 'high';
  maxTokens?: number;
}

/**
 * The one place the app talks to Claude. Called only from the backend; the
 * key never reaches a browser or phone. Answers are parsed against a Zod
 * schema, so callers get typed data or an error, never loose text.
 *
 * With no ANTHROPIC_API_KEY the client reports itself unconfigured and the
 * AI features say so in the UI. Tests replace this class with a fake.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  private readonly client: Anthropic | null;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 })
      : null;
  }

  /** Available to the current company: a key is set and the company has AI switched on. */
  get configured(): boolean {
    return this.client != null && companyFeatures().ai;
  }

  get model(): string {
    return this.env.AI_MODEL;
  }

  async structured<T extends z.ZodType>(req: StructuredRequest<T>): Promise<z.infer<T>> {
    if (!this.client) throw new AiUnavailableError('The AI service is not configured');
    if (!companyFeatures().ai) {
      throw new AiUnavailableError('AI features are switched off for this company');
    }
    try {
      const response = await this.client.beta.messages.parse({
        model: this.env.AI_MODEL,
        max_tokens: req.maxTokens ?? 4000,
        // If the model declines on a safety policy, the API retries on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: req.effort ?? 'low', format: betaZodOutputFormat(req.schema) },
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: req.user }],
      });
      if (response.stop_reason === 'refusal')
        throw new AiUnavailableError('The AI model declined this request');
      if (response.parsed_output == null)
        throw new AiUnavailableError('The AI answer could not be read');
      return response.parsed_output as z.infer<T>;
    } catch (err) {
      if (err instanceof AiUnavailableError) throw err;
      if (err instanceof Anthropic.RateLimitError)
        throw new AiUnavailableError('The AI service is busy. Try again in a minute.');
      if (err instanceof Anthropic.AuthenticationError) {
        this.logger.error('ANTHROPIC_API_KEY was rejected');
        throw new AiUnavailableError('The AI service is not configured correctly');
      }
      if (err instanceof Anthropic.APIError) {
        this.logger.error(`Claude API error ${err.status}`);
        throw new AiUnavailableError('The AI service had a problem. Try again later.');
      }
      throw new AiUnavailableError('Could not reach the AI service');
    }
  }
}
