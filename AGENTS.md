# Backend Instructions

These instructions apply to all backend development.

Also follow all instructions from the root `AGENTS.md`.

## Stack

- NestJS
- TypeScript
- Prisma
- PostgreSQL
- Redis
- BullMQ

## Architecture

The backend is a modular monolith.

Do not introduce microservices without explicit approval.

PostgreSQL is the source of truth.

Redis is auxiliary infrastructure for:

- BullMQ;
- cache;
- background jobs;
- rate limiting;
- distributed locks when necessary.

Never store critical business state only in Redis.

## Prisma

Prisma is the official ORM.

Do not introduce:

- TypeORM;
- Sequelize;
- MikroORM;
- another ORM

without explicit architectural approval.

Use Prisma for PostgreSQL access.

Use transactions for critical operations when required.

Migrations must be reviewed before completion.

## NestJS

Keep responsibilities separated.

Prefer:

### Controllers

Responsible for:

- HTTP transport;
- request parsing;
- authentication context;
- responses.

Controllers must not contain complex business rules.

### Services / Use Cases

Responsible for:

- business rules;
- orchestration;
- state transitions.

### DTOs

Responsible for:

- input contract;
- validation.

### Prisma

Responsible for:

- PostgreSQL persistence.

### Adapters / Integrations

Responsible for:

- Asaas;
- Cloudflare R2;
- Twilio;
- Resend;
- other external providers.

## External Integrations

External providers must be encapsulated.

Current integrations:

- Asaas
- Cloudflare R2
- Twilio
- Resend

Do not spread provider-specific SDK calls throughout business services.

## Redis

Redis may be used for:

- BullMQ;
- cache;
- rate limiting;
- background jobs;
- locks.

Redis must not become the official persistence layer for business entities.

## BullMQ

BullMQ is the default queue and background job mechanism.

Workers performing critical actions must validate the current PostgreSQL state before modifying business data.

Jobs must be idempotent when applicable.

## Webhooks

Webhook implementations must consider:

- authentication or provider validation;
- idempotency;
- duplicated events;
- transactional persistence;
- retries;
- effects performed asynchronously when appropriate.

## Code Quality

- Prefer self-documenting code.
- Avoid obvious comments.
- Avoid unnecessary JSDoc.
- Avoid `any`.
- Avoid unnecessary abstractions.
- Do not silently swallow errors.
- Do not log credentials, tokens or secrets.

## Before Finishing

Check:

- migrations;
- transactions;
- authorization;
- DTO validation;
- idempotency;
- relevant tests;
- lint;
- typecheck.
