# HIMT Learning Management System

A role-aware learning management platform for HIMT learners, faculty, academic operations, quality and IT teams.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/himt-lms/src/App.tsx` — learner and operations interface, routes and API hook wiring
- `artifacts/himt-lms/src/index.css` — HIMT visual language and responsive theme tokens
- `lib/api-spec/openapi.yaml` — source of truth for dashboard, curriculum, assignments, sessions, certificates, analytics and user-management contracts
- `artifacts/api-server/src/routes/lms.ts` — current LMS API surface and demonstration data
- `lib/api-client-react/src/generated/` — generated typed React Query client

## Architecture decisions

- The first release is contract-first: the OpenAPI document drives both the server validation schemas and the React Query client.
- The initial API surface uses a small in-memory dataset to keep the proof-of-concept usable while the production data model, migration mapping and storage decisions are finalized.
- The learner experience and operations surfaces share one responsive shell, with role-aware navigation as the next access-control boundary.
- Protected-content behavior is represented in the curriculum model (`protected` activities) and is intended to be backed by private storage, short-lived authorization and watermarking in the production implementation.

## Product

The current proof-of-concept includes a learner dashboard, searchable course catalogue, course structure and progress, assignment queue, classroom/webinar schedule, attendance signals, certificate shelf, analytics overview, user and role administration, and bulk-import feedback. The experience is designed around the mandatory HIMT requirements for curriculum hierarchy, learner progress, assessments, sessions, certificates and compliance visibility.

## User preferences

No additional user preferences recorded.

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before using generated client or Zod types.
- Restart `artifacts/api-server: API Server` and `artifacts/himt-lms: web` after contract, route or frontend changes.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
