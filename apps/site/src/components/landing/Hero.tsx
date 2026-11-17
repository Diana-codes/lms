import type { Dictionary } from '@/dictionaries/en';
import {
  IconAdvisory,
  IconArrowRight,
  IconCheck,
  IconFunds,
  IconInvoice,
  IconLoan,
} from '@/components/icons';
import { HomeScreen, Phone } from './Phone';

/** Illustrative bar heights (% of max) for the example cash-flow card. */
const bars = [62, 74, 58, 88, 70, 81];

export function Hero({ dict }: { dict: Dictionary }) {
  const c = dict.heroCard;
  const words = dict.slogans.trust.split(' ');

  return (
    <section id="top" className="relative isolate overflow-hidden pt-32 sm:pt-40">
      <HeroBackdrop />

      <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8">
        <p className="mx-auto inline-flex animate-fade-up items-center gap-3 rounded-full bg-white/80 py-1.5 pl-1.5 pr-4 text-xs font-semibold text-forest-800 shadow-sm ring-1 ring-forest-900/5 backdrop-blur">
          <span aria-hidden className="flex -space-x-2">
            {[IconLoan, IconAdvisory, IconFunds, IconInvoice].map((Icon, i) => (
              <span
                key={i}
                className={`grid size-7 place-items-center rounded-full ring-2 ring-white ${
                  [
                    'bg-forest-900 text-mint-300',
                    'bg-mint-300 text-forest-900',
                    'bg-green-500 text-white',
                    'bg-mint-100 text-forest-900',
                  ][i]
                }`}
              >
                <Icon className="size-3.5" />
              </span>
            ))}
          </span>
          <span className="text-left leading-snug">{dict.hero.eyebrow}</span>
        </p>

        <h1 className="text-display relative isolate mx-auto mt-8 max-w-6xl font-extrabold text-balance text-forest-900">
          {words.map((w, i) => {
            const last = i === words.length - 1;
            return (
              <span key={i}>
                {i > 0 && ' '}
                <span
                  className="relative inline-block animate-word"
                  style={{ animationDelay: `${150 + i * 90}ms` }}
                >
                  {last && (
                    <span
                      aria-hidden
                      className="absolute inset-x-[-0.08em] bottom-[0.06em] -z-10 h-[0.36em] origin-left animate-highlight rounded-full bg-mint-300"
                    />
                  )}
                  {w}
                </span>
              </span>
            );
          })}
        </h1>

        <p
          className="mx-auto mt-7 max-w-2xl animate-fade-up text-lg leading-relaxed text-ink-500 sm:text-xl"
          style={{ animationDelay: '600ms' }}
        >
          {dict.hero.subtitle}
        </p>

        <div
          className="mt-9 flex animate-fade-up flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: '750ms' }}
        >
          <a
            href="#services"
            className="group inline-flex items-center gap-3 rounded-full bg-forest-900 py-2 pl-6 pr-2 font-semibold text-white shadow-xl shadow-forest-900/25 transition duration-300 hover:bg-forest-700"
          >
            {dict.hero.primary}
            <span className="grid size-10 place-items-center rounded-full bg-mint-300 text-forest-950 transition duration-500 ease-spring group-hover:translate-x-1 group-hover:-rotate-45">
              <IconArrowRight className="size-4" />
            </span>
          </a>
          <a
            href="#apply"
            className="relative overflow-hidden rounded-full bg-mint-300 px-7 py-4 font-bold text-forest-950 transition duration-300 hover:bg-mint-400"
          >
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 w-1/3 animate-shine bg-gradient-to-r from-transparent via-white/60 to-transparent"
            />
            <span className="relative">{dict.hero.secondary}</span>
          </a>
        </div>

        <ul
          className="mx-auto mt-8 flex max-w-3xl animate-fade-up flex-wrap justify-center gap-x-6 gap-y-2 text-sm font-medium text-ink-700"
          style={{ animationDelay: '900ms' }}
        >
          {dict.hero.points.map((p) => (
            <li key={p} className="flex items-center gap-2">
              <span className="grid size-5 place-items-center rounded-full bg-mint-200 text-forest-900">
                <IconCheck className="size-3" />
              </span>
              {p}
            </li>
          ))}
        </ul>
      </div>

      {/* Device stage (illustrative) */}
      <div
        className="relative mx-auto mt-14 h-[420px] max-w-5xl animate-fade-up px-4 sm:h-[500px] [animation-duration:1.4s]"
        style={{ animationDelay: '500ms' }}
      >
        <Rings className="absolute left-1/2 top-[-60px] w-[760px] max-w-none -translate-x-1/2 text-forest-900/10 sm:w-[920px]" />

        <div className="relative z-10 mx-auto w-[270px] sm:w-[290px]">
          <div className="animate-float">
            <Phone className="w-full">
              <HomeScreen dict={dict} />
            </Phone>
          </div>
        </div>

        {/* Application card */}
        <div
          aria-hidden
          className="absolute left-0 top-10 z-20 hidden w-72 animate-float-delayed rounded-3xl bg-white/90 p-5 text-left shadow-2xl shadow-forest-900/15 ring-1 ring-ink-100 backdrop-blur md:block lg:left-4"
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-ink-500">{c.application}</p>
              <p className="mt-0.5 font-bold text-forest-950">BF-2026-0142</p>
            </div>
            <span className="rounded-full bg-mint-200 px-2.5 py-1 text-[11px] font-bold text-forest-900">
              {c.status}
            </span>
          </div>
          <ol className="mt-5 grid grid-cols-4 gap-1.5">
            {c.steps.map((s, i) => (
              <li key={s} className="flex flex-col gap-1.5">
                <span className={`h-1.5 rounded-full ${i < 2 ? 'bg-green-500' : 'bg-ink-100'}`} />
                <span
                  className={`text-[10px] leading-tight ${i < 2 ? 'font-bold text-forest-950' : 'text-ink-500'}`}
                >
                  {s}
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Cash-flow card */}
        <div
          aria-hidden
          className="absolute right-0 top-36 z-20 hidden w-72 animate-float rounded-3xl bg-forest-900 p-5 text-left shadow-2xl shadow-forest-900/30 md:block lg:right-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-white">{c.cashflow}</p>
              <p className="mt-0.5 text-[11px] text-mint-100/80">{c.cashflowNote}</p>
            </div>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-mint-100">
              {c.example}
            </span>
          </div>
          <div className="mt-4 flex h-20 items-end gap-2">
            {bars.map((h, i) => (
              <div key={i} className="flex h-full flex-1 flex-col items-center gap-1">
                <div className="flex w-full flex-1 items-end">
                  <div
                    className={`w-full origin-bottom animate-[grow-y_1.2s_var(--ease-expo)_both] rounded-t-md ${i === bars.length - 1 ? 'bg-mint-300' : 'bg-white/25'}`}
                    style={{ height: `${h}%`, animationDelay: `${1100 + i * 90}ms` }}
                  />
                </div>
                <span className="text-[9px] text-mint-100/70">{c.months[i]}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t border-white/10 pt-3">
            <span className="text-[11px] text-mint-100/80">{c.avgIncome}</span>
            <span className="text-base font-extrabold text-white">RWF 412,000</span>
          </div>
        </div>

        {/* Floating chip */}
        <div
          aria-hidden
          className="absolute bottom-24 left-[12%] z-20 hidden animate-float items-center gap-2 rounded-full bg-mint-300 py-2 pl-2 pr-4 text-sm font-bold text-forest-950 shadow-xl shadow-forest-900/15 lg:flex"
          style={{ animationDelay: '-2s' }}
        >
          <span className="grid size-7 place-items-center rounded-full bg-forest-900 text-mint-300">
            <IconCheck className="size-3.5" />
          </span>
          {dict.why.items[0].title}
        </div>

        <span className="absolute -bottom-px left-0 z-30 h-40 w-full bg-gradient-to-t from-cream via-cream/80 to-transparent" />
      </div>
    </section>
  );
}

function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute inset-0 bg-dots text-forest-900/[0.12] mask-fade" />
      <div className="absolute -left-40 top-24 size-[520px] animate-blob rounded-full bg-mint-300/45 blur-3xl" />
      <div
        className="absolute -right-32 top-80 size-[460px] animate-blob rounded-full bg-green-200/50 blur-3xl"
        style={{ animationDelay: '-7s' }}
      />
      <svg
        className="absolute inset-x-0 top-[38%] h-[60%] w-full"
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        fill="none"
      >
        {[0, 1, 2, 3].map((i) => (
          <path
            key={i}
            d={`M-20 ${300 - i * 26} C320 ${330 - i * 30} 760 ${120 + i * 12} 1220 ${40 + i * 30}`}
            pathLength={1}
            strokeDasharray="1"
            className="animate-draw"
            style={{ animationDelay: `${300 + i * 180}ms` }}
            stroke="var(--color-green-300)"
            strokeOpacity={0.35 - i * 0.07}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
    </div>
  );
}

export function Rings({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 800 800" fill="none" stroke="currentColor" className={className}>
      <g className="origin-center animate-spin-slow">
        {[140, 210, 280, 350].map((r, i) => (
          <circle key={r} cx="400" cy="400" r={r} strokeDasharray={i % 2 ? '3 10' : undefined} />
        ))}
        <circle cx="400" cy="50" r="7" fill="var(--color-mint-400)" stroke="none" />
        <circle cx="750" cy="400" r="5" fill="var(--color-green-500)" stroke="none" />
        <circle cx="190" cy="610" r="6" fill="var(--color-forest-700)" stroke="none" />
      </g>
    </svg>
  );
}
