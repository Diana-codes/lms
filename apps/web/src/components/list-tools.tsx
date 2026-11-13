import { buttonClasses, SearchIcon } from '@kora/ui';
import Link from 'next/link';

/** Build a URL for a list page, dropping empty filters and page 1. */
export function listHref(
  base: string,
  params: Record<string, string | number | undefined | null>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '' || (key === 'page' && Number(value) <= 1)) continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${base}?${text}` : base;
}

/** A search box that works as a plain GET form, so results are a shareable URL. */
export function SearchForm({
  action,
  q,
  placeholder,
  keep,
}: {
  action: string;
  q?: string;
  placeholder: string;
  /** Other filters to carry through a new search. */
  keep?: Record<string, string | undefined>;
}) {
  return (
    <form action={action} role="search" className="flex flex-[1_1_260px] gap-2">
      {Object.entries(keep ?? {}).map(([name, value]) =>
        value ? <input key={name} type="hidden" name={name} value={value} /> : null,
      )}
      <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-surface px-3.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest">
        <SearchIcon size={16} className="flex-none text-ink-muted" />
        <span className="sr-only">{placeholder}</span>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={placeholder}
          className="w-full border-0 bg-transparent text-sm outline-none placeholder:text-ink-muted"
        />
      </label>
      <button type="submit" className={buttonClasses({ variant: 'secondary' })}>
        Search
      </button>
    </form>
  );
}

export function Pagination({
  page,
  pages,
  total,
  noun,
  href,
}: {
  page: number;
  pages: number;
  total: number;
  noun: string;
  href: (page: number) => string;
}) {
  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 pt-1">
      <span className="mr-auto text-[13px] text-ink-muted">
        {total.toLocaleString('en-US')} {total === 1 ? noun : `${noun}s`}
        {pages > 1 ? ` · page ${page} of ${pages}` : ''}
      </span>
      {page > 1 ? (
        <Link href={href(page - 1)} className={buttonClasses({ variant: 'secondary' })}>
          Previous
        </Link>
      ) : null}
      {page < pages ? (
        <Link href={href(page + 1)} className={buttonClasses({ variant: 'secondary' })}>
          Next
        </Link>
      ) : null}
    </nav>
  );
}

export function Breadcrumb({
  parent,
  parentHref,
  current,
}: {
  parent: string;
  parentHref: string;
  current: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] text-ink-muted">
      <Link
        href={parentHref}
        className="inline-flex min-h-11 items-center text-ink-muted no-underline hover:underline"
      >
        {parent}
      </Link>
      <span aria-hidden="true">/</span>
      <span className="text-ink" aria-current="page">
        {current}
      </span>
    </nav>
  );
}
