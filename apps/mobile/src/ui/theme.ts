import { colors, radii } from '@kora/ui/tokens';

/** The same tokens as the console, as React Native values. */
export const c = colors;
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
