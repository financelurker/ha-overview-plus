// @ts-check
/**
 * Visual editor for the Overview Plus dashboard strategy.
 *
 * Home Assistant opens it from the dashboard's edit dialog via the strategy's static
 * getConfigElement(). Contract (home-assistant/frontend src/panels/lovelace/editor/hui-element-editor.ts):
 * the element receives `hass`, gets `setConfig(config)` and fires `config-changed`
 * with `{ config }` on every change.
 *
 * Layout (no dialogs):
 *   - Area layouts: one collapsible block per customized area with its options and its
 *     sections (each a collapsible block with move/delete buttons), "add area" below
 *   - General: card rules (each a collapsible block) and the dashboard-wide options
 *
 * Everything is a form field; a YAML field appears only for constructs the form cannot
 * show (see editor-config.js).
 *
 * Fields are rendered with Home Assistant's `ha-form`. Value changes update the state
 * without re-rendering (keeps the focus); structure changes re-render the affected part.
 */

import { fromForm, toForm } from "./editor-config.js";
import { areaTileClassOptions, collectOptions, matchSummary, ruleSchema, sectionSchema } from "./schemas.js";
import { t } from "../i18n.js";

export const EDITOR_TAG = "overview-plus-strategy-editor";

const ICON = {
  up: "M13,20H11V8L5.5,13.5L4.08,12.08L12,4.16L19.92,12.08L18.5,13.5L13,8V20Z",
  down: "M11,4H13V16L18.5,10.5L19.92,11.92L12,19.84L4.08,11.92L5.5,10.5L11,16V4Z",
  delete: "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z",
};

