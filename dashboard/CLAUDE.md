# dashboard/ — React Admin Dashboard (Phase 5)

React SPA for DUSTIN admin and monitoring. Built with Vite, served from the same Bun server at `/dashboard`.

Universal rules are governed by the root `CLAUDE.md`.

## Tech Stack

- **Framework**: React 19 + React Router 7 (HashRouter)
- **Build**: Vite (outputs to `../public/dashboard/`)
- **Styling**: Tailwind v4 + DaisyUI v5 (browser CDN, loaded in `index.html`)
- **Design System**: Matches the existing Phantom theme (`phantom-light`/`phantom-dark`)

## Directory Structure

```
dashboard/
  src/
    main.tsx              — Entry point (React root)
    App.tsx               — HashRouter with Layout + page routes
    api/
      client.ts           — Fetch wrapper for /api/admin/* (cookie auth, auto-redirect on 401)
    components/
      Layout.tsx           — Navbar, mobile nav, theme toggle, Outlet
      StatusBadge.tsx       — Health status badge (ok/degraded/down)
      ConfirmDialog.tsx     — Modal confirmation for destructive actions
    hooks/
      usePolling.ts        — Generic polling hook (fetcher + interval)
    pages/
      Overview.tsx         — Health, uptime, channels, memory, evolution stats
      Config.tsx           — Model/effort selector, restart, read-only config display
  index.html              — SPA shell (DaisyUI/Tailwind CDN, theme init)
  vite.config.ts          — Build config (base: /dashboard/, proxy for dev)
  tsconfig.json           — Strict TS, React JSX, no emit
  package.json            — Deps: react, react-dom, react-router-dom
```

## Build & Dev

```bash
# Build for production (outputs to public/dashboard/)
bun run dashboard:build    # from project root
cd dashboard && bun run build  # from dashboard/

# Dev server with HMR (proxies API to localhost:3100)
cd dashboard && bun run dev
```

## Auth

- Uses the same `phantom_session` cookie as `/ui/*`
- Cookie path is `/` (set by `/ui/login` or `/dashboard?magic=TOKEN`)
- Unauthenticated requests redirect to `/ui/login`
- Magic link tokens can be consumed directly on `/dashboard?magic=TOKEN`

## API Client Convention

All API calls go through `src/api/client.ts`. It:
- Prepends `/api/admin` to all paths
- Sends `credentials: "include"` for cookie auth
- Auto-redirects to `/ui/login` on 401
- Returns typed responses

## Adding a New Page

1. Create `src/pages/NewPage.tsx` as a function component
2. Add a `<Route>` in `App.tsx`
3. Add a `<NavLink>` in `Layout.tsx` (both desktop and mobile nav)
4. If the page needs a new API endpoint, add it to `src/core/admin-api.ts` (backend) and `src/api/client.ts` (frontend)

## Styling Rules

- Use DaisyUI semantic classes (`bg-base-200`, `text-base-content`, `btn-primary`)
- Never use hardcoded hex colors
- Cards: `card bg-base-200 border border-base-300` with `card-body p-5`
- Section headers: `text-sm font-semibold uppercase tracking-wider text-base-content/60`
- Responsive: test on mobile widths, use `sm:` breakpoints

## Linting

Dashboard files are excluded from the project's biome config (different formatting conventions — spaces vs tabs). The dashboard uses its own TypeScript strict config.

## Update Protocol

Update this file when adding new pages, changing the build pipeline, modifying auth patterns, or adding new API endpoints.
