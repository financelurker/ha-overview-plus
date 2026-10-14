// Interaction tests for the visual editor in a simulated browser (happy-dom).
// ha-form is replaced by a stub that stores its properties; tests "edit" a form by
// dispatching value-changed like the real ha-form does.
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
  editor.hass = makeHass({ floors: { ground: { floor_id: "ground", name: "Ground" }, virtual: { floor_id: "virtual", name: "Virtual" } } });
  editor.setConfig(config);
  return { editor, events, last: () => events.at(-1) };
}

const forms = (editor) => [...editor.shadowRoot.querySelectorAll("ha-form")];
const fieldNames = (schema) => schema.flatMap((s) => (s.schema ? fieldNames(s.schema) : [s.name]));
const formWith = (editor, name) => forms(editor).find((f) => fieldNames(f.schema).includes(name));
const sectionForms = (editor) => forms(editor).filter((f) => fieldNames(f.schema).includes("layout"));
const edit = (form, patch) =>
  form.dispatchEvent(new CustomEvent("value-changed", { detail: { value: { ...form.data, ...patch } } }));
const buttons = (editor, text) => [...editor.shadowRoot.querySelectorAll("button")].filter((b) => b.textContent === text);
const click = (el) => el.dispatchEvent(new Event("click"));

test("without overrides no area is selected and the picker lists areas by floor", () => {
  const { editor } = setup({ type: "custom:overview-plus" });
  const picker = formWith(editor, "area");
  assert.equal(picker.data.area, undefined);
  const labels = picker.schema[0].selector.select.options.map((o) => o.label);
  assert.deepEqual(labels, ["Empty", "Ground › Living room", "Virtual › Proxmox"]);
  assert.equal(sectionForms(editor).length, 0);
});

test("add a section with labels for an area", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", favorite_entities: ["light.lamp"] });
  edit(formWith(editor, "area"), { area: "proxmox" });
  click(buttons(editor, "Add section")[0]);
  assert.deepEqual(last().area_overrides, { proxmox: { sections: [{ layout: "tiles" }] } }, "new section is a placeholder");
  const [section] = sectionForms(editor);
  edit(section, { title: "VMs", layout: "compact", labels: ["virt-guest"] });
  assert.deepEqual(last(), {
    type: "custom:overview-plus",
    favorite_entities: ["light.lamp"],
    area_overrides: { proxmox: { sections: [{ title: "VMs", layout: "compact", match: { label: "virt-guest" } }] } },
  });
  // the picker marks the area as customized
  const options = formWith(editor, "area").schema[0].selector.select.options;
  assert.match(options.find((o) => o.value === "proxmox").label, /customized/);
});

test("primary entity field only for the compact layout", () => {
  const { editor } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "x" } }] } } });
  const [section] = sectionForms(editor);
  assert.ok(!fieldNames(section.schema).includes("primary"));
  edit(section, { layout: "compact" });
  assert.ok(fieldNames(section.schema).includes("primary"));
});

test("badge entities only when 'selected entities' is chosen", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "x" } }] } } });
  const options = formWith(editor, "badges");
  assert.ok(!fieldNames(options.schema).includes("badge_entities"));
  edit(options, { badges: "custom" });
  assert.ok(fieldNames(options.schema).includes("badge_entities"));
  edit(options, { badge_entities: ["sensor.pve_cpu"] });
  assert.deepEqual(last().area_overrides.proxmox.badges, ["sensor.pve_cpu"]);
});

test("move and delete sections", () => {
  const { editor, last } = setup({
    type: "custom:overview-plus",
    area_overrides: { proxmox: { sections: [
      { title: "A", match: { label: "a" } },
      { title: "B", match: { label: "b" } },
      { title: "C", match: { label: "c" } },
    ] } },
  });
  const titles = () => last().area_overrides.proxmox.sections.map((s) => s.title);
  click(buttons(editor, "Move down")[0]);
  assert.deepEqual(titles(), ["B", "A", "C"]);
  click(buttons(editor, "Delete section")[2]);
  assert.deepEqual(titles(), ["B", "A"]);
  // first "Move up" is disabled
  assert.equal(buttons(editor, "Move up")[0].disabled, true);
});

test("reset area removes its override", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { badges: false } } });
  click(buttons(editor, "Reset area to default")[0]);
  assert.deepEqual(last(), { type: "custom:overview-plus" });
});

test("our own change echoed back by Home Assistant does not re-render (focus is kept)", () => {
  const { editor, last } = setup({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "a" } }] } } });
  const [before] = sectionForms(editor);
  edit(before, { title: "AB" });
  editor.setConfig(last());
  const [after] = sectionForms(editor);
  assert.equal(after, before);
  // an external change does re-render
  editor.setConfig({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "X", match: { label: "a" } }] } } });
  assert.notEqual(sectionForms(editor)[0], before);
  assert.equal(sectionForms(editor)[0].data.title, "X");
});

test("unknown options and advanced selections survive editing", () => {
  const config = {
    type: "custom:overview-plus",
    card_rules: [{ match: { domain: "climate" }, card: false }],
    area_overrides: { proxmox: { future: 1, sections: [{ title: "E", match: { integration: "mqtt" }, entities: { include_domains: ["sensor"] } }] } },
  };
  const { editor, last } = setup(config);
  edit(sectionForms(editor)[0], { title: "Exporter" });
  assert.deepEqual(last(), {
    ...config,
    area_overrides: { proxmox: { future: 1, sections: [{ title: "Exporter", match: { integration: "mqtt" }, entities: { include_domains: ["sensor"] } }] } },
  });
});

test("consecutive edits of different fields are all kept", () => {
  const { editor, last } = setup({ type: "custom:overview-plus" });
  edit(formWith(editor, "area"), { area: "proxmox" });
  click(buttons(editor, "Add section")[0]);
  const [section] = sectionForms(editor);
  edit(section, { title: "VMs" });
  edit(section, { icon: "mdi:server" });
  edit(section, { labels: ["virt-guest"] });
  assert.deepEqual(last().area_overrides.proxmox.sections, [
    { title: "VMs", layout: "tiles", icon: "mdi:server", match: { label: "virt-guest" } },
  ]);
});
