# curto

![tests](https://github.com/ViniciuscLemos/url-shortener/actions/workflows/tests.yml/badge.svg)

A link shortener that also tells you who clicked: how many people, on which days, coming from where, on a phone or a computer. "Curto" is Portuguese for short.

![The page: a field to paste a link, the short link that was just made, a table of your links with their clicks, and the numbers of one link with a chart of the last 30 days](docs/page.png)

I wanted something like short.io or Bitly to see how they work inside. Making the short link is the easy part. The interesting parts are the redirect, that has to be fast and can't wait on the database, and counting clicks without counting the wrong things.

Work in progress. What works: making links (random or with a custom name), the redirect, the click counting and the stats page.

## How it works

- **Codes.** 7 random characters from 32 (letters and digits without `0 o 1 l`, which get mixed up when someone types the link by hand): about 34 billion codes, and you can't guess the next one like you could with 1, 2, 3. Everything is lower case, so `/Black-Friday` and `/black-friday` are the same link.
- **Custom names.** 3 to 32 letters, numbers or dashes. Paths the site uses (`api`, `assets`...) can't be taken. A name that already exists gets a 409, with the `ON CONFLICT DO NOTHING` deciding it in the database instead of a check before the insert that two people could pass at the same time.
- **Which links are accepted.** Only `http` and `https`. `javascript:`, `data:` and `file:` would turn a trusted looking short link into a way to attack whoever clicks. A link to this site itself is refused too, since it could loop. `example.com/page` without the `https://` gets it added, because that's how people paste.
- **302, not 301.** A browser remembers a 301 forever and stops asking the server, so the next clicks wouldn't be counted and the link could never be changed.
- **Clicks don't slow the redirect.** They wait in memory and go to the database in batches: every 2 seconds or every 200 clicks, one `INSERT` for all of them (`unnest` of arrays) and one `UPDATE` for the totals. If the database is having a bad moment, a few clicks are lost but the redirects keep working.
- **Hot links skip the database.** The last 1000 links used stay in memory, so a popular link is answered without a query.
- **Only people count.** WhatsApp, Slack, Telegram and the like open the link to draw the preview card. That isn't a click, so user agents of bots, previews and scripts are left out. From each click it keeps the day, the site it came from (just `instagram.com`, not the whole address), the kind of device and the browser. No IP.
- **The stats.** Clicks per day for the last 30 days in the São Paulo timezone (a click at 23:30 there is already the next day in UTC), with `generate_series` filling the days without clicks so the chart has no holes. Every query goes through the `(link_id, clicked_at)` index and only reads that link's rows in that window. The total is a column updated with each batch, so it never needs a `COUNT(*)` over everything.

Works on a phone and follows the system's dark mode:

<p>
  <img src="docs/phone.png" alt="The stats of a link on a phone" width="220">
  <img src="docs/page-dark.png" alt="The page in dark mode" width="520">
</p>

## API

| | |
|---|---|
| `POST /api/links` | `{"url": "...", "alias": "optional"}` → the short link (201), 400 for a bad link or name, 409 for a taken name |
| `GET /api/links/{code}` | the link, its total and the stats (`?days=` up to 90) |
| `GET /{code}` | the redirect |

## Running it

Node 22 or newer.

```bash
npm install
npm run demo
```

`npm run demo` starts an embedded PostgreSQL (npm downloads it, no Docker), adds three links with a month of clicks and opens on http://localhost:3000. Everything is gone when it stops.

With a real database:

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/curto BASE_URL=https://your.domain npm start
```

The tables are created on start (`migrations/`).

Tests, on a real Postgres too (the embedded one locally, a service container in CI):

```bash
npm test
```

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
- editing where a link goes, and turning it off
- a limit of links per IP per hour against spam
- QR code for each link
- a daily summary table, so stats over a year don't have to read every click
