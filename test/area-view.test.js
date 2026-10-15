import { test } from "node:test";
import assert from "node:assert/strict";
import { generateAreaView } from "../src/views/area-view.js";
import { cards, headings, makeHass } from "./fixtures.js";

const BT = { type: "custom:better-thermostat-normal-climate-card" };

test("default area view mirrors the built-in structure", () => {
  const { view } = generateAreaView(makeHass(), "living_room");
  assert.equal(view.type, "sections");
  assert.deepEqual(headings(view), [
    "Lights", "Climate", "Media players", "Scenes", "", "Radiator", "Coffee machine", "Others", "Automations",
  ]);
  assert.deepEqual(view.badges.map((b) => b.entity), ["sensor.living_temp", "sensor.living_hum"]);
  const ceiling = cards(view).find((c) => c.entity === "light.ceiling");
  assert.deepEqual(ceiling.features, [{ type: "light-brightness" }]);
  const lamp = cards(view).find((c) => c.entity === "light.lamp");
  assert.equal(lamp.features, undefined);
  assert.deepEqual(cards(view).find((c) => c.entity === "climate.living").features, [{ type: "target-temperature" }]);
  // hidden and diagnostic entities are not shown, battery becomes a heading badge
  const ids = cards(view).map((c) => c.entity);
  assert.ok(!ids.includes("sensor.hidden"));
  assert.ok(!ids.includes("sensor.trv_signal"));
  const radiator = view.sections.find((s) => s.cards[0].heading === "Radiator");
  assert.equal(radiator.cards[0].badges[0].entity, "sensor.trv_battery");
  assert.equal(radiator.cards[0].tap_action.navigation_path, "/config/devices/device/dev_trv");
});

test("light heading has on/off buttons targeting the area", () => {
  const { view } = generateAreaView(makeHass(), "living_room");
  const badges = view.sections[0].cards[0].badges;
  assert.equal(badges.length, 2);
  assert.equal(badges[0].tap_action.target.area_id, "living_room");
});

test("non-admin users get no config navigation", () => {
  const { view } = generateAreaView(makeHass({ user: { is_admin: false } }), "living_room");
  const radiator = view.sections.find((s) => s.cards[0].heading === "Radiator");
  assert.equal(radiator.cards[0].tap_action, undefined);
});

test("empty area shows the empty state", () => {
  const { view } = generateAreaView(makeHass(), "empty");
  assert.equal(view.type, "panel");
  assert.equal(view.cards[0].type, "empty-state");
});

test("unknown area throws", () => {
  assert.throws(() => generateAreaView(makeHass(), "nope"));
});

test("card_rules replace cards before rendering and merge partial configs", () => {
  const { view } = generateAreaView(makeHass(), "living_room", {
    card_rules: [
      { match: { integration: "better_thermostat", domain: "climate" }, card: BT },
      { match: { entity: "climate.living" }, card: { name: "Living room" } },
    ],
  });
  const card = cards(view).find((c) => c.entity === "climate.living");
  assert.deepEqual(card, { ...BT, name: "Living room", entity: "climate.living" });
});

test("card: false hides an entity, stop ends the rule chain", () => {
  const { view, report } = generateAreaView(makeHass(), "living_room", {
    card_rules: [
      { match: { domain: "light" }, card: false, stop: true },
      { match: { domain: "light" }, card: { type: "button" } },
    ],
  });
  assert.ok(!cards(view).some((c) => c.entity?.startsWith("light.")));
  assert.deepEqual(report.hidden.sort(), ["light.ceiling", "light.lamp"]);
});

test("contexts restrict where a rule applies", () => {
  const { view } = generateAreaView(makeHass(), "living_room", {
    card_rules: [{ match: { domain: "switch" }, contexts: ["area"], card: { type: "button" } }],
  });
  // switch.plug is in the remaining devices (context area_other) -> unchanged
  assert.equal(cards(view).find((c) => c.entity === "switch.plug").type, "tile");
});

test("placeholders are substituted and suppress automatic entity injection", () => {
  const { view } = generateAreaView(makeHass(), "living_room", {
    card_rules: [{ match: { domain: "media_player" }, card: { type: "media-control", entity: "$entity", name: "$area" } }],
  });
  const card = cards(view).find((c) => c.type === "media-control");
  assert.deepEqual(card, { type: "media-control", entity: "media_player.tv", name: "living_room" });
});

