# Cache Explorer Design System

## Product Context

Cache Explorer is an engineering workbench for modeling cache and hardware behavior from source code. The experience should feel like a dense lab instrument: fast, precise, repeatable, and built for comparison. Avoid marketing-page composition and decorative hero treatment.

## Visual Direction

- Use a quiet graphite workspace, not a neon lab-console theme.
- Primary accent: muted blue via `--phosphor`, used for focus, selected rows, and primary actions.
- Supporting signal colors: sage for modeled/success, olive for good, amber for caution, softened red for critical.
- Surfaces: `--void`, `--panel`, `--surface`, and `--elevated` should feel layered but not black-on-black.
- Typography: system sans for UI chrome; JetBrains Mono only for code, values, and reproducible command text.
- Radii stay compact but less severe: 3px, 6px, 8px.
- Density is a feature. Prefer scannable rows, compact controls, tables, chips, badges, and panel headers over roomy cards.
- Avoid generated-dashboard tells: excessive uppercase, wide letter spacing, glowing accents, and one-note teal/purple gradients.

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
