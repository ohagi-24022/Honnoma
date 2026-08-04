# 蒐集架 Shushuka

蒐集架 Shushuka is a mobile app for managing owned books, unread books, and completed books by series.
It is designed for readers who buy manga, light novels, and other multi-volume series and want to quickly see owned volumes, missing volumes, and reading status.

## Features

- ISBN barcode scanning with Expo Camera
- Book metadata lookup via OpenBD, Google Books, and optional Rakuten Books API
- Manual book registration and ISBN lookup fallback
- Series-based bookshelf view
- Missing volume detection for gaps such as volume 5 and 7 without volume 6
- Reading status management: unread, reading, read
- Bulk status updates in series detail
- Per-series favorite and new release notification settings
- Wanted manga list with score-based priority ranking
- Owned series and wanted manga ranking tab
- Supabase Auth and PostgreSQL synchronization
- Account deletion from the settings screen
- CSV and JSON export
- Light, dark, and system theme modes
- External purchase link handling for missing volumes

## Tech Stack

- React Native
- Expo SDK 54
- expo-router
- Supabase
- EAS Build
- OpenBD API
- Google Books API
- Rakuten Books API, optional

## Getting Started

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env
```

Fill in the required values:

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY=
EXPO_PUBLIC_RAKUTEN_APP_ID=
```

Start with Expo Go:

```bash
npm run start:go
```

If cache-related issues occur:

```bash
npm run start:go -- --clear
```

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon public key |
| `EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY` | Recommended | Google Books API key |
| `EXPO_PUBLIC_RAKUTEN_APP_ID` | Optional | Rakuten Web Service application ID for local development fallback |

Do not commit `.env`. Use `.env.example` as the shareable template.

For production-like Rakuten API access, deploy the Supabase Edge Function and store the Rakuten access key as a Supabase secret. Do not put the access key in `.env` or commit it to Git:

```bash
npx supabase secrets set RAKUTEN_APP_ID=your-rakuten-application-id
npx supabase secrets set RAKUTEN_ACCESS_KEY=your-rakuten-access-key
npx supabase secrets set RAKUTEN_REFERER=https://github.com/ohagi-24022/BookNest
npm run supabase:deploy:rakuten
```

The deploy script uses `--use-api`, so Docker does not need to be running.

## New Release Notifications

Deploy the notification checker Edge Function:

```bash
npm run supabase:deploy:notifications
```

The app can save Expo Push Tokens and per-series notification subscriptions to Supabase.
To run the checker on a schedule, store `project_url` and `function_key` in Supabase Vault, then run:

```sql
-- see supabase/schedules/check-new-releases.sql
```

`function_key` must be the Supabase service role key. The `check-new-releases` Edge Function rejects normal authenticated-user requests. If you use another trusted scheduler, you can also set `CHECK_NEW_RELEASES_SECRET` as a Supabase secret and send it in the `x-booknest-cron-secret` header.

The checker reads enabled `series_subscriptions`, looks up the latest volume, sends Expo push notifications, and records results in `notification_logs`.

The production notification flow is split into two phases:

- Around 11:30 JST, the server checks the latest publication by series, not by user.
- Around 12:00 JST, the server sends one generic notification per user in batches of up to 100 users.
- Notification text does not include the series title. Users can open the in-app user page to see the detailed series and volume list.
- `notification_logs` is also used as the in-app notification detail list.
- Old notification logs are pruned by the Edge Function after 90 days.

Book cover images are not copied into Supabase Storage. 蒐集架 Shushuka stores provider image URLs in `books.thumbnail_url` and renders those URLs directly, following the safer URL-cache approach for Google Books, Rakuten Books, and OpenBD metadata.

## Operations and Scale Strategy

蒐集架 Shushuka is designed to start on Supabase and keep a migration path open for heavier server-side work.

Operational logs are stored in `server_operation_logs`:

- `external-api-proxy`: Rakuten Books proxy calls from the app or server
- `external-api-call`: server-side external API calls during new release checks
- `check-new-releases`: scheduled notification batch runs

The settings screen shows a development-only diagnostics button for recent operation logs.
The Rakuten Books proxy includes a small request-rate guard so a single caller cannot repeatedly hit the proxy in a short window.

Migration should be considered when:

- Edge Function execution time or invocation count regularly approaches plan limits
- new release subscriptions grow to tens of thousands of series checks
- retry queues, detailed monitoring, or admin dashboards become necessary
- Supabase plan cost exceeds a small dedicated worker service

Preferred migration path:

1. Keep Supabase Auth and PostgreSQL as the system of record.
2. Move only server-heavy jobs, such as new release checks and API cache refreshes, to Cloud Run, Railway, Render, or another worker runtime.
3. Keep app-facing contracts stable by preserving the current Edge Function response shapes.
4. Move the entire backend only if database limits, not just batch work, become the bottleneck.

## Account Deletion

蒐集架 Shushuka supports account deletion from the settings screen.
Deletion is handled by the `delete-account` Supabase Edge Function so the service role key never needs to be stored in the app.

Deploy the function:

```bash
npm run supabase:deploy:delete-account
```

When a logged-in user deletes their account, the app removes user-scoped cloud data such as push tokens, series notification settings, notification logs, and the Supabase Auth user. Book rows are connected to the Auth user with `on delete cascade`, so they are removed with the account.

## Privacy Policy

A Japanese privacy policy is available at [`docs/privacy-policy.md`](docs/privacy-policy.md). Keep the in-app privacy policy, store listing, and public support/contact information in sync before each release.

## Supabase

Database migrations are stored in `supabase/migrations`.

Important tables and policies include:

- `books`
- Row Level Security for authenticated users
- User-scoped insert, update, delete, and select policies
- Optional unique index for preventing duplicate ISBN registration per user

## EAS

Configure EAS:

```bash
npm run eas:configure
```

Development build:

```bash
npm run eas:build:dev
```

Android preview build:

```bash
npm run eas:build:preview:android
```

Production build:

```bash
npm run eas:build:production
```

## Project Status

蒐集架 Shushuka is under active development. Current focus areas are:

- More reliable series grouping
- Better cover image retrieval for Japanese books
- Missing volume workflow improvements
- Scan confirmation and continuous registration improvements
- Wanted manga list and purchase candidate workflow improvements
- Backup import and restore workflow
