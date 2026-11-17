import type { Dictionary } from '@/dictionaries/en';
import { site } from '@/config/site';
import { delay } from '@/lib/motion';
import { IconClock, IconMail, IconMapPin, IconPhone } from '@/components/icons';
import { ContactForm } from './ContactForm';

export function Contact({ dict }: { dict: Dictionary }) {
  const d = dict.contact;
  const s = dict.services.items;
  const services = [
    { value: 'loans', label: s.loans.title },
    { value: 'advisory', label: s.advisory.title },
    { value: 'funds', label: s.funds.title },
    { value: 'factoring', label: s.factoring.title },
  ];

  const details = [
    { icon: IconMapPin, label: d.visit, value: site.contact.address },
    { icon: IconPhone, label: d.call, value: site.contact.phone, href: site.contact.phoneHref },
    {
      icon: IconMail,
      label: d.email,
      value: site.contact.email,
      href: `mailto:${site.contact.email}`,
    },
    { icon: IconClock, label: d.hours, value: d.hoursValue },
  ];

  return (
    <section id="contact" className="relative isolate overflow-hidden py-24 sm:py-32">
      <div aria-hidden className="absolute inset-0 -z-10 bg-dots text-forest-900/[0.1] mask-fade" />
      <div
        aria-hidden
        className="absolute -left-40 top-1/3 -z-10 size-[420px] animate-blob rounded-full bg-mint-300/35 blur-3xl"
      />
      <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-[1fr_1.35fr] lg:gap-16 lg:px-8">
        <div>
          <div data-reveal>
            <p className="inline-flex items-center gap-2 rounded-full bg-mint-200/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-forest-800">
              <span className="size-1.5 rounded-full bg-green-500" />
              {d.eyebrow}
            </p>
            <h2 className="mt-5 text-4xl font-extrabold tracking-[-0.035em] text-forest-900 sm:text-5xl lg:text-6xl">
              {d.title}
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-500">{d.text}</p>
          </div>

          <dl className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {details.map(({ icon: Icon, label, value, href }, i) => (
              <div key={label} data-reveal style={delay(i * 90)}>
                <div className="group flex items-center gap-4 rounded-3xl bg-white p-4 ring-1 ring-ink-100 transition duration-500 ease-spring hover:translate-x-1.5 hover:ring-mint-400">
                  <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-forest-900 text-mint-300 transition duration-500 ease-spring group-hover:-rotate-12 group-hover:bg-mint-300 group-hover:text-forest-900">
                    <Icon className="size-5" />
                  </span>
                  <div>
                    <dt className="text-sm text-ink-500">{label}</dt>
                    <dd className="mt-0.5 font-bold text-forest-900">
                      {href ? (
                        <a href={href} className="hover:text-green-700">
                          {value}
                        </a>
                      ) : (
                        value
                      )}
                    </dd>
                  </div>
                </div>
              </div>
            ))}
          </dl>
        </div>

        <div data-reveal="right" style={delay(150)}>
          <div className="relative rounded-[2.5rem] bg-white p-6 shadow-2xl shadow-forest-900/10 ring-1 ring-ink-100 sm:p-10">
            <span
              aria-hidden
              className="absolute -right-3 -top-3 size-20 rounded-3xl bg-mint-300 bg-stripes text-forest-900/15"
            />
            <div className="relative">
              <ContactForm labels={d.form} services={services} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
