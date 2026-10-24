// Interaction tests for the visual editor in a simulated browser (happy-dom).
// ha-form is replaced by a stub that stores its properties; tests "edit" a form by
// dispatching value-changed like the real ha-form does. ha-expansion-panel and
// ha-button are not defined, so the editor uses its plain HTML fallbacks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { makeHass } from "./fixtures.js";

const win = new Window({ url: "http://ha.local/" });
for (const key of ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event"]) {
  globalThis[key] = win[key];
}
win.customElements.define("ha-form", class extends win.HTMLElement {});

const { EDITOR_TAG } = await import("../src/editor/editor.js");

function setup(config) {
  const editor = document.createElement(EDITOR_TAG);
  document.body.appendChild(editor);
  const events = [];
  editor.addEventListener("config-changed", (ev) => events.push(ev.detail.config));
  editor.hass = makeHass({
    floors: { ground: { floor_id: "ground", name: "Ground" }, virtual: { floor_id: "virtual", name: "Virtual" } },
    labels: { "virt-guest": { label_id: "virt-guest", name: "VM" } },
  });
  editor.setConfig(config);
  return { editor, events, last: () => events.at(-1) };
}

const root = (editor) => editor.shadowRoot;
const forms = (scope) => [...scope.querySelectorAll("ha-form")];
const fieldNames = (schema) => schema.flatMap((s) => (s.schema ? fieldNames(s.schema) : [s.name]));
const formWith = (scope, name) => forms(scope).find((f) => fieldNames(f.schema).includes(name));
const sectionForms = (scope) => forms(scope).filter((f) => fieldNames(f.schema).includes("layout"));
const edit = (form, patch) =>
  form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { ...form.data, ...patch } } }));
const buttons = (scope, text) => [...scope.querySelectorAll("button")].filter((b) => b.textContent === text);
const click = (el) => el.dispatchEvent(new Event("click"));
/** Ordered entity list of a field: its entity values, and helpers to pick, add and move. */
const entityList = (scope, field) => scope.querySelector(`.entity-list[data-field="${field}"]`);
const listValues = (list) => [...list.querySelectorAll(".entity-row ha-form")].map((f) => f.data.entity);
const addEntity = (list, entity) => edit(list.querySelector("ha-form.entity-add"), { entity });
const rowButton = (list, index, label) => buttons(list.querySelectorAll(".entity-row")[index], label)[0];

/** Area blocks (fallback <details>) with their summary text. */
const areaPanels = (editor) => [...root(editor).querySelectorAll("details.area-panel")];
const summary = (panel) => panel.querySelector(":scope > summary").textContent;
const areaPanel = (editor, name) => areaPanels(editor).find((p) => summary(p).startsWith(name));

/** Labels of the summaries and shortcuts list (panels and plain rows). */
const homeItemLabels = (editor) =>
  [...root(editor).querySelectorAll(".home-items > *")].map((el) =>
    el.matches("details") ? el.querySelector(":scope > summary > span").textContent : el.querySelector(".label").textContent
  );

const TWO_AREAS = {
  type: "custom:overview-plus",
  area_overrides: {
    proxmox: { badges: false, sections: [{ title: "Disks", layout: "devices", match: { label: "harddisk" } }] },
    living_room: { sections: [{ title: "A", match: { label: "a" } }, { title: "B", match: { label: "b" } }] },
  },
};

test("every customized area is its own block with a summary; general options separate", () => {
  const { editor } = setup(TWO_AREAS);
  assert.deepEqual(areaPanels(editor).map(summary), [
    "Virtual › Proxmox1 section · Badges: None",
    "Ground › Living room2 sections",
  ]);
  assert.deepEqual(sectionForms(areaPanel(editor, "Virtual › Proxmox")).map((f) => f.data.title), ["Disks"]);
  assert.deepEqual(sectionForms(areaPanel(editor, "Ground › Living room")).map((f) => f.data.title), ["A", "B"]);
  const general = root(editor).querySelector(".general");
  assert.ok(buttons(general, "Add rule").length === 1);
  assert.ok(formWith(general, "debug"));
  assert.ok(!areaPanels(editor).some((p) => formWith(p, "r_action")));
});

test("'add area' offers only areas without a layout", () => {
  const { editor } = setup(TWO_AREAS);
  const add = formWith(root(editor), "add_area");
  assert.deepEqual(add.schema[0].selector.select.options.map((o) => o.label), ["Empty"]);
});

test("add an area, then a section with labels (consecutive edits are kept)", () => {
  const { editor, last, events } = setup({ type: "custom:overview-plus", favorite_entities: ["light.lamp"] });
  edit(formWith(root(editor), "add_area"), { add_area: "proxmox" });
  assert.equal(events.length, 0, "an empty area layout changes nothing yet");
  const panel = areaPanel(editor, "Virtual › Proxmox");
  assert.ok(panel.open, "a new area block is expanded");
  click(buttons(panel, "Add section")[0]);
  const [section] = sectionForms(panel);
  edit(section, { title: "VMs" });
  edit(section, { layout: "compact" });
  edit(section, { m_label: ["virt-guest"] });
  assert.deepEqual(last(), {
    type: "custom:overview-plus",
    favorite_entities: ["light.lamp"],
    area_overrides: { proxmox: { sections: [{ title: "VMs", layout: "compact", match: { label: "virt-guest" } }] } },
  });
  assert.equal(summary(panel), "Virtual › Proxmox1 section");
  const sectionSummary = panel.querySelector(".sections details > summary").textContent;
  assert.equal(sectionSummary, "VMsCompact (one tile per device) · VM");
  // the selection is a form field, no YAML field anywhere
  assert.ok(fieldNames(section.schema).includes("m_integration"));
  assert.ok(!fieldNames(section.schema).some((n) => n.endsWith("_yaml")));
});

test("changes in one area do not touch the other", () => {
  const { editor, last } = setup(TWO_AREAS);
  edit(sectionForms(areaPanel(editor, "Ground › Living room"))[1], { title: "B2" });
  assert.deepEqual(last().area_overrides.proxmox, TWO_AREAS.area_overrides.proxmox);
  assert.deepEqual(last().area_overrides.living_room.sections.map((s) => s.title), ["A", "B2"]);
});

