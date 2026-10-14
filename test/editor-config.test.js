import { test } from "node:test";
import assert from "node:assert/strict";
import { fromForm, toForm } from "../src/editor/editor-config.js";

const FULL = {
  type: "custom:overview-plus",
  favorite_entities: ["light.lamp"],
  debug: true,
  load_home_settings: false,
  card_rules: [{ match: { integration: "better_thermostat" }, card: { type: "custom:bt" } }],
  area_overrides: {
    proxmox: {
      badges: false,
      show_other_devices: false,
      future_option: 42,
      sections: [
        { title: "Hypervisor", icon: "mdi:server", match: { label: "virt-hypervisor" }, layout: "devices" },
        { title: "VMs", match: { label: ["virt-guest", "virt-lxc"] }, layout: "compact", primary: { domain: "binary_sensor" } },
        { title: "Exporter", match: { integration: "mqtt", manufacturer: "Proxmox" }, entities: { include_domains: ["sensor"] } },
        { title: "Either", match: [{ domain: "light" }, { domain: "switch" }] },
      ],
    },
    truenas: { badges: ["sensor.pool_usage"], show_automations: false },
  },
};

test("round trip keeps the configuration unchanged", () => {
  assert.deepEqual(fromForm(toForm(FULL), FULL), FULL);
});

test("minimal config round trips without adding keys", () => {
  const min = { type: "custom:overview-plus" };
  assert.deepEqual(fromForm(toForm(min), min), min);
});

test("label-only matches become the label shortcut", () => {
  const form = toForm(FULL);
  const [hyper, vms, exporter, either] = form.areas[0].sections;
  assert.deepEqual([hyper.labels, hyper.match], [["virt-hypervisor"], undefined]);
  assert.deepEqual(vms.labels, ["virt-guest", "virt-lxc"]);
  assert.deepEqual([exporter.labels, exporter.match], [[], { integration: "mqtt", manufacturer: "Proxmox" }]);
  assert.ok(Array.isArray(either.match));
});

test("badges modes", () => {
  const form = toForm(FULL);
  assert.equal(form.areas[0].badges, "none");
  assert.deepEqual([form.areas[1].badges, form.areas[1].badge_entities], ["custom", ["sensor.pool_usage"]]);
});

test("editing in the form produces the expected config", () => {
  const original = { type: "custom:overview-plus", favorite_entities: ["x.y"] };
  const form = toForm(original);
  form.areas.push({
    area: "network",
    badges: "default",
    badge_entities: [],
    show_other_devices: true,
    show_automations: true,
    sections: [
      { title: "Switches", icon: "mdi:switch", layout: "table", labels: ["net-switch"], match: { integration: "unifi" } },
      { title: "", labels: [], match: undefined },
    ],
  });
  form.debug = true;
  assert.deepEqual(fromForm(form, original), {
    type: "custom:overview-plus",
    favorite_entities: ["x.y"],
    debug: true,
    area_overrides: {
      network: {
        sections: [
          { title: "Switches", icon: "mdi:switch", layout: "table", match: { integration: "unifi", label: "net-switch" } },
          {},
        ],
      },
    },
  });
});

test("areas without an area id are dropped", () => {
  const form = toForm({});
  form.areas.push({ sections: [] });
  assert.deepEqual(fromForm(form, {}), {});
});

test("an area with default options and no sections produces no override", () => {
  const form = toForm({});
  form.areas.push({ area: "proxmox", badges: "default", badge_entities: [], show_other_devices: true, show_automations: true, sections: [] });
  assert.deepEqual(fromForm(form, {}), {});
});
