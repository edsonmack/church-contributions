# Church Contributions Tracker

A multi-tenant web platform for tracking contributions (church funds, weddings, funerals, send-off parties) paid in cash or mobile money. Amounts are in Tanzanian shillings (TZS).

Stack: React (frontend), Node + Express (API), Prisma, PostgreSQL.

## Folder structure

```
church-contributions/
  backend/
    prisma/schema.prisma   database tables
    src/index.js           starter API with a health check
    package.json
    .env.example
  frontend/                React app (added in a later step)
```

## Local setup

You need Node 20 or newer and PostgreSQL installed on your machine.

1. Create the database:

   ```
   psql -U postgres -c "CREATE DATABASE contributions;"
   ```

2. Install backend packages and create your env file:

   ```
   cd backend
   npm install
   cp .env.example .env
   ```

   Open `.env` and put your real Postgres password in `DATABASE_URL`.

3. Create the tables:

   ```
   npx prisma migrate dev --name init
   ```

4. Start the API:

   ```
   npm run dev
   ```

5. Check it works by opening http://localhost:4000/api/health. You should see `{"status":"ok","database":"connected"}`.

To browse your data visually at any time, run `npm run db:studio`.

## Design decisions built into the schema

- Every table links to an Organisation, so one organiser never sees another's data.
- Payments are voided, never deleted. A void keeps the reason, who did it, and when.
- Partial payments are separate rows; the dashboard sums them per member per month.
- `paymentDate` is when money was received (backdating allowed). `createdAt` is the real entry time.
- The audit log records who changed or voided what.
- Roles: OWNER, ASSISTANT, and a MEMBER role reserved for later.

## Build order

1. Project setup and database (this step)
2. Signup and login with organisations and roles
3. Members and contribution types
4. Quick add payment, with void
5. Dashboard and reports with Excel export
6. Deploy to Railway for the pilot (see DEPLOY.md)