// Spacing follows Home Assistant's own forms: 24px between fields and parts,
// 12px padding inside collapsible blocks, 8px between the blocks of a list.
const STYLE = `
  :host { display: block; }
  .block + .block { margin-top: 24px; }
  .heading { font-size: var(--ha-font-size-l, 16px); font-weight: var(--ha-font-weight-medium, 500); margin: 0 0 4px; }
  .subheading { font-weight: var(--ha-font-weight-medium, 500); margin: 0 0 4px; }
  .heading + .subheading { margin-top: 16px; }
  .hint { color: var(--secondary-text-color); margin: 0 0 16px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .list:empty { display: none; }
  .list > .hint { margin: 0; }
  .areas, .rules { margin-bottom: 16px; }
  .general { border-top: 1px solid var(--divider-color); padding-top: 24px; }
  .rule-actions { margin-bottom: 24px; }
  ha-expansion-panel { display: block; --expansion-panel-content-padding: 0; --expansion-panel-summary-padding: 0 4px 0 12px; }
  .panel-body { display: flex; flex-direction: column; gap: 24px; padding: 12px; }
  .panel-body > .row.icons { margin-top: -16px; }
  .row { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
  .row.left { justify-content: flex-start; flex-wrap: wrap; gap: 8px; }
  details.panel { border: 1px solid var(--divider-color); border-radius: var(--ha-border-radius-md, 12px); }
  details.panel > summary { padding: 12px; cursor: pointer; }
  details.panel > summary .secondary { display: block; color: var(--secondary-text-color); font-size: 0.9em; }
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

/** @param {any} v */
const filled = (v) => v !== undefined && v !== null && v !== "" && JSON.stringify(v) !== "{}" && JSON.stringify(v) !== "[]";

/** Things that change which fields a section form shows. @param {any} s */
const sectionShape = (s) => [(s.layout ?? "tiles") === "compact", filled(s.m_yaml), filled(s.e_yaml), filled(s.p_yaml)].join();

/** Things that change which fields a rule form shows. @param {any} r */
const ruleShape = (r) => [r.r_action || "replace", r.r_scope || "entity", r.r_tap || "default", filled(r.m_yaml)].join();

/** @param {string} area */
const newAreaEntry = (area) => ({
  area,
  badges: "default",
  badge_entities: [],
  show_other_devices: true,
  show_automations: true,
  t_sensors: "default",
  t_sensor_classes: [],
  t_entities: [],
  t_show_names: false,
  t_alert_classes: [],
  t_alert_entities: [],
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
    /** @type {Set<string>} area ids whose block is expanded */
    this._openAreas = new Set();
    /** @type {Map<string, Set<number>>} per area: indexes of expanded section blocks */
    this._openSections = new Map();
    /** @type {Set<number>} indexes of expanded card rule blocks */
    this._openRules = new Set();
    /** @type {any} */
    this._opts = undefined;
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
    // Keep the open/closed state of areas that still exist; open the only area by default
    const ids = new Set(this._form.areas.map((/** @type {any} */ a) => a.area));
    this._openAreas = new Set([...this._openAreas].filter((id) => ids.has(id)));
    if (ids.size === 1) this._openAreas.add([...ids][0]);
    this._openSections = new Map();
    this._openRules = new Set([...this._openRules].filter((i) => i < this._form.rules.length));
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

  _emit() {
    const config = fromForm(this._form, this._config);
    this._config = config;
    this._lastEmitted = JSON.stringify(config);
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  /** @param {string} areaId */
  _areaName(areaId) {
    const area = this._hass.areas?.[areaId];
    if (!area) return areaId;
    const floor = area.floor_id ? this._hass.floors?.[area.floor_id]?.name : undefined;
    return floor ? `${floor} › ${area.name}` : area.name;
  }

  /** @param {string} areaId */
  _sectionState(areaId) {
    if (!this._openSections.has(areaId)) this._openSections.set(areaId, new Set());
    return /** @type {Set<number>} */ (this._openSections.get(areaId));
  }

  // ------------------------------------------------------------------- render

  _renderAll() {
    const root = /** @type {ShadowRoot} */ (this.shadowRoot);
    if (!this._hass || !root) return;
    root.innerHTML = "";
    this._opts = collectOptions(this._hass, (k) => this._t(k));
    const style = document.createElement("style");
    style.textContent = STYLE;
    root.appendChild(style);

    // ---- Area layouts: one block per customized area
    const areaBlock = document.createElement("div");
    areaBlock.className = "block";
    areaBlock.append(this._heading("editor_areas"), this._hint("editor_areas_help"));
    this._parts.areas = document.createElement("div");
    this._parts.areas.className = "areas list";
    this._parts.addArea = document.createElement("div");
    this._parts.addArea.className = "add-area";
    areaBlock.append(this._parts.areas, this._parts.addArea);

    // ---- General: card rules and options for the whole dashboard
    const generalBlock = document.createElement("div");
    generalBlock.className = "block general";
    this._parts.rules = document.createElement("div");
    this._parts.rules.className = "rules list";
    const ruleActions = document.createElement("div");
    ruleActions.className = "row left rule-actions";
    ruleActions.append(this._button(this._t("editor_add_rule"), () => {
      this._form.rules.push({ r_action: "replace", r_scope: "entity", r_tap: "default" });
      this._openRules.add(this._form.rules.length - 1);
      this._renderRules();
      this._emit();
    }));
    generalBlock.append(
      this._heading("editor_general"),
      this._subheading("editor_card_rules"),
      this._hint("editor_card_rules_help"),
      this._parts.rules,
      ruleActions,
      this._haForm(
        [
          { name: "strip_area_names", selector: { boolean: {} } },
          { name: "lazy_render", selector: { boolean: {} } },
          { name: "", type: "grid", schema: [
            { name: "load_home_settings", selector: { boolean: {} } },
            { name: "debug", selector: { boolean: {} } },
          ] },
        ],
        { strip_area_names: this._form.strip_area_names, lazy_render: this._form.lazy_render, load_home_settings: this._form.load_home_settings, debug: this._form.debug },
        (v) => {
          this._form.strip_area_names = v.strip_area_names;
          this._form.lazy_render = v.lazy_render;
          this._form.load_home_settings = v.load_home_settings;
          this._form.debug = v.debug;
          this._emit();
        }
      )
    );

    root.append(areaBlock, generalBlock);
    this._built = true;
    this._renderAreas();
    this._renderRules();
  }

  /** @param {string} key */
  _subheading(key) {
    const el = document.createElement("div");
    el.className = "subheading";
    el.textContent = this._t(key);
    return el;
  }

  _ctx() {
    return { hass: this._hass, t: (/** @type {string} */ k, /** @type {any} */ p) => this._t(k, p) };
  }

  /** @param {string} key */
  _heading(key) {
    const el = document.createElement("div");
    el.className = "heading";
    el.textContent = this._t(key);
    return el;
  }

  /** @param {string} key */
  _hint(key) {
    const el = document.createElement("div");
    el.className = "hint";
    el.textContent = this._t(key);
    return el;
  }

  _updateHass() {
    const root = /** @type {ShadowRoot} */ (this.shadowRoot);
    root.querySelectorAll("ha-form").forEach((form) => { /** @type {any} */ (form).hass = this._hass; });
  }

  _renderAreas() {
    const container = this._parts.areas;
    container.innerHTML = "";
    if (!this._form.areas.length) container.append(this._hint("editor_no_area"));
    for (const entry of this._form.areas) container.appendChild(this._renderAreaPanel(entry));
    this._renderAddArea();
  }

  /** "Add area": picker with the areas that have no layout yet. */
  _renderAddArea() {
    const container = this._parts.addArea;
    container.innerHTML = "";
    const used = new Set(this._form.areas.map((/** @type {any} */ a) => a.area));
    const options = Object.keys(this._hass.areas || {})
      .filter((id) => !used.has(id))
      .map((id) => ({ value: id, label: this._areaName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label));
    if (!options.length) return;
    container.append(
      this._haForm(
        [{ name: "add_area", selector: { select: { mode: "dropdown", options } } }],
        {},
        (v) => {
          if (!v.add_area) return;
          this._form.areas.push(newAreaEntry(v.add_area));
          this._openAreas.add(v.add_area);
          this._renderAreas();
          // nothing to emit yet: an area without sections and with default options has no override
        }
      )
    );
  }

  /** @param {any} entry */
  _areaSummary(entry) {
    const n = entry.sections.length;
    const parts = [this._t(n === 1 ? "editor_one_section" : "editor_n_sections", { n: String(n) })];
    if (entry.badges !== "default") parts.push(`${this._t("editor_badges")}: ${this._t(`editor_badges_${entry.badges}`)}`);
    return parts.join(" · ");
  }

  /** @param {any} entry */
  _renderAreaPanel(entry) {
    const panel = this._panel(this._areaName(entry.area), this._areaSummary(entry), this._openAreas.has(entry.area), (open) => {
      if (open) this._openAreas.add(entry.area);
      else this._openAreas.delete(entry.area);
    });
    panel.root.classList.add("area-panel");
    const refreshHeader = () => panel.setHeader(this._areaName(entry.area), this._areaSummary(entry));

    const options = this._haForm(this._optionsSchema(entry), this._optionsData(entry), (v) => {
      const shapeChanged = v.badges !== entry.badges || (v.t_sensors ?? "default") !== (entry.t_sensors ?? "default");
      Object.assign(entry, v);
      if (shapeChanged) options.schema = this._optionsSchema(entry);
      refreshHeader();
      this._emit();
    });

    const sections = document.createElement("div");
    sections.className = "sections list";
    const renderSections = () => this._renderSections(entry, sections, refreshHeader);

    const actions = document.createElement("div");
    actions.className = "row left";
    actions.append(
      this._button(this._t("editor_add_section"), () => {
        entry.sections.push({ title: "", layout: "tiles", m_label: [] });
        this._sectionState(entry.area).add(entry.sections.length - 1);
        renderSections();
        refreshHeader();
        this._emit();
      }),
      this._button(this._t("editor_remove_area"), () => {
        this._form.areas = this._form.areas.filter((/** @type {any} */ a) => a !== entry);
        this._openAreas.delete(entry.area);
        this._openSections.delete(entry.area);
        this._renderAreas();
        this._emit();
      }, "plain")
    );

    panel.body.append(options, sections, actions);
    renderSections();
    return panel.root;
  }

  /** @param {any} entry */
  _optionsData(entry) {
    return {
      badges: entry.badges,
      badge_entities: entry.badge_entities,
      show_other_devices: entry.show_other_devices,
      show_automations: entry.show_automations,
      t_sensors: entry.t_sensors ?? "default",
      t_sensor_classes: entry.t_sensor_classes,
      t_entities: entry.t_entities,
      t_show_names: entry.t_show_names,
      t_alert_classes: entry.t_alert_classes,
      t_alert_entities: entry.t_alert_entities,
      t_color: entry.t_color,
      t_name: entry.t_name,
    };
  }

  /** @param {any} entry */
  _optionsSchema(entry) {
    const badgeOptions = ["default", "none", "custom"].map((value) => ({ value, label: this._t(`editor_badges_${value}`) }));
    const sensorModes = ["default", "custom", "entities"].map((value) => ({ value, label: this._t(`editor_t_sensors_${value}`) }));
    const tileClasses = areaTileClassOptions(this._hass, entry.area, entry.t_sensor_classes, entry.t_alert_classes);
    /** @param {{ value: string, label: string }[]} options */
    const classes = (options) => ({ select: { mode: "dropdown", multiple: true, custom_value: true, options } });
    return [
      { name: "badges", required: true, selector: { select: { mode: "dropdown", options: badgeOptions } } },
      ...(entry.badges === "custom" ? [{ name: "badge_entities", selector: { entity: { multiple: true } } }] : []),
      { name: "", type: "grid", schema: [
        { name: "show_other_devices", selector: { boolean: {} } },
        { name: "show_automations", selector: { boolean: {} } },
      ] },
      {
        name: "", type: "expandable", flatten: true, title: this._t("editor_tile"),
        schema: [
          { name: "", type: "grid", schema: [
            { name: "t_name", selector: { text: {} } },
            { name: "t_color", selector: { ui_color: {} } },
          ] },
          { name: "t_sensors", required: true, selector: { select: { mode: "dropdown", options: sensorModes } } },
          ...((entry.t_sensors ?? "default") === "custom" ? [{ name: "t_sensor_classes", selector: classes(tileClasses.sensor) }] : []),
          ...((entry.t_sensors ?? "default") === "entities" ? [
            { name: "t_entities", selector: { entity: { multiple: true, reorder: true } } },
            { name: "t_show_names", selector: { boolean: {} } },
          ] : []),
          { name: "t_alert_classes", selector: classes(tileClasses.alert) },
          { name: "t_alert_entities", selector: { entity: { multiple: true, filter: { domain: "binary_sensor" } } } },
        ],
      },
    ];
  }

  /** @param {any} section @param {number} index */
  _sectionHeader(section, index) {
    const header = section.title || this._t("editor_section_n", { n: String(index + 1) });
    const selection = matchSummary(this._ctx(), section);
    const secondary = [this._t(`editor_layout_${section.layout || "tiles"}`), selection].filter(Boolean).join(" · ");
    return { header, secondary };
  }

  /**
   * @param {any} entry
   * @param {HTMLElement} container
   * @param {() => void} refreshAreaHeader
   */
  _renderSections(entry, container, refreshAreaHeader) {
    container.innerHTML = "";
    const open = this._sectionState(entry.area);
    const rerender = () => this._renderSections(entry, container, refreshAreaHeader);
    entry.sections.forEach((/** @type {any} */ section, /** @type {number} */ index) => {
      const { header, secondary } = this._sectionHeader(section, index);
      const panel = this._panel(header, secondary, open.has(index), (isOpen) => {
        if (isOpen) open.add(index);
        else open.delete(index);
      });

      const form = this._haForm(sectionSchema(this._ctx(), this._opts, section), clone(section), (v) => {
        const before = sectionShape(section);
        for (const key of Object.keys(section)) delete section[key];
        Object.assign(section, v);
        if (sectionShape(section) !== before) form.schema = sectionSchema(this._ctx(), this._opts, section);
        const h = this._sectionHeader(section, index);
        panel.setHeader(h.header, h.secondary);
        this._emit();
      });

      const row = document.createElement("div");
      row.className = "row icons";
      row.append(
        this._iconButton(ICON.up, this._t("editor_move_up"), () => this._move(entry, index, -1, rerender), index === 0),
        this._iconButton(ICON.down, this._t("editor_move_down"), () => this._move(entry, index, 1, rerender), index === entry.sections.length - 1),
        this._iconButton(ICON.delete, this._t("editor_delete_section"), () => {
          entry.sections.splice(index, 1);
          const next = new Set([...open].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
          this._openSections.set(entry.area, next);
          rerender();
          refreshAreaHeader();
          this._emit();
        })
      );
      panel.body.append(form, row);
      container.appendChild(panel.root);
    });
  }

  /**
   * @param {any} entry
   * @param {number} index
   * @param {number} delta
   * @param {() => void} rerender
   */
  _move(entry, index, delta, rerender) {
    const sections = entry.sections;
    const target = index + delta;
    if (target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    const open = this._sectionState(entry.area);
    const a = open.has(index);
    const b = open.has(target);
    open.delete(index);
    open.delete(target);
    if (a) open.add(target);
    if (b) open.add(index);
    rerender();
    this._emit();
  }

  /** @param {any} rule @param {number} index */
  _ruleHeader(rule, index) {
    const action = rule.r_action || "replace";
    let header = this._t(`editor_action_${action}`);
    if (action === "replace" && rule.r_type) header += `: ${rule.r_type}`;
    if (action === "adjust" && rule.r_name) header += `: ${rule.r_name}`;
    if (action !== "hide" && rule.r_tap === "popup" && rule.r_popup_type) {
      header += ` · ${this._t("editor_rule_popup", { type: rule.r_popup_type })}`;
    }
    const selection = matchSummary(this._ctx(), rule) || this._t("editor_all_entities");
    return { header: `${index + 1}. ${header}`, secondary: selection };
  }

  _renderRules() {
    const container = this._parts.rules;
    if (!container) return;
    container.innerHTML = "";
    const rules = this._form.rules;
    rules.forEach((/** @type {any} */ rule, /** @type {number} */ index) => {
      const { header, secondary } = this._ruleHeader(rule, index);
      const panel = this._panel(header, secondary, this._openRules.has(index), (open) => {
        if (open) this._openRules.add(index);
        else this._openRules.delete(index);
      });
      const form = this._haForm(ruleSchema(this._ctx(), this._opts, rule), clone(rule), (v) => {
        const before = ruleShape(rule);
        for (const key of Object.keys(rule)) delete rule[key];
        Object.assign(rule, v);
        if (ruleShape(rule) !== before) form.schema = ruleSchema(this._ctx(), this._opts, rule);
        const h = this._ruleHeader(rule, index);
        panel.setHeader(h.header, h.secondary);
        this._emit();
      });
      const swap = (/** @type {number} */ delta) => {
        const target = index + delta;
        [rules[index], rules[target]] = [rules[target], rules[index]];
        const a = this._openRules.has(index);
        const b = this._openRules.has(target);
        this._openRules.delete(index);
        this._openRules.delete(target);
        if (a) this._openRules.add(target);
        if (b) this._openRules.add(index);
        this._renderRules();
        this._emit();
      };
      const row = document.createElement("div");
      row.className = "row icons";
      row.append(
        this._iconButton(ICON.up, this._t("editor_move_up"), () => swap(-1), index === 0),
        this._iconButton(ICON.down, this._t("editor_move_down"), () => swap(1), index === rules.length - 1),
        this._iconButton(ICON.delete, this._t("editor_delete_rule"), () => {
          rules.splice(index, 1);
          this._openRules = new Set([...this._openRules].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)));
          this._renderRules();
          this._emit();
        })
      );
      panel.body.append(form, row);
      container.appendChild(panel.root);
    });
  }
}

if (!customElements.get(EDITOR_TAG)) customElements.define(EDITOR_TAG, OverviewPlusStrategyEditor);
