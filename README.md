# KobeSplit

Shared expenses, permanent public group links, and clear pairwise balances.

## Local development

Requires Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The Cloudflare Vite plugin runs the Worker and a persistent local D1 database. Cloudflare login is not needed for local development. `GET /api/health` checks D1 connectivity.

```sh
npm test
npm run build
```

This foundation includes the mobile-first landing page, Workers API routing, local D1 binding, and CI. Authentication and financial features will arrive in separate PRs.

## Credentials

Authentication will use `VITE_CLERK_PUBLISHABLE_KEY` in `.env.local` and `CLERK_SECRET_KEY` in `.dev.vars`. Create these files locally; all `.env*` and `.dev.vars*` files are ignored by Git. Only the publishable key may appear in frontend code.

## Deployment (not configured yet)

The database ID in `wrangler.jsonc` is a local-development placeholder. Before deployment, authenticate with `npx wrangler login`, create the production D1 database, replace the placeholder with its ID, and apply the schema migrations from the database feature PR. Run `npm run deploy` only after those steps and production authentication are configured. Local and remote databases are separate; redeploying code does not reset D1 data.

The domain has not been registered or connected. Database recovery and periodic exports must be configured before launch.

## Branches and pull requests

Each feature gets its own branch and PR. Dependent work uses stacked branches with the dependency identified in the PR. Do not merge into `main` without review and the user's instruction.

Planned PRs: foundation; authentication; groups and invitations; expenses and pairwise balances; repayments; corrections and audit history; membership management and archiving; dashboard and launch verification.

## Dependency note

`sharp` is overridden to a patched release to address a transitive security advisory in the local Cloudflare tooling. Revisit the override when Miniflare updates its dependency.