test("conditional fields: primary only for compact, badge entities only for selected entities", () => {
  const { editor, last } = setup(TWO_AREAS);
  const panel = areaPanel(editor, "Virtual › Proxmox");
  const [section] = sectionForms(panel);
  assert.ok(!fieldNames(section.schema).includes("p_domain"));
  edit(section, { layout: "compact" });
  assert.ok(fieldNames(section.schema).includes("p_domain"));

  assert.equal(entityList(panel, "badge_entities"), null);
  edit(formWith(panel, "badges"), { badges: "custom" });
  addEntity(entityList(panel, "badge_entities"), "sensor.pve_cpu");
  addEntity(entityList(panel, "badge_entities"), "binary_sensor.pve_status");
  assert.deepEqual(last().area_overrides.proxmox.badges, ["sensor.pve_cpu", "binary_sensor.pve_status"]);
  click(rowButton(entityList(panel, "badge_entities"), 1, "Move up"));
  assert.deepEqual(last().area_overrides.proxmox.badges, ["binary_sensor.pve_status", "sensor.pve_cpu"]);
});

test("move and delete sections within an area", () => {
  const { editor, last } = setup({
    type: "custom:overview-plus",
    area_overrides: { proxmox: { sections: [
      { title: "A", match: { label: "a" } },
      { title: "B", match: { label: "b" } },
      { title: "C", match: { label: "c" } },
    ] } },
  });
  const panel = areaPanel(editor, "Virtual › Proxmox");
  const titles = () => last().area_overrides.proxmox.sections.map((s) => s.title);
  click(buttons(panel.querySelector(".sections"), "Move down")[0]);
  assert.deepEqual(titles(), ["B", "A", "C"]);
  click(buttons(panel.querySelector(".sections"), "Delete section")[2]);
  assert.deepEqual(titles(), ["B", "A"]);
  assert.equal(buttons(panel.querySelector(".sections"), "Move up")[0].disabled, true);
  assert.equal(summary(panel), "Virtual › Proxmox2 sections");
});

test("remove an area layout", () => {
  const { editor, last } = setup(TWO_AREAS);
  click(buttons(areaPanel(editor, "Virtual › Proxmox"), "Remove area layout")[0]);
  assert.deepEqual(Object.keys(last().area_overrides), ["living_room"]);
  assert.equal(areaPanels(editor).length, 1);
  const options = formWith(root(editor), "add_area").schema[0].selector.select.options.map((o) => o.value);
  assert.ok(options.includes("proxmox"));
});

test("our own change echoed back by Home Assistant does not re-render (focus is kept)", () => {
  const { editor, last } = setup(TWO_AREAS);
  const [before] = sectionForms(areaPanel(editor, "Virtual › Proxmox"));
  edit(before, { title: "Disks2" });
  editor.setConfig(last());
  assert.equal(sectionForms(areaPanel(editor, "Virtual › Proxmox"))[0], before);
  editor.setConfig(TWO_AREAS);
  assert.notEqual(sectionForms(areaPanel(editor, "Virtual › Proxmox"))[0], before);
});

test("open/closed state survives an external re-render", () => {
  const { editor } = setup(TWO_AREAS);
  const living = areaPanel(editor, "Ground › Living room");
  assert.equal(living.open, false);
  living.open = true;
  living.dispatchEvent(new Event("toggle"));
  editor.setConfig({ ...TWO_AREAS, debug: true });
  assert.equal(areaPanel(editor, "Ground › Living room").open, true);
});

test("unknown options and advanced selections survive editing", () => {
  const config = {
    type: "custom:overview-plus",
    card_rules: [{ match: { domain: "climate" }, card: false }],
    area_overrides: { proxmox: { future: 1, sections: [{ title: "E", match: { integration: "mqtt" }, entities: { include_domains: ["sensor"] } }] } },
  };
  const { editor, last } = setup(config);
  edit(sectionForms(root(editor))[0], { title: "Exporter" });
  assert.deepEqual(last(), {
    ...config,
    area_overrides: { proxmox: { future: 1, sections: [{ title: "Exporter", match: { integration: "mqtt" }, entities: { include_domains: ["sensor"] } }] } },
  });
});

const rulePanels = (editor) => [...root(editor).querySelectorAll(".rules > details")];
const ruleForm = (editor, i) => formWith(rulePanels(editor)[i], "r_action");

test("card rules are blocks with form fields", () => {
  const { editor, last } = setup({ type: "custom:overview-plus" });
  click(buttons(root(editor), "Add rule")[0]);
  const form = ruleForm(editor, 0);
  assert.ok(fieldNames(form.schema).includes("r_type"));
  edit(form, { r_type: "custom:better-thermostat-normal-climate-card" });
  edit(form, { m_integration: ["better_thermostat"] });
  edit(form, { m_domain: ["climate"] });
  assert.deepEqual(last().card_rules, [
    { match: { integration: "better_thermostat", domain: "climate" }, card: { type: "custom:better-thermostat-normal-climate-card" } },
  ]);
  assert.equal(summary(rulePanels(editor)[0]), "1. Replace card: custom:better-thermostat-normal-climate-cardbetter_thermostat · climate");
});

test("rule fields follow the action", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", card_rules: [{ match: { entity: "climate.living" }, card: { name: "Living" } }] });
  const form = ruleForm(editor, 0);
  assert.deepEqual([form.data.r_action, form.data.r_name], ["adjust", "Living"]);
  assert.ok(!fieldNames(form.schema).includes("r_type"));
  edit(form, { r_action: "hide" });
  assert.ok(!fieldNames(form.schema).includes("r_name"), "hide has no card fields");
  assert.deepEqual(last().card_rules, [{ match: { entity: "climate.living" }, card: false }]);
});

test("move and delete rules", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", card_rules: [
    { match: { domain: "a" }, card: false },
    { match: { domain: "b" }, card: false },
  ] });
  const general = root(editor).querySelector(".general");
  click(buttons(general, "Move down")[0]);
  assert.deepEqual(last().card_rules.map((r) => r.match.domain), ["b", "a"]);
  click(buttons(general, "Delete rule")[0]);
  assert.deepEqual(last().card_rules.map((r) => r.match.domain), ["a"]);
});

