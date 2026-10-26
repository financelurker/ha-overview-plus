import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.js";
import { st } from "./fixtures.js";
import { activeIndicators, prepareIndicators, resolveIndicator, watchedIndicators } from "../src/area-indicators.js";
import { indicatorsFromForm, indicatorsToForm } from "../src/editor/editor-config.js";

function hass() {
  const states = Object.fromEntries([
    st("binary_sensor.room_occupied", "on", { device_class: "occupancy" }),
    st("binary_sensor.room_motion", "on", { device_class: "motion" }),
    st("binary_sensor.office_presence", "off", { device_class: "presence" }),
    st("climate.room_trv", "heat", { hvac_action: "heating" }),
    st("climate.office_trv", "heat", { hvac_action: "idle" }),
    st("humidifier.room_hygrostat", "on", { action: "humidifying" }),
    st("media_player.room_tv", "playing", { device_class: "tv" }),
    st("binary_sensor.room_window", "off", { device_class: "window" }),
    st("binary_sensor.room_diag", "on", { device_class: "occupancy" }),
    st("sensor.washer", "running"),
  ].map((s) => [s.entity_id, s]));
  const entities = {
    "binary_sensor.room_occupied": { area_id: "room" },
    "binary_sensor.room_motion": { area_id: "room" },
    "binary_sensor.office_presence": { area_id: "office" },
    "climate.room_trv": { device_id: "trv" },
    "climate.office_trv": { area_id: "office" },
    "humidifier.room_hygrostat": { area_id: "room" },
    "media_player.room_tv": { area_id: "room" },
    "binary_sensor.room_window": { area_id: "room" },
    "binary_sensor.room_diag": { area_id: "room", entity_category: "diagnostic" },
    "sensor.washer": { area_id: "cellar" },
  };
  return { states, entities, devices: { trv: { id: "trv", area_id: "room" } }, areas: {} };
}

const ALL = ["occupied", "heating", "humidifying", "window_open", "media_playing"].map((preset) => ({ preset }));

test("presets detect the states of an area from its entities (also via the device)", () => {
  const active = activeIndicators(hass(), "room", ALL);
  assert.deepEqual(active.map((i) => i.key), ["occupied", "heating", "humidifying", "media_playing"]);
  assert.deepEqual(active[0].entities, ["binary_sensor.room_occupied"], "motion and diagnostic sensors do not count as occupancy");
  assert.equal(active[0].style, "tile");
  assert.equal(active[1].style, "icon");
  assert.equal(active.find((i) => i.key === "media_playing").icon, "mdi:television-play", "icon by device class");
  assert.deepEqual(activeIndicators(hass(), "office", ALL), [], "office: presence off, thermostat idle");
});

test("any matching entity makes the indicator active; an explicit entity replaces the search", () => {
  const h = hass();
  h.states["binary_sensor.room_occupied"].state = "off";
  assert.deepEqual(activeIndicators(h, "room", [{ preset: "occupied" }]), []);
  const explicit = [{ preset: "occupied", entity: "binary_sensor.room_motion" }];
  assert.deepEqual(activeIndicators(h, "room", explicit)[0].entities, ["binary_sensor.room_motion"]);
  assert.deepEqual(watchedIndicators(prepareIndicators(h, "room", explicit)).entities, ["binary_sensor.room_motion"]);
});

test("own indicators: entity + state, overrides of presets", () => {
  const own = [{ name: "Washer", entity: "sensor.washer", state: "running", icon: "mdi:washing-machine", color: "purple" }];
  assert.deepEqual(activeIndicators(hass(), "cellar", own), [
    { key: "Washer", name: "Washer", icon: "mdi:washing-machine", color: "purple", style: "icon", entities: ["sensor.washer"] },
  ]);
  const heating = resolveIndicator({ preset: "heating", style: "tile", color: "red" });
  assert.deepEqual([heating.style, heating.color, heating.attribute], ["tile", "red", "hvac_action"]);
  assert.equal(resolveIndicator({ preset: "nope" }), undefined);
});

