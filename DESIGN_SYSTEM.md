# Mosaic Design System

The Mosaic UI follows the **Atlassian Design System (ADS)** language: a neutral
canvas, white cards with crisp hairline borders, a single confident blue brand
accent, tight uniform corners, and clear status lozenges. It is the product's
**default** theme (`palette = 'mosaic'`). Fluent and Aubergine remain selectable
alternates; everything below is about the default.

> **The one rule:** style from **tokens**, never from literal colours, radii, or
> shadows. Tokens are defined once in `app/globals.css` and re-skin the whole app.
> A component that hardcodes `#0052cc` or `borderRadius: 12` has silently opted out
> of the design system and will drift. If a value you need isn't a token, add a
> token — don't inline a literal.

---

## Why tokens (how consistency is actually enforced)

Mosaic components are styled with inline React styles that read CSS custom
properties, e.g. `style={{ background: 'var(--surface)', borderRadius: 'var(--radius)' }}`.
Because every surface reads the same tokens, changing the token set in
`app/globals.css` propagates app-wide in one place. This is the entire mechanism
behind "consistent UI all across" — keep using it.

- **Light** = base `:root` block.
- **Dark** = `[data-theme="dark"]` block (overrides colours only; radii/fonts are
  mode-independent and inherited from `:root`).
- **Alternate palettes** (`fluent`, `aubergine`) are `[data-palette="…"]` compound
  selectors (specificity 0,2,0) that override the base. Don't touch them when
  working on the default look.

---

## Colour tokens

### Neutrals & surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f4f5f7` | `#161a1d` | App canvas / page background |
| `--bg2` | `#ffffff` | `#1d2125` | Raised neutral fill |
| `--bg3` | `#ebecf0` | `#22272b` | Hover / subtle neutral (nav active, chips) |
| `--bg4` | `#dfe1e6` | `#2c333a` | Stronger neutral fill |
| `--surface` | `#ffffff` | `#1d2125` | Cards, panels, nav, inputs |
| `--surface2` | `#f7f8f9` | `#22272b` | Sunken / secondary surface |
| `--border` | `#dfe1e6` | `#2c333a` | Default hairline border / divider |
| `--border2` | `#c1c7d0` | `#454f59` | Stronger border (inputs, emphasis) |

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--text` | `#172b4d` | `#c7d1db` | Primary text, headings |
| `--text2` | `#44546f` | `#9fadbc` | Secondary / subtle text |
| `--text3` | `#626f86` | `#8c9bab` | Muted / meta / placeholders |
| `--text4` | `#8993a4` | `#738496` | Faintest (disabled, whisker lines) |

### Brand & status

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` / `--accent-bg` | `#0052cc` | `#579dff` | Brand blue — primary buttons, active, links, focus |
| `--accent-fg` | `#ffffff` | `#1c2b41` | Text/icon **on** an accent fill (note: dark uses navy on light-blue) |
| `--green` / `--green-bg` / `--green-t` | `#22a06b` / `#e3fcef` / `#216e4e` | lightened | Success / running / pass |
| `--red` / `--red-bg` / `--red-t` | `#c9372c` / `#ffebe6` / `#ae2a19` | lightened | Error / fail / below-target |
| `--amber` / `--amber-bg` / `--amber-t` | `#e2b203` / `#fff7d6` / `#7f5f01` | lightened | Warning / held-for-approval |
| `--blue` / `--blue-bg` / `--blue-t` | `#0052cc` / `#e9f2ff` / `#0052cc` | lightened | Information / neutral-info lozenge |
| `--purple` / `--purple-bg` / `--purple-t` | `#6e5dc6` / `#f3f0ff` / `#5e4db2` | lightened | Discovery / AI-proposed |
| `--highlight` / `--highlight-border` | `rgba(0,82,204,.14)` / `.40` | blue-based | Search/selection highlight |

**Status lozenge pattern:** background `var(--*-bg)`, text `var(--*-t)`, pill
radius `var(--radius-pill)`. Never put white text on a pale status background.

---