test("a YAML field only appears for selections a form cannot show", () => {
  const { editor } = setup({ type: "custom:overview-plus", card_rules: [{ match: [{ domain: "a" }, { domain: "b" }], card: false }] });
  const names = fieldNames(ruleForm(editor, 0).schema);
  assert.ok(names.includes("m_yaml"));
  assert.ok(!names.includes("m_domain"));
  // clearing it switches to the fields
  edit(ruleForm(editor, 0), { m_yaml: undefined });
  assert.ok(fieldNames(ruleForm(editor, 0).schema).includes("m_domain"));
});

test("every field has a label and every option list is filled from the data", async () => {
  const { collectOptions, ruleSchema, sectionSchema } = await import("../src/editor/schemas.js");
  const { t } = await import("../src/i18n.js");
  const hass = makeHass();
  const opts = collectOptions(hass);
  assert.ok(opts.integrations.some((o) => o.value === "better_thermostat"));
  assert.ok(opts.domains.some((o) => o.value === "climate"));
  assert.ok(opts.manufacturers.some((o) => o.label === "Proxmox VE Exporter" && o.value === "^Proxmox VE Exporter$"));
  const all = [
    ...fieldNames(sectionSchema({ hass, t: (k, p) => t(hass, k, p) }, opts, { layout: "compact" })),
    ...fieldNames(ruleSchema({ hass, t: (k, p) => t(hass, k, p) }, opts, {})),
    "m_yaml", "e_yaml", "p_yaml",
  ].filter(Boolean);
  for (const lang of ["en", "de"]) {
    const h = { locale: { language: lang } };
    const missing = all.filter((name) => t(h, `editor_${name}`) === `editor_${name}`);
    assert.deepEqual(missing, [], `missing ${lang} labels`);
  }
});

test("field types: required fields, device rules without 'adjust', no area fields in sections", async () => {
  const { collectOptions, ruleSchema, sectionSchema } = await import("../src/editor/schemas.js");
  const { t } = await import("../src/i18n.js");
  const hass = makeHass();
  const ctx = { hass, t: (k, p) => t(hass, k, p) };
  const opts = collectOptions(hass, (k) => t(hass, k));
  const flat = (schema) => schema.flatMap((s) => (s.schema ? flat(s.schema) : [s]));
  const byName = (schema, name) => flat(schema).find((s) => s.name === name);

  const section = sectionSchema(ctx, opts, { layout: "compact" });
  assert.equal(byName(section, "layout").required, true);
  for (const name of ["m_area", "m_floor", "m_not_area", "m_not_floor"]) assert.equal(byName(section, name), undefined, name);
  assert.equal(byName(section, "m_device_name").selector.text.multiple, true);
  assert.equal(byName(section, "p_domain").selector.select.multiple, true);
  assert.ok(byName(section, "m_not_device"), "every criterion can be excluded");
  assert.ok(opts.deviceClasses.some((o) => o.value === "none"));

  const entityRule = ruleSchema(ctx, opts, { r_action: "replace", r_scope: "entity" });
  assert.equal(byName(entityRule, "r_type").required, true);
  assert.equal(byName(entityRule, "r_scope").required, true);
  assert.deepEqual(byName(entityRule, "r_action").selector.select.options.map((o) => o.value), ["replace", "adjust", "hide"]);
  assert.ok(byName(entityRule, "m_area") && byName(entityRule, "m_not_floor"));

  const deviceRule = ruleSchema(ctx, opts, { r_action: "adjust", r_scope: "device" });
  assert.deepEqual(byName(deviceRule, "r_action").selector.select.options.map((o) => o.value), ["replace", "hide"]);
  assert.ok(byName(deviceRule, "r_type"), "adjust is shown as replace for device rules");
});

test("tile options: sensor classes only when 'selected sensor classes' is chosen", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "a" } }] } } });
  const panel = areaPanel(editor, "Virtual › Proxmox");
  assert.equal(formWith(panel, "t_sensor_classes"), undefined);
  edit(formWith(panel, "t_sensors"), { t_sensors: "custom" });
  edit(formWith(panel, "t_sensor_classes"), { t_sensor_classes: ["power"] });
  edit(formWith(panel, "t_alert_classes"), { t_alert_classes: ["problem"] });
  assert.deepEqual(last().area_overrides.proxmox.tile, { sensor_classes: ["power"], alert_classes: ["problem"] });
});

test("tile class options come from the area's own regular sensors, plus configured values", async () => {
  const { areaTileClassOptions } = await import("../src/editor/schemas.js");
  const hass = makeHass();
  const living = areaTileClassOptions(hass, "living_room");
  assert.deepEqual(living.sensor.map((o) => o.value), ["humidity", "temperature"], "battery/signal are diagnostic");
  const proxmox = areaTileClassOptions(hass, "proxmox", ["power"], ["problem"]);
  assert.deepEqual(proxmox.sensor.map((o) => o.value), ["power"], "only the configured value: no classified regular sensors");
  assert.deepEqual(proxmox.alert.map((o) => o.value), ["problem", "running"]);
});

test("tile with selected entities: entity fields only in that mode", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "a" } }] } } });
  const panel = areaPanel(editor, "Virtual › Proxmox");
  assert.equal(entityList(panel, "t_entities"), null);
  assert.ok(formWith(panel, "t_alert_entities"));
  edit(formWith(panel, "t_sensors"), { t_sensors: "entities" });
  assert.ok(entityList(panel, "t_entities"));
  assert.equal(formWith(panel, "t_sensor_classes"), undefined);
  addEntity(entityList(panel, "t_entities"), "sensor.pve_cpu");
  edit(formWith(panel, "t_show_names"), { t_show_names: true });
  edit(formWith(panel, "t_alert_entities"), { t_alert_entities: ["binary_sensor.vm_db_status"] });
  assert.deepEqual(last().area_overrides.proxmox.tile, {
    entities: ["sensor.pve_cpu"], show_names: true, alert_entities: ["binary_sensor.vm_db_status"],
  });
});

