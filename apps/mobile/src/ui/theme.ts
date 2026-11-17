import { colors, radii } from '@kora/ui/tokens';

/** The console's design tokens, plus the few extra shades the phone designs use. */
export const c = {
  ...colors,
  track: '#DADDD5',
  field: '#D5D9D0',
  divider: '#E8EAE4',
  momoTile: '#FFF4D6',
  momoText: '#6B4A00',
  switchOff: '#C9CEC5',
  dashed: '#A7ADA3',
  limeSoft: 'rgba(198,244,50,0.16)',
  whiteSoft: 'rgba(255,255,255,0.14)',
};
export const r = {
  control: Number.parseInt(radii.control),
  panel: Number.parseInt(radii.panel),
  card: Number.parseInt(radii.card),
  pill: 999,
};
export const font = {
  display: 'SpaceGrotesk_600SemiBold',
  body: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
};
export const TOUCH = 44;
