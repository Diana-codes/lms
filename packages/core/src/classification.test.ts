import { describe, expect, it } from 'vitest';
import {
  classifyByDpd,
  classifyLoan,
  classifyPortfolio,
  CREDIT_CLASS_DPD,
  isNonPerforming,
  PROVISION_BPS,
  requiredProvision,
} from './classification';

describe('BNR 59/2023 classification', () => {
  it('uses the company day bands', () => {
    const b = CREDIT_CLASS_DPD.COMPANY;
    expect(classifyByDpd(0, 'COMPANY')).toBe('NORMAL');
    expect(classifyByDpd(b.WATCH - 1, 'COMPANY')).toBe('NORMAL');
    expect(classifyByDpd(b.WATCH, 'COMPANY')).toBe('WATCH');
    expect(classifyByDpd(b.SUBSTANDARD - 1, 'COMPANY')).toBe('WATCH');
    expect(classifyByDpd(b.SUBSTANDARD, 'COMPANY')).toBe('SUBSTANDARD');
    expect(classifyByDpd(b.DOUBTFUL - 1, 'COMPANY')).toBe('SUBSTANDARD');
    expect(classifyByDpd(b.DOUBTFUL, 'COMPANY')).toBe('DOUBTFUL');
    expect(classifyByDpd(b.LOSS - 1, 'COMPANY')).toBe('DOUBTFUL');
    expect(classifyByDpd(b.LOSS, 'COMPANY')).toBe('LOSS');
  });

  it('uses the stricter cooperative day bands', () => {
    expect(classifyByDpd(0, 'COOPERATIVE')).toBe('NORMAL');
    expect(classifyByDpd(1, 'COOPERATIVE')).toBe('WATCH');
    expect(classifyByDpd(30, 'COOPERATIVE')).toBe('SUBSTANDARD');
    expect(classifyByDpd(90, 'COOPERATIVE')).toBe('DOUBTFUL');
    expect(classifyByDpd(180, 'COOPERATIVE')).toBe('LOSS');
  });

  it('marks substandard and worse as non-performing', () => {
    expect(isNonPerforming('NORMAL')).toBe(false);
    expect(isNonPerforming('WATCH')).toBe(false);
    expect(isNonPerforming('SUBSTANDARD')).toBe(true);
    expect(isNonPerforming('DOUBTFUL')).toBe(true);
    expect(isNonPerforming('LOSS')).toBe(true);
  });

  it('provisions at the Art. 14–15 minima', () => {
    expect(PROVISION_BPS.NORMAL).toBe(100);
    expect(PROVISION_BPS.WATCH).toBe(500);
    expect(PROVISION_BPS.SUBSTANDARD).toBe(2500);
    expect(PROVISION_BPS.DOUBTFUL).toBe(5000);
    expect(PROVISION_BPS.LOSS).toBe(10_000);
    expect(requiredProvision(1_000_000n, 'NORMAL')).toBe(10_000n);
    expect(requiredProvision(1_000_000n, 'WATCH')).toBe(50_000n);
    expect(requiredProvision(1_000_000n, 'SUBSTANDARD')).toBe(250_000n);
    expect(requiredProvision(1_000_000n, 'DOUBTFUL')).toBe(500_000n);
    expect(requiredProvision(1_000_000n, 'LOSS')).toBe(1_000_000n);
    expect(requiredProvision(0n, 'LOSS')).toBe(0n);
  });

  it('classifies one loan and a portfolio', () => {
    const one = classifyLoan(2_000_000n, 100, 'COMPANY');
    expect(one.creditClass).toBe('SUBSTANDARD');
    expect(one.requiredProvision).toBe(500_000n);
    expect(one.nonPerforming).toBe(true);

    // Art. 19: cash collateral reduces the Watch+ provision base.
    const secured = classifyLoan(2_000_000n, 100, 'COMPANY', 800_000n);
    expect(secured.provisionBase).toBe(1_200_000n);
    expect(secured.requiredProvision).toBe(300_000n);
    // Normal: collateral does not reduce the 1% general provision.
    expect(classifyLoan(2_000_000n, 0, 'COMPANY', 800_000n).requiredProvision).toBe(20_000n);

    const port = classifyPortfolio(
      [
        { outstandingPrincipal: 1_000_000n, dpd: 0 },
        { outstandingPrincipal: 1_000_000n, dpd: 45 },
        { outstandingPrincipal: 1_000_000n, dpd: 100 },
        { outstandingPrincipal: 0n, dpd: 400 },
      ],
      'COMPANY',
    );
    expect(port.loans).toBe(3);
    expect(port.outstandingPrincipal).toBe(3_000_000n);
    expect(port.requiredProvision).toBe(10_000n + 50_000n + 250_000n);
    expect(port.nonPerformingPrincipal).toBe(1_000_000n);
    expect(port.nplBps).toBe(3333);
    expect(port.buckets.find((b) => b.creditClass === 'NORMAL')?.loanCount).toBe(1);
    expect(port.buckets.find((b) => b.creditClass === 'WATCH')?.loanCount).toBe(1);
    expect(port.buckets.find((b) => b.creditClass === 'SUBSTANDARD')?.loanCount).toBe(1);
  });
});