test("rule summary names every criterion, exclusions included", async () => {
  const { matchSummary } = await import("../src/editor/schemas.js");
  const h = makeHass();
  const ctx = { hass: h, t: (/** @type {string} */ k, /** @type {any} */ p) => (k === "editor_summary_not" ? `not ${p.values}` : k) };
  assert.equal(matchSummary(ctx, { m_entity_category: ["diagnostic"] }), "diagnostic");
  assert.equal(
    matchSummary(ctx, { m_domain: ["sensor"], m_not_entity_category: ["config"], m_not_domain: ["button"] }),
    "sensor · not button · not config"
  );
  assert.equal(matchSummary(ctx, {}), "");
});

test("overview page: built-in settings by default, own settings as form fields", () => {
  const { editor } = setup({ type: "custom:overview-plus" });
  const source = formWith(root(editor), "h_source");
  assert.equal(source.data.h_source, "builtin");
  assert.equal(entityList(root(editor), "h_favorites"), null, "no own fields while the built-in settings are used");

  const own = setup({ type: "custom:overview-plus", load_home_settings: false, favorite_entities: ["light.lamp"], shortcuts: [{ type: "summary", key: "energy" }] });
  assert.deepEqual(listValues(entityList(root(own.editor), "h_favorites")), ["light.lamp"]);
  const rows = homeItemLabels(own.editor);
  assert.equal(rows[0], "Today's energy", "summaries in the saved order");
  assert.equal(rows.length, 7);
});

test("overview page: editing favorites, hiding a summary, adding a shortcut", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", load_home_settings: false });
  const favorites = entityList(root(editor), "h_favorites");
  addEntity(favorites, "light.lamp");
  addEntity(favorites, "climate.living");
  edit(formWith(root(editor), "h_welcome"), { h_welcome: false });
  assert.deepEqual(last().favorite_entities, ["light.lamp", "climate.living"]);
  assert.equal(last().hide_welcome_message, true);

  const toggle = root(editor).querySelector(".home-items input[type=checkbox]");
  toggle.checked = false;
  toggle.dispatchEvent(new Event("change"));
  assert.deepEqual(last().shortcuts[0], { type: "summary", key: "light", hidden: true });

  click(buttons(root(editor), "Add shortcut")[0]);
  edit(formWith(root(editor), "s_path"), { s_path: "/lovelace/plan", s_label: "Plan" });
  assert.deepEqual(last().shortcuts.at(-1), { type: "custom", path: "/lovelace/plan", label: "Plan" });
});

test("overview page: switching to own settings copies those of the built-in Overview", async () => {
  const { editor, last } = setup({ type: "custom:overview-plus" });
  editor.hass = {
    ...editor.hass,
    callWS: async ({ key }) => ({
      value: key === "home"
        ? { favorite_entities: ["light.ceiling"], hide_suggested_entities: true }
        : { alert_entities: [{ entity: "binary_sensor.door", severity: "alert" }] },
    }),
  };
  edit(formWith(root(editor), "h_source"), { h_source: "own" });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(last().load_home_settings, false);
  assert.deepEqual(last().favorite_entities, ["light.ceiling"]);
  assert.equal(last().hide_suggested_entities, true);
  assert.deepEqual(last().alert_entities, [{ entity: "binary_sensor.door", severity: "alert" }]);

  // back to the built-in settings: the own ones are kept for later
  edit(formWith(root(editor), "h_source"), { h_source: "builtin" });
  assert.equal(last().load_home_settings, undefined);
  assert.deepEqual(last().favorite_entities, ["light.ceiling"]);
});

test("summary pages are set on the summary itself, also with the built-in settings", () => {
  const own = setup({ type: "custom:overview-plus", load_home_settings: false });
  const lights = formWith(root(own.editor), "sp_light");
  assert.ok(lights, "page field inside the Lights summary");
  assert.equal(formWith(root(own.editor), "sp_weather"), undefined, "weather has no page");
  edit(lights, { sp_light: "/lights-plus/0" });
  assert.deepEqual(own.last().summary_pages, { light: "/lights-plus/0" });
  assert.ok(homeItemLabels(own.editor).includes("Lights"));

  const builtin = setup({ type: "custom:overview-plus", summary_pages: { security: "/alarm" } });
  assert.equal(formWith(root(builtin.editor), "sp_security").data.sp_security, "/alarm");
  edit(formWith(root(builtin.editor), "sp_security"), { sp_security: "" });
  assert.equal(builtin.last().summary_pages, undefined);
});

test("area states: switching a preset on writes area_indicators, styles can be changed", () => {
  const { editor, last } = setup({ type: "custom:overview-plus" });
  const rows = [...root(editor).querySelectorAll(".indicator-items > details")];
  assert.equal(rows.length, 12, "all presets listed");
  const toggle = rows[0].querySelector("input[type=checkbox]");
  toggle.checked = true;
  toggle.dispatchEvent(new Event("change"));
  assert.deepEqual(last().area_indicators, [{ preset: "occupied" }]);
  edit(formWith(rows[0], "i_style"), { i_style: "icon", i_color: "green" });
  assert.deepEqual(last().area_indicators, [{ preset: "occupied", style: "icon", color: "green" }]);
});

test("top-level parts are collapsible, collapsed whenever the editor opens, with a summary", () => {
  const { editor } = setup({ ...TWO_AREAS, card_rules: [{ match: { domain: "light" }, card: false }], load_home_settings: false });
  const tops = [...root(editor).querySelectorAll("details.top")];
  assert.equal(tops.length, 3);
  assert.ok(tops.every((d) => !d.open), "collapsed when opened the first time");
  const summaries = tops.map((d) => d.querySelector(":scope > summary").textContent);
  assert.match(summaries[0], /Overview page.*Own settings/);
  assert.match(summaries[1], /2 areas with their own layout/);
  assert.match(summaries[2], /General1 card rule$/);
  tops[1].open = true;
  tops[1].dispatchEvent(new Event("toggle"));
  // Home Assistant re-renders the same editor after a change: the part stays open
  editor.setConfig({ ...TWO_AREAS, load_home_settings: false });
  assert.ok(root(editor).querySelector("details.top-areas").open, "kept while the dialog is open");
  // a new editor (the dialog opened again) starts collapsed
  const again = setup({ type: "custom:overview-plus" });
  assert.ok(!root(again.editor).querySelector("details.top-areas").open, "collapsed when opened again");
});

