import type { SVGProps } from 'react';

/**
 * Bridge to Finance "BF" mark, redrawn as a vector from the supplied logo
 * artwork. Uses currentColor, so set the colour with a text-* class.
 * TODO(BF): replace with the designer's official vector (SVG/AI) when available.
 */
export function BfMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="355 225 880 500" fill="currentColor" fillRule="evenodd" aria-hidden {...props}>
      <path d="M360 297H800C950 297 1100 270 1230 230V265C1100 305 960 332 845 332V660Q845 720 785 720H360ZM397 332V685H782Q805 685 805 662V332Z" />
      <path d="M440 367H722Q766 367 766 411V611Q766 655 722 655H440ZM480 402V620H712Q732 620 732 600V422Q732 402 712 402Z" />
      <path d="M530 435H638C662 435 677 450 677 472C677 488 670 500 660 507C678 514 690 530 690 552C690 577 672 595 645 595H530ZM572 468V500H630C640 500 645 494 645 484C645 474 640 468 630 468ZM572 530V562H635C645 562 650 555 650 546C650 537 645 530 635 530Z" />
      <path d="M880 720V365C1000 362 1120 335 1230 297V332C1120 370 1010 395 920 397V720Z" />
      <path d="M950 528V427C1050 424 1140 398 1230 365V397C1140 428 1060 452 990 457V492H1128V528Z" />
      <path d="M950 720V565H1128V597H990V720Z" />
    </svg>
  );
}
