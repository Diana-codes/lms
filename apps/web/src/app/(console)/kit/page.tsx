import type { Metadata } from 'next';
import { PageHeader } from '@/components/page-header';
import { KitGallery } from './kit-gallery';

export const metadata: Metadata = { title: 'UI kit' };

export default function KitPage() {
  return (
    <>
      <PageHeader eyebrow="Shared components from @kora/ui" title="UI kit" />
      <KitGallery />
    </>
  );
}
