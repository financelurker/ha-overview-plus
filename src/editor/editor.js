// @ts-check
/**
 * Visual editor for the Overview Plus dashboard strategy.
 *
 * Home Assistant opens it from the dashboard's edit dialog via the strategy's static
 * getConfigElement(). Contract (home-assistant/frontend src/panels/lovelace/editor/hui-element-editor.ts):
 * the element receives `hass`, gets `setConfig(config)` and fires `config-changed`
 * with `{ config }` on every change.
 *
 * The form is built with Home Assistant's own `ha-form` and selectors. `ha-form` is
 * loaded by the frontend on demand, so ensureHaForm() loads it through a built-in card
 * editor first. If that fails, getConfigElement() returns nothing and Home Assistant
 * falls back to its YAML editor.
 */

import { fromForm, toForm } from "./editor-config.js";
import { t } from "../i18n.js";

export const EDITOR_TAG = "overview-plus-strategy-editor";

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make sure `ha-form` is defined. Loading the tile card editor imports ha-form.
 * @returns {Promise<boolean>}
 */
export async function ensureHaForm() {
  if (customElements.get("ha-form")) return true;
  try {
    const helpers = await /** @type {any} */ (window).loadCardHelpers?.();
    helpers?.createCardElement({ type: "tile", entity: "sun.sun" });
    await Promise.race([customElements.whenDefined("hui-tile-card"), sleep(3000)]);
    const tile = /** @type {any} */ (customElements.get("hui-tile-card"));
    await tile?.getConfigElement?.();
  } catch (err) {
    console.warn("[overview-plus] Could not preload the form components.", err);
  }
  await Promise.race([customElements.whenDefined("ha-form"), sleep(3000)]);
  return !!customElements.get("ha-form");
}

/**
 * @param {any} hass
 * @returns {any[]} ha-form schema
 */
export function buildSchema(hass) {
  /** @param {string} key */
  const L = (key) => t(hass, key);
  const layoutOptions = ["tiles", "devices", "compact", "table"].map((value) => ({
    value,
    label: L(`editor_layout_${value}`),
  }));
  const badgeOptions = ["default", "none", "custom"].map((value) => ({ value, label: L(`editor_badges_${value}`) }));

  const sectionFields = {
    title: { label: L("editor_title"), selector: { text: {} } },
    icon: { label: L("editor_icon"), selector: { icon: {} } },
    layout: { label: L("editor_layout"), selector: { select: { mode: "dropdown", options: layoutOptions } } },
    labels: { label: L("editor_labels"), description: L("editor_labels_help"), selector: { label: { multiple: true } } },
    match: { label: L("editor_match"), description: L("editor_match_help"), selector: { object: {} } },
    entities: { label: L("editor_entities"), description: L("editor_entities_help"), selector: { object: {} } },
    primary: { label: L("editor_primary"), description: L("editor_primary_help"), selector: { object: {} } },
  };

  const areaFields = {
    area: { label: L("editor_area"), required: true, selector: { area: {} } },
    sections: {
      label: L("editor_sections"),
      description: L("editor_sections_help"),
      selector: { object: { multiple: true, label_field: "title", description_field: "layout", fields: sectionFields } },
    },
    badges: { label: L("editor_badges"), selector: { select: { mode: "dropdown", options: badgeOptions } } },
    badge_entities: { label: L("editor_badge_entities"), selector: { entity: { multiple: true } } },
    show_other_devices: { label: L("editor_show_other_devices"), selector: { boolean: {} } },
    show_automations: { label: L("editor_show_automations"), selector: { boolean: {} } },
  };

  return [
    {
      name: "areas",
      selector: { object: { multiple: true, label_field: "area", fields: areaFields } },
    },
    { name: "card_rules", selector: { object: {} } },
    {
      name: "",
      type: "grid",
      schema: [
        { name: "load_home_settings", selector: { boolean: {} } },
        { name: "debug", selector: { boolean: {} } },
      ],
    },
  ];
}

class OverviewPlusStrategyEditor extends HTMLElement {
  constructor() {
    super();
    /** @type {any} */
    this._hass = undefined;
    /** @type {Record<string, any>} */
    this._config = {};
    /** @type {Record<string, any>} */
    this._form = {};
    /** @type {any} */
    this._formEl = undefined;
    /** @type {string | undefined} */
    this._schemaLang = undefined;
  }

  /** @param {any} hass */
  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  get hass() {
    return this._hass;
  }

  /** @param {Record<string, any>} config */
  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    this._config = config;
    this._form = toForm(config);
    this._render();
  }

  connectedCallback() {
    this._render();
  }

  _render() {
    if (!this._hass) return;
    if (!this._formEl) {
      this._formEl = document.createElement("ha-form");
      this._formEl.addEventListener("value-changed", (/** @type {any} */ ev) => this._valueChanged(ev));
      this.appendChild(this._formEl);
    }
    const lang = this._hass.locale?.language || this._hass.language;
    if (lang !== this._schemaLang) {
      this._schemaLang = lang;
      this._formEl.schema = buildSchema(this._hass);
      this._formEl.computeLabel = (/** @type {any} */ s) => t(this._hass, `editor_${s.name}`);
      this._formEl.computeHelper = (/** @type {any} */ s) => {
        const help = t(this._hass, `editor_${s.name}_help`);
        return help === `editor_${s.name}_help` ? undefined : help;
      };
    }
    this._formEl.hass = this._hass;
    this._formEl.data = this._form;
  }

  /** @param {CustomEvent} ev */
  _valueChanged(ev) {
    ev.stopPropagation();
    this._form = ev.detail.value;
    const config = fromForm(this._form, this._config);
    this._config = config;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }
}

if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, OverviewPlusStrategyEditor);
