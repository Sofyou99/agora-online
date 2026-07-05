# Setup & Deployment Guide

Everything in this file requires a browser, an account, or a decision only
you can make — I can't do any of it from here (no network access, and some
of it needs your identity/payment details anyway). Follow it in order.

---

## 1. Create your Supabase project

1. Go to https://supabase.com and sign up / log in (free tier is enough to start).
2. Click **New project**. Pick any name and a database password (save the
   password somewhere — you likely won't need it again, but keep it safe).
3. Wait ~2 minutes for it to provision.

## 2. Run the database schema

1. In your new project, open the **SQL Editor** (left sidebar).
2. Open `supabase/schema.sql` from this project, copy the whole file, paste
   it into the SQL editor, and click **Run**.
3. You should see "Success. No rows returned." If you see an error, read it
   carefully — it's most likely a copy/paste issue (make sure you copied the
   entire file) or the script partially ran before — re-running it is safe.

## 3. Turn on anonymous sign-ins

The app signs people in anonymously (just a name, no email/password) so
there's no friction to jumping into a conversation.

1. In Supabase: **Authentication → Sign In / Providers**.
2. Find **Anonymous Sign-Ins** and turn it **on**.
3. Save.

## 4. Get your API keys

1. In Supabase: **Project Settings → API**.
2. Copy the **Project URL** and the **anon public** key (not the
   `service_role` key — that one must never go in frontend code).
3. In this project, copy `.env.example` to `.env.local` and paste them in:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

## 5. (Strongly recommended) Set up a TURN server

WebRTC needs a way for two people's browsers to find a path to each other.
**STUN** (already built into this app, free, no signup) works when at least
one side is on a fairly open network — typically fine for two people both
on home wifi. It **fails** when both sides are behind strict NATs/firewalls,
which is common on corporate networks, school networks, and some mobile
carriers. **TURN** is a relay server that fixes this — without one, some
meaningful fraction of your users will simply never connect.

Pick one:

**Option A — Cloudflare Calls (has a usable free tier)**
1. Sign up at https://developers.cloudflare.com/calls/
2. Create a TURN app in the Cloudflare dashboard under **Calls**.
3. It'll give you a TURN URL, a username, and a credential (sometimes as a
   short-lived token you generate via their API — follow their current
   docs, since exact steps change).

**Option B — Twilio Network Traversal Service**
1. Sign up at https://www.twilio.com (requires a phone number + payment
   method, though there's a free trial credit).
2. Under **Programmable Voice → Network Traversal Service**, generate TURN
   credentials via their API or dashboard.

**Option C — Run your own coturn server**
- More setup work, but no per-minute costs and no third-party account
  needed beyond a small VPS (e.g. $5-6/mo droplet). Search "coturn setup
  guide" for current instructions — it's a well-documented, standard piece
  of open-source software.

Whichever you choose, add the values to `.env.local` (and later to your
Vercel project's environment variables):

```
NEXT_PUBLIC_TURN_URL=turn:your-turn-host:3478
NEXT_PUBLIC_TURN_USERNAME=...
NEXT_PUBLIC_TURN_CREDENTIAL=...
```

You can skip this step to launch faster and add it later — the app works
without it, just less reliably across networks.

## 6. Run it locally and actually test it

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in two different browser windows (e.g. one
normal, one incognito), enter two different names, open a Duo conversation
in one, join it from the other, and confirm video connects both ways.
Fix any errors you hit — see the note at the top of `README.md`.

## 7. Put the code in a Git repository

If you don't already have one:

```bash
git init
git add .
git commit -m "Agora Online"
```

Then create a repo on GitHub (or GitLab/Bitbucket) and push to it. GitHub's
own "create a new repository" page gives you the exact commands for your
situation.

## 8. Deploy the frontend

**Vercel is the easiest path for a Next.js app:**

1. Go to https://vercel.com, sign up/log in, click **Add New → Project**.
2. Import your Git repository.
3. In the project's **Environment Variables** settings, add the same
   variables from your `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_TURN_URL` / `NEXT_PUBLIC_TURN_USERNAME` /
     `NEXT_PUBLIC_TURN_CREDENTIAL` (if you set up TURN)
4. Click **Deploy**. Vercel will build and host it, and camera/mic access
   will work automatically since Vercel serves everything over HTTPS
   (required by browsers for `getUserMedia`).

Any Next.js-friendly host works the same way in principle (Netlify,
Cloudflare Pages, your own server with `npm run build && npm run start`) —
Vercel is just the path of least resistance since Next.js is made by the
same company.

## 9. Optional: a custom domain

In your Vercel project: **Settings → Domains**, add your domain, and follow
the DNS instructions Vercel shows you (usually adding a CNAME or A record
at your domain registrar). This part is entirely between you, Vercel, and
your registrar — I can't touch DNS from here either.

## 10. Before opening this up publicly

A few things worth deciding before real strangers start using this:

- **Terms of use / code of conduct** — what's not allowed, and what happens
  if someone violates it.
- **Reporting/blocking** — right now there's no way to report a bad actor
  from inside a call. Worth adding before wide release.
- **Age gating** — decide your minimum age and how (if at all) you'll
  enforce it.
- **Rate limiting / abuse prevention** — e.g. stopping one person from
  spamming the board with dozens of posts.

None of these are hard to build — just say the word and I'll build whichever
of these you want next, following the same pattern as the rest of the app.
