/**
 * Design tokens from BUILD_BRIEF §2, as plain values. The web console uses
 * them through Tailwind (theme.css mirrors this file, and a test keeps the
 * two in step). The mobile app imports this file directly.
 */
export const colors = {
  ground: '#F4F5F1',
  surface: '#FFFFFF',
  line: '#E1E4DD',
  'line-soft': '#F0F1EC',
  track: '#E9ECE5',
  ink: '#121614',
  'ink-soft': '#3B423E',
  'ink-muted': '#5B635E',
  forest: '#173C2E',
  'forest-deep': '#0F2A20',
  'forest-fg': '#E8EFE9',
  'forest-muted': '#B9CCC0',
  lime: '#A2E8B8',
  'lime-deep': '#7FD39B',
  'lime-tint': '#EEF9F1',
  amber: '#F0A23B',
  rust: '#C2410C',
  ai: '#4B2A9B',
  'ai-tint': '#F1EDFB',
  'ai-line': '#DCD3F5',
  'success-bg': '#E2F5C4',
  'success-fg': '#2E4A05',
  'info-bg': '#E3ECF8',
  'info-fg': '#1E3A66',
  'warning-bg': '#FFF0DA',
  'warning-fg': '#7A3B06',
  'danger-bg': '#FBE4DF',
  'danger-fg': '#8A2412',
  'neutral-bg': '#EEF0EA',
  'neutral-fg': '#3B423E',
  'avatar-bg': '#E3EBDF',
  'positive-fg': '#1F6B45',
  'caution-fg': '#A6420E',
  'caution-bg': '#FFF4E5',
  'caution-ink': '#5A2A08',
  'board-column': '#EBEDE6',
  'ai-ink': '#2D1766',
  'ai-ink-soft': '#3E2A78',
  'ai-edge': '#B7A6EA',
  'tag-personal-bg': '#F1E6F8',
  'tag-personal-fg': '#5B1F7A',
  'paid-row': '#F2F8E3',
} as const;

export type ColorToken = keyof typeof colors;

export const radii = {
  control: '12px',
  nav: '10px',
  panel: '14px',
  card: '20px',
  pill: '999px',
} as const;

export const fonts = {
  sans: "'Inter Variable', Inter, system-ui, sans-serif",
  display: "'Space Grotesk Variable', 'Space Grotesk', system-ui, sans-serif",
} as const;

/** Minimum size of anything tappable. */
export const TOUCH_TARGET_PX = 44;
