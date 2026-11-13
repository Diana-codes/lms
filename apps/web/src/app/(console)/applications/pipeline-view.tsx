'use client';

import {
  type ApplicationStage,
  formatRwfCompact,
  PRODUCT_KIND_LABELS,
  PRODUCT_KINDS,
  type ProductKind,
  scoreBand,
  scorePercent,
} from '@kora/core';
import {
  ApplicationsIcon,
  BorrowersIcon,
  Button,
  Chip,
  cx,
  Money,
  PlusIcon,
  SegmentedControl,
  SparkleIcon,
  useToast,
} from '@kora/ui';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { cardAge, count, termLine } from '@/lib/format';
import type { ApplicationCard, Me, Pipeline, Product } from '@/lib/types';
import { ApplicationDialog } from './application-dialog';
import { NewApplicationDialog } from './new-application-dialog';

const STAGE_DOT: Record<ApplicationStage, string> = {
  NEW: 'bg-[#7C8580]',
  UNDER_REVIEW: 'bg-[#3B6FC2]',
  CREDIT_CHECK: 'bg-amber',
  APPROVED: 'bg-lime-deep',
  DISBURSED: 'bg-forest',
  DECLINED: 'bg-rust',
  WITHDRAWN: 'bg-ink-muted',
};

const KIND_TAG: Record<ProductKind, string> = {
  SME: 'bg-info-bg text-info-fg',
  PERSONAL: 'bg-tag-personal-bg text-tag-personal-fg',
  AGRI: 'bg-success-bg text-success-fg',
  ASSET: 'bg-warning-bg text-warning-fg',
};

const AI_BOX = {
  ok: 'bg-ai-tint text-ai-ink',
  warn: 'bg-warning-bg text-[#5A2D04]',
  flag: 'bg-danger-bg text-[#6E1C0E]',
};

const SCORE_BAR = { strong: 'bg-forest', fair: 'bg-lime-deep', weak: 'bg-amber' };

const sum = (cards: ApplicationCard[]) => cards.reduce((t, c) => t + BigInt(c.amount), 0n);
const short = (amount: bigint) => (amount === 0n ? '—' : formatRwfCompact(amount));

function ProductTag({ card, className }: { card: ApplicationCard; className?: string }) {
  return (
    <span
      className={cx(
        'rounded-pill px-2 py-[3px] text-[11px] font-semibold whitespace-nowrap',
        KIND_TAG[card.kind],
        className,
      )}
    >
      {card.productShortName}
    </span>
  );
}

/** The stored AI note on a card. Purple with the sparkle unless it is a warning or a flag. */
function AiNote({ card }: { card: ApplicationCard }) {
  if (!card.ai) {
    return (
      <div className="rounded-nav bg-neutral-bg px-2.5 py-2 text-xs leading-snug text-neutral-fg">
        <span className="font-semibold">Not scored yet</span>
      </div>
    );
  }
  return (
    <div
      className={cx(
        'flex gap-2 rounded-nav px-2.5 py-2 text-xs leading-snug',
        AI_BOX[card.ai.tone],
      )}
    >
      <SparkleIcon size={14} className="mt-px flex-none" />
      <span className="flex flex-col gap-px">
        <span className="font-semibold">{card.ai.title}</span>
        {card.ai.why ? <span>{card.ai.why}</span> : null}
      </span>
    </div>
  );
}

