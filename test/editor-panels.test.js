// The editor with a stand-in for HA's ha-expansion-panel, whose expanded-changed event bubbles.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { makeHass } from "./fixtures.js";

const win = new Window({ url: "http://ha.local/" });
for (const key of ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event"]) globalThis[key] = win[key];
win.customElements.define("ha-form", class extends win.HTMLElement {});
win.customElements.define("ha-expansion-panel", class extends win.HTMLElement {
  toggle(open) {
    this.expanded = open;
    this.dispatchEvent(new CustomEvent("expanded-changed", { detail: { expanded: open }, bubbles: true, composed: true }));
  }
});
const { EDITOR_TAG } = await import("../src/editor/editor.js");

test("collapsing a nested panel does not change the remembered top-level part", () => {
  win.localStorage.removeItem("overview-plus:editor-open");
  const editor = document.createElement(EDITOR_TAG);
  document.body.appendChild(editor);
  editor.hass = makeHass();
  editor.setConfig({ type: "custom:overview-plus", area_overrides: { proxmox: { sections: [{ title: "A", match: { label: "a" } }] } } });
  const top = editor.shadowRoot.querySelector(".top-areas");
  top.toggle(true);
  assert.deepEqual(JSON.parse(win.localStorage.getItem("overview-plus:editor-open")), ["areas"]);
  const area = top.querySelector(".area-panel");
  area.toggle(true);
  area.toggle(false);
  assert.deepEqual(JSON.parse(win.localStorage.getItem("overview-plus:editor-open")), ["areas"], "the area panel's events stay with it");
  top.toggle(false);
  assert.deepEqual(JSON.parse(win.localStorage.getItem("overview-plus:editor-open")), []);
});
