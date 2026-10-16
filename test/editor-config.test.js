import { test } from "node:test";
import assert from "node:assert/strict";
import { fieldsToMatch, fromForm, matchToFields, toForm } from "../src/editor/editor-config.js";

const FULL = {
  type: "custom:overview-plus",
  favorite_entities: ["light.lamp"],
  debug: true,
  load_home_settings: false,
  strip_area_names: false,
  lazy_render: false,
  card_rules: [
    { match: { integration: "better_thermostat", domain: "climate" }, card: { type: "custom:bt" } },
    { match: { entity: "climate.bath" }, card: { name: "Bath", icon: "mdi:bathtub" } },
    { match: { label: "hidden" }, card: false, stop: true },
    { match: { domain: "camera" }, contexts: ["area"], card: { type: "picture-entity", show_state: false } },
    { match: { label: "virt-guest" }, scope: "device", card: { type: "entities", title: "$device", entities: "$entities" } },
  ],
  area_overrides: {
    proxmox: {
      badges: false,
      show_other_devices: false,
      future_option: 42,
      sections: [
        { title: "Hypervisor", icon: "mdi:server", match: { label: "virt-hypervisor" }, layout: "devices" },
        { title: "VMs", match: { label: ["virt-guest", "virt-lxc"] }, layout: "compact", primary: { domain: "binary_sensor", device_class: "running" } },
        {
          title: "Exporter",
          match: { integration: "mqtt", manufacturer: "Proxmox", device_name: "^pve", not: { entity_category: "config" } },
          entities: { include_domains: ["sensor"], exclude: ["sensor.x"] },
        },
        { title: "Either", match: [{ domain: "light" }, { domain: "switch" }], primary: { domain: "sensor", not: { device_class: "x" } } },
      ],
    },
    truenas: { badges: ["sensor.pool_usage"], show_automations: false, tile: { sensor_classes: [], alert_classes: ["problem"], color: "blue", name: "NAS", aspect_ratio: "1" } },
    network: { tile: { alert_classes: ["connectivity"] } },
    proxmox_tile: { tile: { entities: ["sensor.cpu", { entity: "sensor.ram", name: "RAM" }], show_names: true, alert_entities: ["binary_sensor.vm"] } },
  },
};

test("round trip keeps the configuration unchanged", () => {
  assert.deepEqual(fromForm(toForm(FULL), FULL), FULL);
});

test("minimal config round trips without adding keys", () => {
  const min = { type: "custom:overview-plus" };
  assert.deepEqual(fromForm(toForm(min), min), min);
});

test("selections become form fields, including exclusions", () => {
  const [, vms, exporter] = toForm(FULL).areas[0].sections;
  assert.deepEqual(vms.m_label, ["virt-guest", "virt-lxc"]);
  assert.deepEqual([vms.p_domain, vms.p_device_class], [["binary_sensor"], ["running"]]);
  assert.deepEqual(
    { i: exporter.m_integration, m: exporter.m_manufacturer, n: exporter.m_device_name, x: exporter.m_not_entity_category },
    { i: ["mqtt"], m: ["Proxmox"], n: ["^pve"], x: ["config"] }
  );
  assert.deepEqual([exporter.e_include_domains, exporter.e_exclude], [["sensor"], ["sensor.x"]]);
  assert.equal(exporter.m_yaml, undefined);
});

test("only constructs a form cannot show fall back to YAML", () => {
  const either = toForm(FULL).areas[0].sections[3];
  assert.ok(Array.isArray(either.m_yaml), "OR list stays YAML");
  assert.deepEqual(either.p_yaml, { domain: "sensor", not: { device_class: "x" } });
  assert.deepEqual(matchToFields({ entity_label: "x" }), { m_yaml: { entity_label: "x" } });
  assert.deepEqual(matchToFields({ device_label: "x" }), { m_yaml: { device_label: "x" } });
  assert.deepEqual(matchToFields({ not: [{ domain: "a" }] }), { m_yaml: { not: [{ domain: "a" }] } });
});

