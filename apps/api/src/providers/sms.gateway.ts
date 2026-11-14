import { appendFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { maskPhone } from '@kora/core';

export interface SmsSendResult {
  accepted: boolean;
  providerMessageId?: string;
  /** True when the provider has already confirmed delivery (the simulator does). */
  delivered?: boolean;
  reason?: string;
}

export abstract class SmsGateway {
  abstract readonly name: 'africastalking' | 'simulator';
  abstract send(to: string, message: string): Promise<SmsSendResult>;
}

/**
 * Stands in for Africa's Talking when no API key is set. Messages are
 * "delivered" at once and never leave the machine. Numbers ending in 00 are
 * refused, to exercise the failure path.
 */
export class SmsSimulator extends SmsGateway {
  readonly name = 'simulator' as const;
  private readonly logger = new Logger('SmsSimulator');
  private counter = 0;
  /** The latest messages, newest last, for tests to read. */
  readonly outbox: Array<{ to: string; message: string }> = [];

  /** `outboxFile`: development only, also append each message there (see SMS_OUTBOX_FILE). */
  constructor(private readonly outboxFile?: string) {
    super();
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    if (to.endsWith('00')) return { accepted: false, reason: 'Number not reachable' };
    this.counter += 1;
    this.outbox.push({ to, message });
    if (this.outbox.length > 200) this.outbox.shift();
    if (this.outboxFile) {
      appendFileSync(this.outboxFile, `${JSON.stringify({ at: Date.now(), to, message })}\n`);
    }
    // The number is masked and the text is not logged: it can hold a one-time code.
    this.logger.log(`Simulated SMS to ${maskPhone(to)} (${message.length} characters)`);
    return {
      accepted: true,
      delivered: true,
      providerMessageId: `SIM-${Date.now().toString(36)}-${this.counter}`,
    };
  }
}

interface AtResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: Array<{ statusCode: number; number: string; status: string; messageId: string }>;
  };
}

/** One company's Africa's Talking account. */
export interface AfricasTalkingSettings {
  username: string;
  apiKey: string;
  senderId?: string;
}

/** Africa's Talking bulk SMS. The sandbox and live APIs differ only in host and username. */
export class AfricasTalkingGateway extends SmsGateway {
  readonly name = 'africastalking' as const;

  constructor(private readonly settings: AfricasTalkingSettings) {
    super();
  }

  async send(to: string, message: string): Promise<SmsSendResult> {
    const sandbox = this.settings.username === 'sandbox';
    const host = sandbox ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
    const form = new URLSearchParams({ username: this.settings.username, to, message });
    if (this.settings.senderId) form.set('from', this.settings.senderId);

    let res: Response;
    try {
      res = await fetch(`https://${host}/version1/messaging`, {
        method: 'POST',
        headers: {
          apiKey: this.settings.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      return { accepted: false, reason: 'Could not reach the SMS provider' };
    }
    if (!res.ok) return { accepted: false, reason: `SMS provider error (${res.status})` };
    const body = (await res.json()) as AtResponse;
    const recipient = body.SMSMessageData?.Recipients?.[0];
    // 100–102 are Africa's Talking's "processed / sent / queued" codes.
    if (!recipient || recipient.statusCode < 100 || recipient.statusCode > 102) {
      return {
        accepted: false,
        reason: recipient?.status ?? body.SMSMessageData?.Message ?? 'Rejected',
      };
    }
    return { accepted: true, providerMessageId: recipient.messageId };
  }
}
