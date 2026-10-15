// @ts-check
/**
 * ha-form schemas of the visual editor. Dropdowns are filled from the user's own data
 * (integrations, domains, device classes, manufacturers and models that actually occur),
 * and still accept own values (custom_value).
 *
 * Manufacturer and model are regular expressions in the config. Values picked from the
 * list are stored as exact patterns (^…$), typed values are kept as entered.
 */

import { domainOf } from "../registry.js";

const LAYOUTS = ["tiles", "devices", "compact", "table"];
const CATEGORIES = ["none", "diagnostic", "config"];

/** Card types offered for "replace", in addition to registered custom cards. */
const BUILTIN_CARDS = [
  "tile", "entity", "button", "entities", "glance", "thermostat", "humidifier", "light",
  "media-control", "picture-entity", "gauge", "sensor", "history-graph", "statistics-graph",
  "alarm-panel", "area", "markdown",
];

/** @param {string} s */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** @param {any} v */
const has = (v) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && !v.length) &&
  !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v).length);

/**
 * @typedef {Object} Ctx
 * @property {any} hass
 * @property {(key: string, params?: Record<string, string>) => string} t
 */

/**
 * @param {Iterable<string>} values
 * @param {(v: string) => string} [label]
 */
const options = (values, label = (v) => v) =>
  [...new Set([...values].filter(Boolean))]
    .map((value) => ({ value, label: label(value) }))
    .sort((a, b) => a.label.localeCompare(b.label));

/**
 * Lists of values that occur in this installation.
 * @param {any} hass
 * @param {(key: string) => string} [t]
 */
export function collectOptions(hass, t = (/** @type {string} */ k) => k) {
  const states = Object.values(hass.states || {});
  const entities = Object.values(hass.entities || {});
  const devices = Object.values(hass.devices || {});
  /** @param {string} domain */
  const integrationName = (domain) => {
    const name = typeof hass.localize === "function" ? hass.localize(`component.${domain}.title`) : "";
    return name ? `${name} (${domain})` : domain;
  };
  /** @param {string} key */
  const exact = (key) =>
    [...new Set(devices.map((/** @type {any} */ d) => d[key]).filter(Boolean))]
      .map((v) => ({ value: `^${escapeRegex(v)}$`, label: v }))
      .sort((a, b) => a.label.localeCompare(b.label));
  return {
    integrations: options(entities.map((/** @type {any} */ e) => e.platform), integrationName),
    domains: options(states.map((/** @type {any} */ s) => domainOf(s.entity_id))),
    deviceClasses: [
      { value: "none", label: t("editor_device_class_none") },
      ...options(states.map((/** @type {any} */ s) => s.attributes?.device_class)),
    ],
    manufacturers: exact("manufacturer"),
    models: exact("model"),
    cardTypes: [
      ...BUILTIN_CARDS.map((type) => ({ value: type, label: type })),
      ...(/** @type {any} */ (globalThis).window?.customCards || []).map((/** @type {any} */ c) => ({
        value: `custom:${c.type}`,
        label: c.name ? `${c.name} (custom:${c.type})` : `custom:${c.type}`,
      })),
    ],
  };
}

/**
 * @param {{ value: string, label: string }[]} opts
 * @param {boolean} [multiple]
 */
const pick = (opts, multiple = true) => ({ select: { mode: "dropdown", multiple, custom_value: true, options: opts } });

/** @param {Ctx} ctx */
const categoryOptions = (ctx) => CATEGORIES.map((value) => ({ value, label: ctx.t(`editor_category_${value}`) }));

/**
 * Selection fields (m_*). With a YAML fallback value only that field is shown.
 * @param {Ctx} ctx
 * @param {ReturnType<typeof collectOptions>} opts
 * @param {Record<string, any>} data
 * @param {{ label?: boolean, area?: boolean }} [include]
 */
export function matchSchema(ctx, opts, data, include = {}) {
  if (has(data.m_yaml)) return [{ name: "m_yaml", selector: { object: {} } }];
  const categories = { select: { mode: "dropdown", multiple: true, options: categoryOptions(ctx) } };
  /** The same criteria for selection (m_) and exclusion (m_not_). @param {string} p */
  const criteria = (p) => [
    { name: `${p}label`, selector: { label: { multiple: true } } },
    { name: "", type: "grid", schema: [
      { name: `${p}integration`, selector: pick(opts.integrations) },
      { name: `${p}domain`, selector: pick(opts.domains) },
    ] },
    { name: "", type: "grid", schema: [
      { name: `${p}device_class`, selector: pick(opts.deviceClasses) },
      { name: `${p}entity_category`, selector: categories },
    ] },
    { name: "", type: "grid", schema: [
      { name: `${p}manufacturer`, selector: pick(opts.manufacturers) },
      { name: `${p}model`, selector: pick(opts.models) },
    ] },
    { name: `${p}device_name`, selector: { text: { multiple: true } } },
    { name: `${p}device`, selector: { device: { multiple: true } } },
    { name: `${p}entity`, selector: { entity: { multiple: true } } },
    ...(include.area ? [{ name: "", type: "grid", schema: [
      { name: `${p}area`, selector: { area: { multiple: true } } },
      { name: `${p}floor`, selector: { floor: { multiple: true } } },
    ] }] : []),
  ];
  const positive = criteria("m_").filter((s) => include.label || s.name !== "m_label");
  return [
    ...positive,
    { name: "", type: "expandable", flatten: true, title: ctx.t("editor_exclude"), schema: criteria("m_not_") },
  ];
}

