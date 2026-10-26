# Area layouts

[← Back to the overview](../README.md)

Every area has a view, by default with the same structure as in the built-in Overview. An area can get
its own layout: its own sections, badges and tile on the overview page.

A normal room keeps its default sections and gains one of its own – here all power plugs of the living
room, selected by label:

<table>
<tr>
<td width="50%"><img src="images/area-plugs-light.png" alt="Living room with the default sections and a power plugs section, light theme"></td>
<td width="50%"><img src="images/area-plugs-dark.png" alt="Living room with the default sections and a power plugs section, dark theme"></td>
</tr>
</table>

A server room shows only its own sections – host and virtual machines, selected by label; the area name
is removed from the card names ("Server CPU load" → "CPU load"):

<table>
<tr>
<td width="50%"><img src="images/area-sections-light.png" alt="Area view with own sections only, light theme"></td>
<td width="50%"><img src="images/area-sections-dark.png" alt="Area view with own sections only, dark theme"></td>
</tr>
</table>

Set up in the editor: [Area layouts](editor.md#area-layouts) · [Sections](editor.md#sections) ·
[Tile on the overview page](editor.md#tile-on-the-overview-page).

## Sections

- A section selects entities by label, integration, device and [more](editor.md#selection-criteria).
- Own sections come first, in their order, followed by the remaining devices of the area and its
  automations, as in the default view.
- **Default sections** – lights, climate, security, media players and scenes – are left out, unless they
  are switched on. Then they come first; each can also be moved between the own sections.
- Any section, own or default, can be **hidden**: it shows nothing and selects nothing; its entities
  appear with the remaining devices.
- An **entity** is shown only once, in the first section that selects it. Own sections select first, the
  default sections take what is left. Other entities of the same device are not taken along: they can be
  selected by a later section, or appear in the device's card below, as in the built-in area view.

## Section heading

The heading of a section opens the device page if the section shows entities of one device, or a list
of its devices if it shows several – a click on a device opens its device page. Device pages are for
administrators; for other users the heading has no action.

<table>
<tr>
<td width="50%"><img src="images/device-list-light.png" alt="List of the devices of a section, light theme"></td>
<td width="50%"><img src="images/device-list-dark.png" alt="List of the devices of a section, dark theme"></td>
</tr>
</table>

## Layouts

- **Tiles:** one tile per entity.
- **Grouped by device:** a heading per device with its entities.
- **Compact:** one tile per device showing its primary entity, named after the device, opening the device
  page. The primary entity is chosen in the section or automatically (running, connectivity or power
  sensor, switch, binary sensor, sensor).
- **Table:** one list per device.

## Hide while in state

A card of a section is hidden **while** its entity is in one of the chosen states, e.g. occupancy sensors
while *Clear* or media players while off. This happens live, without reloading; a heading with nothing
left to show disappears too.

## Order

The entities of a section are shown group by group, e.g. first occupancy sensors, then switches and
lights – each in the first group it fits, the rest after them. Without groups, and within a group, Home
Assistant's order applies, as in the built-in Overview. In the layouts *Grouped by device* and *Table*,
devices keep their order and the groups apply within each device; *Compact* ignores them.

## Tile on the overview page

An area's tile on the overview page can show other values than the temperature: the area's sensors of
chosen device classes (combined, as the area card does), or specific entities in a fixed order – also
diagnostic sensors and sensors without device class, e.g. CPU and memory of a server. Alert icons show
while a binary sensor of the area (or a chosen one) is on. An area can have its own tile and keep the
default view.