test("card rules become form fields", () => {
  const [bt, bath, hide, camera, device] = toForm(FULL).rules;
  assert.deepEqual([bt.r_action, bt.r_type, bt.m_integration, bt.m_domain], ["replace", "custom:bt", ["better_thermostat"], ["climate"]]);
  assert.deepEqual([bath.r_action, bath.r_name, bath.r_icon], ["adjust", "Bath", "mdi:bathtub"]);
  assert.deepEqual([hide.r_action, hide.r_stop], ["hide", true]);
  assert.deepEqual([camera.r_contexts, camera.r_options], [["area"], { show_state: false }]);
  assert.deepEqual([device.r_scope, device.r_options], ["device", { title: "$device", entities: "$entities" }]);
});

test("editing card rules in the form", () => {
  const form = toForm({});
  form.rules.push({ r_action: "replace", r_type: "custom:bt", r_scope: "entity", m_integration: ["better_thermostat"] });
  form.rules.push({ r_action: "adjust", r_name: "Bad", r_scope: "entity", m_entity: ["climate.bad"] });
  form.rules.push({ r_action: "hide", r_scope: "entity", m_label: ["hidden"], r_type: "ignored-when-hidden" });
  assert.deepEqual(fromForm(form, {}).card_rules, [
    { match: { integration: "better_thermostat" }, card: { type: "custom:bt" } },
    { match: { entity: "climate.bad" }, card: { name: "Bad" } },
    { match: { label: "hidden" }, card: false },
  ]);
});

test("editing a section in the form", () => {
  const original = { type: "custom:overview-plus", favorite_entities: ["x.y"] };
  const form = toForm(original);
  form.areas.push({
    area: "network", badges: "default", badge_entities: [], show_other_devices: true, show_automations: true,
    sections: [
      { title: "Switches", icon: "mdi:switch", layout: "table", m_label: ["net-switch"], m_integration: ["unifi"], m_not_domain: ["button"], e_include_domains: ["sensor", "switch"] },
      { title: "", m_label: [] },
    ],
  });
  assert.deepEqual(fromForm(form, original), {
    type: "custom:overview-plus",
    favorite_entities: ["x.y"],
    area_overrides: {
      network: {
        sections: [
          {
            title: "Switches", icon: "mdi:switch", layout: "table",
            match: { label: "net-switch", integration: "unifi", not: { domain: "button" } },
            entities: { include_domains: ["sensor", "switch"] },
          },
          {},
        ],
      },
    },
  });
});

test("clearing the YAML fallback switches back to the fields", () => {
  assert.deepEqual(fieldsToMatch({ m_yaml: [{ domain: "light" }], m_domain: ["switch"] }), [{ domain: "light" }]);
  assert.deepEqual(fieldsToMatch({ m_yaml: undefined, m_domain: ["switch"] }), { domain: "switch" });
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

test("every criterion has a list field, also as exclusion", () => {
  const match = {
    label: ["a", "b"], integration: "mqtt", domain: ["sensor"], device_class: "none", entity_category: "diagnostic",
    manufacturer: "^APC$", model: ["x", "y"], device: ["d1"], device_name: ["^pve", "nas"], entity: "sensor.a",
    area: "proxmox", floor: ["virtual"],
    not: { device: "d2", manufacturer: "Foo", device_name: "test", area: "x", floor: "y", label: "l", entity: ["e"] },
  };
  const fields = matchToFields(match);
  assert.equal(fields.m_yaml, undefined);
  assert.deepEqual(fields.m_device_name, ["^pve", "nas"]);
  assert.deepEqual(fields.m_not_device, ["d2"]);
  // one-element lists are stored as single values (same meaning at runtime)
  const single = (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v);
  const normalize = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, k === "not" ? normalize(v) : single(v)]));
  assert.deepEqual(fieldsToMatch(fields), normalize(match));
});

