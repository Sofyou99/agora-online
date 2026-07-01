# Agora Online

A real, deployable web app that matches people live, on video, to talk through a
question together — as a duo (2 people) or a circle (up to 5). Built with:

- **Next.js 14** (App Router, TypeScript) — the web app itself
- **Supabase** — Postgres database, anonymous auth, and Realtime (Presence +
  Broadcast for WebRTC signaling, Postgres change feeds for the live lobby board)
- **WebRTC** (peer-to-peer, mesh topology) — the actual audio/video

There is no custom backend server to run or host — Supabase provides the
database, auth, and realtime signaling, and Next.js is deployed as a normal
static/serverless frontend (e.g. on Vercel).

## ⚠️ Before you start

This codebase was written and reviewed carefully, but **it has not been
installed, built, or run** — the environment that produced it has no network
access, so `npm install` / `npm run build` were never executed here. Treat
this as a complete, ready-to-run first draft rather than a tested release:
run it locally first (`npm install && npm run dev`), read any TypeScript or
build errors that come up, and fix them before deploying. Given the code's
straightforwardness, errors (if any) are most likely to be small — a typo,
a version mismatch in a dependency, that kind of thing — not structural.

## What you still need to do yourself

I can't create accounts, click through dashboards, or reach the internet
from here, so the following steps are **yours to do** — they're fully
covered in `SETUP.md`:

1. Create a free Supabase project and run `supabase/schema.sql` in it
2. Turn on **Anonymous sign-ins** in Supabase Auth settings
3. Copy your Supabase URL + anon key into `.env.local`
4. (Strongly recommended) get TURN server credentials so video calls work
   reliably across different networks
5. Push this code to a Git repository
6. Deploy it (e.g. connect the repo to Vercel) and set the same environment
   variables there
7. Test it yourself across two devices/networks before sharing it further

## Local development

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev
```

Open two different browsers (or one normal + one incognito window) at
`http://localhost:3000`, enter two different names, and try matching
yourself with yourself to confirm video connects.

## How it works

- **Lobby ("the plaza")** — `posts` and `post_participants` tables in
  Postgres. The board subscribes to Postgres changes on both tables via
  Supabase Realtime, so it updates live for everyone with no polling.
- **Seat limits & the 30-minute timer** — enforced *in the database* via
  triggers (`supabase/schema.sql`), not just in the UI, so two people can't
  race into the same last seat and the timer can't be tampered with from the
  browser.
- **Video matching** — once you're in a room, the page opens a Supabase
  Realtime channel scoped to that room. **Presence** tracks who's currently
  in the room; **Broadcast** carries WebRTC offers/answers/ICE candidates
  between everyone in the room (a full mesh — every pair of participants
  connects directly to each other, which is why group mode is capped at 5).
- **History** — private per-user rows in `session_history`, protected by
  row-level security so nobody else can read them.

## Known limitations / good next steps

- **Auth is anonymous-only.** Identity resets if someone clears their
  browser or switches devices. Adding email/password or an OAuth provider
  through Supabase Auth would let people keep a persistent identity — happy
  to build that next if you want it.
- **No moderation tools.** Before opening this to strangers publicly, you'll
  want at minimum a report/block mechanism and a terms-of-service /
  age-gate flow. This is a "you" decision as much as a build task — let me
  know what you want and I can build the mechanics.
- **Mesh video tops out around 5 people.** Beyond that, each browser is
  juggling too many simultaneous peer connections. A larger group calling
  feature would need a media server (SFU) like LiveKit or mediasoup instead
  of peer-to-peer mesh.
