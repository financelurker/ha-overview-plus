# Reference

[← Back to the overview](../README.md)

## Options

| Option | Description |
|---|---|
| `card_rules` | Rules that replace, adjust or hide cards, see [Card rules](card-rules.md). |
| `area_overrides` | Layout per area, keyed by area id, see [Area layouts](area-layouts.md). |
| `load_home_settings` | Use the overview page settings of the built-in Overview (default `true`); `false` = own settings, see [Overview page](overview-page.md). |
| `favorite_entities`, `hide_welcome_message`, `hide_suggested_entities`, `shortcuts`, `alert_entities` | Own overview page settings (with `load_home_settings: false`), see [Overview page](overview-page.md). |
| `summary_pages` | Pages the summaries and category headings lead to, see [Pages of the summaries](overview-page.md#pages-of-the-summaries). |
| `area_indicators` | States shown on the area tiles, see [Area states](area-states.md). |
| `lazy_render` | Render cards below the first screen of an area view only when they scroll into view (default `true`). |
| `strip_area_names` | Remove the area name from card names and device headings in area views, e.g. "Living room Ceiling light" → "Ceiling light" (default `true`). |
| `debug` | Log the generated area views and the section assignment to the browser console. |

## Area layout

| Option | Description |
|---|---|
| `sections` | Own sections (`title`, `icon`, `match`, `layout`, `primary`, `entities`, `sort`, `hidden`) and, with `show_default_sections`, `{ default: … }` entries. |
| `badges` | `false`, or a list of entity ids; default: area temperature and humidity. |
| `show_default_sections` | Also show lights, climate, security, media players and scenes (default `false`). |
| `show_other_devices` | Show the remaining devices of the area (default `true`). |
| `show_automations` | Show the automations of the area (default `true`). |
| `tile` | Options of the area's tile on the overview page. |

## Match specifications

`card_rules` and `area_overrides` select entities with the same match syntax. All criteria in one
object must match (AND); a list of objects matches if any object matches (OR). Every criterion accepts
a single value or a list.

| Criterion | Matches | Example |
|---|---|---|
| `entity` | entity id | `climate.bath` |
| `domain` | entity domain | `climate`, `sensor`, `switch` |
| `device_class` | device class (`none` if unset) | `temperature`, `running` |
| `integration` | integration of the entity | `better_thermostat`, `mqtt` |
| `entity_category` | `none`, `config`, `diagnostic` | `diagnostic` |
| `label` | label on the entity **or** its device | `virt-guest` |
| `entity_label` / `device_label` | label on the entity / device only | |
| `device` | device id | |
| `device_name` | device name, regular expression | `^pve` |
| `manufacturer` / `model` | device manufacturer / model, regular expression | `Proxmox` |
| `area` / `floor` | area id / floor id | `proxmox`, `virtual` |
| `not` | nested match that must not match | `{ entity_category: diagnostic }` |

For devices that arrive through the same integration (e.g. several MQTT bridges), **labels** are the most
robust way to group them – assign them in the UI, no dashboard change needed.
