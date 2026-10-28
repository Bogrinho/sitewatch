# SiteWatch

A website monitoring dashboard that tracks availability, response times and certificate expiry. SiteWatch combines a React interface with a Cloudflare Worker and D1 database. It is a portfolio project designed to explore full-stack development, scheduled jobs and operational monitoring.

## Features

- Manage up to 10 public HTTPS websites: add, edit, archive and restore monitors. Archived monitors retain their historical data; changing a URL starts a separate history.
- Run scheduled checks every five minutes and display status, observed response times and availability history.
- Record incidents when repeated checks fail and resolve them when a site recovers.
- Show certificate-expiry observations from the SSL Labs API when available, and flag stale observations as unavailable.
- Configure email alerts for outages, slow responses and expiring certificates, plus a weekly summary, when Gmail SMTP credentials are configured.
- Explore a demo mode with sample data, independent of the live database.
- Protect the online dashboard and API with HTTP Basic authentication; validate targets and redirects before monitoring.

## Technology

React, TypeScript, Vite and CSS for the frontend; JavaScript, Cloudflare Workers, D1 (SQLite) and Cron Triggers for the backend. The Worker uses DNS-over-HTTPS for target validation and SSL Labs for certificate observations.

## Run the demo locally

Requirements: Node.js 24 or later and npm. From the project root:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite and select **Demo**, or append `?mode=demo`. Demo mode uses sample data and does not require a database, credentials or a Cloudflare account. The default Vite proxy targets a separate local API at port 8000; use demo mode unless you have configured an API.

To build and test:

```sh
npm run build
npm run test:frontend
node --test monitor.test.mjs smtp.test.mjs targets.test.mjs
```

## Deploy your own Worker

Deployment requires a Cloudflare account, Wrangler and a D1 database. These steps create resources in your own account; check current platform limits before deployment.

1. Install the frontend dependencies and run `npm run build` to create `dist/`.
2. Copy `wrangler.example.jsonc` to `wrangler.jsonc`. Create a D1 database with Wrangler, then replace the example database ID and other variables in the copied configuration.
3. Apply the schema to your new database: `npx wrangler d1 execute sitewatch --remote --file=./schema.sql`. This schema creates an empty workspace; add websites in the dashboard after deployment.
4. Set `DASHBOARD_PASSWORD` using `npx wrangler secret put DASHBOARD_PASSWORD`. For Gmail alerts, configure `SMTP_USER` in your own configuration and set `SMTP_PASSWORD` as a Wrangler secret. Never commit either value, your real Wrangler configuration or local data.
5. Deploy with `npx wrangler deploy` and sign in using the configured `DASHBOARD_USER` and dashboard password. Set the alert recipient in the dashboard if email is enabled.

The online dashboard is intended for a single owner. Demo mode is sample data inside the interface; it is not an independently public demo when the Worker is protected. Availability percentages describe recorded checks only and do not account for missing observations. SSL data can be temporarily unavailable. Scheduled checks, external APIs and email delivery are subject to service limits and outages.

## Project structure

- `frontend/src/`: dashboard, demo data and monitor management.
- `worker.mjs`: authenticated API, scheduler, storage and notifications.
- `monitor.mjs`: status transitions and alert rules.
- `targets.mjs`: HTTPS target and redirect validation.
- `smtp.mjs`: Gmail SMTP delivery.
- `schema.sql`: database schema for a fresh workspace.
- `*.test.mjs`: backend unit tests.

## Security

This repository intentionally excludes credentials, private database exports and live configuration. HTTP Basic authentication is suitable here for a small personal dashboard but should be reconsidered for multi-user or production deployments. Monitor URLs should not contain credentials or sensitive query parameters. Keep secrets in Cloudflare secrets and rotate them if exposed.