test("primary entity accepts several domains and device classes", () => {
  const config = { area_overrides: { p: { sections: [{ layout: "compact", match: { label: "x" }, primary: { domain: ["binary_sensor", "switch"] } }] } } };
  const form = toForm(config);
  assert.deepEqual(form.areas[0].sections[0].p_domain, ["binary_sensor", "switch"]);
  assert.deepEqual(fromForm(form, config), config);
});

test("a device rule cannot adjust a card: it is stored as replace", () => {
  const form = toForm({});
  form.rules.push({ r_action: "adjust", r_scope: "device", r_type: "entities", m_label: ["x"] });
  assert.deepEqual(fromForm(form, {}).card_rules, [{ match: { label: "x" }, scope: "device", card: { type: "entities" } }]);
});

test("area tile options: default vs selected sensor classes", () => {
  const form = toForm({});
  form.areas.push({ area: "a", badges: "default", t_sensors: "custom", t_sensor_classes: [], t_alert_classes: [], sections: [] });
  form.areas.push({ area: "b", badges: "default", t_sensors: "default", t_sensor_classes: ["power"], t_alert_classes: ["running"], sections: [] });
  assert.deepEqual(fromForm(form, {}).area_overrides, {
    a: { tile: { sensor_classes: [] } },
    b: { tile: { alert_classes: ["running"] } },
  });
});

test("popup on tap: form fields and round trip", () => {
  const config = {
    card_rules: [
      { match: { domain: "climate" }, card: { type: "custom:mini" }, tap: { popup: { type: "thermostat", features: [] } } },
      { match: { domain: "light" }, tap: { popup: { type: "light" } } },
      { match: { domain: "fan" }, tap: false },
    ],
  };
  const form = toForm(config);
  assert.deepEqual([form.rules[0].r_tap, form.rules[0].r_popup_type, form.rules[0].r_popup_options], ["popup", "thermostat", { features: [] }]);
  assert.deepEqual([form.rules[1].r_action, form.rules[1].r_tap], ["adjust", "popup"]);
  assert.equal(form.rules[2].r_tap, "default");
  assert.deepEqual(fromForm(form, config), config);
});

test("choosing a popup in the form", () => {
  const form = toForm({});
  form.rules.push({ r_action: "adjust", r_scope: "entity", r_tap: "popup", r_popup_type: "thermostat", m_domain: ["climate"] });
  form.rules.push({ r_action: "replace", r_type: "tile", r_scope: "entity", r_tap: "default", r_popup_type: "ignored", m_domain: ["light"] });
  assert.deepEqual(fromForm(form, {}).card_rules, [
    { match: { domain: "climate" }, tap: { popup: { type: "thermostat" } } },
    { match: { domain: "light" }, card: { type: "tile" } },
  ]);
});

test("overview page settings round trip", () => {
  const config = {
    load_home_settings: false,
    favorite_entities: ["light.a", "light.b"],
    hide_welcome_message: true,
    shortcuts: [
      { type: "custom", path: "/map", label: "Map", icon: "mdi:map" },
      { type: "summary", key: "climate" },
      { type: "summary", key: "light", hidden: true },
      { type: "summary", key: "security" },
      { type: "summary", key: "media_players" },
      { type: "summary", key: "maintenance" },
      { type: "summary", key: "weather" },
      { type: "summary", key: "energy" },
    ],
    alert_entities: [{ entity: "binary_sensor.door", severity: "alert" }, { entity: "lock.front" }],
  };
  assert.deepEqual(fromForm(toForm(config), config), config);
  // default summaries are not written
  const plain = { load_home_settings: false, shortcuts: [{ type: "summary", key: "light" }] };
  assert.deepEqual(fromForm(toForm(plain), plain), { load_home_settings: false });
});

test("summary pages: only configured ones are written", () => {
  const config = { summary_pages: { light: "/lights-plus/0", security: "/alarm" } };
  assert.deepEqual(fromForm(toForm(config), config), config);
  const form = toForm({});
  form.summary_pages = { light: "", climate: "/heat" };
  assert.deepEqual(fromForm(form, {}), { summary_pages: { climate: "/heat" } });
});
