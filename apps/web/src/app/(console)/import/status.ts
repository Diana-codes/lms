/** How each upload status is shown. */
export const STATUS = {
  INVALID: { tone: 'danger', label: 'Has problems' },
  VALIDATED: { tone: 'info', label: 'Ready to import' },
  IMPORTED: { tone: 'warning', label: 'Awaiting sign-off' },
  SIGNED_OFF: { tone: 'success', label: 'Signed off' },
} as const;
