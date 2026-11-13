'use client';

import { formatRwf } from '@kora/core';
import {
  AiBadge,
  AiPanel,
  AiReason,
  ApplicationsIcon,
  Avatar,
  BellIcon,
  BorrowersIcon,
  Button,
  Card,
  CardTitle,
  CheckIcon,
  CollectionsIcon,
  colors,
  EmptyState,
  LoansIcon,
  Money,
  OverviewIcon,
  Pill,
  type PillTone,
  PlusIcon,
  ProgressBar,
  ReportsIcon,
  SearchIcon,
  SearchInput,
  SegmentedControl,
  SparkleIcon,
  StatTile,
  Table,
  Td,
  TextField,
  Th,
  useToast,
  WarningIcon,
} from '@kora/ui';
import { type ReactNode, useState } from 'react';

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <Card>
      <div className="flex flex-col gap-1">
        <CardTitle>{title}</CardTitle>
        {note ? <p className="m-0 text-[13px] text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </Card>
  );
}

const SWATCHES: Array<[keyof typeof colors, string]> = [
  ['ground', 'Page background'],
  ['surface', 'Cards'],
  ['line', 'Borders'],
  ['ink', 'Primary text, dark buttons'],
  ['ink-muted', 'Secondary text'],
  ['forest', 'Brand, sidebar, hero cards'],
  ['lime', 'Accent, CTA on dark'],
  ['lime-deep', 'Charts, early states'],
  ['amber', 'Warnings, 31–90 days late'],
  ['rust', 'Danger, 90+ days late'],
  ['ai', 'AI features'],
  ['ai-tint', 'AI background'],
];

const PILLS: Array<[PillTone, string]> = [
  ['success', 'Approved'],
  ['info', 'In review'],
  ['warning', 'Docs needed'],
  ['danger', 'Declined'],
  ['neutral', 'Upcoming'],
  ['dark', 'Due next'],
];

// Sample rows from the Overview design, to show the table against real shapes.
const ROWS: Array<[string, string, string, bigint, number, PillTone, string]> = [
  ['Aline Uwase', 'APP-20931', 'SME working capital', 4_500_000n, 742, 'success', 'Approved'],
  ['Jean-Paul Mugisha', 'APP-20928', 'Asset finance', 12_000_000n, 688, 'info', 'In review'],
  ['Grace Ingabire', 'APP-20925', 'Salary advance', 600_000n, 715, 'warning', 'Docs needed'],
  ['Claudine Mukamana', 'APP-20917', 'Personal loan', 2_200_000n, 594, 'danger', 'Declined'],
];

