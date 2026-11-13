import { cx } from './cx';

export interface ProgressBarProps {
  /** 0–100. */
  value: number;
  label: string;
  /** Use on forest surfaces. */
  onDark?: boolean;
  className?: string;
}

export function ProgressBar({ value, label, onDark, className }: ProgressBarProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cx('h-1.5 rounded-pill', onDark ? 'bg-white/15' : 'bg-track', className)}
    >
      <div
        className={cx('h-1.5 rounded-pill', onDark ? 'bg-lime' : 'bg-forest')}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
