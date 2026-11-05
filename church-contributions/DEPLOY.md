# Putting the app online with Railway

You do this once. Allow about 45 minutes. You need a GitHub account (free) and a Railway account.

Railway runs the app and the database for you and takes the backups. You pay Railway only; check the current price at https://railway.com/pricing before you add a card.

## Part A. Check your project folder

1. Open PowerShell and go to the project folder (the one that holds `backend` and `frontend`).
2. Run: `dir backend\prisma\migrations`
3. You must see a folder whose name ends in `_init`. This folder creates the tables online. If it is missing, stop and tell Claude.

## Part B. Put the project on GitHub

Easiest way, with GitHub Desktop.

1. Install GitHub Desktop from https://desktop.github.com and sign in with your GitHub account.
2. Choose File, then Add local repository, and pick the project folder. If it says it is not a repository, click "create a repository here".
3. Look at the list of changed files on the left. You must NOT see `.env` or `node_modules`. (They are ignored on purpose.) You must see `backend/prisma/migrations`.
4. Type a summary such as `First version` and click Commit.
5. Click Publish repository. Tick **Keep this code private**. Click Publish.

## Part C. Create the Railway project

1. Go to https://railway.com and sign up with GitHub.
2. Click New Project, then Deploy from GitHub repo, and pick your repository.
3. The first build will start and will fail or crash because there is no database yet. That is expected.
4. In the same project click Create (or New), then Database, then Add PostgreSQL. Wait until it shows as running.

## Part D. Connect the app to the database

1. Click your app service (the one from GitHub), then the Variables tab.
2. Click New Variable and add these three, one at a time:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (type it exactly like this) |
   | `JWT_SECRET` | a long random text (see below) |
   | `ALLOW_SIGNUP` | `true` |

   To make the `JWT_SECRET`, run this in PowerShell and paste the result:
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   Keep a copy somewhere safe. If you lose it nothing breaks, but everyone must sign in again.

3. Railway redeploys by itself. Open the Deployments tab and wait for "Active".
4. Go to Settings, then Networking, then Generate Domain. You get an address like `something.up.railway.app`.
5. Open `https://YOUR-ADDRESS/api/health`. You should see `{"status":"ok","database":"connected"}`.

## Part E. Create your account online

The online database starts empty, so your test members and payments from your laptop are not there.

1. Open `https://YOUR-ADDRESS`. Sign up with your real name, email and a strong password, and name the organisation.
2. **Close sign-up now:** in Railway, Variables, change `ALLOW_SIGNUP` to `false`. It redeploys. After this nobody else can create an organisation.
3. In the app: Contribution types (add Monthly fee and so on), Members (use Add many to paste the list), then Team (add your assistant).

## Later

- **Your own domain:** buy a domain, then in Railway go to Settings, Networking, Custom Domain and follow the steps it shows.
- **Updating the app:** change files, then in GitHub Desktop commit and click Push origin. Railway redeploys automatically and the database keeps its data.
- **Your own copy of the data:** on the Reports tab, download the Excel file each month and keep it.