export function KitGallery() {
  const toast = useToast();
  const [range, setRange] = useState<'3M' | '12M'>('12M');
  const [view, setView] = useState<'board' | 'list'>('board');
  const [amount, setAmount] = useState('');
  const amountError = amount && !/^\d[\d,]*$/.test(amount) ? 'Enter a whole amount in RWF' : null;

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="Colour"
        note="Tokens from the build brief, available as Tailwind classes (bg-forest, text-ink-muted, border-line…)."
      >
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 p-0">
          {SWATCHES.map(([name, use]) => (
            <li key={name} className="flex flex-col gap-2">
              <div
                className="h-14 rounded-control border border-line"
                style={{ background: colors[name] }}
              />
              <div className="flex flex-col">
                <span className="text-sm font-semibold">{name}</span>
                <span className="text-xs text-ink-muted">
                  {colors[name]} · {use}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        title="Type"
        note="Space Grotesk 600 for headings and big numbers. Inter for everything else."
      >
        <div className="flex flex-col gap-3">
          <span className="font-display text-[32px] leading-tight font-semibold tracking-[-0.02em]">
            RWF 2.48B
          </span>
          <span className="font-display text-[30px] leading-tight font-semibold tracking-[-0.02em]">
            Portfolio overview
          </span>
          <span className="font-display text-lg font-semibold">Recent applications</span>
          <span className="text-sm">Body text, 14px. Instalment 6 of 18 received via MoMo.</span>
          <span className="text-[13px] text-ink-muted">Secondary text, 13px. Updated 2 Nov.</span>
          <span className="text-sm font-semibold tabular-nums">
            Tabular numerals: {formatRwf(1_111_111n)} · {formatRwf(4_500_000n)}
          </span>
        </div>
      </Section>

      <Section title="Buttons" note="Every button is at least 44px tall.">
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => toast('Primary button pressed.')}>
            <PlusIcon size={16} />
            New loan
          </Button>
          <Button variant="secondary">Send SMS reminders</Button>
          <Button variant="ghost">View pipeline</Button>
          <Button variant="danger">Write off</Button>
          <Button disabled>Reminders sent</Button>
          <Button loading>Saving…</Button>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-card bg-forest p-5">
          <Button variant="accent" size="lg">
            Pay with MoMo
          </Button>
          <Button variant="accent">Approve 5 low-risk</Button>
        </div>
      </Section>

      <Section title="Status pills">
        <div className="flex flex-wrap items-center gap-2">
          {PILLS.map(([tone, label]) => (
            <Pill key={tone} tone={tone}>
              {label}
            </Pill>
          ))}
          <span className="rounded-pill bg-forest p-1.5">
            <Pill tone="lime">+8.2% vs last month</Pill>
          </span>
        </div>
      </Section>

      <section
        aria-label="Stat tiles"
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4"
      >
        <StatTile
          tone="forest"
          label="Active portfolio"
          value={<Money amount={2_480_000_000n} compact />}
        >
          <Pill tone="lime" className="self-start">
            +8.2% vs last month
          </Pill>
        </StatTile>
        <StatTile label="Disbursed this month" value={<Money amount={318_000_000n} compact />}>
          <span className="text-[13px] font-medium text-positive-fg">142 loans · +12 vs Oct</span>
        </StatTile>
        <StatTile label="Collection rate" value="96.4%">
          <ProgressBar value={96.4} label="Collection rate" />
        </StatTile>
        <StatTile label="Portfolio at risk (30+ days)" value="3.1%">
          <span className="text-[13px] font-medium text-caution-fg">+0.4 pts · 37 loans</span>
        </StatTile>
      </section>

      <Section
        title="Table"
        note="Money is right-aligned with tabular numerals. The table scrolls sideways on small screens."
      >
        <Table>
          <thead>
            <tr>
              <Th>Borrower</Th>
              <Th>Product</Th>
              <Th numeric>Amount</Th>
              <Th>Credit score</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map(([name, id, product, value, score, tone, status]) => (
              <tr key={id}>
                <Td>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={name} />
                    <div className="flex flex-col">
                      <span className="font-medium">{name}</span>
                      <span className="text-xs text-ink-muted">{id}</span>
                    </div>
                  </div>
                </Td>
                <Td className="text-ink-soft">{product}</Td>
                <Td numeric>
                  <Money amount={value} />
                </Td>
                <Td className="tabular-nums">{score}</Td>
                <Td>
                  <Pill tone={tone}>{status}</Pill>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>

      <Section title="Form controls">
        <div className="flex flex-wrap items-start gap-4">
          <SearchInput placeholder="Search loans, borrowers…" className="flex-[1_1_240px]" />
          <TextField
            className="flex-[1_1_240px]"
            label="Amount (RWF)"
            inputMode="numeric"
            placeholder="e.g. 4,500,000"
            hint="Whole francs. No decimals."
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            error={amountError}
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SegmentedControl
            label="Range"
            value={range}
            onChange={setRange}
            options={[
              { value: '3M', label: '3M' },
              { value: '12M', label: '12M' },
            ]}
          />
          <SegmentedControl
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'board', label: 'Board' },
              { value: 'list', label: 'List' },
            ]}
          />
          <span className="text-[13px] text-ink-muted">
            Showing {range}, {view} view
          </span>
        </div>
      </Section>

      <AiPanel title="AI summary" meta="Updated today">
        <p className="mt-0 mb-3">
          Low risk, and improving. MoMo inflows have been steady at about RWF 1.6M a month for 14
          months.
        </p>
        <div className="flex flex-wrap gap-2">
          <AiReason>24 on-time payments</AiReason>
          <AiReason>stable revenue</AiReason>
          <AiReason kind="watch">proof of address expires 30 Nov</AiReason>
          <AiBadge>AI pre-screen</AiBadge>
        </div>
      </AiPanel>

      <Section title="Feedback">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => toast('Reminder SMS sent to 4 borrowers due this week.')}
          >
            Show a toast
          </Button>
          <div className="flex-[1_1_240px]">
            <ProgressBar value={74} label="Lending limit used" />
          </div>
        </div>
        <Card tone="caution" compact className="flex-row items-start gap-2.5">
          <WarningIcon className="mt-px flex-none text-caution-fg" />
          <span className="text-[13px] leading-snug">
            12 loans moved into 31–90 days this week.
          </span>
        </Card>
        <EmptyState
          icon={<ApplicationsIcon size={22} />}
          title="No applications match these filters"
          action={<Button variant="secondary">Clear filters</Button>}
        >
          Try a different product, or clear the filters to see everything.
        </EmptyState>
      </Section>

      <Section title="Icons">
        <div className="flex flex-wrap items-center gap-4 text-forest">
          <OverviewIcon />
          <ApplicationsIcon />
          <LoansIcon />
          <BorrowersIcon />
          <CollectionsIcon />
          <ReportsIcon />
          <SearchIcon />
          <BellIcon />
          <PlusIcon />
          <CheckIcon />
          <WarningIcon />
          <SparkleIcon className="text-ai" size={18} />
        </div>
      </Section>
    </div>
  );
}