function BoardCard({
  card,
  now,
  onOpen,
}: {
  card: ApplicationCard;
  now: number;
  onOpen: () => void;
}) {
  return (
    <article className="relative flex flex-col gap-3 rounded-panel bg-surface p-3.5 shadow-card focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-forest hover:shadow-pop">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-ink-muted tabular-nums">{card.code}</span>
        <ProductTag card={card} className="ml-auto" />
      </div>
      <div className="flex flex-col gap-0.5">
        {/* The button's hit area stretches over the whole card. */}
        <button
          type="button"
          onClick={onOpen}
          className="cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-ink outline-none after:absolute after:inset-0 after:rounded-panel"
        >
          {card.borrowerName}
        </button>
        <Money
          amount={card.amount}
          className="font-display text-xl font-semibold tracking-[-0.01em]"
        />
        <span className="text-xs text-ink-muted">{termLine(card)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="h-[5px] flex-1 rounded-pill bg-neutral-bg">
          {card.score != null ? (
            <div
              className={cx('h-[5px] rounded-pill', SCORE_BAR[scoreBand(card.score)])}
              style={{ width: `${scorePercent(card.score)}%` }}
            />
          ) : null}
        </div>
        <span className="text-xs font-semibold tabular-nums">
          {card.score != null ? `Score ${card.score}` : 'No score'}
        </span>
      </div>
      <AiNote card={card} />
      <div className="flex items-center gap-2 border-t border-line-soft pt-2.5">
        <span
          title={card.officerName ?? undefined}
          className="flex size-6 items-center justify-center rounded-full bg-avatar-bg text-[10px] font-semibold text-forest"
        >
          {card.officerInitials ?? '–'}
        </span>
        <span className="text-xs text-ink-muted">{cardAge(card, now)}</span>
        <span
          className="ml-auto flex items-center gap-1 text-xs text-ink-muted"
          title="Documents received"
        >
          <ApplicationsIcon size={13} />
          {card.docsReceived}/{card.docsRequired}
        </span>
      </div>
    </article>
  );
}

export function PipelineView({
  columns,
  products,
  me,
  now,
  openCode,
  startNew,
}: {
  columns: Pipeline['columns'];
  products: Product[];
  me: Me;
  now: number;
  openCode: string | null;
  startNew: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [kind, setKind] = useState<ProductKind | 'ALL'>('ALL');
  const [mine, setMine] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [view, setView] = useState<'board' | 'list'>('board');
  const [selected, setSelected] = useState<string | null>(openCode);
  const [creating, setCreating] = useState(startNew);

  // Once a link's ?open= or ?new= has been used, tidy it out of the address bar.
  useEffect(() => {
    if (openCode || startNew) router.replace(pathname, { scroll: false });
  }, [openCode, startNew, router, pathname]);

  const all = useMemo(() => columns.flatMap((c) => c.cards), [columns]);
  const filtered = kind !== 'ALL' || mine || flagged;
  const keep = (c: ApplicationCard) =>
    (kind === 'ALL' || c.kind === kind) &&
    (!mine || c.officerId === me.id) &&
    (!flagged || c.ai?.tone === 'flag');
  const shown = columns.map((col) => ({ ...col, cards: col.cards.filter(keep) }));
  const flat = shown.flatMap((c) => c.cards);
  const selectedCard = all.find((c) => c.code === selected) ?? null;

  // What the stored AI pre-screen says about applications still awaiting a decision.
  const undecided = all.filter(
    (c) => c.stage === 'NEW' || c.stage === 'UNDER_REVIEW' || c.stage === 'CREDIT_CHECK',
  );
  const scored = undecided.filter((c) => c.ai);
  const flags = undecided.filter((c) => c.ai?.tone === 'flag').length;
  const favourable = undecided.filter((c) => c.ai?.tone === 'ok').length;
  const canCreate = me.role !== 'COLLECTIONS_AGENT';
  // Meets its product's auto-approve policy. A person still presses the button.
  const eligible = all.filter((c) => c.autoEligible);
  const [approving, setApproving] = useState(false);
  const toast = useToast();

  async function approveEligible() {
    setApproving(true);
    try {
      const r = await api<{
        approved: string[];
        skipped: Array<{ code: string; reason: string }>;
        total: string;
      }>('/applications/auto-approve', { method: 'POST' });
      toast(
        r.approved.length
          ? `${r.approved.length} low-risk ${r.approved.length === 1 ? 'application' : 'applications'} approved (${formatRwfCompact(BigInt(r.total))}).${r.skipped.length ? ` ${r.skipped.length} skipped: ${r.skipped[0]!.reason}` : ''}`
          : `None approved. ${r.skipped[0]?.reason ?? ''}`,
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setApproving(false);
    }
  }

  return (
    <>
      <header className="flex flex-wrap items-end gap-4">
        <div className="mr-auto flex flex-col gap-1">
          <span className="text-[13px] text-ink-muted">
            {count(all.length)} open · {short(sum(all))} requested
          </span>
          <h1 className="m-0 font-display text-[30px] leading-tight font-semibold tracking-[-0.02em]">
            Applications
          </h1>
        </div>
        <SegmentedControl
          label="View"
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: 'Board' },
            { value: 'list', label: 'List' },
          ]}
          className="border border-line bg-surface"
        />
        {canCreate ? (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon size={16} />
            New application
          </Button>
        ) : null}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Chip pressed={kind === 'ALL'} onClick={() => setKind('ALL')}>
          All products
        </Chip>
        {PRODUCT_KINDS.map((k) => (
          <Chip key={k} pressed={kind === k} onClick={() => setKind(k)}>
            {PRODUCT_KIND_LABELS[k]}
          </Chip>
        ))}
        <span className="mx-1 h-6 w-px bg-line" aria-hidden="true" />
        <Chip pressed={mine} onClick={() => setMine((v) => !v)}>
          <BorrowersIcon size={14} />
          Assigned to me
        </Chip>
        {flagged ? (
          <Chip pressed onClick={() => setFlagged(false)}>
            Flagged only
          </Chip>
        ) : null}
        {filtered ? (
          <>
            <span className="ml-1 text-[13px] text-ink-muted" role="status">
              Showing {flat.length} {flat.length === 1 ? 'application' : 'applications'} ·{' '}
              {short(sum(flat))}
            </span>
            <button
              type="button"
              onClick={() => {
                setKind('ALL');
                setMine(false);
                setFlagged(false);
              }}
              className="h-11 cursor-pointer border-0 bg-transparent px-2.5 text-[13px] font-semibold text-forest underline"
            >
              Clear filters
            </button>
          </>
        ) : null}
      </div>

      {scored.length > 0 ? (
        <section
          aria-label="AI pre-screening"
          className="flex flex-wrap items-center gap-4 rounded-[18px] border border-ai-line bg-ai-tint px-[18px] py-4"
        >
          <span className="flex size-10 flex-none items-center justify-center rounded-control bg-ai text-white">
            <SparkleIcon size={20} />
          </span>
          <div className="flex min-w-0 flex-[1_1_360px] flex-col gap-[3px]">
            <span className="text-sm font-semibold text-ai-ink">
              AI pre-screened {scored.length} of {undecided.length} applications awaiting a decision
            </span>
            <span className="text-[13px] text-ai-ink-soft">
              {favourable} recommended for approval · {flags} flagged ·{' '}
              {scored.length - favourable - flags} need a closer look. These are suggestions; an
              officer makes every decision.
            </span>
          </div>
          {flags > 0 ? (
            <button
              type="button"
              onClick={() => {
                setFlagged(true);
                setKind('ALL');
                setMine(false);
              }}
              className="h-11 cursor-pointer rounded-nav border border-ai-edge bg-surface px-3.5 text-[13px] font-semibold text-ai-ink"
            >
              Review {flags} flagged
            </button>
          ) : null}
          {canCreate && eligible.length > 0 ? (
            <Button
              className="bg-ai text-[13px] hover:bg-ai-ink"
              loading={approving}
              onClick={approveEligible}
            >
              Approve {eligible.length} low-risk
            </Button>
          ) : null}
        </section>
      ) : null}

      {view === 'board' ? (
        <div className="overflow-x-auto pb-2">
          <div className="grid min-w-[1240px] grid-cols-[repeat(5,minmax(240px,1fr))] gap-3.5">
            {shown.map((col) => (
              <section
                key={col.stage}
                aria-label={col.label}
                className="flex flex-col gap-2.5 rounded-[18px] bg-board-column p-3"
              >
                <div className="flex items-center gap-2 px-1.5 pt-1 pb-1.5">
                  <span className={cx('size-2 rounded-full', STAGE_DOT[col.stage])} />
                  <h2 className="m-0 text-sm font-semibold whitespace-nowrap">{col.label}</h2>
                  <span className="rounded-pill bg-surface px-2 py-0.5 text-xs text-ink-muted">
                    {col.cards.length}
                  </span>
                  <span className="ml-auto text-xs whitespace-nowrap text-ink-muted tabular-nums">
                    {short(sum(col.cards))}
                  </span>
                </div>
                {col.cards.map((card) => (
                  <BoardCard
                    key={card.code}
                    card={card}
                    now={now}
                    onOpen={() => setSelected(card.code)}
                  />
                ))}
                {col.cards.length === 0 ? (
                  <p className="m-0 px-1.5 py-3 text-center text-xs text-ink-muted">
                    {filtered ? 'None match the filters' : 'Nothing here'}
                  </p>
                ) : null}
                {col.stage === 'NEW' && canCreate ? (
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="h-11 cursor-pointer rounded-control border border-dashed border-[#B9BEB4] bg-transparent text-[13px] text-ink-soft hover:bg-surface"
                  >
                    + Add
                  </button>
                ) : null}
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {view === 'list' && flat.length > 0 ? (
        <section className="rounded-card border border-line bg-surface px-5 pt-2 pb-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-ink-muted">
                  {[
                    'Applicant',
                    'Product',
                    'Amount',
                    'Stage',
                    'AI recommendation',
                    'Officer',
                    'Docs',
                  ].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className={cx(
                        'border-b border-line px-2 pt-3 pb-2.5 font-medium first:pl-0 last:pr-0',
                        h === 'Amount' && 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flat.map((c) => (
                  <tr
                    key={c.code}
                    className="[&>td]:border-b [&>td]:border-line-soft [&>td]:px-2 [&>td]:py-3 [&>td:first-child]:pl-0 [&>td:last-child]:pr-0"
                  >
                    <td>
                      <span className="flex flex-col items-start">
                        <button
                          type="button"
                          onClick={() => setSelected(c.code)}
                          className="min-h-6 cursor-pointer border-0 bg-transparent p-0 text-left text-sm font-semibold text-ink hover:underline"
                        >
                          {c.borrowerName}
                        </button>
                        <span className="text-xs text-ink-muted">
                          {c.code} · {termLine(c)}
                        </span>
                      </span>
                    </td>
                    <td>
                      <ProductTag card={c} />
                    </td>
                    <td className="text-right font-semibold">
                      <Money amount={c.amount} />
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className={cx('size-2 rounded-full', STAGE_DOT[c.stage])} />
                        {c.stageLabel}
                      </span>
                    </td>
                    <td className="text-[13px]">
                      {c.ai ? (
                        <span className="inline-flex items-center gap-1.5 text-ai-ink">
                          <SparkleIcon size={12} className="text-ai" />
                          {c.ai.title}
                        </span>
                      ) : (
                        <span className="text-ink-muted">Not scored yet</span>
                      )}
                    </td>
                    <td>{c.officerName ?? '—'}</td>
                    <td>
                      {c.docsReceived}/{c.docsRequired}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {flat.length === 0 ? (
        <div className="p-6 text-center text-sm text-ink-muted" role="status">
          {filtered
            ? 'No applications match these filters.'
            : 'No open applications. Create the first one.'}
        </div>
      ) : null}

      <ApplicationDialog card={selectedCard} me={me} now={now} onClose={() => setSelected(null)} />
      <NewApplicationDialog
        open={creating}
        products={products}
        onClose={() => setCreating(false)}
      />
    </>
  );
}
