# Cache Explorer Design System

## Product Context

Cache Explorer is an engineering workbench for modeling cache and hardware behavior from source code. The experience should feel like a dense lab instrument: fast, precise, repeatable, and built for comparison. Avoid marketing-page composition and decorative hero treatment.

## Visual Direction

- Use the existing dark console palette.
- Primary accent: `--phosphor` teal `#4ec9b0`.
- Supporting signal colors: green `#b5cea8`, yellow `#dcdcaa`, red `#f14c4c`.
- Surfaces: `--void`, `--panel`, `--surface`, and `--elevated`.
- Typography: JetBrains Mono for display/code, IBM Plex Mono for body.
- Radii stay compact: 2px, 4px, 6px.
- Density is a feature. Prefer scannable rows, compact controls, tables, chips, badges, and panel headers over roomy cards.

## Layout Rules

- First screen is the product workspace: header, settings toolbar, examples sidebar, editor, and results panel.
- Cards are for repeated items, modal rows, and framed data panels only.
- Do not put cards inside cards.
- Use full-width modal bands or dense split panes for complex flows.
- Preserve stable dimensions for toolbars, buttons, grids, and status bars so progress/status text does not shift layout.

## Interaction Patterns

- Buttons: compact text buttons for clear commands; icon-style buttons only where the symbol is familiar and has a tooltip/title.
- Selects: use the existing `StyledSelect` pattern for toolbar choices.
- Toggles: use existing active-state buttons or checkboxes.
- Progress: status bar progress should be bounded and never resize the footer.
- Modals: use shared `.batch-modal-*` shell classes.

## Product Priorities

- Make result fidelity and provenance visible.
- Make verified workload status, history, and regressions easy to scan.
- Explain unavailable or degraded hardware/model fields in-place.
- Keep reproducible commands and exports close to results.
- Do not add instructional marketing copy inside the app; use concise operational labels.
