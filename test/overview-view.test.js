import { test } from "node:test";
import assert from "node:assert/strict";
import { generateOverviewView, overviewShouldRegenerate, resolveShortcutItems } from "../src/views/overview-view.js";
import { makeHass } from "./fixtures.js";

function hass(extra = {}) {
  const h = makeHass({
    floors: {
      ground: { floor_id: "ground", name: "Ground", level: 0 },
      virtual: { floor_id: "virtual", name: "Virtual", icon: "mdi:server-network" },
    },
    panels: { light: {}, climate: {}, security: {}, maintenance: {}, energy: {} },
    config: { components: ["usage_prediction", "energy"] },
    callWS: async ({ type }) => {
      if (type === "usage_prediction/common_control") return { entities: ["switch.plug", "sensor.hidden", "light.lamp", "nope.x"] };
      if (type === "energy/get_prefs") return { energy_sources: [] };
      throw new Error(type);
    },
    ...extra,
  });
  return h;
}

const heads = (cards) => cards.filter((c) => c.type === "heading").map((c) => c.heading);
const section = (view, heading) => view.sections.find((s) => s.cards.some((c) => c.type === "heading" && c.heading === heading));

test("structure: favorites, mobile summaries, one section per floor, other areas", async () => {
  const { view } = await generateOverviewView(hass(), { favorite_entities: ["light.ceiling"] });
  assert.equal(view.type, "sections");
  assert.equal(view.max_columns, 3);
  assert.deepEqual(view.sections.map((s) => heads(s.cards)[0]), ["Favorites", "Summaries", "Ground", "Virtual", "Other areas"]);
  const ground = section(view, "Ground");
  assert.equal(ground.cards[0].icon, "mdi:home-floor-0");
  assert.equal(section(view, "Virtual").cards[0].icon, "mdi:server-network");
  const area = ground.cards[1];
  assert.deepEqual(area, {
    type: "area", area: "living_room", display_type: "compact", sensor_classes: ["temperature"],
    tap_action: { action: "navigate", navigation_path: "areas-living_room" }, vertical: true, grid_options: { rows: 2, columns: 4 },
  });
  assert.deepEqual(section(view, "Virtual").cards[1].sensor_classes, [], "no temperature sensor → no sensor classes");
  assert.equal(view.header.card.content, "## Welcome {{ user }}");
  assert.ok(view.sidebar.sections[0].cards.every((c) => c.type === "heading" || c.grid_options.columns === 12));
});

test("favorites first, then suggestions (existing, not hidden, no duplicates), card rules applied", async () => {
  const { view, report } = await generateOverviewView(hass(), {
    favorite_entities: ["light.ceiling", "climate.living", "sensor.gone"],
    card_rules: [{ match: { integration: "better_thermostat" }, card: { type: "custom:bt" } }],
  });
  const cards = section(view, "Favorites").cards.slice(1);
  assert.deepEqual(cards.map((c) => c.entity), ["light.ceiling", "climate.living", "switch.plug", "light.lamp"]);
  assert.deepEqual(cards[0], { type: "tile", entity: "light.ceiling", state_content: ["state", "area_name"], show_entity_picture: true });
  assert.deepEqual(cards[1], { type: "custom:bt", entity: "climate.living" });
  assert.deepEqual(report.suggested, ["switch.plug", "light.lamp"]);
});

test("hide_suggested_entities: only favorites; no favorites → no section", async () => {
  const only = (await generateOverviewView(hass(), { favorite_entities: ["light.lamp"], hide_suggested_entities: true })).view;
  assert.deepEqual(section(only, "Favorites").cards.slice(1).map((c) => c.entity), ["light.lamp"]);
  const none = (await generateOverviewView(hass(), { hide_suggested_entities: true })).view;
  assert.equal(section(none, "Favorites"), undefined);
});

test("card rules can hide favorites", async () => {
  const { view } = await generateOverviewView(hass(), {
    favorite_entities: ["light.ceiling"], hide_suggested_entities: true,
    card_rules: [{ match: { domain: "light" }, contexts: ["favorites"], card: false }],
  });
  assert.equal(section(view, "Favorites"), undefined);
});

test("summaries follow the shortcut order; hidden summaries and custom shortcuts", async () => {
  const shortcuts = [
    { type: "custom", path: "/lovelace/0", label: "Plan", icon: "mdi:floor-plan" },
    { type: "summary", key: "security", hidden: true },
    { type: "summary", key: "climate" },
  ];
  const { view } = await generateOverviewView(hass(), { shortcuts });
  const cards = section(view, "Summaries").cards.slice(1);
  assert.deepEqual(cards.map((c) => c.summary ?? c.type), [
    "repairs", "updates", "discovered-devices", "shortcut", "climate", "light", "media_players", "maintenance",
  ]);
  assert.deepEqual(cards[3], { type: "shortcut", label: "Plan", icon: "mdi:floor-plan", color: undefined, tap_action: { action: "navigate", navigation_path: "/lovelace/0" }, grid_options: { columns: 6 } });
});

