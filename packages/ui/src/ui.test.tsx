import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiBadge,
  AiPanel,
  AiReason,
  Avatar,
  Button,
  Money,
  Pill,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  Sidebar,
  Table,
  Td,
  TextField,
  Th,
  TOAST_MS,
  ToastProvider,
  colors,
  radii,
  useToast,
} from './index';

afterEach(cleanup);

describe('design tokens', () => {
  // Compared in lower case: formatters are free to change the case of hex colours.
  const css = readFileSync(join(__dirname, 'theme.css'), 'utf8').toLowerCase();

  it('theme.css carries every colour and radius in tokens.ts', () => {
    for (const [name, value] of Object.entries(colors)) {
      expect(css, name).toContain(`--color-${name}: ${value.toLowerCase()};`);
    }
    for (const [name, value] of Object.entries(radii)) {
      expect(css, name).toContain(`--radius-${name}: ${value};`);
    }
  });

  it('matches the palette in the build brief', () => {
    expect(colors).toMatchObject({
      ground: '#F4F5F1',
      surface: '#FFFFFF',
      line: '#E1E4DD',
      ink: '#121614',
      'ink-muted': '#5B635E',
      forest: '#0E3B2E',
      lime: '#C6F432',
      'lime-deep': '#A9D61C',
      amber: '#F0A23B',
      rust: '#C2410C',
      ai: '#4B2A9B',
      'ai-tint': '#F1EDFB',
      'ai-line': '#DCD3F5',
    });
  });
});

describe('Button', () => {
  it('is a real button that does not submit forms by accident', () => {
    render(<Button>New loan</Button>);
    const button = screen.getByRole('button', { name: 'New loan' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.className).toContain('h-11');
  });

  it('cannot be clicked while loading', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole('button');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.getAttribute('aria-busy')).toBe('true');
  });
});

describe('Pill', () => {
  it('uses the status colours from the designs', () => {
    render(
      <>
        <Pill tone="success">Approved</Pill>
        <Pill tone="danger">Declined</Pill>
      </>,
    );
    expect(screen.getByText('Approved').className).toContain('bg-success-bg text-success-fg');
    expect(screen.getByText('Declined').className).toContain('bg-danger-bg text-danger-fg');
  });
});

describe('Money', () => {
  it('formats bigint and wire-format amounts with separators and RWF', () => {
    render(
      <>
        <Money amount={4_500_000n} />
        <Money amount="284985" bare />
        <Money amount={2_480_000_000n} compact />
      </>,
    );
    expect(screen.getByText('RWF 4,500,000').className).toContain('tabular-nums');
    expect(screen.getByText('284,985')).toBeTruthy();
    expect(screen.getByText('RWF 2.48B')).toBeTruthy();
  });

  it('shows negative figures from the API, such as a net loss', () => {
    render(<Money amount="-479692909" bare />);
    expect(screen.getByText('−479,692,909')).toBeTruthy();
  });

  it('refuses a decimal amount instead of rounding it', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Money amount="1500.50" />)).toThrow(RangeError);
    quiet.mockRestore();
  });
});

describe('Table', () => {
  it('right-aligns numeric columns', () => {
    render(
      <Table>
        <thead>
          <tr>
            <Th>Borrower</Th>
            <Th numeric>Amount</Th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <Td>Aline Uwase</Td>
            <Td numeric>4,500,000</Td>
          </tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByRole('columnheader', { name: 'Amount' }).className).toContain('text-right');
    expect(screen.getByRole('cell', { name: '4,500,000' }).className).toContain('tabular-nums');
    expect(screen.getByRole('columnheader', { name: 'Borrower' }).getAttribute('scope')).toBe(
      'col',
    );
  });
});

describe('SegmentedControl', () => {
  it('marks the chosen option and reports changes', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        label="Range"
        value="12M"
        onChange={onChange}
        options={[
          { value: '3M', label: '3M' },
          { value: '12M', label: '12M' },
        ]}
      />,
    );
    expect(screen.getByRole('group', { name: 'Range' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '12M' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '3M' }));
    expect(onChange).toHaveBeenCalledWith('3M');
  });
});

describe('Sidebar', () => {
  it('is a labelled nav that marks the current page', () => {
    render(
      <Sidebar
        items={[
          { href: '/', label: 'Overview', icon: null, active: true },
          { href: '/applications', label: 'Applications', icon: null, badge: 24 },
        ]}
      />,
    );
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('aria-current')).toBe(
      'page',
    );
    const apps = screen.getByRole('link', { name: /Applications/ });
    expect(apps.getAttribute('aria-current')).toBeNull();
    expect(apps.textContent).toContain('24');
  });
});

describe('fields', () => {
  it('ties the label, hint and error to the input', () => {
    const { rerender } = render(<TextField label="Email" hint="Your work address" />);
    const input = screen.getByLabelText('Email');
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    rerender(<TextField label="Email" error="Enter your email" />);
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toBe('Enter your email');
  });

  it('gives the search box an accessible name', () => {
    render(<SearchInput placeholder="Search loans, borrowers…" />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeTruthy();
  });
});

describe('AI treatment', () => {
  it('always uses the purple style', () => {
    render(
      <AiPanel title="AI summary" meta="Updated today">
        Low risk, and improving.
        <AiReason>24 on-time payments</AiReason>
        <AiReason kind="watch">proof of address expires 30 Nov</AiReason>
      </AiPanel>,
    );
    const panel = screen.getByRole('heading', { name: 'AI summary' }).closest('section')!;
    expect(panel.className).toContain('bg-ai-tint');
    expect(panel.className).toContain('border-ai-line');
    expect(screen.getByText(/Why:/).className).toContain('text-ai');
    expect(screen.getByText(/Watch:/)).toBeTruthy();
    render(<AiBadge>AI pre-screen</AiBadge>);
    expect(screen.getByText('AI pre-screen').className).toContain('text-ai');
  });
});

describe('small pieces', () => {
  it('Avatar shows initials and hides them from screen readers', () => {
    const { container } = render(<Avatar name="Aline Uwase" />);
    const avatar = container.firstElementChild!;
    expect(avatar.textContent).toBe('AU');
    expect(avatar.getAttribute('aria-hidden')).toBe('true');
  });

  it('ProgressBar exposes its value and clamps it', () => {
    render(<ProgressBar value={140} label="Lending limit used" />);
    const bar = screen.getByRole('progressbar', { name: 'Lending limit used' });
    expect(bar.getAttribute('aria-valuenow')).toBe('100');
  });
});

describe('Toast', () => {
  function Trigger() {
    const toast = useToast();
    return <Button onClick={() => toast('Note saved.')}>Save note</Button>;
  }

  it('announces a message, then clears it', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(region.textContent).toBe('Note saved.');
    act(() => {
      vi.advanceTimersByTime(TOAST_MS + 10);
    });
    expect(region.textContent).toBe('');
    vi.useRealTimers();
  });

  it('explains itself when the provider is missing', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger />)).toThrow(/ToastProvider/);
    quiet.mockRestore();
  });
});
