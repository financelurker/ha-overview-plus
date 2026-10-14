import { test } from "node:test";
import assert from "node:assert/strict";
import { matches } from "../src/matcher.js";
import { entityContext } from "../src/registry.js";
import { substitute } from "../src/card-factory.js";
import { makeHass } from "./fixtures.js";

const hass = makeHass();
const ctx = (id) => entityContext(hass, id);

test("criteria are AND-combined, lists OR-combined", () => {
  assert.ok(matches({ domain: "climate", integration: "better_thermostat" }, ctx("climate.living")));
  assert.ok(!matches({ domain: "climate", integration: "demo" }, ctx("climate.living")));
  assert.ok(matches([{ domain: "light" }, { domain: "climate" }], ctx("climate.living")));
  assert.ok(matches({ domain: ["light", "climate"] }, ctx("climate.living")));
});

test("empty spec matches everything", () => {
  assert.ok(matches(undefined, ctx("light.lamp")));
  assert.ok(matches({}, ctx("light.lamp")));
  assert.ok(matches([], ctx("light.lamp")));
});

test("device criteria: regex, labels, area inheritance, floor", () => {
  assert.ok(matches({ manufacturer: "^proxmox$" }, ctx("sensor.pve_cpu")));
  assert.ok(!matches({ manufacturer: "^proxmox$" }, ctx("sensor.exporter_load")));
  assert.ok(matches({ device_name: "web|db" }, ctx("sensor.vm_db_cpu")));
  assert.ok(matches({ label: "virt-guest" }, ctx("sensor.vm_db_cpu")));
  assert.ok(matches({ device_label: "virt-guest" }, ctx("sensor.vm_db_cpu")));
  assert.ok(!matches({ entity_label: "virt-guest" }, ctx("sensor.vm_db_cpu")));
  assert.ok(matches({ area: "proxmox", floor: "virtual" }, ctx("sensor.vm_db_cpu")));
});

test("not, device_class and entity_category", () => {
  assert.ok(matches({ domain: "sensor", not: { device_class: "battery" } }, ctx("sensor.living_temp")));
  assert.ok(!matches({ domain: "sensor", not: { device_class: "battery" } }, ctx("sensor.trv_battery")));
  assert.ok(matches({ entity_category: "diagnostic" }, ctx("sensor.trv_battery")));
  assert.ok(matches({ device_class: "none" }, ctx("switch.plug")));
});

test("invalid regex does not throw", () => {
  assert.ok(!matches({ device_name: "(" }, ctx("sensor.vm_db_cpu")));
});

test("substitute replaces placeholders but not similar words", () => {
  const out = substitute(
    { a: "$entity", b: "/x/$device", c: "$entities", d: ["$entities", "y"], e: "$entityfoo" },
    { entity: "light.a", device: "d1", entities: ["e1", "e2"] }
  );
  assert.deepEqual(out, { a: "light.a", b: "/x/d1", c: ["e1", "e2"], d: ["e1", "e2", "y"], e: "$entityfoo" });
});
