# ai-usage-dashboard

See your AI coding agent token usage (Claude Code, Codex, Copilot,
Qwen, …) – today, this week, this month, any day, all time, and the
current Claude 5-hour block – in a local dashboard or straight in the
terminal. Filter by agent or model. Reads the logs these tools already
keep on your machine (e.g. `~/.claude/projects`). Nothing is uploaded.

![AI Usage dashboard: usage overview, current 5-hour block, this week,
daily tokens by type and tokens per model](docs/dashboard.png)

## Quick start

You need **Node.js 20+** and a machine where you use Claude Code.

```sh
git clone https://github.com/OmarOsmanSN/ai-usage-dashboard.git
cd ai-usage-dashboard
npm ci
```

No global install needed: `npm ci` puts the pinned ccusage version
inside this folder and the app uses only that copy. A global
`npm install -g ccusage` is ignored.

**Numbers in the terminal:**

```sh
npm run report                          # all agents: today, week, month, all time
npm run report -- --agent claude        # one agent (claude, codex, copilot, qwen…)
npm run report -- --model claude-opus-5-5   # one model
npm run report -- --day 2026-10-22      # add a specific day
npm run report -- --online              # latest prices (fetches price list)
```

Unknown agent or model names print the list of available ones.

**Dashboard in the browser:**

```sh
npm start
```

Open <http://127.0.0.1:4317>. Stop with `Ctrl+C`.

Different port: `PORT=5000 npm start` (macOS/Linux) or
`$env:PORT=5000; npm start` (Windows PowerShell).

## What you see

- **Agent and model filters (header):** all agents or one (Claude
  Code, Codex, Copilot, Qwen, …), all models or one. Every section
  follows the filter except the 5-hour block and peak cards, which are
  Claude Code only.
- **Usage overview:** pick *Today*, *This week* (Mon–Sun), *This month*
  a specific *Day* or *All time*. Shows total, output, cache-read share,
  estimated cost and the exact count per token type.
- **5-hour block (local estimate):** active/idle, time left, tokens,
  cost, burn rate, projection. This is ccusage's estimate, not your
  real limit: it rounds the start down to the full hour, only sees
  Claude Code logs on this computer (not claude.ai or other devices),
  and does not know your plan's limits. For the real reset time and
  % used, see claude.ai → Settings → Usage or `/usage` in Claude Code.
- **This week:** tokens per day (Mon–Sun) and change vs last week to
  the same weekday.
- **Charts:** daily tokens by type (30 days), tokens per model, monthly
  trend.
- **Peak vs off-peak:** tokens used Mon–Fri 05:00–11:00 Pacific time
  vs the rest, counted per clock hour (1-hour ccusage blocks), DST-aware.
- **Detail table:** per day, agent and model; sortable, date filter,
  CSV export.
- **Controls:** price list (built-in / latest online), Auto / Light /
  Dark theme.

Dates use Europe/Stockholm.

### How is the cost calculated?

Per model: `input × input price + output × output price + cache write ×
cache-write price + cache read × cache-read price`, using the public
LiteLLM model price list.

- **Prices: built-in list** (default) – the copy shipped inside
  ccusage. No network, but newer models show "Unpriced".
- **Prices: latest online** – ccusage downloads the current list.

It is what the usage would cost on the pay-as-you-go API, not your
subscription bill.

### Peak hours

From March 2026 Anthropic counted usage on weekdays 05:00–11:00 Pacific
faster against 5-hour session limits. Third-party reports say Claude
Code on Pro/Max is exempt since 6 May 2026; check Anthropic's help
center for your plan. The section is informational.

### Why is "cache read" so large?

Every Claude Code turn re-sends the whole conversation. The repeated
part is served from Anthropic's prompt cache and logged as
`cache_read_input_tokens` (billed at ~10% of the input price). So 90%+
cache read is normal for long sessions. The numbers here match the raw
logs exactly (checked by re-summing the JSONL files for a day).

