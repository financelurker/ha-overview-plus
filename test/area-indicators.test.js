import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { activeIndicators, resolveIndicator, watchedIndicatorEntities } from "../src/area-indicators.js";
import { indicatorsFromForm, indicatorsToForm } from "../src/editor/editor-config.js";

const st = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });
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
  assert.deepEqual(watchedIndicatorEntities(h, "room", explicit), ["binary_sensor.room_motion"]);
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

// ------------------------------------------------------------------ tile

const win = new Window({ url: "http://ha.local/" });
for (const key of ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event"]) globalThis[key] = win[key];
for (const tag of ["ha-card", "ha-tile-container", "ha-tile-icon", "ha-tile-info", "ha-tile-badge", "ha-state-icon", "ha-icon"]) {
  win.customElements.define(tag, class extends win.HTMLElement {});
}
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
