'use client';

import { formatRwf, normaliseRwPhone } from '@kora/core';
import { Button, FormError, Modal, SelectField, TextField, useToast } from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { groupDigits, rate } from '@/lib/format';
import type { ApplicationCard, Product } from '@/lib/types';

export function NewApplicationDialog({
  open,
  products,
  onClose,
}: {
  open: boolean;
  products: Product[];
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [productCode, setProductCode] = useState(products[0]?.code ?? '');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setPhone('');
    setAmount('');
    setError(null);
    setTouched(false);
    setBusy(false);
  }, [open]);

  const product = products.find((p) => p.code === productCode);
  const value = amount ? BigInt(amount.replace(/,/g, '')) : 0n;
  const nameError = name.trim().length < 2 ? 'Add the applicant’s name' : null;
  const phoneError = normaliseRwPhone(phone)
    ? null
    : 'Enter a Rwandan mobile number, e.g. 078 812 3412';
  const amountError = !product
    ? null
    : value === 0n
      ? 'Add an amount'
      : value < BigInt(product.minAmount) || value > BigInt(product.maxAmount)
        ? `Between ${formatRwf(BigInt(product.minAmount))} and ${formatRwf(BigInt(product.maxAmount))}`
        : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (nameError || phoneError || amountError || !product) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api<ApplicationCard>('/applications', {
        method: 'POST',
        body: { name: name.trim(), phone, productCode, amount: value.toString() },
      });
      toast(`${created.code} created for ${created.borrowerName}.`);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New application" subtitle="Goes into “New”">
      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <TextField
          label="Applicant or business name"
          placeholder="e.g. Claudine Mukamana"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={touched ? nameError : null}
          autoComplete="off"
          data-autofocus
        />
        <div className="grid grid-cols-2 gap-2.5">
          <SelectField
            label="Product"
            value={productCode}
            onChange={(e) => setProductCode(e.target.value)}
          >
            {products.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </SelectField>
          <TextField
            label="Amount (RWF)"
            inputMode="numeric"
            placeholder="1,000,000"
            value={amount}
            onChange={(e) => setAmount(groupDigits(e.target.value))}
            error={touched ? amountError : null}
            autoComplete="off"
          />
        </div>
        <TextField
          label="Phone (for MoMo)"
          type="tel"
          inputMode="tel"
          placeholder="+250 7__ ___ ___"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          error={touched ? phoneError : null}
          hint="A number we already know is matched to that borrower."
          autoComplete="off"
        />
        {product ? (
          <p className="m-0 text-[13px] text-ink-muted">
            {product.name}: {rate(product.annualRateBps)} a year, {product.minTermMonths}–
            {product.maxTermMonths} months. The term starts at 12 months where the product allows
            it.
          </p>
        ) : null}
        <FormError>{error}</FormError>
        <div className="flex flex-wrap justify-end gap-2.5">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {busy ? 'Creating…' : 'Create application'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
