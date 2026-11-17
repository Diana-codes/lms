import type { ReactNode } from 'react';
import type { Dictionary } from '@/dictionaries/en';
import { BfMark } from '@/components/BfMark';
import {
  IconArrowRight,
  IconBell,
  IconCheck,
  IconClock,
  IconInvoice,
  IconPhone,
  IconWallet,
} from '@/components/icons';

/*
 * Illustrative phone mockups. Every figure on these screens is an example,
 * not a customer record or an offer.
 */

export function Phone({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative aspect-[9/19.2] shrink-0 rounded-[2.75rem] bg-forest-950 p-[7px] shadow-[0_40px_80px_-30px_rgb(10_31_23/0.55)] ring-1 ring-black/40 ${className}`}
    >
      <span className="absolute -left-[3px] top-[20%] h-10 w-[3px] rounded-l-sm bg-forest-800" />
      <span className="absolute -left-[3px] top-[30%] h-14 w-[3px] rounded-l-sm bg-forest-800" />
      <span className="absolute -right-[3px] top-[26%] h-16 w-[3px] rounded-r-sm bg-forest-800" />
      <div className="relative flex h-full flex-col overflow-hidden rounded-[2.3rem] bg-cream text-forest-950">
        <span className="absolute inset-x-0 top-2.5 z-30 mx-auto h-[22px] w-[32%] rounded-full bg-black" />
        {children}
        <span className="absolute inset-x-0 bottom-1.5 z-30 mx-auto h-1 w-[34%] rounded-full bg-current opacity-30" />
      </div>
    </div>
  );
}

function StatusBar({ light = false }: { light?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between px-6 pb-1 pt-3.5 text-[10px] font-semibold ${light ? 'text-white' : 'text-forest-950'}`}
    >
      <span>9:41</span>
      <span className="flex items-end gap-[2px]">
        {[4, 6, 8, 10].map((h) => (
          <span key={h} className="w-[3px] rounded-sm bg-current" style={{ height: h }} />
        ))}
        <span className="ml-1 h-[9px] w-[17px] rounded-[3px] border border-current p-[1px]">
          <span className="block h-full w-3/4 rounded-[1px] bg-current" />
        </span>
      </span>
    </div>
  );
}

function ScreenTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="px-5 pt-3">
      {sub && <p className="text-[10px] font-medium text-ink-500">{sub}</p>}
      <p className="text-[15px] font-extrabold tracking-tight">{title}</p>
    </div>
  );
}

/* ---------------- Splash ---------------- */

export function SplashScreen() {
  return (
    <div className="relative flex h-full flex-col bg-forest-900 text-white">
      <StatusBar light />
      <svg
        className="absolute left-1/2 top-1/2 w-[180%] max-w-none -translate-x-1/2 -translate-y-1/2 animate-spin-slow text-mint-300/15"
        viewBox="0 0 400 400"
        fill="none"
        stroke="currentColor"
      >
        {[60, 95, 130, 165, 198].map((r) => (
          <circle key={r} cx="200" cy="200" r={r} strokeDasharray={r > 150 ? '2 8' : undefined} />
        ))}
      </svg>
      <div className="relative flex flex-1 flex-col items-center justify-center gap-4">
        <BfMark className="w-24 text-white" />
        <div className="text-center">
          <p className="text-[15px] font-extrabold tracking-tight">Bridge to Finance</p>
          <p className="mt-1 text-[9px] font-semibold uppercase tracking-[0.2em] text-mint-300">
            We plant your idea
          </p>
        </div>
      </div>
      <div className="relative mx-6 mb-8 grid place-items-center rounded-full bg-mint-300 py-2 text-forest-950">
        <IconArrowRight className="size-4" />
      </div>
    </div>
  );
}

/* ---------------- Home ---------------- */

