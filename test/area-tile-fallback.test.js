// The area tile before Home Assistant's tile components are loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

const win = new Window({ url: "http://ha.local/" });
for (const key of ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event"]) globalThis[key] = win[key];
win.customElements.define("ha-card", class extends win.HTMLElement {});
win.customElements.define("ha-icon", class extends win.HTMLElement {});
await import("../src/area-tile-card.js");

test("fallback shows the area states and switches to the tile once the components are loaded", async () => {
  const el = document.createElement("overview-plus-area-tile");
  el.setConfig({ type: "custom:overview-plus-area-tile", area: "room", vertical: true, indicators: [{ preset: "lights_on" }] });
  el.hass = {
    states: { "light.a": { entity_id: "light.a", state: "on", attributes: {} } },
    entities: { "light.a": { area_id: "room" } }, devices: {}, areas: { room: { area_id: "room", name: "Room" } },
  };
  document.body.appendChild(el);
  assert.ok(el.shadowRoot.querySelector(".fallback"));
  assert.equal(el.shadowRoot.querySelectorAll(".chip").length, 1);
  win.customElements.define("ha-tile-container", class extends win.HTMLElement {});
  for (const tag of ["ha-tile-icon", "ha-tile-info"]) win.customElements.define(tag, class extends win.HTMLElement {});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(el.shadowRoot.querySelector(".fallback"), null);
  assert.ok(el.shadowRoot.querySelector("ha-tile-container"));
  assert.equal(el.shadowRoot.querySelectorAll(".chip").length, 1);
});
