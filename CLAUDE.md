# Project instructions for Claude Code

This repo builds the Kora Lend loan management system: a web console for lenders and a mobile app for borrowers in Rwanda.

## Read first
1. `BUILD_BRIEF.md`: scope, stack, business rules and build phases. It is the source of truth.
2. `design/screens/*.dc.html`: approved screen designs. Treat them as specs. Rebuild them as React (web) and React Native (mobile) components that match them visually and behaviourally. Don't copy the template syntax (`{{ }}`, `<sc-for>`, `<sc-if>`) into the app.

## How to work
- Build one phase at a time (see BUILD_BRIEF.md §6). Before each phase, propose a short plan and wait for approval.
- Stack: pnpm + Turborepo monorepo · Next.js + Tailwind (apps/web) · Expo React Native (apps/mobile) · NestJS + Prisma + PostgreSQL (apps/api) · BullMQ + Redis (jobs) · Python FastAPI (services/ml).
- Keep shared types, money helpers and the schedule calculator in `packages/core`, with unit tests.

## Hard rules
- Money is integer RWF (`bigint`). No floats for balances.
- All balance changes go through the double-entry ledger.
- Payment callbacks must be idempotent.
- Never commit secrets. Use `.env` files (gitignored) and `.env.example` templates.
- Mask phone and ID numbers in UIs and logs.
- AI outputs are advisory, store their reasons, and never auto-decline.
- Run tests and type-checks before saying a task is done.