test("normalized config: unquoted on/off, states and device classes as text, bad entries", () => {
  const h = hass();
  h.states["switch.plug"] = st("switch.plug", "on");
  h.entities["switch.plug"] = { area_id: "room" };
  assert.equal(activeIndicators(h, "room", [{ name: "Plug", entity: "switch.plug", state: true }]).length, 1, "YAML on = true");
  assert.equal(activeIndicators(h, "room", [{ name: "Plug", entity: "switch.plug", states: "on" }]).length, 1, "states as text");
  assert.equal(activeIndicators(h, "room", [{ name: "Occ", domain: "binary_sensor", device_classes: "occupancy" }]).length, 1);
  assert.equal(activeIndicators(h, "room", [{ name: "Part", domain: "binary_sensor", device_classes: "occ" }]).length, 0, "no substring match");
  assert.deepEqual(activeIndicators(h, "room", [null, "x", { preset: "nope" }, 42]), [], "bad entries are skipped");
});

test("attribute indicators and states that arrive after the registry was read", () => {
  const h = hass();
  h.states["climate.room_trv"].attributes.preset_mode = "eco";
  const boost = [{ name: "Boost", domain: "climate", attribute: "preset_mode", state: "boost" }];
  const prepared = prepareIndicators(h, "room", boost);
  assert.deepEqual(watchedIndicators(prepared).attributes, ["preset_mode"]);
  assert.equal(activeIndicators(h, "room", boost).length, 0);
  h.states["climate.room_trv"].attributes.preset_mode = "boost";
  assert.equal(activeIndicators(h, "room", boost).length, 1);
  // registry entry without state yet: candidate anyway, the device class is checked later
  h.entities["binary_sensor.room_radar"] = { area_id: "room" };
  const occupied = prepareIndicators(h, "room", [{ preset: "occupied" }]);
  assert.ok(occupied[0].candidates.includes("binary_sensor.room_radar"));
});

test("an area found through the parent device", () => {
  const h = hass();
  h.devices.child = { id: "child", parent_device_id: "trv" };
  h.states["humidifier.child"] = st("humidifier.child", "on", { action: "drying" });
  h.entities["humidifier.child"] = { device_id: "child" };
  assert.deepEqual(activeIndicators(h, "room", [{ preset: "drying" }])[0].entities, ["humidifier.child"]);
});

test("editor form: enabled presets in order, the others disabled; own ones kept", () => {
  const config = [{ preset: "heating", color: "red" }, { name: "Washer", entity: "sensor.washer", state: "running" }, { preset: "occupied" }];
  const items = indicatorsToForm(config);
  assert.deepEqual(items.slice(0, 3).map((i) => i.preset ?? "custom"), ["heating", "custom", "occupied"]);
  assert.ok(items.slice(3).every((i) => i.enabled === false));
  assert.deepEqual(indicatorsFromForm(items), config);
  items.find((i) => i.preset === "lights_on").enabled = true;
  items.find((i) => i.preset === "occupied").style = "tile"; // same as the preset: not written
  assert.deepEqual(indicatorsFromForm(items).at(-1), { preset: "lights_on" });
  assert.equal(indicatorsFromForm(indicatorsToForm(undefined)), undefined, "nothing enabled: no key");
});

test("editor form keeps what it cannot edit: unknown presets, duplicates, other values", () => {
  const config = [{ preset: "future_preset" }, { preset: "occupied", entity: "a" }, { preset: "occupied", entity: "b", name: "Guest" }, "lights_on"];
  assert.deepEqual(indicatorsFromForm(indicatorsToForm(config)), config);
});

// ------------------------------------------------------------------ tile

const win = installDom({ stubs: ["ha-card", "ha-tile-container", "ha-tile-icon", "ha-tile-info", "ha-tile-badge", "ha-state-icon", "ha-icon"] });
await import("../src/area-tile-card.js");

function tile(indicators, h = hass()) {
  const el = document.createElement("overview-plus-area-tile");
  el.setConfig({ type: "custom:overview-plus-area-tile", area: "room", vertical: true, indicators });
  el.hass = h;
  document.body.appendChild(el);
  return el.shadowRoot;
}

test("tile: occupied tints the tile, other states are chips above the room icon", () => {
  const root = tile(ALL);
  const card = root.querySelector("ha-card");
  assert.ok(card.classList.contains("tinted"));
  assert.equal(card.style.getPropertyValue("--indicator-color"), "var(--blue-color)");
  const chips = [...root.querySelectorAll(".chips .chip")];
  assert.deepEqual(chips.map((c) => c.querySelector("ha-icon")?.icon), ["mdi:fire", "mdi:water", "mdi:television-play"]);
  assert.equal(chips[0].title, "Heating");
});

