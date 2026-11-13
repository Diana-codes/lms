import { buttonClasses, EmptyState } from '@kora/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center p-6">
      <EmptyState
        title="Page not found"
        action={
          <Link href="/" className={buttonClasses()}>
            Back to overview
          </Link>
        }
      >
        That address doesn’t match anything in the console.
      </EmptyState>
    </main>
  );
}
