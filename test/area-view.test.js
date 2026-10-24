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

test("area override: an entity belongs to the first section that shows it", () => {
  const { view } = generateAreaView(makeHass(), "proxmox", {
    override: {
      sections: [
        { title: "Status", match: { integration: "proxmoxve", domain: "binary_sensor" } },
        { title: "CPU", match: { domain: "sensor", integration: "proxmoxve" } },
        { title: "Again", match: { integration: "proxmoxve" } },
      ],
    },
  });
  const entitiesOf = (title) => {
    const section = view.sections.find((s) => s.cards[0]?.heading === title);
    return section ? section.cards.slice(1).map((c) => c.entity) : [];
  };
  // the status sensors go to "Status", the CPU sensors of the same devices still to "CPU"
  assert.deepEqual(entitiesOf("Status"), ["binary_sensor.pve_status", "binary_sensor.vm_web_status", "binary_sensor.vm_db_status"]);
  assert.ok(entitiesOf("CPU").includes("sensor.pve_cpu"));
  assert.ok(!entitiesOf("Again").includes("binary_sensor.pve_status"), "shown entities are not shown again");
});

test("area override: other entities of a device stay in its card below", () => {
  const { view } = generateAreaView(makeHass(), "proxmox", {
    override: { sections: [{ title: "Status", match: { entity: "binary_sensor.pve_status" } }] },
  });
  const pve = view.sections.find((s) => s.cards[0]?.heading === "pve1");
  assert.ok(pve, "the device keeps its own card");
  const shown = pve.cards.slice(1).map((c) => c.entity);
  assert.ok(shown.includes("sensor.pve_cpu"));
  assert.ok(!shown.includes("binary_sensor.pve_status"), "without the entity already shown above");
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
  assert.equal(stripAreaName("Proxmox pve-01", { name: "Proxmox" }), "pve-01", "identifiers keep their case");
  assert.equal(stripAreaName("Küche ölradiator", { name: "Küche" }), "Ölradiator");
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

test("device headings and table titles without the area name", () => {
  const hass = hassWithNames();
  hass.devices.dev_trv.name = "Living room Radiator";
  hass.devices.dev_pve.name = "Proxmox pve1";
  const living = generateAreaView(hass, "living_room").view;
  assert.ok(headings(living).includes("Radiator"));
  assert.ok(!headings(living).includes("Living room Radiator"));

  const off = generateAreaView(hass, "living_room", { strip_area_names: false }).view;
  assert.ok(headings(off).includes("Living room Radiator"));

  const devicesLayout = generateAreaView(hass, "proxmox", {
    override: { sections: [{ title: "Hypervisor", match: { label: "virt-hypervisor" }, layout: "devices" }] },
  }).view;
  assert.ok(headings(devicesLayout).includes("pve1"), "identifiers keep their case");

  const table = generateAreaView(hass, "proxmox", {
    override: { sections: [{ title: "Hypervisor", match: { label: "virt-hypervisor" }, layout: "table" }] },
  }).view;
  assert.equal(table.sections[0].cards[1].title, "pve1");
});

test("category headings lead to the configured summary pages", () => {
  const { view } = generateAreaView(makeHass(), "living_room", { summary_pages: { light: "/lights-plus/0" } });
  const heading = (name) => view.sections.flatMap((s) => s.cards).find((c) => c.type === "heading" && c.heading === name);
  assert.equal(heading("Lights").tap_action.navigation_path, "/lights-plus/0");
  assert.equal(heading("Climate").tap_action.navigation_path, "/climate?historyBack=1");
});

const MULTIMEDIA = { title: "Multimedia", icon: "mdi:television", match: { entity: ["media_player.tv", "switch.plug"] } };

test("area override with default sections: categories, then own sections, then remaining devices", () => {
  const { view } = generateAreaView(makeHass(), "living_room", { override: { show_default_sections: true, sections: [MULTIMEDIA] } });
  // the own section takes the TV first (explicit configuration wins): no "Media players" category,
  // and the plug's only entity is in "Multimedia", so "Coffee machine" is not shown below
  assert.deepEqual(headings(view), ["Lights", "Climate", "Scenes", "Multimedia", "", "Radiator", "Others", "Automations"]);
  const ids = cards(view).map((c) => c.entity);
  for (const id of ["media_player.tv", "switch.plug"]) assert.equal(ids.filter((e) => e === id).length, 1, `${id} shown once`);
});

test("area override without default sections leaves the categories out (default)", () => {
  const { view } = generateAreaView(makeHass(), "living_room", { override: { sections: [MULTIMEDIA] } });
  assert.deepEqual(headings(view).slice(0, 2), ["Multimedia", ""]);
  assert.ok(!headings(view).includes("Lights"));
});

test("own section heading: device page for one device, device list for several, nothing without devices", () => {
  const sections = [
    MULTIMEDIA,
    { title: "Heating", match: { entity: "climate.living" } },
    { title: "Lamp", match: { entity: "light.lamp" } },
  ];
  const tap = (hass, title) =>
    generateAreaView(hass, "living_room", { override: { sections } }).view.sections.find((s) => s.cards[0]?.heading === title).cards[0].tap_action;
  assert.deepEqual(tap(makeHass(), "Multimedia"), {
    action: "fire-dom-event",
    overview_plus_devices: { title: "Multimedia", devices: [{ id: "dev_tv", name: "TV" }, { id: "dev_plug", name: "Coffee machine" }] },
  });
  assert.deepEqual(tap(makeHass(), "Heating"), { action: "navigate", navigation_path: "/config/devices/device/dev_trv" });
  assert.equal(tap(makeHass(), "Lamp"), undefined);
  assert.equal(tap(makeHass({ user: { is_admin: false } }), "Multimedia"), undefined, "device pages are for admins");
});

test("own sections and default sections: automations and lights are not doubled", () => {
  const sections = [{ title: "Mine", match: { entity: ["automation.evening", "light.lamp"] } }];
  const { view } = generateAreaView(makeHass(), "living_room", { override: { show_default_sections: true, sections } });
  const ids = cards(view).map((c) => c.entity);
  assert.equal(ids.filter((e) => e === "automation.evening").length, 1, "automation shown once");
  assert.ok(!headings(view).includes("Automations"));
  // the light buttons switch only the lights of the category, not the one in "Mine"
  const lights = view.sections.find((s) => s.cards[0].heading === "Lights");
  assert.deepEqual(lights.cards[0].badges[0].tap_action.target, { entity_id: ["light.ceiling"] });
  // without own lights the whole area is switched, as in the built-in view
  const plain = generateAreaView(makeHass(), "living_room").view;
  assert.deepEqual(plain.sections[0].cards[0].badges[0].tap_action.target, { area_id: "living_room" });
});
