# Editor

[← Back to the overview](../README.md)

The visual editor of the dashboard has three collapsible parts:

<table>
<tr>
<td width="50%"><img src="images/editor-collapsed-light.png" alt="Editor: the three parts collapsed, light theme"></td>
<td width="50%"><img src="images/editor-collapsed-dark.png" alt="Editor: the three parts collapsed, dark theme"></td>
</tr>
</table>

- **Overview page:** welcome message, favorites, suggested entities, alert entities – the same as in the
  built-in Overview, or own settings for this dashboard; inside it *Summaries and shortcuts* and
  *Area states*. See [Overview page](overview-page.md) and [Area states](area-states.md).
- **Area layouts:** every area with its own layout is a collapsible block with a short summary: badges,
  the toggles for the default sections, remaining devices and automations, the tile on the overview page
  and the sections – each with *Refine selection*, *Entity filter*, *Primary entity*, *Hide while in
  state* and *Order* as form fields. See [Area layouts](area-layouts.md).
- **General:** the card rules and the options for the whole dashboard. See [Card rules](card-rules.md).

Integration, domain, device class, manufacturer and model are dropdowns filled from your own
installation; own values can be typed. Lists are ordered with the ↑/↓ buttons.

Only two things are YAML in the editor: the options specific to a replacement card (*More card
options*, because every card type has different ones), and – only if your configuration contains one – a
selection the form cannot show, such as an either/or list. The full YAML view is available at any time; the
[reference](reference.md) lists all options.

> Do not click **Take control** in that menu: it converts the dashboard into a static copy of
> the currently generated cards, and Overview Plus no longer updates it.
