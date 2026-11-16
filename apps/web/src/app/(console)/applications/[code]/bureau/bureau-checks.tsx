'use client';

import { formatDate } from '@kora/core';
import {
  Button,
  Card,
  CardTitle,
  FormError,
  Pill,
  SelectField,
  TextAreaField,
  TextField,
  useToast,
} from '@kora/ui';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime, todayIso } from '@/lib/format';

export interface BureauChecksView {
  application: string;
  borrower: { name: string; phone: string };
  consent: { grantedAt: string; channel: string; textVersion: string } | null;
  borrowerChecked: boolean;
  checks: Array<{
    id: string;
    subject: 'BORROWER' | 'GUARANTOR';
    guarantorName: string | null;
    consentNote: string | null;
    bureau: string;
    reference: string | null;
    score: number | null;
    openLoans: number | null;
    hasDefaults: boolean;
    summary: string;
    checkedOn: string;
    createdAt: string;
  }>;
}

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
const CHANNEL: Record<string, string> = {
  APP: 'in the app',
  OFFICER: 'on a signed form, recorded by staff',
  USSD: 'by USSD',
};

export function BureauChecks({
  code,
  initial,
  canEdit,
}: {
  code: string;
  initial: BureauChecksView;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [view, setView] = useState(initial);
  const [subject, setSubject] = useState<'BORROWER' | 'GUARANTOR'>('BORROWER');
  const [guarantorName, setGuarantorName] = useState('');
  const [consentNote, setConsentNote] = useState('');
  const [bureau, setBureau] = useState(initial.checks[0]?.bureau ?? 'TransUnion Rwanda');
  const [reference, setReference] = useState('');
  const [score, setScore] = useState('');
  const [openLoans, setOpenLoans] = useState('');
  const [hasDefaults, setHasDefaults] = useState<'no' | 'yes'>('no');
  const [summary, setSummary] = useState('');
  const [checkedOn, setCheckedOn] = useState(todayIso());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recordConsent() {
    setBusy('consent');
    setError(null);
    try {
      setView(
        await api<BureauChecksView>(`/applications/${code}/bureau/consent`, {
          method: 'POST',
          body: {},
        }),
      );
      toast('Consent recorded.');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function record(event: FormEvent) {
    event.preventDefault();
    setBusy('check');
    setError(null);
    try {
      setView(
        await api<BureauChecksView>(`/applications/${code}/bureau/checks`, {
          method: 'POST',
          body: {
            subject,
            guarantorName: subject === 'GUARANTOR' ? guarantorName : undefined,
            consentNote: subject === 'GUARANTOR' ? consentNote : undefined,
            bureau,
            reference: reference || undefined,
            score: score ? Number(score) : undefined,
            openLoans: openLoans ? Number(openLoans) : undefined,
            hasDefaults: hasDefaults === 'yes',
            summary,
            checkedOn,
          },
        }),
      );
      toast('Bureau report recorded.');
      setReference('');
      setScore('');
      setOpenLoans('');
      setSummary('');
      setGuarantorName('');
      setConsentNote('');
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  const needsConsent = subject === 'BORROWER' && !view.consent;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col gap-4">
        <Card className="gap-3">
          <CardTitle>Borrower’s consent</CardTitle>
          {view.consent ? (
            <p className="m-0 text-sm">
              <Pill tone="success">Given</Pill> {dateTime(view.consent.grantedAt)},{' '}
              {CHANNEL[view.consent.channel] ?? view.consent.channel} (wording{' '}
              {view.consent.textVersion}).
            </p>
          ) : (
            <>
              <p className="m-0 text-sm text-ink-soft">
                No consent on record. Borrowers who apply in the app give it there; for others, have
                them sign the consent form, then record it here.
              </p>
              {canEdit ? (
                <Button
                  type="button"
                  variant="secondary"
                  loading={busy === 'consent'}
                  onClick={recordConsent}
                  className="self-start"
                >
                  Record signed consent
                </Button>
              ) : null}
            </>
          )}
          {!view.borrowerChecked ? (
            <p className="m-0 text-sm text-amber">
              No bureau report recorded for the applicant yet.
            </p>
          ) : null}
        </Card>

        {canEdit ? (
          <Card className="gap-3">
            <CardTitle>Record a bureau report</CardTitle>
            <form onSubmit={record} className="flex flex-col gap-3">
              <SelectField
                label="Whose report"
                value={subject}
                onChange={(e) => setSubject(e.target.value as 'BORROWER' | 'GUARANTOR')}
              >
                <option value="BORROWER">The applicant</option>
                <option value="GUARANTOR">A guarantor</option>
              </SelectField>
              {subject === 'GUARANTOR' ? (
                <>
                  <TextField
                    label="Guarantor’s name"
                    value={guarantorName}
                    onChange={(e) => setGuarantorName(e.target.value)}
                    maxLength={120}
                  />
                  <TextField
                    label="How the guarantor gave consent"
                    placeholder="e.g. signed the guarantee form with bureau consent"
                    value={consentNote}
                    onChange={(e) => setConsentNote(e.target.value)}
                    maxLength={200}
                  />
                </>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label="Bureau"
                  value={bureau}
                  onChange={(e) => setBureau(e.target.value)}
                  maxLength={60}
                />
                <TextField
                  label="Report reference"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  maxLength={80}
                />
                <TextField
                  label="Score (if given)"
                  inputMode="numeric"
                  value={score}
                  onChange={(e) => setScore(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <TextField
                  label="Open loans elsewhere"
                  inputMode="numeric"
                  value={openLoans}
                  onChange={(e) => setOpenLoans(e.target.value.replace(/\D/g, '').slice(0, 4))}
                />
                <SelectField
                  label="Defaults or write-offs on record"
                  value={hasDefaults}
                  onChange={(e) => setHasDefaults(e.target.value as 'no' | 'yes')}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </SelectField>
                <TextField
                  label="Report date"
                  type="date"
                  max={todayIso()}
                  value={checkedOn}
                  onChange={(e) => setCheckedOn(e.target.value)}
                />
              </div>
              <TextAreaField
                label="What the report shows"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                maxLength={1000}
              />
              <FormError>{error}</FormError>
              <Button
                type="submit"
                loading={busy === 'check'}
                disabled={needsConsent || summary.trim().length < 5}
                className="self-start"
              >
                Record report
              </Button>
              {needsConsent ? (
                <p className="m-0 text-xs text-ink-muted">Record the borrower’s consent first.</p>
              ) : null}
            </form>
          </Card>
        ) : null}
      </div>

      <Card className="gap-3">
        <CardTitle>Reports on file</CardTitle>
        {view.checks.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">None yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {view.checks.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-1 border-b border-line-soft pb-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">
                    {c.subject === 'BORROWER' ? 'Applicant' : `Guarantor · ${c.guarantorName}`}
                  </span>
                  <Pill tone={c.hasDefaults ? 'danger' : 'success'}>
                    {c.hasDefaults ? 'Defaults on record' : 'No defaults'}
                  </Pill>
                </div>
                <p className="m-0 text-sm">{c.summary}</p>
                <p className="m-0 text-xs text-ink-muted">
                  {c.bureau} · {formatDate(c.checkedOn)}
                  {c.reference ? ` · ref. ${c.reference}` : ''}
                  {c.score != null ? ` · score ${c.score}` : ''}
                  {c.openLoans != null ? ` · ${c.openLoans} open loans` : ''}
                  {c.consentNote ? ` · consent: ${c.consentNote}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
