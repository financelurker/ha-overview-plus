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
