import { BfMark } from '@/components/BfMark';

/** Brand lockup: BF mark + "Bridge to Finance" wordmark + slogan (kept in English in both languages). */
export function Logo({ onDark = false }: { onDark?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <BfMark className={`h-8 w-auto ${onDark ? 'text-white' : 'text-green-600'}`} />
      <span className="flex flex-col leading-none">
        <span
          className={`text-[15px] font-extrabold tracking-tight ${onDark ? 'text-white' : 'text-ink-900'}`}
        >
          Bridge to Finance
        </span>
        <span
          className={`mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${onDark ? 'text-green-200' : 'text-green-600'}`}
        >
          We plant your idea
        </span>
      </span>
    </span>
  );
}
