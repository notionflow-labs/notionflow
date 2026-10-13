# NotionFlow

Turn meeting notes and project briefs into a draft you can review, edit and save in Notion.

Claude extracts decisions, tasks and open questions. The editor shows source excerpts alongside tasks and decisions. You can correct owners and dates, download Markdown or JSON, or explicitly save the reviewed draft to a connected Notion sandbox.

Preview access: contact@notionflow.app. Hosted preview URLs are not published in this repository.

- [Recorded Claude-to-Notion check](examples/verified-run.json)

## Run locally

Public source access is for inspection. Obtain permission before copying or running your own instance; see [COPYRIGHT](COPYRIGHT). Requires Node.js 22 or newer. PowerShell, macOS and Linux shells can run the same commands.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:4320/app/. The saved example works without credentials. It is a fixed draft, not a live AI response. You can switch views, edit it and export files.

```sh
npm run check
npm test
```

Tests mock provider responses and do not spend API credits or write to Notion.

## Process your own document with Claude

Copy `.env.example` to `.env`, then configure:

```dotenv
ANTHROPIC_API_KEY=your-server-side-key
DEMO_ACCESS_TOKEN=your-long-random-access-code
LIVE_DEMO_ENABLED=true
```

Restart `npm run dev`, choose **Your document**, enter your access code and paste notes or upload TXT, Markdown or PDF. Never enter an API key in the browser. Text is limited to 30,000 characters; PDFs to 1 MB, with about ten pages recommended.

The server calls Claude's Messages API with a JSON schema. Text task/decision excerpts must match the source; unmatched items are removed with a warning. An excerpt match does not prove the interpretation or deadline is correct. PDF excerpts need manual review. The default model is `claude-sonnet-4-6`, configurable server-side.

## Connect a Notion sandbox

1. Create an internal Notion integration with read and insert permissions.
2. Create a dedicated parent page and grant the integration access through its Connections menu.
3. Add `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID` and `LIVE_NOTION_ENABLED=true` to `.env`.
4. Restart the server. Review a draft, check the publishing confirmation and select **Create Notion page**.

The app creates a new page, optionally with a task database containing owners, dates and excerpts. It does not overwrite the source. A result link requires Notion viewing permission; saving does not make the page public. Import is limited to 100 blocks, three levels and 30,000 characters, and reports skipped content.

The hosted preview uses NotionFlow's shared sandbox, not a visitor's personal workspace. The operator can see saved content. Use non-sensitive test notes. Personal-workspace OAuth is implemented separately and needs a public Notion connection and session storage configured before it is enabled. Document history and batch processing are not implemented.

Notion API version: `2025-09-03`. Publishing is not idempotent across requests. If a timeout or partial database failure occurs, inspect the destination before retrying: a page may already exist.

## Connect a visitor’s own workspace

Create a **public connection** in the Notion Developer portal with installation scope **Any workspace** and read/insert content capabilities. Follow Notion’s public-connection review requirements. Configure the exact API-host callback path `/api/notion/callback` in both Notion and `NOTION_OAUTH_REDIRECT_URI`; no preview hostname is published here.

Set `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET` and `NOTION_SESSION_KEY` server-side. The session key is 32 random bytes as 64 lowercase hex characters. On Workers, bind a D1 database as `NOTION_DB` and apply `migrations/0001_notion_sessions.sql`. Keep account IDs, bindings for private deployments and secrets outside public source. Local development uses an in-memory store and loses connections when restarted.

Select **My Notion workspace**, enter the preview access code, connect through Notion, then load shared pages and select a destination. Notion authorization only grants access to selected pages. New page grants may take time to appear in search. Import uses the selected connection; publishing validates access to the parent before creating a page. A missing or revoked personal connection never falls back to the demo sandbox.

Tokens are encrypted with AES-GCM in server-side storage; browser cookies contain random identifiers. Authorization state is browser-bound and consumed atomically in D1. Sessions last up to 24 hours; expired credentials require reconnection rather than automatic token refresh. Expired storage records are deleted on the next connection attempt. Disconnect removes the local session and attempts provider revocation, with a warning if revocation fails. Drafts are not stored in the session database.

The OAuth tests use simulated provider responses; a real public-connection login still requires operator configuration and verification. The existing recorded sandbox check is not evidence of a successful personal-workspace OAuth test.

## How the code fits together

```text
Browser editor -> /api/generate -> Claude -> editable draft
Reviewed draft -> /api/notion/publish -> Notion page + task database
Notion page -> /api/notion/read -> source text
Browser editor -> Markdown / JSON download (no server call)
```

- `public/`: website, guide, legal pages and editor.
- `src/document.mjs`: output schema, excerpt checks, exports and Notion page payloads.
- `src/worker.mjs`: authentication, request validation, Claude and Notion calls.
- `src/notion-oauth.mjs`: browser-bound authorization, encrypted sessions and disconnection.
- `migrations/`: D1 session schema.
- `src/preview-worker.mjs`: password protection and crawler blocking for private previews.
- `server.mjs`: local Node server using the same backend.
- `test/`: mocked workflow and private-preview tests.

## Verification

A recorded hosted check used Claude Sonnet 4.6 to extract two tasks, saved the page and task database in Notion, and read the page back. `examples/verified-run.json` contains the synthetic input, returned draft, usage and a sanitized verification summary. It is a historical result, not a response generated from the current visitor's input.

The protected preview has also been checked on desktop and mobile. JSON and Markdown downloads saved successfully in the reviewed browser environment. These checks do not establish production reliability or exhaustive model accuracy.

## Rights and contact

This repository contains NotionFlow's document-to-Notion implementation. It does not import the previous domain operator's proprietary code, customers or operating history. NotionFlow is independent of Notion Labs and Anthropic.

All rights reserved. Publishing this repository does not grant an open-source license. Third-party dependencies retain their own licenses.

Questions, evaluation permission or preview access: contact@notionflow.app.
