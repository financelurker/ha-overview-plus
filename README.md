# Overview Plus

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://hacs.xyz/docs/faq/custom_repositories/)
[![GitHub release](https://img.shields.io/github/v/release/financelurker/ha-overview-plus)](https://github.com/financelurker/ha-overview-plus/releases)
[![CI](https://github.com/financelurker/ha-overview-plus/actions/workflows/ci.yml/badge.svg)](https://github.com/financelurker/ha-overview-plus/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/financelurker/ha-overview-plus)](https://github.com/financelurker/ha-overview-plus/blob/main/LICENSE)

**The Home Assistant Overview, configurable.** Overview Plus is a dashboard strategy that builds the same
dashboard as the built-in Overview – overview page, one view per area, media players and devices – and
lets you change what the built-in one does not let you change. It keeps up with your installation by
itself: new devices and areas appear without editing the dashboard.

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/financelurker/ha-overview-plus/main/docs/images/overview-light.png?v=ca6dc38004" alt="Overview page, light theme"></td>
<td width="50%"><img src="https://raw.githubusercontent.com/financelurker/ha-overview-plus/main/docs/images/overview-dark.png?v=cf280aa6b2" alt="Overview page, dark theme"></td>
</tr>
</table>

## What it does

- **[Overview page](https://github.com/financelurker/ha-overview-plus/blob/main/docs/overview-page.md):**
  favorites, summaries, shortcuts and alerts of the built-in Overview, or own ones per dashboard; the
  summaries lead to [pages of your choice](https://github.com/financelurker/ha-overview-plus/blob/main/docs/overview-page.md#pages-of-the-summaries).
- **[Area states](https://github.com/financelurker/ha-overview-plus/blob/main/docs/area-states.md):**
  see at a glance which rooms are occupied, heated, lit or have a window open – tinted tiles and colored
  chips, also for states of your own (e.g. the washing machine runs).
- **[Area tiles](https://github.com/financelurker/ha-overview-plus/blob/main/docs/area-layouts.md#tile-on-the-overview-page):**
  specific sensors on an area's tile instead of the temperature, e.g. CPU and memory of a server.
- **[Area layouts](https://github.com/financelurker/ha-overview-plus/blob/main/docs/area-layouts.md):**
  own sections per area, selected by label, integration, device and more, in four layouts – instead of
  the default sections or mixed with them. Cards can be [hidden while in a state](https://github.com/financelurker/ha-overview-plus/blob/main/docs/area-layouts.md#hide-while-in-state)
  (e.g. an occupancy sensor while clear) and [ordered](https://github.com/financelurker/ha-overview-plus/blob/main/docs/area-layouts.md#order) by domain and device class.
- **[Card rules](https://github.com/financelurker/ha-overview-plus/blob/main/docs/card-rules.md):**
  a different card for selected entities or devices, e.g. a thermostat card for all Better Thermostat
  entities; adjust or hide cards, or combine a device's entities into one card.
- **[Popup on tap](https://github.com/financelurker/ha-overview-plus/blob/main/docs/card-rules.md#popup-on-tap):**
  a card of your choice instead of the entity's info dialog.
- **[Visual editor](https://github.com/financelurker/ha-overview-plus/blob/main/docs/editor.md):**
  everything in the dashboard's editor, with dropdowns filled from your installation.

<table>
<tr>
<td width="50%"><img src="https://raw.githubusercontent.com/financelurker/ha-overview-plus/main/docs/images/area-sections-light.png?v=035a4c4774" alt="Area view with own sections, light theme"></td>
<td width="50%"><img src="https://raw.githubusercontent.com/financelurker/ha-overview-plus/main/docs/images/area-sections-dark.png?v=8c18ed69f4" alt="Area view with own sections, dark theme"></td>
</tr>
</table>

## Is it for you?

**It fits if**

- you like the built-in Overview, but want to change parts of it: other cards for some entities, own
  sections in some areas, the states of your rooms at a glance;
- the dashboard should keep up with new devices and areas by itself;
- you run Home Assistant 2026.10 or newer.

**It does not fit if**

- you want to place every card yourself – use a regular dashboard for that.

## Installation

Requires **Home Assistant 2026.10** or newer: the overview page uses cards and summaries of the
built-in Overview that were added up to that release.

### HACS

[![Open your Home Assistant instance and open the Overview Plus repository in HACS.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=financelurker&repository=ha-overview-plus&category=plugin)

1. Click the button above. It opens the repository in HACS and adds it as a custom repository if needed.
2. Install **Overview Plus** and reload the browser.

Without the button: HACS → ⋮ → **Custom repositories** → add `https://github.com/financelurker/ha-overview-plus`
as type *Dashboard*.

### Manual

1. Copy the contents of `src/` (including subfolders) to `config/www/overview-plus/`.
2. Settings → Dashboards → ⋮ → Resources → add `/local/overview-plus/overview-plus.js` as *JavaScript module*.

## Getting started

1. Settings → Dashboards → **Add dashboard** → *Community dashboards* → **Overview Plus**. Without
   changes it shows the same as the built-in Overview.
2. Open the dashboard → ✏️ (edit) to change it in the [editor](https://github.com/financelurker/ha-overview-plus/blob/main/docs/editor.md).
   Do not click **Take control** there: it turns the dashboard into a static copy that Overview Plus no
   longer updates.

In YAML, the dashboard is:

```yaml
strategy:
  type: custom:overview-plus
```

## Documentation

| Page | Content |
|---|---|
| [Overview page](https://github.com/financelurker/ha-overview-plus/blob/main/docs/overview-page.md) | own or built-in settings, favorites, summaries and shortcuts, pages of the summaries |
| [Area states](https://github.com/financelurker/ha-overview-plus/blob/main/docs/area-states.md) | presets, tinted tile or chip, own states |
| [Area layouts](https://github.com/financelurker/ha-overview-plus/blob/main/docs/area-layouts.md) | own sections, default sections, layouts, hide while in state, order, the area's tile |
| [Card rules](https://github.com/financelurker/ha-overview-plus/blob/main/docs/card-rules.md) | replace, adjust or hide cards, contexts, device cards, popup on tap |
| [Editor](https://github.com/financelurker/ha-overview-plus/blob/main/docs/editor.md) | the three parts of the editor, what stays YAML |
| [Reference](https://github.com/financelurker/ha-overview-plus/blob/main/docs/reference.md) | all options, match specifications |

## Support

Questions, bugs and ideas: [GitHub issues](https://github.com/financelurker/ha-overview-plus/issues). For a bug,
please add the Home Assistant and Overview Plus versions, the dashboard's YAML and the messages of the
browser console that start with `[overview-plus]` (with `debug: true`, Overview Plus logs the generated
area views too).

## License

Apache License 2.0, see [LICENSE](https://github.com/financelurker/ha-overview-plus/blob/main/LICENSE) and
[NOTICE](https://github.com/financelurker/ha-overview-plus/blob/main/NOTICE).

This project is not affiliated with Home Assistant or the Open Home Foundation.
