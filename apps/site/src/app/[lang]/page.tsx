import { ViewTransition } from 'react';
import { notFound } from 'next/navigation';
import { getDictionary, hasLocale } from '@/lib/i18n';
import { Header } from '@/components/landing/Header';
import { Hero } from '@/components/landing/Hero';
import {
  CallToAction,
  Highlights,
  HowItWorks,
  Intro,
  Products,
  Services,
  Showcase,
  Why,
} from '@/components/landing/Sections';
import { Contact } from '@/components/landing/Contact';
import { Footer } from '@/components/landing/Footer';
import { RevealObserver } from '@/components/motion/RevealObserver';

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  if (!hasLocale(lang)) notFound();
  const dict = await getDictionary(lang);

  return (
    <ViewTransition key={lang} enter="page-in" exit="page-out" default="none">
      <div>
        <Header dict={dict} lang={lang} />
        <main id="main">
          <Hero dict={dict} />
          <Highlights dict={dict} />
          <Intro dict={dict} />
          <Services dict={dict} />
          <Showcase dict={dict} />
          <Products dict={dict} lang={lang} />
          <Why dict={dict} />
          <HowItWorks dict={dict} />
          <CallToAction dict={dict} lang={lang} />
          <Contact dict={dict} />
        </main>
        <Footer dict={dict} lang={lang} />
        <RevealObserver />
      </div>
    </ViewTransition>
  );
}