test("top-level summaries follow changes", () => {
  const { editor } = setup({ type: "custom:overview-plus" });
  const header = (key) => root(editor).querySelector(`details.top-${key} > summary`).textContent;
  assert.match(header("general"), /No card rules$/);
  click(buttons(root(editor), "Add rule")[0]);
  assert.match(header("general"), /General1 card rule$/);
  assert.match(header("areas"), /All areas use the default layout$/);
  edit(formWith(root(editor), "h_source"), { h_source: "own" });
  assert.match(header("home"), /Own settings for this dashboard$/);
});

test("summaries and area states are collapsible parts of the overview page, with a summary", () => {
  const { editor } = setup({
    type: "custom:overview-plus",
    load_home_settings: false,
    shortcuts: [{ type: "summary", key: "light", hidden: true }, { type: "custom", path: "/map" }],
    summary_pages: { climate: "/heat" },
    area_indicators: [{ preset: "occupied" }, { preset: "heating" }],
  });
  const sub = (key) => root(editor).querySelector(`details.sub-${key}`);
  const text = (key) => sub(key).querySelector(":scope > summary").textContent;
  assert.ok(sub("summaries") && !sub("summaries").open);
  assert.ok(sub("indicators") && !sub("indicators").open);
  assert.match(text("summaries"), /6 of 7 shown · 1 shortcut · 1 with own page$/);
  assert.match(text("indicators"), /2 switched on$/);

  const builtin = setup({ type: "custom:overview-plus" });
  assert.match(root(builtin.editor).querySelector("details.sub-summaries > summary").textContent, /Home Assistant's pages$/);
  assert.match(root(builtin.editor).querySelector("details.sub-indicators > summary").textContent, /None switched on$/);
});

test("overview page part summaries follow changes; open state kept while the dialog is open", () => {
  const { editor } = setup({ type: "custom:overview-plus", load_home_settings: false, shortcuts: [{ type: "custom", path: "/map" }] });
  const sub = (key) => root(editor).querySelector(`details.sub-${key}`);
  const text = (key) => sub(key).querySelector(":scope > summary").textContent;
  assert.match(text("summaries"), /7 of 7 shown · 1 shortcut$/);
  // an empty new shortcut is not saved, so it is not counted
  click(buttons(root(editor), "Add shortcut")[0]);
  const toggle = root(editor).querySelector(".home-items input[type=checkbox]");
  toggle.checked = false;
  toggle.dispatchEvent(new Event("change"));
  assert.match(text("summaries"), /6 of 7 shown · 1 shortcut$/);
  edit(formWith(root(editor), "sp_light"), { sp_light: "/lights-plus/0" });
  assert.match(text("summaries"), /· 1 with own page$/);
  const state = root(editor).querySelector(".indicator-items input[type=checkbox]");
  state.checked = true;
  state.dispatchEvent(new Event("change"));
  assert.match(text("indicators"), /1 switched on$/);

  sub("summaries").open = true;
  sub("summaries").dispatchEvent(new Event("toggle"));
  edit(formWith(root(editor), "h_source"), { h_source: "builtin" });
  assert.ok(sub("summaries").open, "still open after switching the source");
});

test("removing an area layout is a red action on the far side, away from Add section", () => {
  const { editor } = setup(TWO_AREAS);
  const panel = areaPanel(editor, "Virtual › Proxmox");
  const remove = buttons(panel, "Remove area layout")[0];
  assert.ok(remove.classList.contains("danger"));
  const row = remove.parentElement;
  assert.ok(row.classList.contains("split"));
  assert.equal(row.firstElementChild.textContent, "Add section");
  assert.equal(row.lastElementChild, remove);
});

test("copying the built-in settings sits under the settings choice, red, and asks first", async () => {
  const { editor, last, events } = setup({ type: "custom:overview-plus", load_home_settings: false, favorite_entities: ["light.lamp"] });
  let calls = 0;
  editor.hass = { ...editor.hass, callWS: async ({ key }) => { calls++; return { value: key === "home" ? { favorite_entities: ["light.ceiling"] } : {} }; } };
  const copy = buttons(root(editor), "Copy from the built-in Overview")[0];
  assert.ok(copy.classList.contains("danger"));
  const row = copy.closest(".copy-home");
  assert.equal(row.previousElementSibling, formWith(root(editor), "h_source"), "right below the settings choice");
  assert.equal(buttons(root(editor), "Add shortcut")[0].parentElement.querySelector(".copy-home"), null);

  click(copy);
  assert.equal(calls, 0, "nothing replaced before confirming");
  assert.match(row.textContent, /Replace your own favorites/);
  click(buttons(row, "Cancel")[0]);
  assert.ok(buttons(row, "Copy from the built-in Overview")[0], "cancel restores the button");
  const before = events.length;

  click(buttons(row, "Copy from the built-in Overview")[0]);
  click(buttons(row, "Replace")[0]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 2);
  assert.ok(events.length > before);
  assert.deepEqual(last().favorite_entities, ["light.ceiling"]);
});

test("shortcuts: only arrows in the header, deleting is a red button in the expanded part", () => {
  const { editor, last } = setup({
    type: "custom:overview-plus", load_home_settings: false,
    shortcuts: [{ type: "custom", path: "/a", label: "A" }, { type: "custom", path: "/b", label: "B" }],
  });
  const panel = [...root(editor).querySelectorAll(".home-items > details")].find((p) => p.querySelector(":scope > summary").textContent.includes("A"));
  // the header controls (in the fallback: their own row) are the arrows only
  const moves = buttons(panel, "Move down")[0].parentElement;
  assert.equal(buttons(moves, "Delete shortcut").length, 0);
  assert.equal(moves.querySelectorAll("button").length, 2);
  const remove = buttons(panel, "Delete shortcut")[0];
  assert.ok(remove.classList.contains("danger"));
  assert.equal(remove.parentElement, panel.querySelector(".panel-body").lastElementChild, "at the end of the expanded part");
  click(remove);
  assert.deepEqual(last().shortcuts.filter((s) => s.type === "custom").map((s) => s.label), ["B"]);
});

test("sections and rules: arrows in the header, red delete button alone at the end", () => {
  const { editor } = setup({ ...TWO_AREAS, card_rules: [{ match: { domain: "light" }, card: { type: "tile" } }] });
  for (const [scope, label] of [[areaPanel(editor, "Ground › Living room"), "Delete section"], [root(editor).querySelector(".general"), "Delete rule"]]) {
    const remove = buttons(scope, label)[0];
    assert.ok(remove.classList.contains("danger"), label);
    const row = remove.parentElement;
    assert.deepEqual([...row.children], [remove], "the delete button has its row to itself");
    assert.equal(row, row.parentElement.lastElementChild, "at the end of the expanded part");
    // header controls (in the fallback: their own row at the top of the body): the arrows only
    const moves = buttons(scope, "Move down")[0].parentElement;
    assert.notEqual(moves, row);
    assert.equal(buttons(moves, label).length, 0);
  }
});

test("own area states: red delete with distance, only after confirming", () => {
  const custom = { name: "Washer", entity: "sensor.washer", state: "running" };
  const { editor, last, events } = setup({ type: "custom:overview-plus", area_indicators: [{ preset: "occupied" }, custom] });
  const scope = root(editor).querySelector(".indicator-items");
  const remove = buttons(scope, "Delete state")[0];
  assert.ok(remove.classList.contains("delete-icon"));
  const row = remove.parentElement;
  click(remove);
  assert.equal(events.length, 0, "nothing deleted before confirming");
  assert.match(row.textContent, /Delete "Washer"\?/);
  click(buttons(row, "Cancel")[0]);
  assert.ok(buttons(row, "Delete state")[0]);
  click(buttons(row, "Delete state")[0]);
  click(buttons(row, "Delete")[0]);
  assert.deepEqual(last().area_indicators, [{ preset: "occupied" }]);
});

test("confirmations: the action runs once, after a cancel the right item is deleted", async () => {
  const states = [{ name: "Washer", entity: "sensor.washer" }, { name: "Dryer", entity: "sensor.dryer" }];
  const { editor, last } = setup({ type: "custom:overview-plus", area_indicators: states });
  const scope = root(editor).querySelector(".indicator-items");
  const row = buttons(scope, "Delete state")[1].parentElement;
  click(buttons(row, "Delete state")[0]);
  assert.equal(row.querySelector(".confirm").getAttribute("role"), "alertdialog");
  click(buttons(row, "Cancel")[0]);
  click(buttons(row, "Delete state")[0]);
  click(buttons(row, "Delete")[0]);
  assert.deepEqual(last().area_indicators, [states[0]]);

  const own = setup({ type: "custom:overview-plus", load_home_settings: false });
  let calls = 0;
  own.editor.hass = { ...own.editor.hass, callWS: async () => { calls++; return { value: {} }; } };
  const copyRow = root(own.editor).querySelector(".copy-home");
  click(buttons(copyRow, "Copy from the built-in Overview")[0]);
  const replace = buttons(copyRow, "Replace")[0];
  click(replace);
  click(replace);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 2, "one copy (home + security), not two");
});

