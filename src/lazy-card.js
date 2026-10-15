// @ts-check
/**
 * Lazy rendering of cards outside the visible area.
 *
 * Rendering is what makes large views slow (~3 ms per tile in Home Assistant),
 * generating the config takes a few milliseconds only. The wrapper card
 * `custom:overview-plus-lazy` creates the real card element right away – cheap, and
 * enough for Home Assistant to size it in the grid – but attaches it to the page only
 * when it comes close to the visible area. Until then a placeholder of the same size
 * is shown. Cards that become visible together are rendered over several frames
 * (time budget per frame), so the first screen appears at once.
 *
 *   { type: "custom:overview-plus-lazy", card: { type: "tile", entity: "…" } }
 */

export const LAZY_TYPE = "custom:overview-plus-lazy";
const LAZY_TAG = "overview-plus-lazy";

/** Cards rendered immediately, in view order (top of the view). */
export const EAGER_CARDS = 24;

/** Start rendering this far before a card scrolls into view. */
const ROOT_MARGIN = "300px 0px";

/** Grid row height and gap of the sections view, for the placeholder height. */
const ROW_HEIGHT = 56;
const ROW_GAP = 8;

/**
 * Tag of the element that renders a card type, or undefined.
 * @param {string} type
 */
function cardTag(type) {
  if (typeof type !== "string" || !type) return undefined;
  return type.startsWith("custom:") ? type.slice(7) : `hui-${type}-card`;
}

/**
 * Whether a card can be wrapped: its element class must already be defined,
 * otherwise Home Assistant could not size it before it is rendered.
 * @param {any} card
 */
export function canWrap(card) {
  if (!card || typeof card !== "object" || card.type === "heading" || card.type === LAZY_TYPE) return false;
  const tag = cardTag(card.type);
  return !!tag && !!globalThis.customElements?.get(tag);
}

/**
 * Wrap the cards of a generated view, except the first `eager` ones and headings.
 * @param {any} view
 * @param {number} [eager]
 * @returns {any} new view config
 */
export function lazifyView(view, eager = EAGER_CARDS) {
  if (!Array.isArray(view?.sections)) return view;
  let seen = 0;
  const sections = view.sections.map((/** @type {any} */ section) => ({
    ...section,
    cards: (section.cards || []).map((/** @type {any} */ card) => {
      if (card?.type === "heading") return card;
      seen++;
      if (seen <= eager || !canWrap(card)) return card;
      /** @type {Record<string, any>} */
      const wrapped = { type: LAZY_TYPE, card };
      // Home Assistant reads grid_options from the card config it knows about
      if (card.grid_options) wrapped.grid_options = card.grid_options;
      return wrapped;
    }),
  }));
  return { ...view, sections };
}

/** Render budget per frame, so the page stays responsive while cards come in. */
const FRAME_BUDGET_MS = 8;

/** @type {IntersectionObserver | undefined} */
let observer;
/** @type {Set<any>} cards waiting to be rendered, in the order they became visible */
const queue = new Set();
let scheduled = false;

const schedule = () => {
  if (scheduled) return;
  scheduled = true;
  const next = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (/** @type {any} */ cb) => setTimeout(cb, 0);
  next(() => {
    scheduled = false;
    const start = performance.now();
    for (const card of queue) {
      queue.delete(card);
      card._attach();
      if (performance.now() - start > FRAME_BUDGET_MS) break;
    }
    if (queue.size) schedule();
  });
};

function getObserver() {
  if (observer || typeof IntersectionObserver !== "function") return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) queue.add(entry.target);
        else queue.delete(entry.target);
      }
      if (queue.size) schedule();
    },
    { rootMargin: ROOT_MARGIN }
  );
  return observer;
}

class OverviewPlusLazyCard extends HTMLElement {
  constructor() {
    super();
    /** @type {any} */
    this._config = undefined;
    /** @type {any} */
    this._card = undefined;
    /** @type {any} */
    this._hass = undefined;
    this._attached = false;
    /** @type {HTMLElement | undefined} */
    this._placeholder = undefined;
    /** @type {any} */
    this._layout = undefined;
    this._preview = false;
  }

  /** @param {any} v */
  set layout(v) {
    this._layout = v;
    if (this._attached && this._card) this._card.layout = v;
  }

  get layout() {
    return this._layout;
  }

  /** @param {boolean} v */
  set preview(v) {
    this._preview = v;
    if (this._attached && this._card) this._card.preview = v;
  }

  get preview() {
    return this._preview;
  }

  /** @param {any} config */
  setConfig(config) {
    if (!config?.card?.type) throw new Error("overview-plus-lazy: card is required");
    this._config = config;
    const Card = customElements.get(/** @type {string} */ (cardTag(config.card.type)));
    if (!Card) throw new Error(`overview-plus-lazy: card type ${config.card.type} is not loaded`);
    if (!this._card || this._card.localName !== cardTag(config.card.type)) {
      this._card = new Card();
    }
    this._card.setConfig(config.card);
    if (this._attached && this._hass) this._card.hass = this._hass;
  }

  /** @param {any} hass */
  set hass(hass) {
    this._hass = hass;
    if (this._attached && this._card) this._card.hass = hass;
  }

  get hass() {
    return this._hass;
  }

  getGridOptions() {
    return this._card?.getGridOptions?.() ?? {};
  }

  getLayoutOptions() {
    return this._card?.getLayoutOptions?.() ?? {};
  }

  getCardSize() {
    return this._card?.getCardSize?.() ?? 1;
  }

  connectedCallback() {
    if (this._attached) return;
    this.style.display = "block";
    this.style.height = "100%";
    if (!this._placeholder) {
      const rows = Number(this.getGridOptions()?.rows) || 1;
      const placeholder = document.createElement("div");
      placeholder.style.cssText = [
        "height:100%",
        `min-height:${rows * ROW_HEIGHT + (rows - 1) * ROW_GAP}px`,
        "box-sizing:border-box",
        "border-radius:var(--ha-card-border-radius, 12px)",
        "background:var(--ha-card-background, var(--card-background-color, transparent))",
        "border:var(--ha-card-border-width, 1px) solid var(--ha-card-border-color, var(--divider-color, transparent))",
      ].join(";");
      this._placeholder = placeholder;
      this.appendChild(placeholder);
    }
    const io = getObserver();
    if (io) io.observe(this);
    else this._attach();
  }

  disconnectedCallback() {
    observer?.unobserve(this);
    queue.delete(this);
  }

  _attach() {
    if (this._attached || !this._card) return;
    this._attached = true;
    observer?.unobserve(this);
    this._card.layout = this._layout;
    this._card.preview = this._preview;
    if (this._hass) this._card.hass = this._hass;
    this._placeholder?.remove();
    this._placeholder = undefined;
    this.appendChild(this._card);
  }
}

if (globalThis.customElements && !customElements.get(LAZY_TAG)) {
  customElements.define(LAZY_TAG, OverviewPlusLazyCard);
}
