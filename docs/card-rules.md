# Card rules

[← Back to the overview](../README.md)

Card rules replace, adjust or hide the cards of selected entities or devices – in the favorites on the
overview page, the area views, the media players view and the devices view. Here a rule replaces the
climate tile of the default area view with a thermostat card:

<table>
<tr>
<td width="50%"><img src="images/area-default-light.png" alt="Default area view with a thermostat card, light theme"></td>
<td width="50%"><img src="images/area-default-dark.png" alt="Default area view with a thermostat card, dark theme"></td>
</tr>
</table>

- A rule selects entities by label, integration, domain, device and [more](editor.md#selection-criteria),
  e.g. all Better Thermostat entities.
- **Replace** shows a card of another type, **adjust** changes the current card (e.g. name, icon or
  color), **hide** removes it.
- Rules are checked in order and **all** matching rules apply, so a general rule can be refined by a later
  one for a single entity. A rule can stop the evaluation for its entities.
- **One card per device:** all entities of a matching device become one card, e.g. an entities card per
  virtual machine. Here the first matching rule counts.
- A rule can be limited to some places: favorites, the highlighted sections or the remaining devices of
  area views, the media players view or the devices view. In the devices view every device is one entities
  card: device rules replace it, entity rules can only hide rows.

Set up in the editor: [Card rules](editor.md#card-rules).

## Popup on tap

A rule can show a card of your choice in a popup instead of the entity's info dialog – also without
replacing the card. This works with any card that opens the info dialog when tapped: tiles, buttons, most
custom cards. Here a button card opens a tile with cover controls:

<table>
<tr>
<td width="50%"><img src="images/popup-light.png" alt="Popup with a card of your choice, light theme"></td>
<td width="50%"><img src="images/popup-dark.png" alt="Popup with a card of your choice, dark theme"></td>
</tr>
</table>

- E.g. a small card in favorites and area views, and the full card when tapped.
- The popup has a button for the regular info dialog. On phones it fills the screen.
- The popup of the last matching rule applies; a later rule can remove it again.
