# Extractable Components

## Header

- Source: `frontend/src/components/Header.tsx`
- Category: layout
- Description: Main title bar with logo, theme toggle, workload/hardware/experiment actions, compare state, and run/cancel CTA.
- Extractable props: `theme`, `diffMode`, `isLoading`, `stage`, `hasResult`, `hasBaseline`
- Hardcoded: Cache Explorer logo mark, action labels, button class names.

## SettingsToolbar

- Source: `frontend/src/components/SettingsToolbar.tsx`
- Category: layout
- Description: Dense target/fidelity/options toolbar beneath the header.
- Extractable props: `config`, `optLevel`, `prefetchPolicy`, `fastMode`, `cacheSegments`, `sampleRate`, `eventLimit`, `showMore`
- Hardcoded: option layout, toolbar labels, define presets.

## EditorPanel

- Source: `frontend/src/components/EditorPanel.tsx`
- Category: layout
- Description: Monaco editor area with file tabs, diff branch, loading progress, status indicators, and target metadata.
- Extractable props: `language`, `theme`, `diffMode`, `isLoading`, `stage`, `progress`, `config`, `vimMode`
- Hardcoded: status bar structure, progress bar classes, editor framing.

## ResultsPanel

- Source: `frontend/src/components/ResultsPanel.tsx`
- Category: layout
- Description: Right-side result shell with exports, error/loading/empty states, result panels, and detail toggles.
- Extractable props: `hasResult`, `hasError`, `isLoading`, `diffMode`, `showDetails`, `copied`, `targetSummary`
- Hardcoded: result panel order, action labels, empty-state composition.

## WorkloadCatalogModal

- Source: `frontend/src/components/WorkloadCatalogModal.tsx`
- Category: layout
- Description: Verified workload browser with search, status filters, target filter, sorting, verification summary, rows, variants, checks, and experiment action.
- Extractable props: `loading`, `verifying`, `hasWorkloads`, `hasVerification`, `statusFilter`, `targetFilter`, `sortBy`
- Hardcoded: filter labels, row hierarchy, modal shell classes.

## HardwareExplorerModal

- Source: `frontend/src/components/HardwareExplorerModal.tsx`
- Category: layout
- Description: Hardware profile browser and run-set matrix with highlights, profile details, export actions, and profile selection.
- Extractable props: `loading`, `selectedId`, `activeId`, `runConfigIds`, `hasError`
- Hardcoded: diff columns, action labels, profile row layout.
