import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Line icons copied from the approved designs (24px grid). */
type IconProps = { size?: number; color?: string; strokeWidth?: number };

function make(children: ReactNode, defaultStroke = 2) {
  return function Icon({ size = 22, color = '#173C2E', strokeWidth = defaultStroke }: IconProps) {
    return (
      <Svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </Svg>
    );
  };
}

export const BellIcon = make(
  <Path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />,
);
export const PlusIcon = make(<Path d="M12 5v14M5 12h14" />);
export const CalendarIcon = make(
  <>
    <Rect x="3" y="4" width="18" height="17" rx="2" />
    <Path d="M3 9h18M8 2v4M16 2v4" />
  </>,
);
export const DocumentIcon = make(
  <>
    <Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <Path d="M14 3v5h5M9 13h6M9 17h4" />
  </>,
);
export const ChatIcon = make(
  <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />,
);
export const ArrowRightIcon = make(<Path d="M5 12h14M13 6l6 6-6 6" />, 2.4);
export const ArrowLeftIcon = make(<Path d="M19 12H5M11 6l-6 6 6 6" />, 2.2);
export const CheckIcon = make(<Path d="M5 12l5 5L20 7" />, 2.2);
export const HomeIcon = make(
  <Path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
);
export const LoansIcon = make(
  <>
    <Rect x="2" y="6" width="20" height="13" rx="2" />
    <Circle cx="12" cy="12.5" r="2.5" />
  </>,
);
export const InsightsIcon = make(
  <>
    <Path d="M3 3v18h18" />
    <Path d="M7 15l4-4 3 3 5-6" />
  </>,
);
export const ProfileIcon = make(
  <>
    <Circle cx="12" cy="8" r="4" />
    <Path d="M4 21a8 8 0 0 1 16 0" />
  </>,
);
export const IdCardIcon = make(
  <>
    <Rect x="2" y="5" width="20" height="14" rx="2" />
    <Circle cx="8" cy="12" r="2.5" />
    <Path d="M13 10h5M13 14h3" />
  </>,
);
export const CameraIcon = make(
  <>
    <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <Circle cx="12" cy="13" r="4" />
  </>,
);
export const LockIcon = make(
  <>
    <Rect x="4" y="11" width="16" height="10" rx="2" />
    <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </>,
);
export const PhoneIcon = make(
  <Path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />,
);
export const ChevronDownIcon = make(<Path d="M6 9l6 6 6-6" />);
export const ChevronRightIcon = make(<Path d="M9 6l6 6-6 6" />);
export const SignOutIcon = make(
  <Path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l4-4-4-4M14 12H4" />,
);
export const ImageIcon = make(
  <>
    <Rect x="3" y="3" width="18" height="18" rx="2" />
    <Circle cx="9" cy="9" r="2" />
    <Path d="M21 15l-5-5L5 21" />
  </>,
);
export const UploadIcon = make(
  <Path d="M12 16V4M7 9l5-5 5 5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
);
export const AlertIcon = make(
  <>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 7.5v5M12 16.5h.01" />
  </>,
);
