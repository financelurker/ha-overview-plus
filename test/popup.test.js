import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { makeHass } from "./fixtures.js";
import { createCardFactory, POPUP_KEY } from "../src/card-factory.js";
import { entityContext } from "../src/registry.js";
import { generateAreaView } from "../src/views/area-view.js";

const win = new Window({ url: "http://ha.local/" });
for (const key of ["window", "document", "customElements", "HTMLElement", "CustomEvent", "Event", "requestAnimationFrame", "cancelAnimationFrame"]) {
  globalThis[key] = win[key];
}
const { popupCardConfig, popupForEvent } = await import("../src/popup.js");

const hass = makeHass();
const ctx = (id) => entityContext(hass, id);
const tile = (entity) => ({ type: "tile", entity });

test("tap rule stores the popup on the card, the card itself stays", () => {
  const f = createCardFactory([{ match: { domain: "climate" }, tap: { popup: { type: "thermostat", name: "$area" } } }], "area");
  const card = f.entity(ctx("climate.living"), tile("climate.living"));
  assert.equal(card.type, "tile");
  assert.deepEqual(card[POPUP_KEY], { popup: { type: "thermostat", name: ctx("climate.living").area?.area_id ?? "$area" } });
});

test("popup combines with a replacement card; the last popup wins, tap: false removes it", () => {
  const rules = [
    { match: { domain: "climate" }, card: { type: "custom:mini" }, tap: { popup: { type: "thermostat" } } },
    { match: { entity: "climate.living" }, tap: { popup: { type: "custom:big", entity: "$entity" } } },
  ];
  const card = createCardFactory(rules, "area").entity(ctx("climate.living"), tile("climate.living"));
  assert.equal(card.type, "custom:mini");
  assert.deepEqual(card[POPUP_KEY].popup, { type: "custom:big", entity: "$entity" }, "$entity is replaced when the popup opens");
  const off = createCardFactory([...rules, { match: { domain: "climate" }, tap: false }], "area").entity(ctx("climate.living"), tile("climate.living"));
  assert.equal(off[POPUP_KEY], undefined);
});

test("popup respects contexts and invalid popups are ignored", () => {
  const rules = [{ match: { domain: "climate" }, contexts: ["favorites"], tap: { popup: { type: "thermostat" } } }];
  assert.equal(createCardFactory(rules, "area").entity(ctx("climate.living"), tile("climate.living"))[POPUP_KEY], undefined);
  assert.ok(createCardFactory(rules, "favorites").entity(ctx("climate.living"), tile("climate.living"))[POPUP_KEY]);
  const bad = createCardFactory([{ match: { domain: "climate" }, tap: { popup: { name: "no type" } } }], "area");
  assert.equal(bad.entity(ctx("climate.living"), tile("climate.living"))[POPUP_KEY], undefined);
});

test("device cards carry the popup too", () => {
  const f = createCardFactory([{ match: { domain: "climate" }, scope: "device", card: { type: "entities", entities: "$entities" }, tap: { popup: { type: "thermostat" } } }], "area");
  const card = f.device({ id: "dev_trv" }, [ctx("climate.living")]);
  assert.deepEqual(card[POPUP_KEY].popup, { type: "thermostat" });
});

test("area views keep the popup on generated cards", () => {
  const { view } = generateAreaView(hass, "living_room", { card_rules: [{ match: { domain: "light" }, tap: { popup: { type: "light" } } }] });
  const cards = view.sections.flatMap((s) => s.cards || []);
  const light = cards.find((c) => c.entity === "light.lamp");
  assert.deepEqual(light?.[POPUP_KEY]?.popup, { type: "light" });
});

test("popup card config: entity is set, or replaces $entity", () => {
  assert.deepEqual(popupCardConfig({ type: "thermostat" }, "climate.a"), { type: "thermostat", entity: "climate.a" });
  assert.deepEqual(popupCardConfig({ type: "entities", entities: ["$entity", "sensor.x"] }, "climate.a"), { type: "entities", entities: ["climate.a", "sensor.x"] });
});

test("more-info from a card with a popup opens the popup instead", async () => {
  const opened = [];
  win.loadCardHelpers = async () => ({ createCardElement: (config) => { opened.push(config); return document.createElement("div"); } });
  const ha = document.createElement("home-assistant");
  ha.hass = hass;
  document.body.appendChild(ha);
  let reachedHa = 0;
  ha.addEventListener("hass-more-info", () => reachedHa++);

  const withPopup = document.createElement("div");
  withPopup.config = { type: "tile", entity: "climate.living", [POPUP_KEY]: { popup: { type: "thermostat" } } };
  const inner = document.createElement("span");
  withPopup.appendChild(inner);
  ha.appendChild(withPopup);
  const plain = document.createElement("div");
  plain.config = { type: "tile", entity: "light.lamp" };
  ha.appendChild(plain);

  const fire = (el, entityId) => el.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));

  fire(plain, "light.lamp");
  assert.equal(reachedHa, 1, "cards without popup are untouched");

  fire(inner, "climate.living");
  assert.equal(reachedHa, 1, "the more-info event is stopped");
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(opened, [{ type: "thermostat", entity: "climate.living" }]);
  const popup = document.querySelector("overview-plus-popup");
  assert.ok(popup, "popup is shown");
  assert.equal(popup.shadowRoot.querySelector(".title").textContent, hass.states["climate.living"].attributes.friendly_name ?? "");

  // the info button opens the regular dialog
  popup.shadowRoot.querySelector(".info").click();
  assert.equal(reachedHa, 2);
});

test("the popup is found on the lazy wrapper too", () => {
  const inner = document.createElement("div");
  const lazy = document.createElement("div");
  lazy._config = { type: "custom:overview-plus-lazy", card: { type: "tile", [POPUP_KEY]: { popup: { type: "thermostat" } } } };
  assert.deepEqual(popupForEvent({ composedPath: () => [inner, lazy, document.body, document, win] }), { type: "thermostat" });
  assert.equal(popupForEvent({ composedPath: () => [inner, document.body, document, win] }), undefined);
});

test.after(() => win.happyDOM.abort?.() ?? win.close());