test("area layout: the default sections can be switched on, shown in the area summary", () => {
  const { editor, last } = setup(TWO_AREAS);
  const panel = areaPanel(editor, "Ground › Living room");
  const options = formWith(panel, "show_default_sections");
  assert.equal(options.data.show_default_sections, false);
  edit(options, { show_default_sections: true });
  assert.equal(last().area_overrides.living_room.show_default_sections, true);
  assert.equal(last().area_overrides.proxmox.show_default_sections, undefined);
  assert.match(summary(panel), /with default sections/);
  edit(formWith(panel, "show_default_sections"), { show_default_sections: false });
  assert.equal(last().area_overrides.living_room.show_default_sections, undefined);
});

test("entity lists: arrows reorder, clearing a picker removes, objects are kept, chosen ones are not offered again", () => {
  const { editor, last } = setup({
    type: "custom:overview-plus",
    area_overrides: { proxmox: { tile: { entities: ["sensor.pve_cpu", { entity: "sensor.pve_uptime", name: "Up" }, "sensor.vm_web_cpu"] } } },
  });
  const panel = areaPanel(editor, "Virtual › Proxmox");
  const list = () => entityList(panel, "t_entities");
  assert.deepEqual(listValues(list()), ["sensor.pve_cpu", "sensor.pve_uptime", "sensor.vm_web_cpu"]);
  assert.ok(rowButton(list(), 0, "Move up").disabled, "the first cannot move up");
  assert.ok(rowButton(list(), 2, "Move down").disabled, "the last cannot move down");
  click(rowButton(list(), 0, "Move down"));
  assert.deepEqual(last().area_overrides.proxmox.tile.entities, [{ entity: "sensor.pve_uptime", name: "Up" }, "sensor.pve_cpu", "sensor.vm_web_cpu"]);
  edit(list().querySelectorAll(".entity-row ha-form")[0], { entity: "sensor.vm_db_cpu" });
  assert.deepEqual(last().area_overrides.proxmox.tile.entities[0], { entity: "sensor.vm_db_cpu", name: "Up" }, "the name stays");
  edit(list().querySelectorAll(".entity-row ha-form")[1], { entity: undefined });
  assert.deepEqual(last().area_overrides.proxmox.tile.entities, [{ entity: "sensor.vm_db_cpu", name: "Up" }, "sensor.vm_web_cpu"]);
  const add = list().querySelector("ha-form.entity-add");
  assert.deepEqual(add.schema[0].selector.entity.exclude_entities, ["sensor.vm_db_cpu", "sensor.vm_web_cpu"]);
});

test("ordered entity lists have no drag handles anywhere in the editor", () => {
  const { editor } = setup({ type: "custom:overview-plus", load_home_settings: false, area_overrides: { proxmox: { badges: ["sensor.pve_cpu"], tile: { entities: ["sensor.pve_cpu"] } } } });
  const all = forms(root(editor)).flatMap((f) => (function walk(schema) { return schema.flatMap((x) => (x.schema ? walk(x.schema) : [x])); })(f.schema));
  assert.ok(!all.some((field) => field.selector?.entity?.reorder), "no reorder (drag) entity selector");
  for (const field of ["h_favorites", "badge_entities", "t_entities"]) assert.ok(entityList(root(editor), field), field);
});

