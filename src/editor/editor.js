// @ts-check
/**
 * Visual editor for the Overview Plus dashboard strategy.
 *
 * Home Assistant opens it from the dashboard's edit dialog via the strategy's static
 * getConfigElement(). Contract (home-assistant/frontend src/panels/lovelace/editor/hui-element-editor.ts):
 * the element receives `hass`, gets `setConfig(config)` and fires `config-changed`
 * with `{ config }` on every change.
 *
 * Layout (no nested dialogs):
 *   - area picker
 *   - for the selected area: area options, then one collapsible block per section
 *     (title, icon, layout, labels; advanced YAML fields collapsed), with move/delete
 *     buttons, and "add section"
 *   - card rules (YAML) and general options
 *
 * Fields are rendered with Home Assistant's `ha-form`. Value changes update the state
 * without re-rendering (keeps the focus); structure changes re-render the affected part.
 */

import { fromForm, toForm } from "./editor-config.js";
import { t } from "../i18n.js";

export const EDITOR_TAG = "overview-plus-strategy-editor";

const ICON = {
  up: "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z",
  down: "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z",
  delete: "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z",
};

const LAYOUTS = ["tiles", "devices", "compact", "table"];

const STYLE = `
  :host { display: block; }
  .block { margin-bottom: 24px; }
  .heading { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-medium, 500); margin: 0 0 8px; }
  .hint { color: var(--secondary-text-color); margin: 8px 0 16px; }
  .sections { display: flex; flex-direction: column; gap: 8px; margin: 16px 0 8px; }
  .panel-body { padding: 0 16px 8px; }
  .row { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
  .row.left { justify-content: flex-start; flex-wrap: wrap; gap: 8px; }
  details.panel { border: 1px solid var(--divider-color); border-radius: 12px; }
  details.panel > summary { padding: 12px 16px; cursor: pointer; }
  details.panel > summary .secondary { color: var(--secondary-text-color); margin-left: 8px; }
  button.fallback { font: inherit; padding: 6px 12px; border-radius: 16px; border: 1px solid var(--divider-color);
    background: none; color: var(--primary-color); cursor: pointer; }
`;

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
    if (helpers) {
      helpers.createCardElement({ type: "tile", entity: "sun.sun" });
      await Promise.race([customElements.whenDefined("hui-tile-card"), sleep(3000)]);
      const tile = /** @type {any} */ (customElements.get("hui-tile-card"));
      await tile?.getConfigElement?.();
    }
  } catch (err) {
    console.warn("[overview-plus] Could not preload the form components.", err);
  }
  await Promise.race([customElements.whenDefined("ha-form"), sleep(3000)]);
  return !!customElements.get("ha-form");
}

/** @param {any} v */
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** @param {string} area */
const newAreaEntry = (area) => ({
  area,
  badges: "default",
  badge_entities: [],
  show_other_devices: true,
  show_automations: true,
  sections: [],
});

class OverviewPlusStrategyEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    /** @type {any} */
    this._hass = undefined;
    /** @type {Record<string, any>} */
    this._config = {};
    /** @type {Record<string, any>} */
    this._form = toForm({});
    /** @type {string | undefined} */
    this._area = undefined;
    /** @type {Set<number>} indexes of expanded section blocks */
    this._expanded = new Set();
    /** @type {string | undefined} config last sent to Home Assistant */
    this._lastEmitted = undefined;
    /** @type {Record<string, HTMLElement>} */
    this._parts = {};
    this._built = false;
  }

  /** @param {any} hass */
  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first || !this._built) this._renderAll();
    else this._updateHass();
  }

  get hass() {
    return this._hass;
  }

  /** @param {Record<string, any>} config */
  setConfig(config) {
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    // Home Assistant passes our own change back in – nothing to re-render then.
    if (this._lastEmitted !== undefined && JSON.stringify(config) === this._lastEmitted) {
      this._config = config;
      return;
    }
    this._config = config;
    this._form = toForm(config);
    if (!this._area || !this._form.areas.some((/** @type {any} */ a) => a.area === this._area)) {
      this._area = this._form.areas[0]?.area;
    }
    this._expanded = new Set();
    this._renderAll();
  }

  connectedCallback() {
    if (!this._built) this._renderAll();
  }

  // ------------------------------------------------------------------ helpers

  /** @param {string} key @param {Record<string, string>} [params] */
  _t(key, params) {
    return t(this._hass, key, params);
  }

  /** @param {any} schema */
  _label = (schema) => this._t(`editor_${schema.name}`);

  /** @param {any} schema */
  _helper = (schema) => {
    const key = `editor_${schema.name}_help`;
    const text = this._t(key);
    return text === key ? undefined : text;
  };

  /**
   * @param {any[]} schema
   * @param {Record<string, any>} data
   * @param {(value: Record<string, any>) => void} onChange
   */
  _haForm(schema, data, onChange) {
    const form = /** @type {any} */ (document.createElement("ha-form"));
    form.hass = this._hass;
    form.schema = schema;
    form.data = data;
    form.computeLabel = this._label;
    form.computeHelper = this._helper;
    form.addEventListener("value-changed", (/** @type {any} */ ev) => {
      ev.stopPropagation();
      // ha-form is controlled: hand the new value back, otherwise the next field
      // change would start from stale data and drop this edit.
      form.data = ev.detail.value;
      onChange(ev.detail.value);
    });
    return form;
  }

  /**
   * @param {string} text
   * @param {() => void} onClick
   * @param {string} [appearance]
   */
  _button(text, onClick, appearance = "filled") {
    const tag = customElements.get("ha-button") ? "ha-button" : "button";
    const btn = document.createElement(tag);
    btn.textContent = text;
    if (tag === "ha-button") btn.setAttribute("appearance", appearance);
    else btn.className = "fallback";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onClick();
    });
    return btn;
  }

  /**
   * @param {string} path
   * @param {string} label
   * @param {() => void} onClick
   * @param {boolean} [disabled]
   */
  _iconButton(path, label, onClick, disabled = false) {
    /** @type {any} */
    let btn;
    if (customElements.get("ha-icon-button")) {
      btn = document.createElement("ha-icon-button");
      btn.path = path;
      btn.label = label;
    } else {
      btn = document.createElement("button");
      btn.className = "fallback";
      btn.textContent = label;
    }
    btn.disabled = disabled;
    btn.title = label;
    btn.addEventListener("click", (/** @type {Event} */ ev) => {
      ev.stopPropagation();
      if (!btn.disabled) onClick();
    });
    return btn;
  }

  /**
   * Collapsible block; ha-expansion-panel if available, <details> otherwise.
   * @param {string} header
   * @param {string} secondary
   * @param {boolean} expanded
   * @param {(expanded: boolean) => void} onToggle
   */
  _panel(header, secondary, expanded, onToggle) {
    if (customElements.get("ha-expansion-panel")) {
      const panel = /** @type {any} */ (document.createElement("ha-expansion-panel"));
      panel.header = header;
      panel.secondary = secondary;
      panel.expanded = expanded;
      panel.outlined = true;
      panel.addEventListener("expanded-changed", (/** @type {any} */ ev) => onToggle(ev.detail.expanded));
      const body = document.createElement("div");
      body.className = "panel-body";
      panel.appendChild(body);
      return {
        root: panel,
        body,
        /** @param {string} h @param {string} s */
        setHeader: (h, s) => { panel.header = h; panel.secondary = s; },
      };
    }
    const details = document.createElement("details");
    details.className = "panel";
    details.open = expanded;
    const summary = document.createElement("summary");
    const title = document.createElement("span");
    const sub = document.createElement("span");
    sub.className = "secondary";
    summary.append(title, sub);
    const body = document.createElement("div");
    body.className = "panel-body";
    details.append(summary, body);
    details.addEventListener("toggle", () => onToggle(details.open));
    const setHeader = (/** @type {string} */ h, /** @type {string} */ s) => { title.textContent = h; sub.textContent = s; };
    setHeader(header, secondary);
    return { root: details, body, setHeader };
  }

  // -------------------------------------------------------------- state & emit

  _entry() {
    return this._form.areas.find((/** @type {any} */ a) => a.area === this._area);
  }

  _ensureEntry() {
    let entry = this._entry();
    if (!entry && this._area) {
      entry = newAreaEntry(this._area);
      this._form.areas.push(entry);
    }
    return entry;
  }

  _emit() {
    const config = fromForm(this._form, this._config);
    this._config = config;
    this._lastEmitted = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  // ------------------------------------------------------------------- render

  _renderAll() {
    const root = /** @type {ShadowRoot} */ (this.shadowRoot);
    if (!this._hass || !root) return;
    root.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    // Area layouts
    const areaBlock = document.createElement("div");
    areaBlock.className = "block";
    const heading = document.createElement("div");
    heading.className = "heading";
    heading.textContent = this._t("editor_areas");
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = this._t("editor_areas_help");
    this._parts.areaPicker = this._haForm(this._areaPickerSchema(), { area: this._area }, (v) => {
      this._area = v.area || undefined;
      this._expanded = new Set();
      this._renderArea();
    });
    this._parts.area = document.createElement("div");
    areaBlock.append(heading, hint, this._parts.areaPicker, this._parts.area);

    // Card rules and general options
    const rulesBlock = document.createElement("div");
    rulesBlock.className = "block";
    this._parts.rules = this._haForm(
      [{ name: "card_rules", selector: { object: {} } }],
      { card_rules: this._form.card_rules },
      (v) => { this._form.card_rules = v.card_rules; this._emit(); }
    );
    rulesBlock.append(this._parts.rules);

    const generalBlock = document.createElement("div");
    generalBlock.className = "block";
    this._parts.general = this._haForm(
      [{ name: "", type: "grid", schema: [
        { name: "load_home_settings", selector: { boolean: {} } },
        { name: "debug", selector: { boolean: {} } },
      ] }],
      { load_home_settings: this._form.load_home_settings, debug: this._form.debug },
      (v) => { this._form.load_home_settings = v.load_home_settings; this._form.debug = v.debug; this._emit(); }
    );
    generalBlock.append(this._parts.general);

    root.append(areaBlock, rulesBlock, generalBlock);
    this._built = true;
    this._renderArea();
  }

  _updateHass() {
    const root = /** @type {ShadowRoot} */ (this.shadowRoot);
    root.querySelectorAll("ha-form").forEach((form) => { /** @type {any} */ (form).hass = this._hass; });
  }

  _areaPickerSchema() {
    const customized = new Set(Object.keys(fromForm(this._form, {}).area_overrides || {}));
    const floors = this._hass.floors || {};
    const options = Object.values(this._hass.areas || {})
      .map((/** @type {any} */ area) => {
        const floor = area.floor_id ? floors[area.floor_id]?.name : undefined;
        const name = floor ? `${floor} › ${area.name}` : area.name;
        return {
          value: area.area_id,
          label: customized.has(area.area_id) ? `${name} – ${this._t("editor_customized")}` : name,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ name: "area", selector: { select: { mode: "dropdown", options } } }];
  }

  _refreshAreaPicker() {
    const picker = /** @type {any} */ (this._parts.areaPicker);
    picker.schema = this._areaPickerSchema();
  }

  _renderArea() {
    const container = this._parts.area;
    container.innerHTML = "";
    if (!this._area) {
      const hint = document.createElement("div");
      hint.className = "hint";
      hint.textContent = this._t("editor_no_area");
      container.appendChild(hint);
      return;
    }
    const entry = this._entry() ?? newAreaEntry(this._area);

    // Area options
    this._parts.options = this._haForm(this._optionsSchema(entry), this._optionsData(entry), (v) => {
      const e = this._ensureEntry();
      const badgesChanged = v.badges !== e.badges;
      Object.assign(e, v);
      if (badgesChanged) /** @type {any} */ (this._parts.options).schema = this._optionsSchema(e);
      this._emit();
      this._refreshAreaPicker();
    });

    // Sections
    this._parts.sections = document.createElement("div");
    this._parts.sections.className = "sections";

    const actions = document.createElement("div");
    actions.className = "row left";
    actions.append(
      this._button(this._t("editor_add_section"), () => {
        const e = this._ensureEntry();
        e.sections.push({ title: "", layout: "tiles", labels: [] });
        this._expanded.add(e.sections.length - 1);
        this._renderSections();
        this._emit();
        this._refreshAreaPicker();
      }),
      this._button(this._t("editor_reset_area"), () => {
        this._form.areas = this._form.areas.filter((/** @type {any} */ a) => a.area !== this._area);
        this._expanded = new Set();
        this._emit();
        this._refreshAreaPicker();
        this._renderArea();
      }, "plain")
    );

    container.append(this._parts.options, this._parts.sections, actions);
    this._renderSections();
  }

  /** @param {any} entry */
  _optionsData(entry) {
    return {
      badges: entry.badges,
      badge_entities: entry.badge_entities,
      show_other_devices: entry.show_other_devices,
      show_automations: entry.show_automations,
    };
  }

  /** @param {any} entry */
  _optionsSchema(entry) {
    const badgeOptions = ["default", "none", "custom"].map((value) => ({ value, label: this._t(`editor_badges_${value}`) }));
    return [
      { name: "badges", selector: { select: { mode: "dropdown", options: badgeOptions } } },
      ...(entry.badges === "custom" ? [{ name: "badge_entities", selector: { entity: { multiple: true } } }] : []),
      { name: "", type: "grid", schema: [
        { name: "show_other_devices", selector: { boolean: {} } },
        { name: "show_automations", selector: { boolean: {} } },
      ] },
    ];
  }

  /** @param {any} section */
  _sectionSchema(section) {
    const layoutOptions = LAYOUTS.map((value) => ({ value, label: this._t(`editor_layout_${value}`) }));
    return [
      { name: "", type: "grid", schema: [
        { name: "title", selector: { text: {} } },
        { name: "icon", selector: { icon: {} } },
      ] },
      { name: "layout", selector: { select: { mode: "dropdown", options: layoutOptions } } },
      { name: "labels", selector: { label: { multiple: true } } },
      {
        name: "",
        type: "expandable",
        flatten: true,
        title: this._t("editor_advanced"),
        schema: [
          { name: "match", selector: { object: {} } },
          { name: "entities", selector: { object: {} } },
          ...((section.layout ?? "tiles") === "compact" ? [{ name: "primary", selector: { object: {} } }] : []),
        ],
      },
    ];
  }

  /** @param {any} section @param {number} index */
  _sectionHeader(section, index) {
    const header = section.title || this._t("editor_section_n", { n: String(index + 1) });
    const labels = (section.labels || []).map((/** @type {string} */ id) => this._hass.labels?.[id]?.name || id);
    const secondary = [this._t(`editor_layout_${section.layout || "tiles"}`), ...labels].join(" · ");
    return { header, secondary };
  }

  _renderSections() {
    const container = this._parts.sections;
    container.innerHTML = "";
    const entry = this._entry();
    const sections = entry?.sections ?? [];
    sections.forEach((/** @type {any} */ section, /** @type {number} */ index) => {
      const { header, secondary } = this._sectionHeader(section, index);
      const panel = this._panel(header, secondary, this._expanded.has(index), (open) => {
        if (open) this._expanded.add(index);
        else this._expanded.delete(index);
      });

      const form = this._haForm(this._sectionSchema(section), clone(section), (v) => {
        const layoutChanged = (v.layout ?? "tiles") !== (section.layout ?? "tiles");
        // Replace the section's content but keep the object identity in the list
        for (const key of Object.keys(section)) delete section[key];
        Object.assign(section, v);
        if (layoutChanged) form.schema = this._sectionSchema(section);
        const h = this._sectionHeader(section, index);
        panel.setHeader(h.header, h.secondary);
        this._emit();
      });

      const row = document.createElement("div");
      row.className = "row";
      row.append(
        this._iconButton(ICON.up, this._t("editor_move_up"), () => this._move(index, -1), index === 0),
        this._iconButton(ICON.down, this._t("editor_move_down"), () => this._move(index, 1), index === sections.length - 1),
        this._iconButton(ICON.delete, this._t("editor_delete_section"), () => this._delete(index))
      );
      panel.body.append(form, row);
      container.appendChild(panel.root);
    });
  }

  /** @param {number} index @param {number} delta */
  _move(index, delta) {
    const sections = this._entry()?.sections;
    const target = index + delta;
    if (!sections || target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    const wasOpen = this._expanded.has(index);
    const otherOpen = this._expanded.has(target);
    this._expanded.delete(index);
    this._expanded.delete(target);
    if (wasOpen) this._expanded.add(target);
    if (otherOpen) this._expanded.add(index);
    this._renderSections();
    this._emit();
  }

  /** @param {number} index */
  _delete(index) {
    const sections = this._entry()?.sections;
    if (!sections) return;
    sections.splice(index, 1);
    this._expanded = new Set([...this._expanded].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
    this._renderSections();
    this._emit();
    this._refreshAreaPicker();
  }
}

if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, OverviewPlusStrategyEditor);
