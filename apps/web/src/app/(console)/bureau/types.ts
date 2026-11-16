export type BureauStatus = 'GENERATED' | 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';

export interface BureauSubmissionRow {
  id: string;
  month: string;
  periodEnd: string;
  sequence: number;
  status: BureauStatus;
  formatVersion: string;
  lenderCode: string;
  recordCount: number;
  excludedCount: number;
  totalBalance: string;
  totalArrears: string;
  fileSha256: string;
  generatedAt: string;
  submittedAt: string | null;
  bureauReference: string | null;
  respondedAt: string | null;
  rejectedCount: number | null;
  responseNote: string | null;
  excluded?: Array<{ accountNumber: string; field: string; message: string }>;
}

export const STATUS: Record<
  BureauStatus,
  { label: string; tone: 'neutral' | 'warning' | 'success' | 'danger' }
> = {
  GENERATED: { label: 'Ready to send', tone: 'warning' },
  SUBMITTED: { label: 'Sent', tone: 'neutral' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
};

export const monthLabel = (month: string) => {
  const [y, m] = month.split('-');
  const names = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${names[Number(m) - 1]} ${y}`;
};