test("device-scope rules turn a device into one card", () => {
  const { view } = generateAreaView(makeHass(), "living_room", {
    card_rules: [
      { scope: "device", match: { device: "dev_plug" }, card: { type: "entities", title: "$device", entities: "$entities" } },
    ],
  });
  const section = view.sections.find((s) => s.cards[0].heading === "Coffee machine");
  assert.deepEqual(section.cards.slice(1), [{ type: "entities", title: "dev_plug", entities: ["switch.plug"] }]);
});

const PROXMOX = {
  badges: false,
  sections: [
    { title: "Hypervisor", icon: "mdi:server", match: { label: "virt-hypervisor" }, layout: "devices" },
    { title: "VMs", icon: "mdi:cube-outline", match: { label: "virt-guest" }, layout: "compact" },
    { title: "Exporter", match: { integration: "mqtt", manufacturer: "^Proxmox" } },
  ],
};

test("area override: own sections first, then remaining devices; no standard categories", () => {
  const { view, report } = generateAreaView(makeHass(), "proxmox", { override: PROXMOX });
  assert.deepEqual(headings(view), ["Hypervisor", "pve1", "VMs", "Exporter", "", "UPS"]);
  assert.deepEqual(view.badges, []);
  assert.equal(view.sections[0].column_span, 3);
  assert.equal(view.sections[0].cards[0].heading_style, "title");
  // devices layout: diagnostic entities included by default
  const pve = view.sections[1].cards.slice(1).map((c) => c.entity);
  assert.deepEqual(pve, ["sensor.pve_cpu", "binary_sensor.pve_status", "sensor.pve_uptime"]);
  // compact layout: one card per VM (child devices inherit the parent's area), primary = running sensor
  const vms = view.sections[2].cards.slice(1);
  assert.deepEqual(vms.map((c) => [c.entity, c.name]), [
    ["binary_sensor.vm_web_status", "web"],
    ["binary_sensor.vm_db_status", "db"],
  ]);
  assert.equal(vms[0].tap_action.navigation_path, "/config/devices/device/dev_vm_web");
  assert.deepEqual(report.sections.map((s) => s.title), ["Hypervisor", "VMs", "Exporter"]);
});

test("area override: a device belongs to the first matching section only", () => {
  const { view } = generateAreaView(makeHass(), "proxmox", {
    override: {
      sections: [
        { title: "All Proxmox", match: { integration: "proxmoxve", domain: "binary_sensor" } },
        { title: "CPU", match: { domain: "sensor", integration: "proxmoxve" } },
      ],
    },
  });
  // every proxmoxve device has a binary_sensor -> all claimed by the first section, "CPU" stays empty
  assert.deepEqual(headings(view), ["All Proxmox", "", "pve exporter", "UPS"]);
});

test("area override: entity selection, table layout, hiding remaining devices", () => {
  const { view } = generateAreaView(makeHass(), "proxmox", {
    override: {
      show_other_devices: false,
      sections: [
        { title: "VMs", match: { label: "virt-guest" }, layout: "table", entities: { include_domains: ["sensor"] } },
      ],
    },
  });
  assert.deepEqual(view.sections[0].cards.slice(1), [
    { type: "entities", title: "web", entities: ["sensor.vm_web_cpu"] },
    { type: "entities", title: "db", entities: ["sensor.vm_db_cpu"] },
  ]);
  assert.equal(view.sections.length, 1);
  assert.equal(view.sections[0].column_span, 2);
});

test("card_rules also apply inside override sections", () => {
  const { view } = generateAreaView(makeHass(), "proxmox", {
    override: PROXMOX,
    card_rules: [{ match: { device_label: "virt-guest", domain: "binary_sensor" }, card: { color: "green" } }],
  });
  assert.ok(view.sections[2].cards.slice(1).every((c) => c.color === "green"));
});

test("area override: a section without selection matches nothing", () => {
  const { view } = generateAreaView(makeHass(), "proxmox", {
    override: { sections: [{ title: "Empty" }, { title: "Also empty", match: {} }, { title: "VMs", match: { label: "virt-guest" } }] },
  });
  assert.deepEqual(headings(view), ["VMs", "", "pve1", "pve exporter", "UPS"]);
});

