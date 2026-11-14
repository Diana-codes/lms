'use client';

import { STAFF_ROLE_LABELS, STAFF_ROLES, type StaffRole } from '@kora/core';
import {
  Button,
  Card,
  CardTitle,
  FormError,
  Modal,
  Pill,
  PlusIcon,
  SelectField,
  Table,
  Td,
  TextField,
  Th,
  useToast,
} from '@kora/ui';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import type { Branch, StaffMember } from '@/lib/types';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; member: StaffMember }
  | { kind: 'reset'; member: StaffMember }
  | { kind: 'branch' }
  | null;

const ROLE_HINTS: Record<StaffRole, string> = {
  ADMIN: 'Everything, including staff and company settings',
  MANAGER: 'Approves loans, sees reports and staff',
  LOAN_OFFICER: 'Takes applications and looks after borrowers',
  COLLECTIONS_AGENT: 'Follows up late payments',
};

/** A readable temporary password: four groups of four, no look-alike characters. */
function temporaryPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

const message = (err: unknown) =>
  err instanceof ApiError ? err.message : 'Something went wrong. Try again.';

export function StaffView({
  staff,
  branches,
  meId,
  canManage,
}: {
  staff: StaffMember[];
  branches: Branch[];
  meId: string;
  canManage: boolean;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const close = () => setDialog(null);

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="mr-auto">People</CardTitle>
          {canManage ? (
            <>
              <Button variant="secondary" onClick={() => setDialog({ kind: 'branch' })}>
                Add branch
              </Button>
              <Button onClick={() => setDialog({ kind: 'add' })}>
                <PlusIcon /> Add staff
              </Button>
            </>
          ) : null}
        </div>
        <Table minWidth={760}>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Role</Th>
              <Th>Branch</Th>
              <Th>Status</Th>
              <Th>Last sign-in</Th>
              {canManage ? (
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id} className={s.isActive ? undefined : 'text-ink-muted'}>
                <Td>
                  <div className="flex flex-col">
                    <span className="font-semibold">
                      {s.firstName} {s.lastName}
                      {s.id === meId ? (
                        <span className="font-normal text-ink-muted"> (you)</span>
                      ) : null}
                    </span>
                    <span className="text-[13px] text-ink-muted">{s.email}</span>
                  </div>
                </Td>
                <Td>{STAFF_ROLE_LABELS[s.role]}</Td>
                <Td>{s.branch ?? '—'}</Td>
                <Td>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusPills member={s} />
                  </div>
                </Td>
                <Td className="text-[13px]">{s.lastLoginAt ? dateTime(s.lastLoginAt) : 'Never'}</Td>
                {canManage ? (
                  <Td className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => setDialog({ kind: 'edit', member: s })}
                      >
                        Edit
                      </Button>
                      {s.isActive && s.id !== meId ? (
                        <Button
                          variant="ghost"
                          onClick={() => setDialog({ kind: 'reset', member: s })}
                        >
                          Reset access
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {dialog?.kind === 'add' ? <AddStaff branches={branches} onClose={close} /> : null}
      {dialog?.kind === 'edit' ? (
        <EditStaff
          member={dialog.member}
          branches={branches}
          isMe={dialog.member.id === meId}
          onClose={close}
        />
      ) : null}
      {dialog?.kind === 'reset' ? <ResetAccess member={dialog.member} onClose={close} /> : null}
      {dialog?.kind === 'branch' ? <AddBranch onClose={close} /> : null}
    </>
  );
}

function StatusPills({ member }: { member: StaffMember }) {
  if (!member.isActive) return <Pill>Deactivated</Pill>;
  const pills: ReactNode[] = [];
  if (member.lockedUntil)
    pills.push(
      <Pill key="locked" tone="danger">
        Locked
      </Pill>,
    );
  if (member.mustChangePassword) {
    pills.push(
      <Pill key="pw" tone="warning">
        Temporary password
      </Pill>,
    );
  }
  pills.push(
    member.twoFactorEnabled ? (
      <Pill key="2fa" tone="success">
        Two-factor on
      </Pill>
    ) : (
      <Pill key="2fa">Two-factor off</Pill>
    ),
  );
  return <>{pills}</>;
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: StaffRole;
  onChange: (role: StaffRole) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <SelectField
        label="Role"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as StaffRole)}
      >
        {STAFF_ROLES.map((r) => (
          <option key={r} value={r}>
            {STAFF_ROLE_LABELS[r]}
          </option>
        ))}
      </SelectField>
      <p className="m-0 text-[13px] text-ink-muted">{ROLE_HINTS[value]}</p>
    </div>
  );
}

function BranchSelect({
  value,
  onChange,
  branches,
}: {
  value: string;
  onChange: (id: string) => void;
  branches: Branch[];
}) {
  return (
    <SelectField label="Branch" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">No branch</option>
      {branches.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name} ({b.district})
        </option>
      ))}
    </SelectField>
  );
}