test("tile: more than four chips end with +N; without indicators nothing changes", () => {
  const many = ["heating", "humidifying", "media_playing"].map((preset) => ({ preset }));
  const h = hass();
  h.states["binary_sensor.room_window"].state = "on";
  const extra = [...many, { preset: "window_open" }, { name: "Occupied too", entity: "binary_sensor.room_occupied" }];
  const chips = [...tile(extra, h).querySelectorAll(".chip")];
  assert.equal(chips.length, 4);
  assert.equal(chips.at(-1).textContent, "+2");
  const plain = tile(undefined);
  assert.equal(plain.querySelector(".chips"), null);
  assert.ok(!plain.querySelector("ha-card").classList.contains("tinted"));
});

test("tile without entities shows the area's temperature like the area card", () => {
  const h = hass();
  h.states["sensor.room_temp"] = st("sensor.room_temp", "21.5", { unit_of_measurement: "°C", device_class: "temperature" });
  h.areas = { room: { area_id: "room", name: "Room", temperature_entity_id: "sensor.room_temp" } };
  h.formatEntityState = (s, v) => `${v ?? s.state} ${s.attributes.unit_of_measurement}`;
  const root = tile([{ preset: "occupied" }], h);
  assert.equal(root.querySelector("ha-tile-info").secondary, "21.5 °C");
});

test("tile re-renders when a compared attribute or a late state changes", () => {
  const h = hass();
  h.states["climate.room_trv"].attributes.preset_mode = "eco";
  const el = document.createElement("overview-plus-area-tile");
  el.setConfig({ type: "custom:overview-plus-area-tile", area: "room", vertical: true,
    indicators: [{ name: "Boost", domain: "climate", attribute: "preset_mode", state: "boost" }, { preset: "occupied" }] });
  h.states["binary_sensor.room_occupied"] = st("binary_sensor.room_occupied", "off", { device_class: "occupancy" });
  el.hass = h;
  document.body.appendChild(el);
  assert.equal(el.shadowRoot.querySelector(".chip"), null);
  const next = { ...h, states: { ...h.states, "climate.room_trv": st("climate.room_trv", "heat", { hvac_action: "heating", preset_mode: "boost" }) } };
  el.hass = next;
  assert.equal(el.shadowRoot.querySelectorAll(".chip").length, 1, "attribute change re-renders");
  assert.equal(el.shadowRoot.querySelector(".chip").title, "Boost");
  // a sensor whose state (with its device class) arrives only now
  const later = { ...next, entities: next.entities, states: { ...next.states, "binary_sensor.room_occupied": st("binary_sensor.room_occupied", "on", { device_class: "occupancy" }) } };
  el.hass = later;
  assert.ok(el.shadowRoot.querySelector("ha-card").classList.contains("tinted"));
});

test("tile: own state without name is called by the entity; screen reader text; space kept", () => {
  const h = hass();
  h.states["sensor.washer"].attributes.friendly_name = "Washing machine";
  h.entities["sensor.washer"] = { area_id: "room" };
  const root = tile([{ entity: "sensor.washer", state: "running" }, { preset: "lights_on" }], h);
  assert.equal(root.querySelector(".chip").title, "Washing machine");
  assert.equal(root.querySelector(".sr-only").textContent, "Washing machine");
  const quiet = tile([{ preset: "lights_on" }]);
  assert.ok(quiet.querySelector("ha-card").classList.contains("has-indicators"), "same layout with or without active states");
});

test("tile: average of several sensors of a class, sensor_classes override", () => {
  const h = hass();
  h.formatEntityState = (s, v) => `${v ?? s.state} ${s.attributes.unit_of_measurement}`;
  h.states["sensor.a"] = st("sensor.a", "20", { unit_of_measurement: "°C", device_class: "temperature" });
  h.states["sensor.b"] = st("sensor.b", "23", { unit_of_measurement: "°C", device_class: "temperature" });
  h.states["sensor.hum"] = st("sensor.hum", "40", { unit_of_measurement: "%", device_class: "humidity" });
  Object.assign(h.entities, { "sensor.a": { area_id: "room" }, "sensor.b": { area_id: "room" }, "sensor.hum": { area_id: "room" } });
  const el = document.createElement("overview-plus-area-tile");
  el.setConfig({ type: "custom:overview-plus-area-tile", area: "room", sensor_classes: ["temperature", "humidity"] });
  el.hass = h;
  assert.equal(el.shadowRoot.querySelector("ha-tile-info").secondary, "21.5 °C · 40 %");
});
