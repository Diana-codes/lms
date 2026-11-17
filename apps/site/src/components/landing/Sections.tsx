import type { ComponentType, SVGProps } from 'react';
import type { Dictionary } from '@/dictionaries/en';
import { catalogue, portalUrl } from '@/config/app';
import { featuredProducts, formatRwf } from '@/config/products';
import { locales } from '@/lib/i18n';
import { delay } from '@/lib/motion';
import { BfMark } from '@/components/BfMark';
import { CountUp } from '@/components/motion/CountUp';
import { Spotlight } from '@/components/motion/Spotlight';
import {
  IconAdvisory,
  IconArrowRight,
  IconArrowUpRight,
  IconEye,
  IconFunds,
  IconInvoice,
  IconLanguage,
  IconLoan,
  IconPhone,
  IconShield,
  IconSprout,
  IconTrack,
  IconWallet,
} from '@/components/icons';
import { Rings } from './Hero';
import {
  ApplicationScreen,
  DocumentsScreen,
  HomeScreen,
  Phone,
  ScheduleScreen,
  SplashScreen,
} from './Phone';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

function Eyebrow({ children, onDark = false }: { children: string; onDark?: boolean }) {
  return (
    <p
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${
        onDark ? 'bg-white/10 text-mint-300' : 'bg-mint-200/70 text-forest-800'
      }`}
    >
      <span className={`size-1.5 rounded-full ${onDark ? 'bg-mint-300' : 'bg-green-500'}`} />
      {children}
    </p>
  );
}

function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = 'left',
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  align?: 'left' | 'center';
}) {
  return (
    <div data-reveal className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-3xl'}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-5 text-4xl font-extrabold tracking-[-0.035em] text-balance text-forest-900 sm:text-5xl lg:text-6xl">
        {title}
      </h2>
      {subtitle && <p className="mt-5 text-lg leading-relaxed text-ink-500">{subtitle}</p>}
    </div>
  );
}

/* ---------------- Marquee + key figures ---------------- */

export function Highlights({ dict }: { dict: Dictionary }) {
  const slogans = [dict.slogans.main, dict.slogans.trust, dict.slogans.dream];
  const marquee = [
    ...Object.values(dict.services.items).map((s) => s.title),
    ...dict.why.items.map((w) => w.title),
  ].flatMap((text, i) =>
    i % 3 === 0
      ? [
          { text: slogans[(i / 3) % slogans.length], slogan: true },
          { text, slogan: false },
        ]
      : [{ text, slogan: false }],
  );
  const stats = [
    { value: Object.keys(dict.services.items).length, label: dict.stats.services },
    { value: Math.max(...featuredProducts.map((p) => p.maxTermMonths)), label: dict.stats.term },
    { value: locales.length, label: dict.stats.languages },
    { value: 0, label: dict.stats.hidden },
  ];

  return (
    <section aria-label={dict.why.eyebrow} className="relative z-10 -mt-12 px-3 sm:px-5">
      <div className="mx-auto max-w-7xl">
        <div className="relative overflow-hidden rounded-[2rem] bg-mint-300 py-5">
          <div aria-hidden className="absolute inset-0 bg-dots text-forest-900/15" />
          <div className="relative flex w-max animate-marquee hover:[animation-play-state:paused]">
            {[0, 1].map((copy) => (
              <ul key={copy} aria-hidden={copy === 1} className="flex shrink-0 items-center">
                {marquee.map((m, i) => (
                  <li
                    key={i}
                    className="flex items-center gap-8 whitespace-nowrap pl-8 text-lg font-extrabold tracking-tight text-forest-900 sm:text-xl"
                  >
                    {m.slogan ? (
                      <span className="inline-flex items-center gap-2 rounded-full bg-forest-900 py-1.5 pl-2 pr-5 text-mint-300">
                        <span className="grid size-7 place-items-center rounded-full bg-mint-300 text-forest-900">
                          <IconSprout className="size-4" />
                        </span>
                        {m.text}
                      </span>
                    ) : (
                      m.text
                    )}
                    <BfMark className="h-4 w-auto text-forest-900/35" />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </div>

        <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s, i) => (
            <li key={s.label} data-reveal style={delay(i * 90)}>
              <div className="group relative h-full overflow-hidden rounded-[1.75rem] bg-white p-6 ring-1 ring-ink-100 transition duration-500 hover:bg-forest-900 sm:p-7">
                <div
                  aria-hidden
                  className="absolute inset-0 bg-stripes text-mint-300/0 transition duration-500 group-hover:text-mint-300/10"
                />
                <p className="relative text-5xl font-extrabold tracking-[-0.04em] text-forest-900 transition group-hover:text-mint-300 sm:text-6xl">
                  <CountUp value={s.value} />
                </p>
                <p className="relative mt-3 text-sm leading-snug text-ink-500 transition group-hover:text-mint-100/80">
                  {s.label}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------- About / intro ---------------- */

export function Intro({ dict }: { dict: Dictionary }) {
  const d = dict.intro;
  return (
    <section id="about" className="relative overflow-hidden py-24 sm:py-32">
      <div className="mx-auto grid max-w-7xl items-center gap-16 px-4 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:px-8">
        <div>
          <SectionHeading eyebrow={d.eyebrow} title={dict.slogans.dream} />
          <p
            data-reveal
            style={delay(100)}
            className="mt-6 max-w-xl text-lg leading-relaxed text-ink-700"
          >
            {d.body}
          </p>

          <ul className="mt-10 grid gap-3">
            {d.values.map((v, i) => (
              <li key={v.title} data-reveal style={delay(150 + i * 100)}>
                <div className="group flex gap-5 rounded-3xl bg-white p-5 ring-1 ring-ink-100 transition duration-500 ease-spring hover:translate-x-2 hover:ring-mint-400 sm:p-6">
                  <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mint-200 text-sm font-extrabold text-forest-900 transition duration-500 group-hover:rotate-[-8deg] group-hover:bg-forest-900 group-hover:text-mint-300">
                    0{i + 1}
                  </span>
                  <div>
                    <h3 className="text-lg font-extrabold text-forest-900">{v.title}</h3>
                    <p className="mt-1 leading-relaxed text-ink-500">{v.text}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative mx-auto flex h-[560px] w-full max-w-lg items-center justify-center sm:h-[640px]">
          <div aria-hidden className="absolute inset-6 rounded-[3rem] bg-forest-900">
            <div className="absolute inset-0 rounded-[3rem] bg-grid-lines text-white/[0.06]" />
            <div className="absolute -right-10 -top-10 size-64 animate-blob rounded-full bg-mint-300/30 blur-3xl" />
          </div>
          <Rings className="absolute left-1/2 top-1/2 w-[640px] max-w-none -translate-x-1/2 -translate-y-1/2 text-mint-300/25" />

          <div data-reveal="rise" className="relative">
            <div className="rotate-[8deg] animate-float">
              <Phone className="w-[250px] sm:w-[270px]">
                <SplashScreen />
              </Phone>
            </div>
          </div>

          <p
            data-reveal="left"
            style={delay(300)}
            className="absolute bottom-16 left-0 flex items-center gap-3 rounded-full bg-white py-2 pl-2 pr-5 font-bold text-forest-900 shadow-2xl shadow-forest-950/25 sm:-left-6"
          >
            <span className="grid size-10 place-items-center rounded-full bg-mint-300 text-forest-900">
              <IconSprout className="size-5" />
            </span>
            {dict.slogans.main}
          </p>
          <div
            aria-hidden
            className="absolute right-0 top-12 size-24 rounded-3xl bg-mint-300 bg-stripes text-forest-900/15 sm:-right-4"
          />
        </div>
      </div>
    </section>
  );
}

/* ---------------- Services ---------------- */

const serviceIcons: Record<keyof Dictionary['services']['items'], Icon> = {
  loans: IconLoan,
  advisory: IconAdvisory,
  funds: IconFunds,
  factoring: IconInvoice,
};

const serviceThemes = [
  {
    card: 'bg-forest-900 text-white',
    pattern: 'bg-grid-lines text-white/[0.06]',
    icon: 'bg-mint-300 text-forest-900',
    muted: 'text-mint-100/75',
    link: 'bg-mint-300 text-forest-900',
  },
  {
    card: 'bg-mint-300 text-forest-950',
    pattern: 'bg-dots text-forest-900/15',
    icon: 'bg-forest-900 text-mint-300',
    muted: 'text-forest-800',
    link: 'bg-forest-900 text-mint-300',
  },
  {
    card: 'bg-white text-forest-950 ring-1 ring-ink-100',
    pattern: 'bg-stripes text-forest-900/[0.05]',
    icon: 'bg-mint-200 text-forest-900',
    muted: 'text-ink-500',
    link: 'bg-forest-900 text-white',
  },
  {
    card: 'bg-green-600 text-white',
    pattern: 'bg-dots text-white/15',
    icon: 'bg-white text-green-700',
    muted: 'text-green-50/85',
    link: 'bg-white text-green-700',
  },
];

export function Services({ dict }: { dict: Dictionary }) {
  const d = dict.services;
  const keys = Object.keys(d.items) as (keyof typeof d.items)[];
  return (
    <section id="services" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading eyebrow={d.eyebrow} title={d.title} />
          <p
            data-reveal
            style={delay(120)}
            className="max-w-md text-lg leading-relaxed text-ink-500"
          >
            {d.subtitle}
          </p>
        </div>

        <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {keys.map((k, i) => {
            const Icon = serviceIcons[k];
            const item = d.items[k];
            const t = serviceThemes[i % serviceThemes.length];
            return (
              <li key={k} data-reveal style={delay(i * 110)}>
                <article
                  className={`group relative flex h-full min-h-[25rem] flex-col overflow-hidden rounded-[2rem] p-7 transition duration-500 ease-spring hover:-translate-y-2 hover:rotate-[-0.6deg] hover:shadow-2xl hover:shadow-forest-900/20 ${t.card}`}
                >
                  <div
                    aria-hidden
                    className={`absolute inset-0 transition duration-700 ease-spring group-hover:scale-110 ${t.pattern}`}
                  />
                  <span
                    aria-hidden
                    className="absolute right-6 top-4 text-7xl font-extrabold tracking-tighter opacity-15"
                  >
                    0{i + 1}
                  </span>
                  <span
                    className={`relative grid size-14 place-items-center rounded-2xl transition duration-500 ease-spring group-hover:-rotate-12 group-hover:scale-110 ${t.icon}`}
                  >
                    <Icon />
                  </span>
                  <h3 className="relative mt-auto pt-14 text-2xl font-extrabold tracking-tight">
                    {item.title}
                  </h3>
                  <p className={`relative mt-3 leading-relaxed ${t.muted}`}>{item.text}</p>
                  <a
                    href="#contact"
                    className="relative mt-7 inline-flex items-center gap-3 font-bold"
                  >
                    {d.cta}
                    <span
                      className={`grid size-9 place-items-center rounded-full transition duration-500 ease-spring group-hover:rotate-45 ${t.link}`}
                    >
                      <IconArrowUpRight className="size-4" />
                    </span>
                    <span className="sr-only">: {item.title}</span>
                  </a>
                </article>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ---------------- Phone showcase ---------------- */

export function Showcase({ dict }: { dict: Dictionary }) {
  const d = dict.showcase;
  const screens = [
    { screen: <SplashScreen />, width: 'w-[200px] sm:w-[210px]', offset: 'lg:mt-24' },
    {
      screen: <ApplicationScreen dict={dict} />,
      width: 'w-[220px] sm:w-[230px]',
      offset: 'lg:mt-10',
    },
    { screen: <HomeScreen dict={dict} />, width: 'w-[250px] sm:w-[265px]', offset: '' },
    { screen: <ScheduleScreen dict={dict} />, width: 'w-[220px] sm:w-[230px]', offset: 'lg:mt-10' },
    {
      screen: <DocumentsScreen dict={dict} />,
      width: 'w-[200px] sm:w-[210px]',
      offset: 'lg:mt-24',
    },
  ];

  return (
    <section
      aria-labelledby="showcase-title"
      className="relative isolate overflow-hidden bg-forest-950 py-24 text-white sm:py-32"
    >
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-grid-lines text-white/[0.05] mask-fade-b"
      />
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -z-10 size-[700px] -translate-x-1/2 -translate-y-1/2 animate-blob rounded-full bg-green-500/20 blur-[120px]"
      />

      <div
        aria-hidden
        className="select-none text-[clamp(3.5rem,12vw,11rem)] font-extrabold leading-[0.95] tracking-[-0.05em]"
      >
        <div className="parallax-left">
          <div className="flex w-max animate-marquee text-mint-300">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="flex shrink-0 items-center gap-[0.3em] whitespace-nowrap pr-[0.3em]"
              >
                {d.title}
                <BfMark className="h-[0.6em] w-auto text-mint-300/40" />
              </span>
            ))}
          </div>
        </div>
        <div className="parallax-right">
          <div className="flex w-max animate-marquee-reverse text-transparent [-webkit-text-stroke:1.5px_rgb(162_232_184/0.45)]">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className="flex shrink-0 items-center gap-[0.3em] whitespace-nowrap pr-[0.3em]"
              >
                {d.title}
                <BfMark className="h-[0.6em] w-auto text-mint-300/20" />
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-12 max-w-2xl px-4 text-center">
        <div data-reveal>
          <Eyebrow onDark>{d.eyebrow}</Eyebrow>
        </div>
        <h2 id="showcase-title" className="sr-only">
          {d.title}
        </h2>
        <p data-reveal style={delay(100)} className="mt-5 text-xl leading-relaxed text-mint-100/85">
          {d.text}
        </p>
      </div>

      <div className="mt-16 snap-x snap-mandatory overflow-x-auto pb-6 [scrollbar-width:none]">
        <ul className="mx-auto flex w-max items-start gap-5 px-6 lg:gap-7">
          {screens.map((s, i) => (
            <li key={i} className={`snap-center ${s.offset}`}>
              <div data-reveal="rise" style={delay(i * 120)}>
                <div className={i === 2 ? 'animate-float' : ''}>
                  <Phone className={s.width}>{s.screen}</Phone>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-6 px-4 text-center text-sm text-mint-100/60">{d.note}</p>
    </section>
  );
}

/* ---------------- Loan products ---------------- */

export async function Products({ dict, lang }: { dict: Dictionary; lang: string }) {
  const d = dict.products;
  const { products } = await catalogue();
  const scale = Math.max(...products.map((p) => p.maxTermMonths));
  return (
    <section id="products" className="relative py-24 sm:py-32">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 -z-10 h-[520px] bg-plus opacity-[0.07] mask-fade"
      />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow={d.eyebrow} title={d.title} subtitle={d.subtitle} align="center" />
        <ul className="mt-14 grid gap-4 md:grid-cols-2">
          {products.map((p, i) => {
            const own = p.key ? d.items[p.key] : null;
            const item = {
              name: own?.name ?? p.name,
              who: own?.who ?? d.kinds[p.kind as keyof typeof d.kinds] ?? '',
              text: own?.text ?? p.description ?? '',
              repayment: d.frequency[p.frequency],
            };
            return (
              <li key={p.code} data-reveal style={delay((i % 2) * 120)}>
                <article className="group relative flex h-full flex-col overflow-hidden rounded-[2rem] bg-white p-7 ring-1 ring-ink-100 transition duration-500 hover:shadow-2xl hover:shadow-forest-900/10 hover:ring-mint-400 sm:p-9">
                  <div
                    aria-hidden
                    className="absolute inset-0 bg-stripes text-forest-900/[0.045] opacity-0 transition duration-500 group-hover:opacity-100"
                  />
                  <div
                    aria-hidden
                    className="absolute -right-16 -top-16 size-48 rounded-full bg-mint-200/0 blur-2xl transition duration-700 group-hover:bg-mint-200/80"
                  />
                  <div className="relative flex items-center justify-between gap-4">
                    <p className="rounded-full bg-mint-100 px-3 py-1 text-xs font-bold text-forest-800">
                      {item.who}
                    </p>
                    <span aria-hidden className="text-sm font-extrabold text-ink-300">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="relative mt-5 text-2xl font-extrabold tracking-tight text-forest-900 sm:text-3xl">
                    {item.name}
                  </h3>
                  <p className="relative mt-2 leading-relaxed text-ink-500">{item.text}</p>

                  <dl className="relative mt-8 grid gap-6">
                    <div>
                      <dt className="text-sm font-medium text-ink-500">{d.amount}</dt>
                      <dd className="mt-1 text-3xl font-extrabold tracking-[-0.03em] text-forest-900">
                        {formatRwf(p.minAmount)}
                        {p.maxAmount > p.minAmount && (
                          <span className="mt-1 block text-base font-semibold tracking-normal text-ink-500">
                            {d.upTo} {formatRwf(p.maxAmount)}
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <div className="flex items-baseline justify-between gap-4">
                        <dt className="text-sm font-medium text-ink-500">{d.term}</dt>
                        <dd className="font-bold text-forest-900">
                          {p.minTermMonths}–{p.maxTermMonths} {d.months}
                        </dd>
                      </div>
                      <div aria-hidden className="relative mt-3 h-2.5 rounded-full bg-ink-100">
                        <div
                          data-reveal="line"
                          className="absolute inset-y-0 rounded-full bg-gradient-to-r from-mint-400 to-green-600"
                          style={{
                            left: `${(p.minTermMonths / scale) * 100}%`,
                            width: `${((p.maxTermMonths - p.minTermMonths) / scale) * 100}%`,
                            ...delay(400 + (i % 2) * 120),
                          }}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-ink-100 pt-5">
                      <dt className="text-sm font-medium text-ink-500">{d.repayment}</dt>
                      <dd className="rounded-full bg-forest-900 px-3 py-1 text-sm font-bold text-mint-300">
                        {item.repayment}
                      </dd>
                    </div>
                  </dl>
                  {p.example ? (
                    <p className="relative mt-5 text-sm leading-relaxed text-ink-500">
                      {d.example
                        .replace('{amount}', formatRwf(p.example.amount))
                        .replace('{term}', String(p.example.termMonths))
                        .replace('{instalment}', formatRwf(p.example.instalment))
                        .replace('{per}', d.per[p.frequency])
                        .replace('{apr}', `${(p.example.aprBps / 100).toFixed(1)}%`)}
                    </p>
                  ) : null}
                  <a
                    href={portalUrl(lang, p.code)}
                    className="relative mt-8 inline-flex w-fit items-center gap-3 rounded-full bg-forest-900 py-1.5 pl-5 pr-1.5 font-bold text-white transition duration-300 hover:bg-forest-700"
                  >
                    {d.apply}
                    <span className="grid size-8 place-items-center rounded-full bg-mint-300 text-forest-950 transition duration-500 ease-spring group-hover:rotate-[-45deg]">
                      <IconArrowRight className="size-4" />
                    </span>
                    <span className="sr-only">: {item.name}</span>
                  </a>
                </article>
              </li>
            );
          })}
        </ul>
        <p
          data-reveal
          className="mx-auto mt-10 max-w-3xl text-center text-sm leading-relaxed text-ink-500"
        >
          {d.note}
        </p>
      </div>
    </section>
  );
}

/* ---------------- Why choose us ---------------- */

const whyIcons: Icon[] = [IconEye, IconPhone, IconTrack, IconWallet, IconLanguage, IconShield];

export function Why({ dict }: { dict: Dictionary }) {
  const d = dict.why;
  return (
    <section className="px-3 sm:px-5">
      <div className="relative isolate mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-forest-900 px-6 py-20 text-white sm:px-12 sm:py-24">
        <div aria-hidden className="absolute inset-0 -z-10 bg-grid-lines text-white/[0.05]" />
        <div
          aria-hidden
          className="absolute -right-24 -top-24 -z-10 size-[420px] animate-blob rounded-full bg-mint-300/20 blur-3xl"
        />
        <BfMark
          aria-hidden
          className="absolute -bottom-16 -left-20 -z-10 w-[520px] text-white/[0.03]"
        />

        <div data-reveal className="max-w-3xl">
          <Eyebrow onDark>{d.eyebrow}</Eyebrow>
          <h2 className="mt-5 text-4xl font-extrabold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl">
            {d.title}
          </h2>
        </div>

        <Spotlight className="mt-14">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {d.items.map((item, i) => {
              const Icon = whyIcons[i];
              return (
                <li key={item.title} data-reveal style={delay(i * 80)}>
                  <article
                    data-spotlight
                    className="group relative h-full overflow-hidden rounded-[1.75rem] bg-white/[0.04] p-7 ring-1 ring-white/10 transition duration-300 hover:ring-mint-300/40 sm:p-8"
                  >
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 opacity-0 transition duration-300 group-hover:opacity-100"
                      style={{
                        background:
                          'radial-gradient(340px circle at var(--x) var(--y), rgb(162 232 184 / 0.16), transparent 70%)',
                      }}
                    />
                    <span className="relative grid size-12 place-items-center rounded-2xl bg-mint-300/15 text-mint-300 transition duration-500 ease-spring group-hover:scale-110 group-hover:bg-mint-300 group-hover:text-forest-900">
                      <Icon />
                    </span>
                    <h3 className="relative mt-6 text-xl font-extrabold">{item.title}</h3>
                    <p className="relative mt-2 leading-relaxed text-mint-100/75">{item.text}</p>
                  </article>
                </li>
              );
            })}
          </ul>
        </Spotlight>
      </div>
    </section>
  );
}

/* ---------------- How it works ---------------- */

export function HowItWorks({ dict }: { dict: Dictionary }) {
  const d = dict.how;
  return (
    <section className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHeading eyebrow={d.eyebrow} title={d.title} align="center" />
        <ol className="relative mt-16 grid gap-5 md:grid-cols-4">
          <span
            aria-hidden
            data-reveal="line"
            style={delay(300)}
            className="absolute left-[12.5%] right-[12.5%] top-10 hidden h-0.5 bg-gradient-to-r from-green-500 via-mint-400 to-green-200 md:block"
          />
          {d.steps.map((s, i) => (
            <li key={s.title} data-reveal style={delay(i * 140)}>
              <div className="group relative flex h-full flex-col items-center rounded-[2rem] px-4 pb-8 text-center">
                <span className="relative grid size-20 place-items-center rounded-full bg-forest-900 text-2xl font-extrabold text-mint-300 ring-8 ring-cream transition duration-500 ease-spring group-hover:scale-110 group-hover:bg-mint-300 group-hover:text-forest-900">
                  <span
                    aria-hidden
                    className="absolute inset-0 animate-ping-slow rounded-full border-2 border-mint-400"
                    style={{ animationDelay: `${i * 800}ms` }}
                  />
                  {i + 1}
                </span>
                <h3 className="mt-6 text-xl font-extrabold text-forest-900">{s.title}</h3>
                <p className="mt-2 leading-relaxed text-ink-500">{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------- Call to action ---------------- */

export function CallToAction({ dict, lang }: { dict: Dictionary; lang: string }) {
  const d = dict.cta;
  return (
    <section id="apply" className="px-3 sm:px-5">
      <div
        data-reveal="scale"
        className="relative isolate mx-auto max-w-7xl overflow-hidden rounded-[2.5rem] bg-mint-300 px-6 py-16 sm:px-14 sm:py-24"
      >
        <div aria-hidden className="absolute inset-0 -z-10 bg-dots text-forest-900/[0.12]" />
        <Rings className="absolute -right-56 top-1/2 -z-10 w-[820px] max-w-none -translate-y-1/2 text-forest-900/15" />
        <BfMark
          aria-hidden
          className="absolute -bottom-10 right-10 -z-10 hidden w-80 text-forest-900/[0.07] lg:block"
        />

        <div className="grid items-end gap-10 lg:grid-cols-[1.5fr_1fr]">
          <div>
            <p className="mb-6 inline-flex items-center gap-2 rounded-full bg-forest-900 py-1.5 pl-1.5 pr-4 text-sm font-bold text-mint-300">
              <span className="grid size-7 place-items-center rounded-full bg-mint-300 text-forest-900">
                <IconSprout className="size-4" />
              </span>
              Bridge to Finance · {dict.slogans.main}
            </p>
            <h2 className="text-4xl font-extrabold tracking-[-0.04em] text-balance text-forest-950 sm:text-6xl lg:text-7xl">
              {d.title}
            </h2>
            <p className="mt-5 max-w-xl text-lg text-forest-800">{d.text}</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
            <a
              href={portalUrl(lang)}
              className="group inline-flex items-center justify-between gap-4 rounded-full bg-forest-900 py-2 pl-7 pr-2 text-lg font-bold text-white shadow-xl shadow-forest-900/25 transition duration-300 hover:bg-forest-700"
            >
              {d.primary}
              <span className="grid size-11 place-items-center rounded-full bg-mint-300 text-forest-950 transition duration-500 ease-spring group-hover:rotate-45">
                <IconArrowUpRight className="size-5" />
              </span>
            </a>
            <a
              href="#contact"
              className="rounded-full bg-white px-7 py-4 text-center text-lg font-bold text-forest-900 transition duration-300 hover:bg-cream"
            >
              {d.secondary}
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