/** Shows the temporary password once, so the admin can pass it on. */
function PasswordHandover({
  email,
  password,
  onClose,
}: {
  email: string;
  password: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm">
        Give <strong>{email}</strong> this temporary password in person or by phone. They choose
        their own when they first sign in. It is not shown again.
      </p>
      <code className="w-fit rounded-control bg-ground px-4 py-3 font-mono text-lg tracking-wide">
        {password}
      </code>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(password);
            setCopied(true);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

function AddStaff({ branches, onClose }: { branches: Branch[]; onClose: () => void }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('LOAN_OFFICER');
  const [branchId, setBranchId] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ email: string; password: string } | null>(null);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!firstName.trim() || !lastName.trim() || !emailOk) return;
    setBusy(true);
    setError(null);
    const password = temporaryPassword();
    try {
      const res = await api<{ email: string }>('/users', {
        method: 'POST',
        body: {
          firstName,
          lastName,
          email,
          role,
          branchId: branchId || null,
          phone: phone.trim() || null,
          password,
        },
      });
      setDone({ email: res.email, password });
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={done ? 'Staff member added' : 'Add staff'}>
      {done ? (
        <PasswordHandover {...done} onClose={onClose} />
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
          <div className="grid grid-cols-2 gap-2.5">
            <TextField
              label="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              error={touched && !firstName.trim() ? 'Required' : null}
              data-autofocus
            />
            <TextField
              label="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              error={touched && !lastName.trim() ? 'Required' : null}
            />
          </div>
          <TextField
            label="Work email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={touched && !emailOk ? 'Enter an email address' : null}
            hint="They sign in with this."
          />
          <TextField
            label="Mobile number (optional)"
            inputMode="tel"
            placeholder="078 812 3412"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <RoleSelect value={role} onChange={setRole} />
          <BranchSelect value={branchId} onChange={setBranchId} branches={branches} />
          <FormError>{error}</FormError>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" loading={busy}>
              Add and create password
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function EditStaff({
  member,
  branches,
  isMe,
  onClose,
}: {
  member: StaffMember;
  branches: Branch[];
  isMe: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [firstName, setFirstName] = useState(member.firstName);
  const [lastName, setLastName] = useState(member.lastName);
  const [role, setRole] = useState<StaffRole>(member.role);
  const [branchId, setBranchId] = useState(member.branchId ?? '');
  const [busy, setBusy] = useState<'save' | 'active' | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>, kind: 'save' | 'active', done: string) {
    setBusy(kind);
    setError(null);
    try {
      await api(`/users/${member.id}`, { method: 'PATCH', body });
      toast(done);
      router.refresh();
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    void patch({ firstName, lastName, role, branchId: branchId || null }, 'save', 'Changes saved.');
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`${member.firstName} ${member.lastName}`}
      subtitle={member.email}
    >
      <form onSubmit={save} className="flex flex-col gap-3.5" noValidate>
        <div className="grid grid-cols-2 gap-2.5">
          <TextField
            label="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
          />
          <TextField
            label="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
          />
        </div>
        <RoleSelect value={role} onChange={setRole} disabled={isMe} />
        {isMe ? (
          <p className="m-0 text-[13px] text-ink-muted">
            Another administrator has to change your role.
          </p>
        ) : null}
        <BranchSelect value={branchId} onChange={setBranchId} branches={branches} />
        {role !== member.role ? (
          <p className="m-0 rounded-control bg-ground px-3.5 py-2.5 text-[13px]">
            Changing the role signs them out so the new access applies at once.
          </p>
        ) : null}
        <FormError>{error}</FormError>
        {confirming ? (
          <div className="flex flex-col gap-3 rounded-control bg-danger-bg px-3.5 py-3">
            <p className="m-0 text-sm text-danger-fg">
              Deactivate {member.firstName}? They are signed out at once and cannot sign in until
              someone reactivates them. Their loans and history stay as they are.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button
                variant="danger"
                loading={busy === 'active'}
                onClick={() =>
                  patch({ isActive: false }, 'active', `${member.firstName} can no longer sign in.`)
                }
              >
                Yes, deactivate
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Keep active
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy === 'save'}>
            Save
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {!isMe ? (
            member.isActive ? (
              confirming ? null : (
                <Button variant="danger" className="ml-auto" onClick={() => setConfirming(true)}>
                  Deactivate
                </Button>
              )
            ) : (
              <Button
                variant="secondary"
                className="ml-auto"
                loading={busy === 'active'}
                onClick={() =>
                  patch({ isActive: true }, 'active', `${member.firstName} can sign in again.`)
                }
              >
                Reactivate
              </Button>
            )
          ) : null}
        </div>
      </form>
    </Modal>
  );
}

function ResetAccess({ member, onClose }: { member: StaffMember; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<'password' | '2fa' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handover, setHandover] = useState<string | null>(null);

  async function resetPassword() {
    setBusy('password');
    setError(null);
    const password = temporaryPassword();
    try {
      await api(`/users/${member.id}/reset-password`, { method: 'POST', body: { password } });
      setHandover(password);
      router.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function resetTwoFactor() {
    setBusy('2fa');
    setError(null);
    try {
      await api(`/users/${member.id}/reset-two-factor`, { method: 'POST' });
      toast(`Two-factor is off for ${member.firstName}. They can set it up again.`);
      router.refresh();
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reset access"
      subtitle={`${member.firstName} ${member.lastName} · ${member.email}`}
    >
      {handover ? (
        <PasswordHandover email={member.email} password={handover} onClose={onClose} />
      ) : (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">Forgotten password</h3>
            <p className="m-0 text-sm text-ink-muted">
              Creates a temporary password and signs them out everywhere. Any lockout is lifted.
            </p>
            <Button
              variant="secondary"
              className="self-start"
              loading={busy === 'password'}
              onClick={resetPassword}
            >
              Create temporary password
            </Button>
          </section>
          {member.twoFactorEnabled ? (
            <section className="flex flex-col gap-2">
              <h3 className="m-0 text-sm font-semibold">Lost phone</h3>
              <p className="m-0 text-sm text-ink-muted">
                Turns two-factor sign-in off so they can set it up on a new phone. Check it is
                really them first.
              </p>
              <Button
                variant="secondary"
                className="self-start"
                loading={busy === '2fa'}
                onClick={resetTwoFactor}
              >
                Turn off two-factor
              </Button>
            </section>
          ) : null}
          <FormError>{error}</FormError>
        </div>
      )}
    </Modal>
  );
}

function AddBranch({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [district, setDistrict] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const codeOk = /^[A-Za-z0-9-]{2,12}$/.test(code.trim());

  async function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!codeOk || name.trim().length < 2 || district.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      await api('/branches', { method: 'POST', body: { code, name, district } });
      toast('Branch added.');
      router.refresh();
      onClose();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add branch">
      <form onSubmit={submit} className="flex flex-col gap-3.5" noValidate>
        <TextField
          label="Branch name"
          placeholder="e.g. Kimironko"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={touched && name.trim().length < 2 ? 'Required' : null}
          data-autofocus
        />
        <div className="grid grid-cols-2 gap-2.5">
          <TextField
            label="Short code"
            placeholder="e.g. KIM"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            error={touched && !codeOk ? '2–12 letters or digits' : null}
          />
          <TextField
            label="District"
            placeholder="e.g. Gasabo"
            value={district}
            onChange={(e) => setDistrict(e.target.value)}
            error={touched && district.trim().length < 2 ? 'Required' : null}
          />
        </div>
        <FormError>{error}</FormError>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy}>
            Add branch
          </Button>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
