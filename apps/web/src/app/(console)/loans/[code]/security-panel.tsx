'use client';

import { COLLATERAL_KIND_LABELS, type CollateralKind } from '@kora/core';
import {
  Button,
  Card,
  CardTitle,
  FormError,
  Money,
  SelectField,
  TextField,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { LoanCollateral, LoanDetail, LoanGuarantor } from '@/lib/types';

const KINDS = Object.keys(COLLATERAL_KIND_LABELS) as CollateralKind[];

/** Collateral and guarantors on a loan detail page. */
export function SecurityPanel({
  loan,
  canEdit,
}: {
  loan: Pick<LoanDetail, 'code' | 'status' | 'collaterals' | 'guarantors' | 'terms'>;
  canEdit: boolean;
}) {
  const closed = loan.status === 'REPAID' || loan.status === 'WRITTEN_OFF';
  const activeCollateral = loan.collaterals.filter((c) => !c.released);
  const activeGuarantors = loan.guarantors.filter((g) => !g.released);
  const admissible = loan.terms.admissibleCollateral ?? '0';

  return (
    <Card className="gap-4 p-[22px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <CardTitle className="mr-auto">Security</CardTitle>
        {admissible !== '0' ? (
          <span className="text-xs text-ink-muted">
            Admissible for provisioning: <Money amount={admissible} />
          </span>
        ) : null}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold">Collateral</h3>
        {activeCollateral.length === 0 ? (
          loan.terms.collateral ? (
            <p className="m-0 text-sm">
              {loan.terms.collateral}
              <span className="block text-xs text-ink-muted">
                Noted at disbursement. Add it below with a value to count it for provisioning.
              </span>
            </p>
          ) : (
            <p className="m-0 text-sm text-ink-muted">None recorded.</p>
          )
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {activeCollateral.map((c) => (
              <CollateralRow
                key={c.id}
                loanCode={loan.code}
                item={c}
                canEdit={canEdit && !closed}
              />
            ))}
          </ul>
        )}
        {canEdit && !closed ? <AddCollateralForm loanCode={loan.code} /> : null}
      </section>

      <section className="flex flex-col gap-2 border-t border-line-soft pt-4">
        <h3 className="m-0 text-sm font-semibold">Guarantors</h3>
        {activeGuarantors.length === 0 ? (
          <p className="m-0 text-sm text-ink-muted">None recorded.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {activeGuarantors.map((g) => (
              <GuarantorRow key={g.id} loanCode={loan.code} item={g} canEdit={canEdit && !closed} />
            ))}
          </ul>
        )}
        {canEdit && !closed ? <AddGuarantorForm loanCode={loan.code} /> : null}
      </section>
    </Card>
  );
}

function CollateralRow({
  loanCode,
  item,
  canEdit,
}: {
  loanCode: string;
  item: LoanCollateral;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function release() {
    setBusy(true);
    try {
      await api(`/loans/${loanCode}/collateral/${item.id}/release`, { method: 'POST' });
      toast('Collateral released');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not release collateral');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-line-soft px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{item.description}</div>
          <div className="text-xs text-ink-muted">
            {item.kindLabel}
            {item.registered ? ' · registered' : ''}
            {item.insured ? ' · insured' : ''}
          </div>
        </div>
        <div className="text-right">
          <div className="font-semibold tabular-nums">
            <Money amount={item.marketValue} />
          </div>
          {canEdit ? (
            <button
              type="button"
              className="text-xs text-ink-muted underline-offset-2 hover:underline"
              disabled={busy}
              onClick={release}
            >
              Release
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function GuarantorRow({
  loanCode,
  item,
  canEdit,
}: {
  loanCode: string;
  item: LoanGuarantor;
  canEdit: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function release() {
    setBusy(true);
    try {
      await api(`/loans/${loanCode}/guarantors/${item.id}/release`, { method: 'POST' });
      toast('Guarantor released');
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not release guarantor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-lg border border-line-soft px-3 py-2 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{item.fullName}</div>
          <div className="text-xs text-ink-muted">
            {[
              item.relationship,
              item.phone,
              item.nationalIdLast3 ? `ID …${item.nationalIdLast3}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Guarantor'}
          </div>
        </div>
        <div className="text-right">
          {item.guaranteeAmount ? (
            <div className="font-semibold tabular-nums">
              <Money amount={item.guaranteeAmount} />
            </div>
          ) : null}
          {canEdit ? (
            <button
              type="button"
              className="text-xs text-ink-muted underline-offset-2 hover:underline"
              disabled={busy}
              onClick={release}
            >
              Release
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AddCollateralForm({ loanCode }: { loanCode: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<CollateralKind>('MOVABLE');
  const [description, setDescription] = useState('');
  const [marketValue, setMarketValue] = useState('');
  const [registered, setRegistered] = useState(false);
  const [insured, setInsured] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loanCode}/collateral`, {
        method: 'POST',
        body: {
          kind,
          description,
          marketValue: marketValue.replace(/[,\s]/g, '') || '0',
          registered,
          insured,
        },
      });
      toast('Collateral added');
      setOpen(false);
      setDescription('');
      setMarketValue('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Add collateral
      </Button>
    );
  }

  const needsRegistered =
    kind === 'RESIDENTIAL_MORTGAGE' || kind === 'COMMERCIAL_MORTGAGE' || kind === 'LAND';
  const needsInsured = kind === 'MOVABLE';

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <SelectField
        label="Kind"
        value={kind}
        onChange={(e) => setKind(e.target.value as CollateralKind)}
      >
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {COLLATERAL_KIND_LABELS[k]}
          </option>
        ))}
      </SelectField>
      <TextField
        label="Description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        required
        maxLength={200}
      />
      <TextField
        label="Market value (RWF)"
        value={marketValue}
        onChange={(e) => setMarketValue(e.target.value)}
        inputMode="numeric"
      />
      {needsRegistered ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={registered}
            onChange={(e) => setRegistered(e.target.checked)}
          />
          Duly registered (required for provisioning)
        </label>
      ) : null}
      {needsInsured ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={insured} onChange={(e) => setInsured(e.target.checked)} />
          Covered by insurance (required for provisioning)
        </label>
      ) : null}
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !description.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function AddGuarantorForm({ loanCode }: { loanCode: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [guaranteeAmount, setGuaranteeAmount] = useState('');

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/loans/${loanCode}/guarantors`, {
        method: 'POST',
        body: {
          fullName,
          phone: phone.trim() || null,
          relationship: relationship.trim() || null,
          guaranteeAmount: guaranteeAmount.replace(/[,\s]/g, '') || null,
        },
      });
      toast('Guarantor added');
      setOpen(false);
      setFullName('');
      setPhone('');
      setRelationship('');
      setGuaranteeAmount('');
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        Add guarantor
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-line p-3">
      <TextField
        label="Full name"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        required
        maxLength={120}
      />
      <TextField
        label="Phone"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        maxLength={30}
      />
      <TextField
        label="Relationship"
        value={relationship}
        onChange={(e) => setRelationship(e.target.value)}
        maxLength={60}
      />
      <TextField
        label="Guarantee amount (RWF, optional)"
        value={guaranteeAmount}
        onChange={(e) => setGuaranteeAmount(e.target.value)}
        inputMode="numeric"
      />
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !fullName.trim()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
