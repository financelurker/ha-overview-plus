// The area tile before Home Assistant's tile components are loaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.js";

const win = installDom({ stubs: ["ha-card", "ha-icon"] });
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

test("space for the chips moves icon and text, not the container with the hover background", () => {
  const el = document.createElement("overview-plus-area-tile");
  el.setConfig({ type: "custom:overview-plus-area-tile", area: "room", vertical: true, indicators: [{ preset: "lights_on" }] });
  el.hass = { states: {}, entities: {}, devices: {}, areas: { room: { area_id: "room", name: "Room" } } };
  document.body.appendChild(el);
  const css = [...el.shadowRoot.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  const rules = css.split("}").filter((r) => r.includes("translateY(8px)"));
  assert.ok(rules.length, "space for the chips is still kept");
  for (const rule of rules) {
    const selectors = rule.slice(0, rule.indexOf("{")).split(",").map((s) => s.trim());
    assert.ok(selectors.every((s) => !s.endsWith("ha-tile-container")), `container is not moved: ${selectors}`);
  }
});
