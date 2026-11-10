# trail

![tests](https://github.com/ViniciuscLemos/url-shortener/actions/workflows/tests.yml/badge.svg)

A link shortener that also tells you who clicked: how many people, on which days, coming from where, on a phone or a computer. The name is for that part: every click leaves a trail.

Try it: **[trail-sfqz.onrender.com](https://trail-sfqz.onrender.com)** (free instance, the first visit after a while takes a few seconds to wake up).

![The page: a field to paste a link, the short link that was just made, a table of your links with their clicks and a small bar chart of the last week, and the numbers of one link with a chart of the last 30 days](docs/page.png)

I wanted something like short.io or Bitly to see how they work inside. Making the short link is the easy part. The interesting parts are the redirect, that has to be fast and can't wait on the database, and counting clicks without counting the wrong things.

Work in progress. What works: making links (random or with a custom name), the redirect, the click counting, the stats page, a QR code for each link, changing or deleting a link later from the browser that made it, an end date, and every click as a CSV.

## How it works

- **Codes.** 7 random characters from 32 (letters and digits without `0 o 1 l`, which get mixed up when someone types the link by hand): about 34 billion codes, and you can't guess the next one like you could with 1, 2, 3. Everything is lower case, so `/Black-Friday` and `/black-friday` are the same link.
- **Custom names.** 3 to 32 letters, numbers or dashes. Paths the site uses (`api`, `assets`...) can't be taken. A name that already exists gets a 409, with the `ON CONFLICT DO NOTHING` deciding it in the database instead of a check before the insert that two people could pass at the same time.
- **Which links are accepted.** Only `http` and `https`. `javascript:`, `data:` and `file:` would turn a trusted looking short link into a way to attack whoever clicks. A link to this site itself is refused too, since it could loop. `example.com/page` without the `https://` gets it added, because that's how people paste.
- **302, not 301.** A browser remembers a 301 forever and stops asking the server, so the next clicks wouldn't be counted and the link could never be changed.
- **Clicks don't slow the redirect.** They wait in memory and go to the database in batches: every 2 seconds or every 200 clicks, one `INSERT` for all of them (`unnest` of arrays) and one `UPDATE` for the totals. If the database is having a bad moment, a few clicks are lost but the redirects keep working.
- **A limit against spam.** One IP can make 20 links every 10 minutes; after that it gets a 429 with how long to wait. A shortener without a limit becomes a free tool to hide spam links.
- **Changing a link later, without accounts.** Making a link gives back a secret token, once, and the page keeps it in the browser. With it the link can point somewhere else (going through the same checks as a new one) or be turned off, which answers `410 Gone` with a page that says so, and stops counting. Only a SHA-256 of the token is stored and it's compared in constant time. The copy of the link kept in memory is dropped on every change, otherwise people would keep landing on the old address.
- **Deleting.** With the same token, a link can also go for good, clicks and all (`ON DELETE CASCADE` takes its clicks and daily rows with it). The page asks once, in place, saying how many clicks go with it, instead of a pop-up. The name is free again afterwards, so `black-friday` can be made again next year. Clicks still waiting in memory for a link that was just deleted are skipped by the next batch instead of making the whole batch fail.

<img src="docs/delete.png" alt="The page of a link with the question before deleting it: anyone who opens it will get not found, with 'Yes, delete it' and 'Keep it'" width="620">

- **An end date.** A link can be made to work until a date: the Black Friday link that shouldn't keep sending people to a sale that ended. A plain date means the end of that day in São Paulo, which is what people mean by "until the 1st". After it the link answers `410` with a page saying it ended, and stops counting. The date can be changed or cleared later, and the copy of the link kept in memory knows the date too, so a popular link doesn't keep working past it.
- **Every click as a CSV.** The owner can download every click of a link (time, where from, device, browser) to open in a spreadsheet. The numbers page is public, the list of every visit isn't, so this one needs the token. A value starting with `=`, `+`, `-` or `@` gets a `'` in front, because a referrer can be anything someone sends and a spreadsheet would run it as a formula.

<img src="docs/owner.png" alt="The page of a link with its end date, the field to send it somewhere else, the end date picker, turn off, every click as CSV and delete for good" width="620">

- **Your links in one request.** The list of links made in this browser asks for all of them at once (`GET /api/links?codes=a,b,c`), with each one's total and its clicks on each of the last 7 days, drawn as seven thin bars next to the number. Enough to see at a glance which links are still being used. A code that doesn't exist anymore just isn't in the answer, and the page drops it from the list.
- **QR code.** Every link has one (`/api/links/{code}/qr.svg`), for a poster or the menu on a restaurant table. It holds the short link, not the long one, so the scans are counted like any other click.
- **Hot links skip the database.** The last 1000 links used stay in memory, so a popular link is answered without a query.
- **Only people count.** WhatsApp, Slack, Telegram and the like open the link to draw the preview card. That isn't a click, so user agents of bots, previews and scripts are left out. From each click it keeps the day, the site it came from (just `instagram.com`, not the whole address), the kind of device and the browser. No IP.
- **The stats.** Clicks per day for the last 30 days in the São Paulo timezone (a click at 23:30 there is already the next day in UTC), with `generate_series` filling the days without clicks so the chart has no holes. Every query goes through the `(link_id, clicked_at)` index and only reads that link's rows in that window. The total is a column updated with each batch, so it never needs a `COUNT(*)` over everything. The chart doesn't count clicks either: each batch also adds to a `link_days` table (one row per link per day, an `INSERT ... ON CONFLICT DO UPDATE`), and the 30 days are 30 small rows from there. A link with a million clicks draws as fast as one with ten.

Works on a phone and follows the system's dark mode:

<p>
  <img src="docs/phone.png" alt="The stats of a link on a phone" width="220">
  <img src="docs/page-dark.png" alt="The page in dark mode" width="520">
</p>

## API

| | |
|---|---|
| `POST /api/links` | `{"url": "...", "alias": "optional", "expiresAt": "optional, 2026-12-01"}` → the short link (201) with its `ownerToken`, 400 for a bad link or name, 409 for a taken name |
| `PATCH /api/links/{code}` | `Authorization: Bearer <ownerToken>` and `{"url": "..."}`, `{"disabled": true}` or `{"expiresAt": "..." / null}` → the link; 403 without the right token |
| `GET /api/links/{code}/clicks.csv` | same token → every click as CSV |
| `DELETE /api/links/{code}` | same token → 204, the link and its clicks are gone |
| `GET /api/links?codes=a,b,c` | up to 50 links at once, each with its total and `week` (clicks on each of the last 7 days); unknown codes are left out |
| `GET /api/links/{code}` | the link, its total and the stats (`?days=` up to 90) |
| `GET /api/links/{code}/qr.svg` | the QR code of the short link |
| `GET /{code}` | the redirect (410 when the link is turned off) |

## Running it

Node 22 or newer.

```bash
npm install
npm run demo
```

`npm run demo` starts an embedded PostgreSQL (npm downloads it, no Docker), adds three links with a month of clicks and opens on http://localhost:3000. Everything is gone when it stops.

With a real database:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/trail BASE_URL=https://your.domain npm start
```

The tables are created on start (`migrations/`).

Tests, on a real Postgres too (the embedded one locally, a service container in CI):

```bash
npm test
```

## Putting it online

It runs on Render's free plan (`render.yaml`), with the database on a free [Neon](https://neon.tech) Postgres, since Render's free database is deleted after 30 days.

1. Create a project on Neon and copy the connection string (`postgres://...?sslmode=require`).
2. On Render, New > Blueprint, pick this repo, and paste the string in `DATABASE_URL`. The short links use the `onrender.com` address Render gives the service; `BASE_URL` is only for a custom domain.

`DEMO_SEED=true` (already in the blueprint) adds the example links with a month of clicks, and the page shows them to anyone who hasn't made a link yet. `GET /health` is there for Render's health check.

The free instance sleeps after 15 minutes without visits, so the first link opened after that takes a few seconds.

## How the code is split

```
src/links.ts    codes, custom names and which links are accepted
src/clicks.ts   who's a person, device, browser, referrer, and the batch queue
src/stats.ts    the stats queries
src/app.ts      routes (Fastify) and the cache of hot links
public/         the page, plain HTML, CSS and JS
```

## What's next

- a login, so "your links" lives in an account instead of the browser