## Development

```sh
npm test    # unit tests (node:test, no extra deps)
```

Pinned dependencies (`npm ci` installs exactly these):

- `ccusage@20.0.26` – reads the local Claude Code logs.
- `chart.js@4.5.1` – chart library, served locally (no CDN).

`.npmrc` sets `save-exact=true` and `ignore-scripts=true`.

## API

The dashboard calls these with `scope=all` (adds `--by-agent`).
All endpoints are `GET`, return JSON, and accept optional
`since=YYYYMMDD`, `until=YYYYMMDD`, `offline=0|1` (default 1) and
`scope=claude|all` (default `claude`).

| Endpoint        | ccusage command                 |
| --------------- | ------------------------------- |
| `/api/daily`    | `claude daily --breakdown`      |
| `/api/monthly`  | `claude monthly --breakdown`    |
| `/api/session`  | `claude session --breakdown`    |
| `/api/blocks`   | `claude blocks`                 |
| `/api/hourly`   | `claude blocks --session-length 1` |

With `scope=all` the `claude` prefix is dropped (unified multi-agent
reports). Every run adds `--json --timezone Europe/Stockholm`.
Responses are normalized so each row has a `period` field
(`date` / `month` / `sessionId` in the Claude-only output).

## Security notes

- Binds to `127.0.0.1` only. Requests whose `Host` header is not
  `127.0.0.1:PORT` or `localhost:PORT` get 403 (DNS-rebinding guard).
- Only `GET`/`HEAD`. No CORS headers. Strict CSP
  (`default-src 'self'`), `nosniff`, `no-referrer`, `frame-ancestors
  'none'`.
- ccusage runs via `execFile(process.execPath, [cli.js, ...])` – no
  shell, no `npx`, no `@latest`. Commands come from a fixed whitelist;
  query values are validated (strict date check, unknown or duplicate
  params rejected) before they become arguments.
- 30 s timeout per run, 64 MB output cap, 60 s in-memory cache
  (parallel requests share one run; failures are not cached).
- Errors are returned as `{ "error": "..." }`, never stack traces.
- Static files are served from an explicit whitelist; URL paths are
  never joined into filesystem paths.
- The UI builds DOM with `textContent` only; CSV export guards against
  spreadsheet formula injection.

## Upgrading ccusage safely

1. Check the publish date is at least 14 days old:
   `npm view ccusage time --json` – pick a version older than 14 days.
2. Check provenance: on the npm package page the version should show
   "Built and signed on GitHub Actions" (trusted publisher). Locally:
   `npm audit signatures` after installing.
3. Read the release notes / diff on GitHub for the versions you skip.
4. Install exactly: `npm install --save-exact ccusage@<version>`.
5. Re-check JSON shapes before trusting the dashboard:
   `node node_modules/ccusage/src/cli.js claude daily --breakdown
   --json --offline` and compare with the fields in `lib/ccusage.js`
   and `public/data.js`. Run `npm test`.
6. Commit `package.json` and `package-lock.json` together.

Apply the same rule to `chart.js` (4.6.1 was skipped because it was
only one day old when this project was set up).

## Notes and assumptions

- ccusage 20 reports **all detected agents** (Claude, Codex, Copilot,
  Qwen, …). The dashboard loads the unified reports with `--by-agent`
  and filters in the browser; Claude-only totals match
  `ccusage claude daily` exactly.
- **History is only as long as your logs.** Claude Code deletes session
  logs older than 30 days by default, so "All time" and older days
  shrink over time. To keep more history, set e.g.
  `"cleanupPeriodDays": 365` in `~/.claude/settings.json`.
- Offline pricing may not know the newest models. Those show
  "Unpriced" (never `$0`); switch to "Prices: latest online" to fetch
  current prices.
- Block costs come from ccusage `costUSD`; a block that used an
  unpriced model is flagged "+ unpriced".

## License

[MIT](LICENSE) © 2026 Omar Osman