test("area layouts can be reordered; only the order of the config entries changes", () => {
  const { editor, last } = setup(TWO_AREAS);
  assert.deepEqual(Object.keys(TWO_AREAS.area_overrides), ["proxmox", "living_room"]);
  const second = areaPanel(editor, "Ground › Living room");
  click(buttons(second.querySelector(".panel-body > .row"), "Move up")[0]);
  assert.deepEqual(Object.keys(last().area_overrides), ["living_room", "proxmox"]);
  assert.deepEqual(last().area_overrides.proxmox, TWO_AREAS.area_overrides.proxmox);
  assert.deepEqual(areaPanels(editor).map(summary).map((s) => s.split("›")[1].trim().split(/\d/)[0]), ["Living room", "Proxmox"]);
});

test("after moving, the focus stays on the moved entry's arrow (keyboard users keep their place)", () => {
  const { editor } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { badges: ["sensor.pve_cpu", "sensor.vm_web_cpu", "sensor.vm_db_cpu"] } } });
  const panel = areaPanel(editor, "Virtual › Proxmox");
  const list = () => entityList(panel, "badge_entities");
  click(rowButton(list(), 0, "Move down"));
  assert.equal(root(editor).activeElement, rowButton(list(), 1, "Move down"), "same arrow, one row further");
  click(rowButton(list(), 1, "Move down"));
  assert.equal(root(editor).activeElement, rowButton(list(), 2, "Move up"), "at the end: the other arrow");
  assert.ok(list().getAttribute("aria-label"), "the list is a named group");
  // the row pickers do not offer entities already in the list
  const second = list().querySelectorAll(".entity-row ha-form")[1];
  assert.deepEqual(second.schema[0].selector.entity.exclude_entities.sort(), ["sensor.pve_cpu", "sensor.vm_web_cpu"].sort().filter((e) => e !== second.data.entity));
});

test("the tile block stays open when its fields change, and is forgotten with its area", () => {
  const config = { type: "custom:overview-plus", area_overrides: { proxmox: { tile: { color: "blue" } } } };
  const { editor, last } = setup(config);
  let tile = areaPanel(editor, "Virtual › Proxmox").querySelector(".tile-panel");
  tile.open = true;
  tile.dispatchEvent(new Event("toggle"));
  edit(formWith(areaPanel(editor, "Virtual › Proxmox"), "t_sensors"), { t_sensors: "entities" });
  tile = areaPanel(editor, "Virtual › Proxmox").querySelector(".tile-panel");
  assert.ok(tile.open, "still open after the fields were rebuilt");
  assert.ok(entityList(tile, "t_entities"));
  // removing the area and adding it again: collapsed
  click(buttons(areaPanel(editor, "Virtual › Proxmox"), "Remove area layout")[0]);
  edit(formWith(root(editor), "add_area"), { add_area: "proxmox" });
  assert.equal(areaPanel(editor, "Virtual › Proxmox").querySelector(".tile-panel").open, false);
  assert.ok(last());
});

test("entity lists tolerate values that are not a list or contain nothing usable", () => {
  for (const entities of ["sensor.pve_cpu", null, [null, 3, "sensor.pve_cpu"]]) {
    const { editor } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { tile: { entities } } } });
    const list = entityList(areaPanel(editor, "Virtual › Proxmox"), "t_entities");
    assert.ok(list === null || list.querySelector("ha-form.entity-add"), String(entities));
  }
});

test("Enter and Space on a header arrow move the entry instead of toggling the panel", () => {
  const { editor } = setup(TWO_AREAS);
  const panel = areaPanel(editor, "Ground › Living room");
  const seen = [];
  panel.addEventListener("keydown", (ev) => seen.push(ev.key));
  for (const key of ["Enter", " ", "ArrowDown"]) {
    buttons(panel, "Move up")[0].dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true, composed: true }));
  }
  assert.deepEqual(seen, ["ArrowDown"], "only other keys reach the panel");
});

const defaultRows = (panel) => [...panel.querySelectorAll(".sections > .default-section")].map((r) => r.dataset.default);
const sectionEntries = (panel) => [...panel.querySelectorAll(".sections > *")].map((el) => el.dataset.default || summary(el).split(/(?=Tiles|Devices|Compact|Table|Hidden)/)[0]);

test("default sections: appear in the list of sections, can be moved and hidden, disappear when switched off", () => {
  const { editor, last } = setup(TWO_AREAS);
  let panel = areaPanel(editor, "Ground › Living room");
  assert.deepEqual(defaultRows(panel), []);
  edit(formWith(panel, "show_default_sections"), { show_default_sections: true });
  panel = areaPanel(editor, "Ground › Living room");
  assert.deepEqual(sectionEntries(panel), ["light", "climate", "security", "media_players", "scenes", "A", "B"]);
  // in their default place they need no entries in the configuration
  assert.deepEqual(last().area_overrides.living_room.sections.map((s) => s.title), ["A", "B"]);
  assert.equal(summary(panel), "Ground › Living room2 sections · with default sections", "only own sections are counted");

  // "Scenes" down, below "A": only what differs from the default place is written
  const scenes = panel.querySelector('.sections > [data-default="scenes"]');
  click(buttons(scenes, "Move down")[0]);
  assert.deepEqual(last().area_overrides.living_room.sections.map((s) => s.default || s.title), ["A", "scenes", "B"]);
  // hide "Climate": a switch, no delete button, not expandable
  const climate = panel.querySelector('.sections > [data-default="climate"]');
  assert.equal(climate.localName, "div");
  assert.equal(buttons(climate, "Delete section").length, 0);
  const toggle = climate.querySelector("input[type=checkbox]");
  toggle.checked = false;
  toggle.dispatchEvent(new Event("change"));
  assert.deepEqual(last().area_overrides.living_room.sections.find((s) => s.default === "climate"), { default: "climate", hidden: true });
  assert.deepEqual(last().area_overrides.living_room.sections.map((s) => s.default || s.title), ["climate", "security", "media_players", "A", "scenes", "B"],
    "lights first need no entry");

  // switched off: the standard categories leave the list
  edit(formWith(panel, "show_default_sections"), { show_default_sections: false });
  panel = areaPanel(editor, "Ground › Living room");
  assert.deepEqual(defaultRows(panel), []);
  assert.deepEqual(last().area_overrides.living_room.sections.map((s) => s.title), ["A", "B"]);
  assert.equal(last().area_overrides.living_room.show_default_sections, undefined);
});