test("a device rule without card type is ignored instead of producing a broken card", () => {
  const { view } = generateAreaView(makeHass(), "living_room", {
    card_rules: [{ scope: "device", match: { device: "dev_plug" }, card: { name: "x" } }],
  });
  const section = view.sections.find((s) => s.cards[0].heading === "Coffee machine");
  assert.equal(section.cards[1].type, "tile");
});

// ---------------------------------------------------------------- area names
import { stripAreaName } from "../src/registry.js";

test("stripAreaName removes the area name at start or end, case-insensitive, incl. aliases", () => {
  const area = { name: "Wohnzimmer", aliases: ["WZ"] };
  assert.equal(stripAreaName("Wohnzimmer Deckenlicht", area), "Deckenlicht");
  assert.equal(stripAreaName("wohnzimmer - deckenlicht", area), "Deckenlicht");
  assert.equal(stripAreaName("Deckenlicht Wohnzimmer", area), "Deckenlicht");
  assert.equal(stripAreaName("WZ: Stehlampe", area), "Stehlampe");
  assert.equal(stripAreaName("Wohnzimmerlampe", area), "Wohnzimmerlampe", "only whole words");
  assert.equal(stripAreaName("Licht Wohnzimmer Ecke", area), "Licht Wohnzimmer Ecke", "not in the middle");
  assert.equal(stripAreaName("Wohnzimmer", area), "Wohnzimmer", "nothing left → unchanged");
  assert.equal(stripAreaName("Proxmox (pve1)", { name: "Pro.mox" }), "Proxmox (pve1)", "area name is not a pattern");
});

function hassWithNames() {
  const hass = makeHass();
  // formatEntityName like the frontend: device name + entity name
  hass.formatEntityName = (state, name) => {
    const ent = hass.entities[state.entity_id];
    const dev = ent?.device_id ? hass.devices[ent.device_id] : undefined;
    const entityName = ent?.name;
    if (name && !Array.isArray(name) && name.type === "entity") return entityName || dev?.name || state.entity_id;
    return [dev?.name, entityName].filter(Boolean).join(" ") || state.entity_id;
  };
  hass.devices.dev_light.name = "Living room Ceiling";
  hass.entities["light.lamp"].name = "Living room lamp";
  hass.entities["switch.plug"].name = "Living Room Plug";
  hass.devices.dev_vm_web.name = "Proxmox web";
  return hass;
}

test("area views remove the area name from card names", () => {
  const { view } = generateAreaView(hassWithNames(), "living_room");
  const byEntity = (id) => cards(view).find((c) => c.entity === id);
  assert.equal(byEntity("light.ceiling").name, "Ceiling");
  assert.equal(byEntity("light.lamp").name, "Lamp");
  assert.equal(byEntity("switch.plug").name, "Plug", "remaining devices (entity name only)");
  assert.equal(byEntity("climate.living").name, undefined, "no area name → name left to the card");
});

test("replacement cards get the short name unless the rule sets one; option can be turned off", () => {
  const hass = hassWithNames();
  const rules = [
    { match: { domain: "light", entity: "light.ceiling" }, card: { type: "custom:x" } },
    { match: { entity: "light.lamp" }, card: { type: "custom:y", name: "Mine" } },
  ];
  const { view } = generateAreaView(hass, "living_room", { card_rules: rules });
  assert.equal(cards(view).find((c) => c.entity === "light.ceiling").name, "Ceiling");
  assert.equal(cards(view).find((c) => c.entity === "light.lamp").name, "Mine");

  const off = generateAreaView(hass, "living_room", { strip_area_names: false }).view;
  assert.equal(cards(off).find((c) => c.entity === "light.ceiling").name, undefined);
});

test("compact layout: device names without the area name", () => {
  const { view } = generateAreaView(hassWithNames(), "proxmox", {
    override: { sections: [{ title: "VMs", match: { label: "virt-guest" }, layout: "compact" }] },
  });
  assert.deepEqual(view.sections[0].cards.slice(1).map((c) => c.name), ["Web", "db"]);
});
