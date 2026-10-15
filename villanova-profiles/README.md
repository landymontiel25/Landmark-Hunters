# Villanova Profiles

A Next.js (App Router), TypeScript and Tailwind app. Students sign in with Supabase Auth using an
`@villanova.edu` email and a 6-digit code, then fill in a profile: name, year, major, bio and one photo.
The app ships with no sample users or seed data.

## How sign-up works

1. You enter a `@villanova.edu` address. The app rejects anything else.
2. Supabase emails a 6-digit code. A first sign-in creates the account.
3. You enter the code and land on your profile page.

The domain rule lives in two places. The app checks it before sending a code, and a database
trigger (`supabase/schema.sql`) rejects any new `auth.users` row that is not `@villanova.edu`. The
trigger holds even when someone calls the Supabase Auth API directly.

## Setup

Requires Node 22 and a free [Supabase](https://supabase.com) project.

### 1. Install

```bash
cd villanova-profiles
npm install
```

### 2. Create the database objects

In the Supabase dashboard, open **SQL Editor**, paste the contents of `supabase/schema.sql` and run it.
It creates:

- the `@villanova.edu` sign-up trigger
- the `profiles` table with row-level security (each person reads and edits only their own row)
- the public `avatars` storage bucket, limited to 5 MB JPG, PNG or WebP, with policies that let each
  person write only to `<their user id>/avatar`

### 3. Configure email codes

In **Authentication > Providers > Email**:

- Turn on **Enable Email provider** and **Confirm email**.
- Set **Email OTP Length** to `6`.

In **Authentication > Email Templates**, edit the **Magic Link** template (Supabase sends it for
`signInWithOtp` when the account already exists) and the **Confirm signup** template (used for a first
sign-in). Put the code in the body of both:

```html
<h2>Your Villanova Profiles code</h2>
<p>Enter this code to continue: <strong>{{ .Token }}</strong></p>
```

Leave out `{{ .ConfirmationURL }}` so the email shows a code and no link.

Supabase's built-in email sender allows only a few messages per hour. For real use, add your own SMTP
provider under **Project Settings > Authentication > SMTP Settings**.

### 4. Add environment variables

```bash
cp .env.example .env.local
```

Fill in both values from **Project Settings > API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

The anon key is safe in the browser because row-level security guards the data. Never put the
`service_role` key in this app.

### 5. Run it

```bash
npm run dev
```

Open <http://localhost:3000>, sign in with your own `@villanova.edu` address and save a profile.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm test` | Run unit tests for email, code, profile and photo checks |
| `npm run typecheck` | TypeScript check |

## Deploy

This app is its own Vercel project, separate from the Landmark Hunters app.

1. In Vercel, choose **Add New > Project** and import the `landymontiel25/Landmark-Hunters` repo.
2. Set **Root Directory** to `villanova-profiles`. Vercel detects Next.js.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` under **Environment Variables**.
4. Deploy. `vercel.json` skips builds when a commit leaves this folder unchanged and turns off previews for `claude/*` branches.
5. In Supabase, set **Authentication > URL Configuration > Site URL** to the Vercel URL.

## Project layout

```
app/                 Pages and server actions (login, profile, sign out)
lib/validation.ts    Email, code, profile and photo rules (unit tested)
lib/supabase/        Server-side Supabase client
proxy.ts             Refreshes the session and guards /profile
supabase/schema.sql  Trigger, table, storage bucket and security policies
```