test("resolveShortcutItems appends missing defaults and drops unknown or duplicate summaries", () => {
  const out = resolveShortcutItems([{ type: "summary", key: "energy" }, { type: "summary", key: "energy" }, { type: "summary", key: "nope" }]);
  assert.deepEqual(out.map((i) => i.key), ["energy", "light", "climate", "security", "media_players", "maintenance", "weather"]);
});

test("alert entities: alerts card with visibility, security summary carries all alert entities", async () => {
  const h = hass();
  h.states["binary_sensor.smoke"] = { entity_id: "binary_sensor.smoke", state: "off", attributes: { device_class: "smoke" } };
  const alerts = [{ entity: "binary_sensor.smoke" }, { entity: "light.lamp" }];
  const { view } = await generateOverviewView(h, { alert_entities: alerts });
  const mobileAlerts = view.sections.find((s) => s.cards[0]?.summary === "alerts");
  assert.deepEqual(mobileAlerts.cards[0].alert_entities, [{ entity: "binary_sensor.smoke" }]);
  assert.deepEqual(mobileAlerts.cards[0].visibility, [{ condition: "or", conditions: [{ condition: "and", conditions: [{ condition: "state", entity: "binary_sensor.smoke", state: "on" }] }] }]);
  const security = view.sidebar.sections[0].cards.find((c) => c.summary === "security");
  assert.deepEqual(security.alert_entities, alerts);
});

test("area tile options from area_overrides are merged into the area card", async () => {
  const { view } = await generateOverviewView(hass(), {
    area_overrides: { proxmox: { tile: { sensor_classes: [], alert_classes: ["problem"], color: "blue" }, sections: [] } },
  });
  const tile = section(view, "Virtual").cards[1];
  assert.deepEqual([tile.area, tile.sensor_classes, tile.alert_classes, tile.color, tile.type], ["proxmox", [], ["problem"], "blue", "area"]);
});

test("devices tile for area-less devices; empty installation shows the empty state", async () => {
  const h = hass();
  h.devices.dev_free = { id: "dev_free", area_id: null, name: "Free", labels: [] };
  h.states["switch.free"] = { entity_id: "switch.free", state: "on", attributes: {} };
  h.entities["switch.free"] = { entity_id: "switch.free", device_id: "dev_free", platform: "demo", labels: [] };
  const { view } = await generateOverviewView(h, {});
  const other = section(view, "Other areas");
  assert.equal(other.cards.at(-1).tap_action.navigation_path, "other-devices");

  const empty = makeHass({ states: {}, entities: {}, devices: {}, areas: {}, floors: {}, panels: {} });
  const res = await generateOverviewView(empty, { shortcuts: [] });
  assert.equal(res.view.type, "panel");
  assert.equal(res.view.cards[0].type, "empty-state");
});

test("failing suggestion and energy calls do not break the overview", async () => {
  const h = hass({ callWS: async () => { throw new Error("offline"); } });
  const { view } = await generateOverviewView(h, { favorite_entities: ["light.lamp"] });
  assert.deepEqual(section(view, "Favorites").cards.slice(1).map((c) => c.entity), ["light.lamp"]);
});

test("shouldRegenerate: registries or alert severity", () => {
  const a = hass();
  const b = { ...a };
  assert.equal(overviewShouldRegenerate({}, a, b), false);
  assert.equal(overviewShouldRegenerate({}, a, { ...a, areas: { ...a.areas } }), true);
  const states = { ...a.states, "binary_sensor.x": { entity_id: "binary_sensor.x", state: "off", attributes: { device_class: "smoke" } } };
  assert.equal(overviewShouldRegenerate({ alert_entities: [{ entity: "binary_sensor.x" }] }, a, { ...a, states }), true);
});

test("summaries lead to the configured pages; a page of your own replaces a missing built-in one", async () => {
  const pages = { light: "/lights-plus/0", media_players: "/media-plus" };
  const { view } = await generateOverviewView(hass(), { summary_pages: pages });
  const cards = section(view, "Summaries").cards;
  const tap = (key) => cards.find((c) => c.summary === key)?.tap_action?.navigation_path;
  assert.equal(tap("light"), "/lights-plus/0");
  assert.equal(tap("climate"), "/climate?historyBack=1", "not configured: Home Assistant's page");

  const noPanels = hass({ panels: {} });
  const res = await generateOverviewView(noPanels, { summary_pages: { light: "/lights-plus/0" } });
  const summaries = section(res.view, "Summaries").cards.map((c) => c.summary).filter(Boolean);
  assert.ok(summaries.includes("light"), "own page: shown without Home Assistant's light page");
  assert.ok(!summaries.includes("climate"));
});
