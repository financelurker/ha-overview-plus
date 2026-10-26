// The editor with a stand-in for HA's ha-expansion-panel, whose expanded-changed event bubbles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.js";
import { makeHass } from "./fixtures.js";

const win = installDom();
win.customElements.define("ha-form", class extends win.HTMLElement {});
win.customElements.define("ha-expansion-panel", class extends win.HTMLElement {
  toggle(open) {
    this.expanded = open;
    this.dispatchEvent(new CustomEvent("expanded-changed", { detail: { expanded: open }, bubbles: true, composed: true }));
  }
});
const { EDITOR_TAG } = await import("../src/editor/editor.js");

test("collapsing a nested panel does not collapse its top-level part", () => {
  const editor = document.createElement(EDITOR_TAG);
  document.body.appendChild(editor);
  editor.hass = makeHass();
  const config = { type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "a" } }] } } };
  editor.setConfig(config);
  const top = () => editor.shadowRoot.querySelector(".top-areas");
  top().toggle(true);
  const area = top().querySelector(".area-panel");
  area.toggle(true);
  area.toggle(false);
  // re-render (as after a change from Home Assistant): the top-level part is still open
  editor.setConfig({ ...config, debug: true });
  assert.equal(top().expanded, true, "the area panel's events stay with it");
  top().toggle(false);
  editor.setConfig({ ...config });
  assert.equal(top().expanded, false);
});

test("lazy building: a part's content is built when it is expanded the first time", () => {
  const editor = document.createElement(EDITOR_TAG);
  document.body.appendChild(editor);
  editor.hass = makeHass();
  editor.setConfig({
    type: "custom:overview-plus",
    card_rules: [{ match: { domain: "light" }, card: { type: "tile" } }],
    area_overrides: {
      proxmox: { sections: [{ title: "A", match: { label: "a" } }, { title: "B", match: { label: "b" } }] },
      living_room: { sections: [{ title: "C", match: { label: "c" } }] },
    },
  });
  const root = editor.shadowRoot;
  const forms = (scope) => scope.querySelectorAll("ha-form").length;
  assert.equal(forms(root), 0, "nothing but the three headers when the editor opens");
  assert.match(root.querySelector(".top-areas").secondary, /2 areas/, "summaries are there without building");

  const areas = root.querySelector(".top-areas");
  areas.toggle(true);
  const panels = [...areas.querySelectorAll(".area-panel")];
  assert.equal(panels.length, 2, "one block per area");
  assert.equal(forms(areas), 1, "only the 'add area' picker: the area blocks are collapsed");
  panels[0].toggle(true);
  const sections = [...panels[0].querySelectorAll(".sections > ha-expansion-panel")];
  assert.equal(sections.length, 2, "section headers are there");
  assert.equal(forms(sections[0]), 0, "a collapsed section has no form yet");
  sections[0].toggle(true);
  assert.ok(forms(sections[0]) > 0, "built when expanded");
  // expanding again does not build twice
  sections[0].toggle(false);
  sections[0].toggle(true);
  assert.equal(sections[0].querySelectorAll(":scope > .panel-body > ha-form").length, 1);
  assert.equal(forms(root.querySelector(".top-general")), 0, "other parts stay unbuilt");
});

test("a closed editor drops its content and builds it again when added back", () => {
  const editor = document.createElement(EDITOR_TAG);
  document.body.appendChild(editor);
  editor.hass = makeHass();
  editor.setConfig({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "a" } }] } } });
  editor.shadowRoot.querySelector(".top-areas").toggle(true);
  editor.remove();
  assert.equal(editor.shadowRoot.childElementCount, 0, "nothing kept while closed");
  document.body.appendChild(editor);
  const areas = editor.shadowRoot.querySelector(".top-areas");
  assert.ok(areas, "built again");
  assert.equal(areas.expanded, true, "with the parts that were open");
  assert.ok(areas.querySelector(".area-panel"));
  editor.remove();
});

/** An editor with lazy building, the areas part expanded and the proxmox area open. */
function lazyAreaEditor(sections) {
  const editor = document.createElement(EDITOR_TAG);
  document.body.appendChild(editor);
  editor.hass = makeHass();
  editor.setConfig({ type: "custom:overview-plus", area_overrides: { proxmox: { sections } } });
  editor.shadowRoot.querySelector(".top-areas").toggle(true);
  const area = editor.shadowRoot.querySelector(".area-panel");
  if (!area.expanded) area.toggle(true);
  return { editor, area, sectionPanels: () => [...area.querySelectorAll(".sections > ha-expansion-panel")] };
}

test("lazy: a section moved while collapsed shows its own form when expanded; added items are open with their form", () => {
  const { editor, area, sectionPanels } = lazyAreaEditor([{ title: "A", match: { label: "a" } }, { title: "B", match: { label: "b" } }]);
  // move B up while both are collapsed
  [...sectionPanels()[1].querySelectorAll(':scope > [slot="icons"]')][0].dispatchEvent(new Event("click"));
  assert.deepEqual(sectionPanels().map((p) => p.header), ["B", "A"]);
  sectionPanels()[0].toggle(true);
  const form = sectionPanels()[0].querySelector(":scope > .panel-body > ha-form");
  assert.equal(form.data.title, "B", "the form of the moved section");
  // add a section: open, with its form
  [...area.querySelectorAll("button, ha-button")].find((b) => b.textContent === "Add section").dispatchEvent(new Event("click"));
  const added = sectionPanels().at(-1);
  assert.equal(added.expanded, true);
  assert.ok(added.querySelector(":scope > .panel-body > ha-form"));
  editor.remove();
});

test("lazy: content is built before Home Assistant measures it (expanded-will-change)", () => {
  const { editor, sectionPanels } = lazyAreaEditor([{ title: "A", match: { label: "a" } }]);
  const panel = sectionPanels()[0];
  assert.equal(panel.querySelectorAll("ha-form").length, 0);
  panel.dispatchEvent(new CustomEvent("expanded-will-change", { detail: { expanded: true } }));
  assert.ok(panel.querySelectorAll("ha-form").length > 0, "built before the panel is expanded");
  editor.remove();
});

test("a detached editor builds nothing until it is added", () => {
  const editor = document.createElement(EDITOR_TAG);
  editor.hass = makeHass();
  editor.setConfig({ type: "custom:overview-plus" });
  assert.equal(editor.shadowRoot.childElementCount, 0);
  editor.hass = makeHass();
  assert.equal(editor.shadowRoot.childElementCount, 0, "hass updates while detached do not build");
  document.body.appendChild(editor);
  assert.ok(editor.shadowRoot.querySelector(".top-home"));
  editor.remove();
});
