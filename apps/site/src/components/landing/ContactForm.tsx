'use client';

import { useActionState } from 'react';
import { submitEnquiry, type EnquiryField, type EnquiryState } from '@/app/[lang]/actions';
import type { Dictionary } from '@/dictionaries/en';

type Props = {
  labels: Dictionary['contact']['form'];
  services: { value: string; label: string }[];
};

const initial: EnquiryState = { status: 'idle' };

const inputClass =
  'mt-2 block w-full rounded-2xl border-0 bg-cream px-4 py-3 text-ink-900 ring-1 ring-ink-100 transition placeholder:text-ink-300 focus:bg-white focus:ring-2 focus:ring-green-500 focus:outline-none aria-[invalid=true]:ring-red-500';

export function ContactForm({ labels, services }: Props) {
  const [state, action, pending] = useActionState(submitEnquiry, initial);

  if (state.status === 'success') {
    return (
      <div
        role="status"
        className="animate-fade-up rounded-3xl bg-mint-100 p-8 text-forest-900 ring-1 ring-mint-300"
      >
        <p className="text-lg font-semibold">{labels.success}</p>
      </div>
    );
  }

  const err = (f: EnquiryField) => state.errors?.[f];
  const errorText = (f: EnquiryField) => {
    const code = err(f);
    return code ? labels.errors[code] : null;
  };
  const describe = (f: EnquiryField) => (err(f) ? `${f}-error` : undefined);
  const errorMsg = (f: EnquiryField) =>
    err(f) ? (
      <p id={`${f}-error`} className="mt-1.5 text-sm text-red-600">
        {errorText(f)}
      </p>
    ) : null;

  return (
    <form action={action} noValidate className="grid gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="fullName" className="text-sm font-semibold text-ink-900">
          {labels.fullName}
        </label>
        <input
          id="fullName"
          name="fullName"
          autoComplete="name"
          required
          className={inputClass}
          aria-invalid={!!err('fullName')}
          aria-describedby={describe('fullName')}
        />
        {errorMsg('fullName')}
      </div>

      <div>
        <label htmlFor="phone" className="text-sm font-semibold text-ink-900">
          {labels.phone}
        </label>
        <input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="078 000 0000"
          required
          className={inputClass}
          aria-invalid={!!err('phone')}
          aria-describedby={describe('phone')}
        />
        {errorMsg('phone')}
      </div>

      <div>
        <label htmlFor="email" className="text-sm font-semibold text-ink-900">
          {labels.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          className={inputClass}
          aria-invalid={!!err('email')}
          aria-describedby={describe('email')}
        />
        {errorMsg('email')}
      </div>

      <div>
        <label htmlFor="service" className="text-sm font-semibold text-ink-900">
          {labels.service}
        </label>
        <select
          id="service"
          name="service"
          required
          defaultValue=""
          className={inputClass}
          aria-invalid={!!err('service')}
          aria-describedby={describe('service')}
        >
          <option value="" disabled>
            {labels.servicePlaceholder}
          </option>
          {services.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        {errorMsg('service')}
      </div>

      <div>
        <label htmlFor="subject" className="text-sm font-semibold text-ink-900">
          {labels.subject}
        </label>
        <input
          id="subject"
          name="subject"
          required
          className={inputClass}
          aria-invalid={!!err('subject')}
          aria-describedby={describe('subject')}
        />
        {errorMsg('subject')}
      </div>

      <div className="sm:col-span-2">
        <label htmlFor="message" className="text-sm font-semibold text-ink-900">
          {labels.message}
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          required
          className={inputClass}
          aria-invalid={!!err('message')}
          aria-describedby={describe('message')}
        />
        {errorMsg('message')}
      </div>

      <div className="sm:col-span-2">
        <label className="flex items-start gap-3 text-sm text-ink-700">
          <input
            type="checkbox"
            name="consent"
            className="mt-0.5 size-4 rounded border-ink-300 accent-green-600"
            aria-invalid={!!err('consent')}
            aria-describedby={describe('consent')}
          />
          {labels.consent}
        </label>
        {errorMsg('consent')}
      </div>

      <div className="sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-full bg-forest-900 px-8 py-4 font-bold text-white shadow-xl shadow-forest-900/20 transition duration-300 hover:bg-forest-700 disabled:opacity-60 sm:w-auto"
        >
          {pending ? labels.sending : labels.submit}
        </button>
      </div>
    </form>
  );
}
