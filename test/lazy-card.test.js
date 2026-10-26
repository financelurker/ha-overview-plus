import { test } from "node:test";
import assert from "node:assert/strict";
import { installDom } from "./dom.js";

const win = installDom();

// Stand-in for HA's tile card: sizes itself from its config, counts renders
let renders = 0;
win.customElements.define("hui-tile-card", class extends win.HTMLElement {
  setConfig(c) { this.config = c; }
  getGridOptions() { return { columns: 6, rows: 1 + (this.config.features?.length || 0) }; }
  connectedCallback() { renders++; }
});

// Controllable IntersectionObserver
const observed = new Set();
let ioCallback;
globalThis.IntersectionObserver = class {
  constructor(cb) { ioCallback = cb; }
  observe(el) { observed.add(el); }
  unobserve(el) { observed.delete(el); }
};
const frames = [];
globalThis.requestAnimationFrame = (cb) => frames.push(cb);
const nextFrame = () => frames.splice(0).forEach((cb) => cb());
const scrollIntoView = (el) => { ioCallback([{ target: el, isIntersecting: true }]); nextFrame(); };

const { lazifyView, LAZY_TYPE, EAGER_CARDS, canWrap } = await import("../src/lazy-card.js");

const tile = (i, extra = {}) => ({ type: "tile", entity: `sensor.s${i}`, ...extra });
const view = (n) => ({
  type: "sections",
  sections: [
    { type: "grid", cards: [{ type: "heading", heading: "A" }, ...Array.from({ length: n }, (_, i) => tile(i))] },
  ],
});

test("the first cards stay as they are, the rest is wrapped; headings are never wrapped", () => {
  const out = lazifyView(view(30));
  const cards = out.sections[0].cards;
  assert.equal(cards[0].type, "heading");
  assert.ok(cards.slice(1, 1 + EAGER_CARDS).every((c) => c.type === "tile"));
  assert.ok(cards.slice(1 + EAGER_CARDS).every((c) => c.type === LAZY_TYPE && c.card.type === "tile"));
  assert.equal(cards.length, 31);
});

test("cards whose element is not loaded yet are not wrapped", () => {
  assert.equal(canWrap({ type: "custom:not-loaded-card" }), false);
  assert.equal(canWrap({ type: "picture-entity" }), false);
  assert.equal(canWrap({ type: "tile" }), true);
  const out = lazifyView({ sections: [{ cards: [{ type: "custom:not-loaded-card" }] }] }, 0);
  assert.equal(out.sections[0].cards[0].type, "custom:not-loaded-card");
});

test("grid options from the card config are kept on the wrapper", () => {
  const out = lazifyView({ sections: [{ cards: [tile(1, { grid_options: { columns: 12 } })] }] }, 0);
  assert.deepEqual(out.sections[0].cards[0].grid_options, { columns: 12 });
});

test("wrapper sizes like the real card and renders it only when scrolled into view", () => {
  const el = document.createElement("overview-plus-lazy");
  el.setConfig({ type: LAZY_TYPE, card: tile(1, { features: [{ type: "x" }] }) });
  assert.deepEqual(el.getGridOptions(), { columns: 6, rows: 2 }, "size known before rendering");

  const hass = { states: {} };
  el.hass = hass;
  renders = 0;
  document.body.appendChild(el);
  assert.equal(renders, 0, "not rendered while off screen");
  assert.ok(observed.has(el));
  assert.equal(el.firstElementChild.localName, "div", "placeholder");
  assert.equal(el.firstElementChild.style.minHeight, "120px", "2 rows = 2×56 + 8");

  scrollIntoView(el);
  assert.equal(renders, 1);
  assert.equal(el.firstElementChild.localName, "hui-tile-card");
  assert.equal(el.firstElementChild.hass, hass);
  assert.ok(!observed.has(el));

  const hass2 = { states: { a: 1 } };
  el.hass = hass2;
  assert.equal(el.firstElementChild.hass, hass2, "hass is passed on after rendering");
});

test("many cards becoming visible at once are rendered over several frames", () => {
  const els = Array.from({ length: 40 }, (_, i) => {
    const el = document.createElement("overview-plus-lazy");
    el.setConfig({ type: LAZY_TYPE, card: tile(100 + i) });
    document.body.appendChild(el);
    return el;
  });
  // simulated clock: every rendered card costs 1 ms, the frame budget is 8 ms
  const realNow = performance.now.bind(performance);
  let fake = 0;
  performance.now = () => fake++;
  renders = 0;
  ioCallback(els.map((target) => ({ target, isIntersecting: true })));
  nextFrame();
  const firstFrame = renders;
  while (frames.length) nextFrame();
  performance.now = realNow;
  assert.ok(firstFrame > 0 && firstFrame < 40, `first frame rendered ${firstFrame}`);
  assert.equal(renders, 40, "all cards rendered eventually");
});