/**
 * @param {Ctx} ctx
 * @param {ReturnType<typeof collectOptions>} opts
 * @param {Record<string, any>} section
 */
export function sectionSchema(ctx, opts, section) {
  const layoutOptions = LAYOUTS.map((value) => ({ value, label: ctx.t(`editor_layout_${value}`) }));
  const compact = (section.layout ?? "tiles") === "compact";
  return [
    { name: "", type: "grid", schema: [
      { name: "title", selector: { text: {} } },
      { name: "icon", selector: { icon: {} } },
    ] },
    { name: "layout", required: true, selector: { select: { mode: "dropdown", options: layoutOptions } } },
    ...(has(section.m_yaml) ? [] : [{ name: "m_label", selector: { label: { multiple: true } } }]),
    {
      name: "", type: "expandable", flatten: true, title: ctx.t("editor_refine"),
      schema: matchSchema(ctx, opts, section),
    },
    {
      name: "", type: "expandable", flatten: true, title: ctx.t("editor_entity_filter"),
      schema: has(section.e_yaml)
        ? [{ name: "e_yaml", selector: { object: {} } }]
        : [
            { name: "", type: "grid", schema: [
              { name: "e_include_domains", selector: pick(opts.domains) },
              { name: "e_exclude_domains", selector: pick(opts.domains) },
            ] },
            { name: "", type: "grid", schema: [
              { name: "e_include_categories", selector: { select: { mode: "dropdown", multiple: true, options: categoryOptions(ctx) } } },
              { name: "e_exclude_device_classes", selector: pick(opts.deviceClasses) },
            ] },
            { name: "e_exclude", selector: { entity: { multiple: true } } },
          ],
    },
    ...(compact ? [{
      name: "", type: "expandable", flatten: true, title: ctx.t("editor_primary"),
      schema: has(section.p_yaml)
        ? [{ name: "p_yaml", selector: { object: {} } }]
        : [{ name: "", type: "grid", schema: [
            { name: "p_domain", selector: pick(opts.domains) },
            { name: "p_device_class", selector: pick(opts.deviceClasses) },
          ] }],
    }] : []),
  ];
}

/**
 * @param {Ctx} ctx
 * @param {ReturnType<typeof collectOptions>} opts
 * @param {Record<string, any>} rule
 */
export function ruleSchema(ctx, opts, rule) {
  const device = rule.r_scope === "device";
  // A device card replaces all entity cards of a device: it cannot "adjust" one of them
  const action = device && rule.r_action === "adjust" ? "replace" : rule.r_action || "replace";
  /** @param {string[]} values @param {string} prefix */
  const choice = (values, prefix) => values.map((value) => ({ value, label: ctx.t(`${prefix}${value}`) }));
  const actions = device ? ["replace", "hide"] : ["replace", "adjust", "hide"];
  return [
    { name: "r_action", required: true, selector: { select: { mode: "dropdown", options: choice(actions, "editor_action_") } } },
    ...(action === "replace" ? [{ name: "r_type", required: true, selector: pick(opts.cardTypes, false) }] : []),
    ...(action !== "hide" ? [
      { name: "", type: "grid", schema: [
        { name: "r_name", selector: { text: {} } },
        { name: "r_icon", selector: { icon: {} } },
      ] },
      { name: "r_color", selector: { ui_color: {} } },
      { name: "", type: "expandable", flatten: true, title: ctx.t("editor_card_options"),
        schema: [{ name: "r_options", selector: { object: {} } }] },
    ] : []),
    { name: "", type: "expandable", flatten: true, expanded: true, title: ctx.t("editor_applies_to"),
      schema: matchSchema(ctx, opts, rule, { label: true, area: true }) },
    { name: "", type: "expandable", flatten: true, title: ctx.t("editor_rule_scope"), schema: [
      { name: "r_scope", required: true, selector: { select: { mode: "dropdown", options: choice(["entity", "device"], "editor_scope_") } } },
      { name: "r_contexts", selector: { select: { mode: "dropdown", multiple: true, options: choice(["favorites", "area", "area_other"], "editor_context_") } } },
      { name: "r_stop", selector: { boolean: {} } },
    ] },
  ];
}

/**
 * Short description of a selection for block headers.
 * @param {Ctx} ctx
 * @param {Record<string, any>} data
 */
export function matchSummary(ctx, data) {
  if (has(data.m_yaml)) return ctx.t("editor_yaml_selection");
  /** @type {string[]} */
  const parts = [];
  /** @param {string} id */
  const label = (id) => ctx.hass.labels?.[id]?.name || id;
  /** @param {string} id */
  const entity = (id) => ctx.hass.states?.[id]?.attributes?.friendly_name || id;
  /** @param {string} id */
  const device = (id) => ctx.hass.devices?.[id]?.name_by_user || ctx.hass.devices?.[id]?.name || id;
  /** @param {string} p */
  const pattern = (p) => p.replace(/^\^/, "").replace(/\$$/, "").replace(/\\(.)/g, "$1");
  /** @type {[string, (v: string) => string][]} */
  const keys = [
    ["m_label", label], ["m_integration", (v) => v], ["m_domain", (v) => v], ["m_device_class", (v) => v],
    ["m_manufacturer", pattern], ["m_model", pattern], ["m_device", device], ["m_entity", entity],
    ["m_area", (id) => ctx.hass.areas?.[id]?.name || id], ["m_device_name", (v) => v],
  ];
  for (const [key, fmt] of keys) {
    const values = data[key];
    if (Array.isArray(values) && values.length) parts.push(values.map(fmt).join(", "));
  }
  return parts.join(" · ");
}
