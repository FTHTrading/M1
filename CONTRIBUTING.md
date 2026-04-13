# Contributing to M1

This repo is the home base for the FTH Trading M1 platform — documentation, the client-facing site, architecture diagrams, and platform-level decision records.

## Structure

```
M1/
├── index.html              Client-facing platform website (GitHub Pages)
├── README.md               SR-engineered technical README with Mermaid diagrams
├── platform/
│   └── README.md           Full component map — all services, repos, ports
├── docs/
│   ├── architecture.md
│   ├── compliance-controls.md
│   ├── operations-runbook.md
│   ├── provider-integration-guide.md
│   └── reconciliation-methodology.md
└── .github/
    └── workflows/
        └── pages.yml       Auto-deploy index.html to GitHub Pages
```

## GitHub Pages

The site at `index.html` is served automatically via GitHub Actions on every push to `main`.

To enable Pages on a fresh fork:
1. Go to **Settings → Pages**
2. Under **Source**, select **GitHub Actions**
3. Push any commit to `main` — the workflow deploys automatically

## Docs

All docs in `docs/` are generated from the live stablecoin-treasury-os monorepo.
To update them, copy fresh versions from `C:\Users\Kevan\stablecoin-treasury-os\docs\`.
