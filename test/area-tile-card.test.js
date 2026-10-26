import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.js";
import { makeHass } from "./fixtures.js";

const win = installDom({ stubs: ["ha-card", "ha-tile-container", "ha-tile-icon", "ha-tile-info", "ha-tile-badge", "ha-state-icon"] });

const { AREA_TILE_TYPE } = await import("../src/area-tile-card.js");
const { generateOverviewView } = await import("../src/views/overview-view.js");

function hass() {
  const h = makeHass();
  h.formatEntityState = (s) => `${s.state}${s.attributes.unit_of_measurement ? ` ${s.attributes.unit_of_measurement}` : ""}`;
  h.formatEntityName = (s) => ({ "sensor.pve_cpu": "CPU", "sensor.vm_web_cpu": "Web CPU" })[s.entity_id] ?? s.entity_id;
  h.areas.proxmox.icon = "mdi:server";
  return h;
}

function tile(config, h = hass()) {
  const el = document.createElement("overview-plus-area-tile");
  el.setConfig({ type: AREA_TILE_TYPE, area: "proxmox", tap_action: { action: "navigate", navigation_path: "areas-proxmox" }, vertical: true, ...config });
  el.layout = "grid";
  el.hass = h;
  document.body.appendChild(el);
  return el;
}
const part = (el, tag) => el.shadowRoot.querySelector(tag);

test("value line shows the selected entities in order, with or without names", () => {
  const el = tile({ entities: ["sensor.pve_cpu", "sensor.vm_web_cpu", "sensor.gone"] });
  const info = part(el, "ha-tile-info");
  assert.equal(info.primary, "Proxmox");
  assert.equal(info.secondary, "12 % · 3", "missing entities are skipped, diagnostic-free choice");
  const named = tile({ entities: ["sensor.pve_cpu", { entity: "sensor.vm_web_cpu", name: "Web" }], show_names: true });
  assert.equal(part(named, "ha-tile-info").secondary, "CPU 12 % · Web 3");
});

test("diagnostic sensors can be shown", () => {
  const el = tile({ entities: ["sensor.pve_uptime"] });
  assert.equal(part(el, "ha-tile-info").secondary, "100");
});

test("icon, color, layout like the compact area card", () => {
  const el = tile({ entities: ["sensor.pve_cpu"], color: "blue", name: "Cluster" });
  assert.equal(part(el, "ha-tile-icon").icon, "mdi:server");
  assert.equal(part(el, "ha-card").style.getPropertyValue("--tile-color"), "var(--blue-color)");
  assert.equal(part(el, "ha-tile-info").primary, "Cluster");
  const container = part(el, "ha-tile-container");
  assert.equal(container.vertical, true);
  assert.equal(container.fixedInfoHeight, true);
  assert.equal(container.interactive, true);
  assert.deepEqual(el.getGridOptions(), { columns: 6, rows: 2, min_columns: 3, min_rows: 2 });
});

test("alert badge for alert entities and alert classes of the area", () => {
  const h = hass();
  assert.equal(part(tile({ alert_entities: ["binary_sensor.vm_db_status"] }, h), "ha-tile-badge"), null, "db is off");
  h.states["binary_sensor.vm_db_status"] = { ...h.states["binary_sensor.vm_db_status"], state: "on" };
  assert.ok(part(tile({ alert_entities: ["binary_sensor.vm_db_status"] }, h), "ha-tile-badge"));
  // running class: pve_status is on, in the area (children inherit the area)
  const byClass = tile({ alert_classes: ["running"] }, hass());
  assert.equal(part(byClass, "ha-state-icon").stateObj.entity_id, "binary_sensor.pve_status");
});

test("tap fires hass-action with the tile's config", () => {
  const el = tile({ entities: ["sensor.pve_cpu"] });
  let detail;
  el.addEventListener("hass-action", (ev) => (detail = ev.detail));
  part(el, "ha-tile-container").dispatchEvent(new CustomEvent("action", { detail: { action: "tap" } }));
  assert.equal(detail.action, "tap");
  assert.equal(detail.config.tap_action.navigation_path, "areas-proxmox");
});

test("re-renders only when a shown entity changes", () => {
  const h = hass();
  const el = tile({ entities: ["sensor.pve_cpu"] }, h);
  const before = part(el, "ha-tile-info");
  el.hass = { ...h, states: { ...h.states, "light.lamp": { ...h.states["light.lamp"], state: "on" } } };
  assert.equal(part(el, "ha-tile-info"), before, "unrelated change: no re-render");
  el.hass = { ...h, states: { ...h.states, "sensor.pve_cpu": { ...h.states["sensor.pve_cpu"], state: "50" } } };
  assert.equal(part(el, "ha-tile-info").secondary, "50 %");
});

test("overview uses the custom tile only when entities are selected", async () => {
  const withEntities = (await generateOverviewView(hass(), { area_overrides: { proxmox: { tile: { entities: ["sensor.pve_cpu"], color: "blue" } } } })).view;
  const card = withEntities.sections.flatMap((s) => s.cards).find((c) => c.area === "proxmox");
  assert.equal(card.type, AREA_TILE_TYPE);
  assert.deepEqual(card.entities, ["sensor.pve_cpu"]);
  assert.equal(card.tap_action.navigation_path, "areas-proxmox");
  assert.equal(card.display_type, undefined);

  const classesOnly = (await generateOverviewView(hass(), { area_overrides: { proxmox: { tile: { sensor_classes: [] } } } })).view;
  assert.equal(classesOnly.sections.flatMap((s) => s.cards).find((c) => c.area === "proxmox").type, "area");
});
