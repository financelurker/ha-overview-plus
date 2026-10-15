import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMediaPlayersView, generateOtherDevicesView } from "../src/views/media-devices-views.js";
import { makeHass } from "./fixtures.js";

function hass() {
  const h = makeHass({
    floors: { ground: { floor_id: "ground", name: "Ground", level: 0 }, virtual: { floor_id: "virtual", name: "Virtual" } },
  });
  const add = (id, entity, state = "on", attributes = {}) => {
    h.states[id] = { entity_id: id, state, attributes };
    h.entities[id] = { entity_id: id, platform: "demo", labels: [], ...entity };
  };
  // media players: one in the living room, one without area
  add("media_player.radio", {});
  // devices without area
  h.devices.dev_free = { id: "dev_free", area_id: null, name: "Garden pump", labels: [] };
  add("switch.pump", { device_id: "dev_free", name: "Pump" });
  add("sensor.pump_rssi", { device_id: "dev_free", entity_category: "diagnostic" });
  add("automation.x", { device_id: "dev_free", platform: "automation" });
  h.devices.dev_phone = { id: "dev_phone", area_id: null, name: "Phone", labels: [] };
  add("sensor.phone_battery", { device_id: "dev_phone", platform: "mobile_app" });
  return h;
}

test("media players: grouped by floor and area, then players without area", () => {
  const view = generateMediaPlayersView(hass());
  assert.equal(view.max_columns, 2);
  const [ground, other] = view.sections;
  assert.equal(ground.cards[0].heading, "Ground");
  assert.equal(ground.cards[0].icon, "mdi:home-floor-0");
  assert.deepEqual(ground.cards[1], {
    heading_style: "subtitle", type: "heading", heading: "Living room",
    tap_action: { action: "navigate", navigation_path: "areas-living_room" },
  });
  assert.deepEqual(ground.cards[2], { type: "media-control", entity: "media_player.tv" });
  assert.equal(other.cards[0].heading, "Other media players");
  assert.deepEqual(other.cards[1], { type: "media-control", entity: "media_player.radio" });
});

test("media players: card rules (context media) and area names removed", () => {
  const h = hass();
  h.states["media_player.tv"].attributes.friendly_name = "Living room TV";
  const view = generateMediaPlayersView(h, { card_rules: [{ match: { entity: "media_player.radio" }, contexts: ["media"], card: { type: "custom:mini-media-player" } }] });
  assert.equal(view.sections[0].cards[2].name, "TV");
  assert.equal(view.sections[1].cards[1].type, "custom:mini-media-player");
});

test("devices view: one section per area-less device, primary entities only, helper platforms left out", () => {
  const view = generateOtherDevicesView(hass());
  assert.equal(view.sections.length, 1, "phone (mobile_app) is left out");
  const [pump] = view.sections;
  assert.equal(pump.cards[0].heading, "Garden pump");
  assert.equal(pump.cards[0].tap_action.navigation_path, "/config/devices/device/dev_free");
  assert.deepEqual(pump.cards[1], { type: "entities", entities: [{ entity: "switch.pump", name: { type: "entity" } }] });
  assert.equal(pump.column_span, 2);
});

test("devices view: device rules replace the card, hide rules remove rows or devices", () => {
  const replaced = generateOtherDevicesView(hass(), { card_rules: [{ scope: "device", match: { device: "dev_free" }, card: { type: "glance", entities: "$entities" } }] });
  assert.deepEqual(replaced.sections[0].cards[1], { type: "glance", entities: ["switch.pump"] });
  const hidden = generateOtherDevicesView(hass(), { card_rules: [{ match: { entity: "switch.pump" }, contexts: ["devices"], card: false }] });
  assert.equal(hidden.type, "panel", "no rows left → empty state");
  assert.equal(hidden.cards[0].title, "All devices are organized");
});