export function HomeScreen({ dict }: { dict: Dictionary }) {
  const a = dict.app;
  const actions = [
    { icon: IconWallet, label: a.pay },
    { icon: IconClock, label: a.schedule },
    { icon: IconInvoice, label: a.documents },
    { icon: IconPhone, label: a.help },
  ];
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="flex items-center justify-between px-5 pt-2">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-full bg-mint-300 text-[11px] font-extrabold">
            A
          </span>
          <div className="leading-tight">
            <p className="text-[9px] text-ink-500">{a.welcome}</p>
            <p className="text-[12px] font-bold">{a.greeting}</p>
          </div>
        </div>
        <span className="relative grid size-8 place-items-center rounded-full bg-white ring-1 ring-ink-100">
          <IconBell className="size-4" />
          <span className="absolute right-2 top-2 size-1.5 rounded-full bg-green-500" />
        </span>
      </div>

      <div className="relative mx-4 mt-4 overflow-hidden rounded-2xl bg-forest-900 p-4 text-white">
        <div className="absolute inset-0 bg-grid-lines text-white/[0.06]" />
        <div className="absolute -right-6 -top-8 size-24 rounded-full bg-mint-300/25 blur-xl" />
        <div className="relative">
          <p className="text-[9px] text-mint-100/80">{a.balance}</p>
          <p className="mt-1 text-[20px] font-extrabold tracking-tight">
            <span className="text-[11px] font-semibold text-mint-300">RWF </span>1,250,000
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/15">
            <div className="h-full w-2/5 rounded-full bg-mint-300" />
          </div>
          <p className="mt-1.5 text-[9px] text-mint-100/80">40% {a.repaid}</p>
        </div>
      </div>

      <div className="mx-4 mt-3 grid grid-cols-4 gap-2">
        {actions.map(({ icon: Icon, label }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <span className="grid size-9 place-items-center rounded-xl bg-white ring-1 ring-ink-100">
              <Icon className="size-4 text-green-700" />
            </span>
            <span className="text-[8.5px] font-semibold">{label}</span>
          </div>
        ))}
      </div>

      <div className="mx-4 mt-3 flex items-center justify-between rounded-2xl bg-mint-200 p-3">
        <div>
          <p className="text-[9px] font-medium text-forest-800">{a.nextPayment}</p>
          <p className="text-[13px] font-extrabold">RWF 86,500</p>
          <p className="text-[8.5px] text-forest-800">{a.due}</p>
        </div>
        <span className="rounded-full bg-forest-900 px-3 py-1.5 text-[9px] font-bold text-white">
          {a.pay}
        </span>
      </div>

      <p className="mx-5 mt-3 text-[10px] font-bold">{a.activity}</p>
      <ul className="mx-4 mt-1.5 grid gap-1.5">
        {[0, 1].map((i) => (
          <li
            key={i}
            className="flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-ink-100"
          >
            <span className="grid size-6 place-items-center rounded-full bg-green-50 text-green-700">
              <IconCheck className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[9px] font-semibold">{a.momo}</p>
              <p className="truncate text-[8px] text-ink-500">{a.receipt}</p>
            </div>
            <span className="text-[9px] font-bold">−86,500</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Application status ---------------- */

export function ApplicationScreen({ dict }: { dict: Dictionary }) {
  const c = dict.heroCard;
  const bars = [62, 74, 58, 88, 70, 81];
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <ScreenTitle title={c.application} sub="BF-2026-0142" />
      <span className="mx-5 mt-2 w-fit rounded-full bg-mint-200 px-2.5 py-1 text-[9px] font-bold text-forest-900">
        {c.status}
      </span>
      <ol className="mx-5 mt-4 grid gap-0">
        {c.steps.map((s, i) => {
          const done = i < 1;
          const active = i === 1;
          return (
            <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
              {i < c.steps.length - 1 && (
                <span
                  className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-0.5 ${done ? 'bg-green-500' : 'bg-ink-100'}`}
                />
              )}
              <span
                className={`relative grid size-5 shrink-0 place-items-center rounded-full ${
                  done
                    ? 'bg-green-500 text-white'
                    : active
                      ? 'bg-forest-900'
                      : 'bg-white ring-2 ring-ink-100'
                }`}
              >
                {done && <IconCheck className="size-3" />}
                {active && (
                  <>
                    <span className="absolute inset-0 animate-ping-slow rounded-full bg-mint-400" />
                    <span className="size-1.5 rounded-full bg-mint-300" />
                  </>
                )}
              </span>
              <p className={`pt-0.5 text-[11px] ${done || active ? 'font-bold' : 'text-ink-500'}`}>
                {s}
              </p>
            </li>
          );
        })}
      </ol>
      <div className="mx-4 mt-auto mb-6 rounded-2xl bg-forest-900 p-3 text-white">
        <p className="text-[10px] font-bold">{c.cashflow}</p>
        <div className="mt-2 flex h-14 items-end gap-1.5">
          {bars.map((h, i) => (
            <span
              key={i}
              className={`flex-1 rounded-t ${i === bars.length - 1 ? 'bg-mint-300' : 'bg-white/25'}`}
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Repayment schedule ---------------- */

export function ScheduleScreen({ dict }: { dict: Dictionary }) {
  const a = dict.app;
  const months = dict.heroCard.months.slice(2);
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <ScreenTitle title={a.schedule} sub={a.balance} />
      <div className="mx-4 mt-3 rounded-2xl bg-white p-3 ring-1 ring-ink-100">
        <div className="flex items-baseline justify-between">
          <p className="text-[16px] font-extrabold tracking-tight">RWF 1,250,000</p>
          <p className="text-[9px] font-bold text-green-700">40%</p>
        </div>
        <div className="mt-2 grid grid-cols-12 gap-[3px]">
          {Array.from({ length: 12 }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full ${i < 5 ? 'bg-green-500' : 'bg-ink-100'}`}
            />
          ))}
        </div>
      </div>
      <ul className="mx-4 mt-3 grid gap-1.5">
        {months.map((m) => (
          <li
            key={m}
            className="flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-ink-100"
          >
            <span className="text-[10px] font-semibold">{m}</span>
            <span className="text-[10px] font-bold">86,500</span>
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-[8.5px] font-bold text-green-700">
              {a.paid}
            </span>
          </li>
        ))}
        <li className="flex items-center justify-between rounded-xl bg-forest-900 px-3 py-2 text-white">
          <span className="text-[10px] font-semibold">{a.due}</span>
          <span className="rounded-full bg-mint-300 px-2 py-0.5 text-[8.5px] font-bold text-forest-950">
            {a.upcoming}
          </span>
        </li>
      </ul>
    </div>
  );
}

/* ---------------- Documents ---------------- */

export function DocumentsScreen({ dict }: { dict: Dictionary }) {
  const a = dict.app;
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <ScreenTitle title={a.documents} sub={dict.heroCard.application} />
      <ul className="mx-4 mt-4 grid gap-2">
        {a.docs.map((d, i) => {
          const pending = i === a.docs.length - 1;
          return (
            <li key={d} className="rounded-xl bg-white p-3 ring-1 ring-ink-100">
              <div className="flex items-center gap-2.5">
                <span
                  className={`grid size-7 shrink-0 place-items-center rounded-lg ${pending ? 'bg-mint-200 text-forest-900' : 'bg-green-500 text-white'}`}
                >
                  {pending ? (
                    <IconInvoice className="size-3.5" />
                  ) : (
                    <IconCheck className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-bold">{d}</p>
                  {!pending && <p className="text-[8.5px] text-green-700">{a.uploaded}</p>}
                </div>
              </div>
              {pending && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-ink-100">
                  <div className="h-full w-3/5 rounded-full bg-mint-400" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mx-4 mb-7 mt-auto rounded-full bg-forest-900 py-2.5 text-center text-[10px] font-bold text-white">
        {a.documents} · 3/4
      </div>
    </div>
  );
}
