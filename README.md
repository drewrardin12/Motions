# MOTIONS

A mobile-first visual routine app for Andrew and Abby’s shared household. Today is a tactile photographic card deck; each Motion opens into an immersive checklist or one-task-at-a-time Focus Mode. Rhythms organize recurring habits. Keep the established dark, cinematic design and gold accents when extending the app.

## Run locally

Requires Node 22.13+ and pnpm.

```bash
pnpm install --frozen-lockfile
pnpm exec vite --config vite.github.config.ts
```

The GitHub Pages app uses the client-only Vite entrypoint in `src/main.tsx`. The older `dev`/`build` scripts target the original Vinext/Cloudflare hosting scaffold; that scaffold references `.openai/hosting.json`, which is not included in this repository. Use the static build and its dedicated type-check configuration for this app.

## Verify

```bash
pnpm test
pnpm run typecheck
pnpm run build:github
```

The unit tests cover queued edits, delayed saves, reconnects, stable checklist identities, empty libraries, household cache isolation, and session renewal. They replace obsolete starter-screen assertions.

For browser checks, start the local Vite app in another terminal, then:

```bash
pnpm exec playwright install chromium
pnpm run test:browser
```

Alternatively use installed Chrome: `MOTIONS_TEST_BROWSER=chrome pnpm run test:browser`. Set `MOTIONS_TEST_URL` to test another local preview URL. The browser check uses two isolated phone-sized sessions and a simulated household service; it creates no production household records. It covers setup, joining, profile switching, shared completion, step rename/reorder, offline recovery, and deleting the final Motion and Rhythm. Its offline scenario disconnects the household service while keeping the local preview reachable for reload.

## Shared data and offline behavior

Supabase anonymous sessions identify each device. A private setup code connects the second device; PINs select Andrew or Abby. Motions, Rhythms, and completion records are shared through the RPC methods in `app/supabase.ts`.

`app/sync.ts` maintains a household-scoped local snapshot and persistent pending-write queue. Local changes are kept while requests run and survive reloads. Failed updates retry on reconnect, on the three-second refresh cycle, or with the visible Retry button. Cached progress is filtered by the current day or Rhythm period. A previously remembered profile can open cached data while the household connection is unavailable; selecting another profile still requires PIN verification online.

On the first open each day, Today asks which Motions the household needs. The selection is shared, can be edited with Choose Today’s Motions, and filters only the Today carousel. Completed selections move to the back in grey; All Motions remains unchanged. Selections use existing shared progress storage under a separate `plan-day:YYYY-MM-DD` period (`motion` items `include:<motion-id>` and `plan-ready`), so they do not count as completions or activity.

Empty remote libraries are authoritative. Starter Motions or Rhythms are added only through an explicit button in the empty state, preventing deleted routines from being recreated on another phone.

Each Motion carries parallel `tasks` and `taskIds` arrays. Existing steps initially keep their numeric IDs, preserving previously saved completion records. Renaming/reordering moves the ID with its step; added steps receive new IDs. Duplicate task text is supported. Removed step IDs are never reused.

### Backend contract

The migration in `db/migrations/20261009_household_sync.sql` preserves checklist IDs and adds transactional checked saving functions. Apply it before deploying this client. The checked Motion and Rhythm RPCs compare the current library with the client's last read under a household-specific transaction lock. A stale write returns `false`; the client reads again and merges pending edits before retrying. Existing household membership checks remain in place. The old saving RPCs are disabled so older clients cannot bypass these checks; refresh app copies after deploying.

Separate-item changes merge on retry. Concurrent changes to the same item follow the last successful save. Automated tests use simulated household services and do not establish live server authorization or physical two-phone behavior.

Rhythms are grouped into clearly bordered Daily, Weekly, Monthly, and Custom intervals sections. Ordering controls move tasks within their recurrence group.

The original unscoped browser caches remain untouched, but the new implementation uses `motions-household:<householdId>` for isolation. An online refresh populates the new cache on upgrade. Don’t clear site storage while changes are pending; it contains their saved local copy.

## Publish with GitHub Pages

The “Deploy MOTIONS to GitHub Pages” workflow builds `dist-github` and deploys pushes to `main`. Under Settings → Pages, use GitHub Actions as the source. The static build supports a repository subpath.

## PWA

Use the browser’s Add to Home Screen / Install app action after publishing. The service worker caches app resources from this app’s own origin; it does not cache household API responses or cross-origin personal media. Supabase reads and writes are handled by the household snapshot/queue, not the service worker. Offline access requires a prior successful visit and remembered profile.
