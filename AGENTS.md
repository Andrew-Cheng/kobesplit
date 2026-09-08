# Development workflow

- Use a feature branch and open a pull request for each independently reviewable feature.
- Keep foundation, authentication, groups/invitations, accounting, and history/management in separate PRs.
- Do not commit directly to main or merge a PR without the user's instruction.
- For dependent features, use stacked branches and state their base PR clearly.
- Keep local credentials in ignored `.env.local` and `.dev.vars` files. Never print or commit keys.
- Verify each PR with `npm test` and `npm run build`.