test("an own section can be hidden with the switch in its header; editing keeps it hidden", () => {
  const { editor, last } = setup(TWO_AREAS);
  const panel = areaPanel(editor, "Ground › Living room");
  const first = panel.querySelector(".sections > details");
  const toggle = first.querySelector("input[type=checkbox]");
  toggle.checked = false;
  toggle.dispatchEvent(new Event("change"));
  assert.equal(last().area_overrides.living_room.sections[0].hidden, true);
  assert.match(summary(first), /Hidden/);
  edit(sectionForms(first)[0], { title: "A2" });
  assert.deepEqual(last().area_overrides.living_room.sections[0], { title: "A2", match: { label: "a" }, hidden: true });
});

test("a configuration with show_default_sections but without entries shows them first; the order is kept as written", () => {
  const { editor } = setup({ type: "custom:overview-plus", area_overrides: { living_room: { show_default_sections: true, sections: [{ default: "scenes" }, { title: "A", match: { label: "a" } }] } } });
  assert.deepEqual(sectionEntries(areaPanel(editor, "Ground › Living room")), ["light", "climate", "security", "media_players", "scenes", "A"]);
  const off = setup({ type: "custom:overview-plus", area_overrides: { living_room: { sections: [{ default: "light" }, { title: "A", match: { label: "a" } }] } } });
  assert.deepEqual(sectionEntries(areaPanel(off.editor, "Ground › Living room")), ["A"], "without the option: no default entries");
});

test("rows line up: an empty last column where a row has no switch", () => {
  const { editor } = setup({ type: "custom:overview-plus", load_home_settings: false, shortcuts: [{ type: "custom", path: "/map", label: "Map" }] });
  const shortcut = [...root(editor).querySelectorAll(".home-items > details")].find((p) => summary(p).startsWith("Map"));
  const controls = buttons(shortcut, "Move down")[0].parentElement;
  assert.ok(controls.lastElementChild.classList.contains("col-empty"));
});

test("own sections show their icon in front, as default sections do; it follows the form", () => {
  const { editor } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", icon: "mdi:server", match: { label: "a" } }, { title: "B", match: { label: "b" } }] } } });
  const panel = areaPanel(editor, "Virtual › Proxmox");
  const icons = () => [...panel.querySelectorAll(".sections .section-icon")].map((i) => i.icon);
  assert.deepEqual(icons(), ["mdi:server", undefined], "without an icon: empty space, titles stay aligned");
  edit(sectionForms(panel)[1], { icon: "mdi:cube-outline" });
  assert.deepEqual(icons(), ["mdi:server", "mdi:cube-outline"]);
});

test("hide while in state: conditions per section with domain, optional device class and states", () => {
  const { editor, last } = setup(TWO_AREAS);
  const panel = areaPanel(editor, "Ground › Living room");
  const first = panel.querySelector(".sections > details");
  const block = first.querySelector(".hide-rules");
  assert.ok(block, "own block in the expanded section");
  click(buttons(block, "Add condition")[0]);
  const form = formWith(block, "hr_states");
  edit(form, { hr_domain: ["binary_sensor"], hr_device_class: ["occupancy"], hr_states: ["off"] });
  assert.deepEqual(last().area_overrides.living_room.sections[0].entities, { hide_states: [{ domain: "binary_sensor", device_class: "occupancy", states: ["off"] }] });
  assert.match(summary(block), /1 condition/);
  // editing the section form keeps the conditions
  edit(sectionForms(first)[0], { title: "A2" });
  assert.deepEqual(last().area_overrides.living_room.sections[0].entities.hide_states, [{ domain: "binary_sensor", device_class: "occupancy", states: ["off"] }]);
  assert.equal(last().area_overrides.living_room.sections[0].title, "A2");
  // the state suggestions follow the domain
  const opts = formWith(block, "hr_states").schema.flatMap((f) => f.schema || [f]).find((f) => f.name === "hr_states").selector.select.options.map((o) => o.value);
  assert.ok(opts.includes("off") && opts.includes("unavailable"));
  // deleting the condition removes hide_states
  click(buttons(block, "Delete condition")[0]);
  assert.equal(last().area_overrides.living_room.sections[0].entities, undefined);
});

test("order of a section: groups with domains and device classes, moved with up/down", () => {
  const { editor, last } = setup(TWO_AREAS);
  const first = areaPanel(editor, "Ground › Living room").querySelector(".sections > details");
  const block = first.querySelector(".sort-groups");
  assert.ok(block);
  click(buttons(block, "Add group")[0]);
  edit(formWith(block, "sg_domain"), { sg_domain: ["light"] });
  click(buttons(block, "Add group")[0]);
  edit(forms(block).filter((f) => fieldNames(f.schema).includes("sg_domain"))[1], { sg_domain: ["binary_sensor"], sg_device_class: ["occupancy"] });
  assert.deepEqual(last().area_overrides.living_room.sections[0].sort, [{ domain: "light" }, { domain: "binary_sensor", device_class: "occupancy" }]);
  assert.match(summary(block), /2 groups/);
  click(buttons(block, "Move up")[1]);
  assert.deepEqual(last().area_overrides.living_room.sections[0].sort.map((g) => g.domain), ["binary_sensor", "light"]);
  // editing the section form keeps the groups; deleting one
  edit(sectionForms(first)[0], { title: "A2" });
  assert.equal(last().area_overrides.living_room.sections[0].sort.length, 2);
  click(buttons(block, "Delete group")[0]);
  assert.deepEqual(last().area_overrides.living_room.sections[0].sort, [{ domain: "light" }]);
});