## Shape, elevation, type

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--radius-sm` | `3px` | — | Controls, inputs, small buttons, chips |
| `--radius` | `4px` | — | Cards, panels, message bubbles (the default) |
| `--radius-lg` | `8px` | — | Large containers, modals |
| `--radius-xl` | `12px` | — | Hero / feature surfaces |
| `--radius-pill` | `999px` | — | Lozenges, avatars, toggles |
| `--shadow` | ADS card elevation | deeper | Resting cards |
| `--shadow-md` | ADS overlay | deeper | Menus, popovers |
| `--shadow-lg` | ADS raised | deeper | Dialogs, drawers |
| `--font-sans` | ADS system sans stack | — | Everything |
| `--font-serif` | **same sans stack** | — | Intentionally sans: no serif headings or wordmark |
| `--font-mono` | SFMono / IBM Plex Mono | — | Code, tool names, IDs |

**Corners are tight and uniform** (3–4px). Resist rounder radii — a `12px` card
reads as a different design language.

**Elevation is subtle.** ADS shadows are a 1px key line plus a soft ambient
layer, not a big drop shadow. Prefer a `--border` hairline over a heavy shadow to
separate a surface.

**Air-gap font policy (do not break):** Mosaic can run air-gapped, so the UI must
never depend on a downloaded web font. `--font-sans`/`--font-serif` are **system
stacks** (San Francisco / Segoe UI / Roboto fallbacks). If a branded font is ever
wanted, self-host it (bundle via `@fontsource`, served from the app) — never a
runtime Google-Fonts/CDN link.

---

## Component patterns

- **Button label weight is medium (500), not bold.** A filled primary button is
  already heavy from its fill — bold text on top reads harsh. Keep all button labels
  at `fontWeight: 500`.
- **Primary button:** `background: var(--accent-bg); color: var(--accent-fg);
  borderRadius: var(--radius-sm)`, no border, label weight 500. Hover darkens via
  opacity, not a new colour.
- **Secondary / default button:** `background: var(--surface); color: var(--text);
  border: 1px solid var(--border2); borderRadius: var(--radius-sm)`.
- **Subtle / ghost button:** transparent background, `color: var(--text2)`, hover
  `background: var(--bg3)`.
- **Card / panel:** `background: var(--surface); border: 1px solid var(--border);
  borderRadius: var(--radius); boxShadow: var(--shadow)`.
- **Input / select / textarea:** `background: var(--surface); border: 1px solid
  var(--border2); borderRadius: var(--radius-sm)`; focus → `border-color:
  var(--accent)` (optionally a 2px accent ring via box-shadow).
- **Table:** header text `var(--text2)` 11px, hairline `var(--border)` row rules,
  row hover `var(--bg3)` (or `var(--highlight)` for selection), numeric columns
  right-aligned + tabular-nums.
- **Nav rail:** `var(--nav-bg)` (= `--surface`), item text `var(--nav-text)`,
  active item `var(--nav-active-bg)` + `var(--accent)` text. Use the `--nav-*`
  tokens, not raw surface tokens, so "dark menu / light page" palettes keep working.
- **Badge / lozenge:** see status pattern above; pill radius.

---

## Charts

Chart series colours live in `components/dashboards/PanelChart.tsx`
(`SERIES_MOSAIC`) because SVG/Recharts can't resolve `var()`. The Mosaic set is an
ADS-flavoured categorical palette led by the brand blue. Semantic chart colours
(primary, mean, outlier, grid) are **read from live tokens** at render and re-read
on theme/mode change — keep it that way so charts follow light/dark automatically.
See also the `dataviz` skill for palette/accessibility rules.

---

## Do / Don't

**Do**
- Read every colour, radius, and shadow from a token.
- Add a new token (in both light and dark blocks) when you need a value that
  doesn't exist, then consume the token.
- Keep status meaning tied to the status tokens (green=good, red=bad, amber=wait,
  purple=AI/discovery, blue=info).
- Verify both light **and** dark before shipping.

**Don't**
- Inline a hex colour, an `rgba()`, a `borderRadius: <number>`, or a drop shadow.
- Reintroduce serif headings or a web-font `<link>`.
- Override `--accent` to a non-brand colour for emphasis — use a status token.
- Edit the `fluent`/`aubergine` blocks when changing the default look.

---

## Changing the theme later

To adjust the default look, edit **only** the base `:root` and `[data-theme="dark"]`
token blocks in `app/globals.css` (plus, if you touch the brand, the `mosaic`
entries in `PanelChart.tsx` `SERIES_MOSAIC` and `TabCustomization.tsx` `PREVIEW`).
Because components read tokens, that is the whole change — no component sweep
needed. Keep this document in sync with the token values.
