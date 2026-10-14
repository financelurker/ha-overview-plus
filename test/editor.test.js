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
/** Area blocks (fallback <details>) with their summary text. */
const areaPanels = (editor) => [...root(editor).querySelectorAll("details.area-panel")];
const summary = (panel) => panel.querySelector(":scope > summary").textContent;
const areaPanel = (editor, name) => areaPanels(editor).find((p) => summary(p).startsWith(name));

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
  assert.ok(formWith(general, "card_rules"));
  assert.ok(formWith(general, "debug"));
  assert.ok(!areaPanels(editor).some((p) => formWith(p, "card_rules")));
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
  edit(section, { labels: ["virt-guest"] });
  assert.deepEqual(last(), {
    type: "custom:overview-plus",
    favorite_entities: ["light.lamp"],
    area_overrides: { proxmox: { sections: [{ title: "VMs", layout: "compact", match: { label: "virt-guest" } }] } },
  });
  assert.equal(summary(panel), "Virtual › Proxmox1 section");
  const sectionSummary = panel.querySelector(".sections details > summary").textContent;
  assert.equal(sectionSummary, "VMsCompact (one tile per device) · VM");
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
  assert.ok(!fieldNames(section.schema).includes("primary"));
  edit(section, { layout: "compact" });
  assert.ok(fieldNames(section.schema).includes("primary"));

  const options = formWith(panel, "badges");
  assert.ok(!fieldNames(options.schema).includes("badge_entities"));
  edit(options, { badges: "custom" });
  assert.ok(fieldNames(options.schema).includes("badge_entities"));
  edit(options, { badge_entities: ["sensor.pve_cpu"] });
  assert.deepEqual(last().area_overrides.proxmox.badges, ["sensor.pve_cpu"]);
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
  click(buttons(panel, "Move down")[0]);
  assert.deepEqual(titles(), ["B", "A", "C"]);
  click(buttons(panel, "Delete section")[2]);
  assert.deepEqual(titles(), ["B", "A"]);
  assert.equal(buttons(panel, "Move up")[0].disabled, true);
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
