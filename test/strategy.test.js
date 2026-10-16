import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { makeHass } from "./fixtures.js";

const win = new Window({ url: "http://ha.local/" });
for (const key of ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event"]) {
  globalThis[key] = win[key];
}
await import("../src/overview-plus.js");
const Strategy = customElements.get("ll-strategy-dashboard-overview-plus");

function hass() {
  const h = makeHass();
  h.callWS = async ({ type, key }) => {
    if (type !== "frontend/get_system_data") throw new Error("unexpected");
    return { value: key === "home" ? { favorite_entities: ["light.ceiling"] } : {} };
  };
  return h;
}
const overviewOf = async (config) => (await Strategy.generate({ type: "custom:overview-plus", ...config }, hass())).views[0].strategy;

test("built-in settings: those of the built-in Overview, own settings in the config are ignored", async () => {
  const s = await overviewOf({ favorite_entities: ["light.lamp"], hide_welcome_message: true });
  assert.deepEqual(s.favorite_entities, ["light.ceiling"]);
  assert.equal(s.hide_welcome_message, undefined);
});

test("own settings: only those of the config", async () => {
  const s = await overviewOf({ load_home_settings: false, favorite_entities: ["light.lamp"] });
  assert.deepEqual(s.favorite_entities, ["light.lamp"]);
});
