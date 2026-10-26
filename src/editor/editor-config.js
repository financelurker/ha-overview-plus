// @ts-check
/**
 * Conversion between the strategy config (YAML shape) and the data edited by the
 * visual editor (ha-form shape). The conversion is lossless: options the form does
 * not know are carried over unchanged. Everything the form can represent is shown
 * as form fields; only constructs it cannot represent (e.g. OR lists of selections)
 * are kept in a YAML fallback field (`m_yaml`, `e_yaml`, `p_yaml`).
 *
 * Form shape:
 *   load_home_settings: boolean        true = overview page settings of the built-in Overview
 *   home: { welcome, suggested, favorites, alerts, alert_extra, items }   own overview page settings
 *   indicators: area states, see indicatorsToForm
 *   summary_pages: { light, climate, … }   pages the summaries lead to; empty = Home Assistant's own
 *   strip_area_names, lazy_render, debug: boolean
 *   rules: [{ r_action, r_type, r_name, r_icon, r_color, r_options, r_tap, r_popup_type, r_popup_options,
 *            r_scope, r_contexts, r_stop, m_* }]
 *   areas: [{
 *     area, badges: "default" | "none" | "custom", badge_entities, show_default_sections, show_other_devices, show_automations,
 *     t_sensors, t_sensor_classes, t_entities, t_show_names, t_alert_classes, t_alert_entities, t_color, t_name,
 *     tile_extra (other tile options),
 *     sections: [{ title, icon, layout, hidden, m_*, e_*, p_*, hide_rules, sort_groups } | { default, hidden }]
 *   }]
 *
 * Selection fields (m_*), all lists: m_label, m_integration, m_domain, m_device_class,
 * m_entity_category, m_manufacturer, m_model, m_device, m_device_name, m_entity, m_area, m_floor,
 * and the same criteria as exclusions (m_not_*). Primary entity: p_domain, p_device_class (lists).
 */

import { DEFAULT_SECTIONS } from "../views/area-view.js";
import { DEFAULT_SUMMARY_KEYS, HOME_KEYS, resolveShortcutItems } from "../home-settings.js";
import { INDICATOR_PRESETS } from "../area-indicators.js";

/** Keys of the strategy config managed by the form. */
const MANAGED = ["load_home_settings", "strip_area_names", "lazy_render", "debug", "card_rules", "area_overrides", "summary_pages", "area_indicators", ...HOME_KEYS];

/** Selection criteria editable as fields (all accept one or more values). */
export const MATCH_FIELDS = [
  "label", "integration", "domain", "device_class", "entity_category",
  "manufacturer", "model", "device", "device_name", "entity", "area", "floor",
];
/** Every criterion can also be excluded. */
const ENTITY_FILTER_FIELDS = ["include_domains", "exclude_domains", "include_categories", "exclude_device_classes", "exclude"];
const CARD_FIELDS = ["name", "icon", "color"];

/** @param {any} v */
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** @param {any} v */
const isEmpty = (v) =>
  v === undefined || v === null || v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (isPlainObject(v) && Object.keys(v).length === 0);

/** @param {Record<string, any>} obj */
const dropEmpty = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => !isEmpty(v)));

/** @param {any} v */
const isStringOrList = (v) => typeof v === "string" || (Array.isArray(v) && v.every((x) => typeof x === "string"));

/** @param {any} v @returns {string[]} */
const toList = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? [...v] : [v]);

/** @param {string[] | undefined} list */
const fromList = (list) => {
  const clean = (list || []).filter((x) => x !== "" && x != null);
  return clean.length === 0 ? undefined : clean.length === 1 ? clean[0] : clean;
};

/** @param {Record<string, any>} obj @param {string} prefix */
const withoutPrefix = (obj, prefix) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith(prefix)));

// ------------------------------------------------------------------ selection

/** @param {any} match */
export function matchRepresentable(match) {
  if (match === undefined || match === null) return true;
  if (!isPlainObject(match)) return false;
  return Object.entries(match).every(([key, value]) => {
    if (key === "not") {
      return isPlainObject(value) && Object.entries(value).every(([k, v]) => MATCH_FIELDS.includes(k) && isStringOrList(v));
    }
    return MATCH_FIELDS.includes(key) && isStringOrList(value);
  });
}

/**
 * @param {any} match
 * @returns {Record<string, any>} m_* fields
 */
export function matchToFields(match) {
  if (!matchRepresentable(match)) return { m_yaml: match };
  /** @type {Record<string, any>} */
  const fields = {};
  for (const key of MATCH_FIELDS) {
    if (match?.[key] === undefined) continue;
    fields[`m_${key}`] = toList(match[key]);
  }
  for (const key of MATCH_FIELDS) {
    if (match?.not?.[key] !== undefined) fields[`m_not_${key}`] = toList(match.not[key]);
  }
  return fields;
}

/**
 * @param {Record<string, any>} fields
 * @returns {any} match spec or undefined
 */
export function fieldsToMatch(fields) {
  if (!isEmpty(fields.m_yaml)) return fields.m_yaml;
  /** @type {Record<string, any>} */
  const match = {};
  for (const key of MATCH_FIELDS) {
    const value = fromList(fields[`m_${key}`]);
    if (value !== undefined) match[key] = value;
  }
  /** @type {Record<string, any>} */
  const not = {};
  for (const key of MATCH_FIELDS) {
    const value = fromList(fields[`m_not_${key}`]);
    if (value !== undefined) not[key] = value;
  }
  if (Object.keys(not).length) match.not = not;
  return Object.keys(match).length ? match : undefined;
}

// ------------------------------------------------------- entity filter, primary

/** @param {any} entities */
function entitiesToFields(entities) {
  if (entities === undefined || entities === null) return {};
  const ok = isPlainObject(entities) && Object.entries(entities).every(([k, v]) => ENTITY_FILTER_FIELDS.includes(k) && isStringOrList(v));
  if (!ok) return { e_yaml: entities };
  return Object.fromEntries(Object.entries(entities).map(([k, v]) => [`e_${k}`, toList(v)]));
}

/** @param {Record<string, any>} fields */
function fieldsToEntities(fields) {
  if (!isEmpty(fields.e_yaml)) return fields.e_yaml;
  /** @type {Record<string, any>} */
  const out = {};
  for (const key of ENTITY_FILTER_FIELDS) {
    const list = (fields[`e_${key}`] || []).filter(Boolean);
    if (list.length) out[key] = list;
  }
  return Object.keys(out).length ? out : undefined;
}

/** @param {any} primary */
function primaryToFields(primary) {
  if (primary === undefined || primary === null) return {};
  const ok = isPlainObject(primary) && Object.entries(primary).every(([k, v]) => ["domain", "device_class"].includes(k) && isStringOrList(v));
  if (!ok) return { p_yaml: primary };
  return dropEmpty({ p_domain: toList(primary.domain), p_device_class: toList(primary.device_class) });
}

/** @param {Record<string, any>} fields */
function fieldsToPrimary(fields) {
  if (!isEmpty(fields.p_yaml)) return fields.p_yaml;
  const out = dropEmpty({ domain: fromList(fields.p_domain), device_class: fromList(fields.p_device_class) });
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- sections

/**
 * "Hide while in state" rules of a section as the editor shows them: one row per rule.
 * The short form (a list of states) becomes one rule for every domain.
 * @param {any} hide
 * @returns {{ domain: string[], device_class: string[], states: string[] }[]}
 */
function hideRulesToForm(hide) {
  const list = /** @type {any[]} */ (toList(hide));
  /** @param {any} v */
  const text = (v) => (v === true ? "on" : v === false ? "off" : String(v));
  // Plain states (also mixed with rules) are one rule for every entity, as in the area view
  const plain = list.filter((r) => !isPlainObject(r) && r !== null && r !== undefined).map(text).filter(Boolean);
  return [
    ...(plain.length ? [{ domain: [], device_class: [], states: plain }] : []),
    ...list.filter(isPlainObject).map((r) => ({
      domain: toList(r.domain).map(String),
      device_class: toList(r.device_class).map(String),
      states: toList(r.states ?? r.state).map(text).filter(Boolean),
    })),
  ];
}

/**
 * "Order" groups of a section as editor rows. Groups the form cannot show (not an object)
 * are dropped – the area view ignores them as well.
 * @param {any} sort
 * @returns {{ domain: string[], device_class: string[] }[]}
 */
function sortToForm(sort) {
  return /** @type {any[]} */ (toList(sort)).map((g) => (typeof g === "string" ? { domain: g } : g)).filter(isPlainObject).map((g) => ({
    domain: toList(g.domain).map(String),
    device_class: toList(g.device_class).map(String),
  }));
}

/** @param {any} groups @returns {Record<string, any>[] | undefined} */
function sortFromForm(groups) {
  const out = (Array.isArray(groups) ? groups : [])
    .map((g) => dropEmpty({ domain: fromList(toList(g?.domain).filter(Boolean)), device_class: fromList(toList(g?.device_class).filter(Boolean)) }))
    .filter((g) => g.domain || g.device_class);
  return out.length ? out : undefined;
}

/** @param {any} rules @returns {Record<string, any>[] | string[] | undefined} */
function hideRulesFromForm(rules) {
  const out = (Array.isArray(rules) ? rules : [])
    .map((r) => dropEmpty({ domain: fromList(toList(r?.domain).filter(Boolean)), device_class: fromList(toList(r?.device_class).filter(Boolean)), states: toList(r?.states).filter(Boolean) }))
    .filter((r) => r.states?.length);
  if (!out.length) return undefined;
  // One rule for every entity: the short form, a plain list of states
  if (out.length === 1 && !out[0].domain && !out[0].device_class) return out[0].states;
  return out;
}

/** @param {any} section */
function sectionToForm(section) {
  const { match, entities, primary, sort, ...rest } = isPlainObject(section) ? section : {};
  // "Hide while in state" and "Order" have their own rows in the editor, the rest of the entity filter its fields
  const { hide_states, ...filter } = isPlainObject(entities) ? entities : { hide_states: undefined };
  const others = isPlainObject(entities) ? (Object.keys(filter).length ? filter : undefined) : entities;
  return {
    ...rest, ...matchToFields(match), ...entitiesToFields(others), ...primaryToFields(primary),
    ...(hide_states !== undefined ? { hide_rules: hideRulesToForm(hide_states) } : {}),
    ...(sort !== undefined ? { sort_groups: sortToForm(sort) } : {}),
  };
}

/**
 * The list of sections as the editor shows it: with "Show the default sections" the
 * standard categories are entries of the list – those the configuration does not place
 * come first, where the area view shows them. Without it there are none.
 * @param {any} sections
 * @param {boolean} withDefaults
 */
function sectionsToForm(sections, withDefaults) {
  // Standard categories: only with the option, only known ones, each once (the first entry counts)
  const seen = new Set();
  const list = (Array.isArray(sections) ? sections : []).filter((s) => {
    if (!isPlainObject(s) || !s.default) return true;
    if (!withDefaults || !DEFAULT_SECTIONS.includes(s.default) || seen.has(s.default)) return false;
    seen.add(s.default);
    return true;
  });
  const placed = new Set(list.filter((s) => isPlainObject(s) && s.default).map((s) => s.default));
  const missing = withDefaults ? DEFAULT_SECTIONS.filter((key) => !placed.has(key)).map((key) => ({ default: key })) : [];
  return [...missing, ...list].map(sectionToForm);
}

/**
 * Leading standard categories that the area view would put there anyway need no entries:
 * categories the list does not name come first, in default order. An entry is dropped
 * only while that keeps the order the same (and it is not hidden). Keeps the
 * configuration short.
 * @param {Record<string, any>[]} list
 */
function withoutDefaultOrder(list) {
  const named = new Set(list.filter((s) => s.default).map((s) => s.default));
  const unnamed = DEFAULT_SECTIONS.filter((key) => !named.has(key));
  let start = 0;
  for (const entry of list) {
    const pos = DEFAULT_SECTIONS.indexOf(entry.default);
    if (!entry.default || entry.hidden === true || pos < 0) break;
    // all categories already placed by the view must come before this one
    if (unnamed.some((key) => DEFAULT_SECTIONS.indexOf(key) > pos)) break;
    unnamed.push(entry.default);
    start++;
  }
  return list.slice(start);
}

/**
 * @param {any} entities entity filter from the form fields (or YAML)
 * @param {Record<string, any>[] | string[] | undefined} rules
 */
function withHideRules(entities, rules) {
  if (!rules) return entities;
  return isPlainObject(entities) || entities === undefined ? { ...(entities || {}), hide_states: rules } : entities;
}

/** @param {Record<string, any>} form */
function formToSection(form) {
  const { hidden, hide_rules, sort_groups, ...fields } = form || {};
  const rest = withoutPrefix(withoutPrefix(withoutPrefix(fields, "m_"), "e_"), "p_");
  // A standard category placed in the list: only its key and whether it is hidden
  if (rest.default) return { default: rest.default, ...(hidden === true ? { hidden: true } : {}) };
  return dropEmpty({
    ...rest,
    match: fieldsToMatch(form || {}),
    entities: withHideRules(fieldsToEntities(fields), hideRulesFromForm(hide_rules)),
    primary: fieldsToPrimary(form || {}),
    sort: sortFromForm(sort_groups),
    ...(hidden === true ? { hidden: true } : {}),
  });
}

// -------------------------------------------------------------- card rules

/** @param {any} rule */
function ruleToForm(rule) {
  const { match, card, scope, contexts, stop, tap, ...rest } = isPlainObject(rule) ? rule : {};
  /** @type {Record<string, any>} */
  const form = { ...rest, ...matchToFields(match) };
  const popup = isPlainObject(tap) && Object.keys(tap).length === 1 && isPlainObject(tap.popup) && typeof tap.popup.type === "string"
    ? tap.popup
    : undefined;
  if (popup) {
    const { type, ...options } = popup;
    form.r_tap = "popup";
    form.r_popup_type = type;
    if (Object.keys(options).length) form.r_popup_options = options;
  } else {
    form.r_tap = "default";
    if (tap !== undefined) form.tap = tap; // a form cannot show it: kept as it is
  }
  if (card === undefined && tap !== undefined) {
    form.r_action = "adjust";
  } else if (card === false) {
    form.r_action = "hide";
  } else {
    const { type, ...cardRest } = isPlainObject(card) ? card : {};
    form.r_action = type ? "replace" : "adjust";
    if (type) form.r_type = type;
    for (const key of CARD_FIELDS) if (cardRest[key] !== undefined) form[`r_${key}`] = cardRest[key];
    const options = Object.fromEntries(Object.entries(cardRest).filter(([k]) => !CARD_FIELDS.includes(k)));
    if (Object.keys(options).length) form.r_options = options;
  }
  form.r_scope = scope === "device" ? "device" : "entity";
  if (contexts !== undefined) form.r_contexts = toList(contexts);
  if (stop === true) form.r_stop = true;
  return form;
}

/** @param {Record<string, any>} form */
function formToRule(form) {
  const rest = withoutPrefix(withoutPrefix(form || {}, "m_"), "r_");
  /** @type {Record<string, any>} */
  const rule = { ...rest };
  const match = fieldsToMatch(form);
  if (match !== undefined) rule.match = match;
  if (form.r_contexts?.length) rule.contexts = [...form.r_contexts];
  if (form.r_scope === "device") rule.scope = "device";
  // A device card replaces all entity cards of the device, so it needs a card type
  const action = form.r_scope === "device" && form.r_action === "adjust" ? "replace" : form.r_action;
  if (action === "hide") {
    rule.card = false;
  } else {
    const card = dropEmpty({
      ...(action === "replace" && form.r_type ? { type: form.r_type } : {}),
      ...(isPlainObject(form.r_options) ? form.r_options : {}),
      ...Object.fromEntries(CARD_FIELDS.map((k) => [k, form[`r_${k}`]])),
    });
    if (form.r_tap === "popup" && form.r_popup_type) {
      rule.tap = { popup: { type: form.r_popup_type, ...(isPlainObject(form.r_popup_options) ? form.r_popup_options : {}) } };
    }
    // A rule that only sets the popup leaves the card as it is
    if (Object.keys(card).length || rule.tap === undefined) rule.card = card;
  }
  if (form.r_stop === true) rule.stop = true;
  return rule;
}

// ------------------------------------------------------- overview page settings

/**
 * Overview page settings (the keys of HOME_KEYS) as form data.
 * @param {Record<string, any>} settings
 */
export function homeToForm(settings) {
  /** @type {Record<string, Record<string, any>>} other fields of an alert entity (e.g. severity) */
  const alertExtra = {};
  /** @type {string[]} */
  const alerts = [];
  for (const item of Array.isArray(settings.alert_entities) ? settings.alert_entities : []) {
    if (typeof item === "string") alerts.push(item);
    else if (isPlainObject(item) && typeof item.entity === "string") {
      const { entity, ...extra } = item;
      alerts.push(entity);
      if (Object.keys(extra).length) alertExtra[entity] = extra;
    }
  }
  return {
    welcome: settings.hide_welcome_message !== true,
    suggested: settings.hide_suggested_entities !== true,
    favorites: toList(settings.favorite_entities),
    alerts,
    alert_extra: alertExtra,
    items: resolveShortcutItems(settings.shortcuts).map((item) => ({ ...item })),
  };
}

/** Summary list without changes: all built-in summaries, default order, none hidden. */
const DEFAULT_ITEMS = JSON.stringify(DEFAULT_SUMMARY_KEYS.map((key) => ({ type: "summary", key })));

/**
 * Form data back to the overview page settings; settings at their default are left out.
 * @param {Record<string, any> | undefined} home
 */
export function homeFromForm(home) {
  /** @type {Record<string, any>} */
  const out = {};
  if (!home) return out;
  if (home.favorites?.length) out.favorite_entities = [...home.favorites];
  if (home.welcome === false) out.hide_welcome_message = true;
  if (home.suggested === false) out.hide_suggested_entities = true;
  const items = (Array.isArray(home.items) ? home.items : [])
    .filter((/** @type {any} */ item) => item?.type === "summary" || item?.path)
    .map((/** @type {any} */ item) =>
      item.type === "summary"
        ? { type: "summary", key: item.key, ...(item.hidden ? { hidden: true } : {}) }
        : dropEmpty({ ...item, label: item.label || undefined, icon: item.icon || undefined, color: item.color || undefined })
    );
  if (JSON.stringify(items) !== DEFAULT_ITEMS) out.shortcuts = items;
  const alerts = (home.alerts || []).map((/** @type {string} */ entity) => ({ entity, ...(home.alert_extra?.[entity] || {}) }));
  if (alerts.length) out.alert_entities = alerts;
  return out;
}

// ------------------------------------------------------------ area indicators

const INDICATOR_FIELDS = ["style", "icon", "color"];

/**
 * Area indicators as form items: the configured ones in their order (enabled), then
 * the other presets (disabled). Entries the form cannot edit are kept as they are.
 * @param {any} indicators `area_indicators` of the config
 * @returns {Record<string, any>[]}
 */
export function indicatorsToForm(indicators) {
  /** @type {Record<string, any>[]} */
  const items = [];
  const seen = new Set();
  for (const entry of Array.isArray(indicators) ? indicators : []) {
    if (isPlainObject(entry) && entry.preset && INDICATOR_PRESETS[entry.preset] && !seen.has(entry.preset)) {
      seen.add(entry.preset);
      const { preset, style, icon, color, ...rest } = entry;
      items.push({ preset, enabled: true, style, icon, color, ...(Object.keys(rest).length ? { extra: rest } : {}) });
    } else {
      // Own states, a preset used a second time, unknown presets (e.g. from a newer
      // version) and anything else: kept unchanged
      items.push({ custom: entry });
    }
  }
  for (const preset of Object.keys(INDICATOR_PRESETS)) if (!seen.has(preset)) items.push({ preset, enabled: false });
  return items;
}

/**
 * @param {Record<string, any>[] | undefined} items
 * @returns {any[] | undefined}
 */
export function indicatorsFromForm(items) {
  const out = (Array.isArray(items) ? items : []).flatMap((item) => {
    if (item.custom !== undefined) return [item.custom];
    if (!item.enabled) return [];
    const preset = INDICATOR_PRESETS[item.preset];
    /** @type {Record<string, any>} */
    const entry = { preset: item.preset, ...(isPlainObject(item.extra) ? item.extra : {}) };
    for (const key of INDICATOR_FIELDS) {
      const value = item[key];
      if (value !== undefined && value !== "" && value !== /** @type {any} */ (preset)?.[key]) entry[key] = value;
    }
    return [entry];
  });
  return out.length ? out : undefined;
}

// ------------------------------------------------------------------ public

/**
 * @param {Record<string, any>} config strategy config
 * @returns {Record<string, any>} form data
 */
export function toForm(config) {
  const overrides = isPlainObject(config.area_overrides) ? config.area_overrides : {};
  return {
    load_home_settings: config.load_home_settings !== false,
    home: homeToForm(config),
    indicators: indicatorsToForm(config.area_indicators),
    summary_pages: isPlainObject(config.summary_pages) ? { ...config.summary_pages } : {},
    strip_area_names: config.strip_area_names !== false,
    lazy_render: config.lazy_render !== false,
    debug: config.debug === true,
    rules: (Array.isArray(config.card_rules) ? config.card_rules : []).map(ruleToForm),
    areas: Object.entries(overrides).map(([area, o]) => {
      const { sections, badges, show_default_sections, show_other_devices, show_automations, tile, ...rest } = isPlainObject(o) ? o : {};
      const { sensor_classes, alert_classes, color, name, entities, show_names, alert_entities, ...tileExtra } =
        isPlainObject(tile) ? tile : {};
      const entityList = toList(entities);
      return {
        ...rest,
        area,
        t_sensors: entityList.length ? "entities" : sensor_classes === undefined ? "default" : "custom",
        t_sensor_classes: toList(sensor_classes),
        t_entities: entityList,
        t_show_names: show_names === true,
        t_alert_classes: toList(alert_classes),
        t_alert_entities: toList(alert_entities),
        t_color: color,
        t_name: name,
        tile_extra: tileExtra,
        badges: badges === false ? "none" : Array.isArray(badges) ? "custom" : "default",
        badge_entities: Array.isArray(badges) ? [...badges] : [],
        show_default_sections: show_default_sections === true,
        show_other_devices: show_other_devices !== false,
        show_automations: show_automations !== false,
        sections: sectionsToForm(sections, show_default_sections === true),
      };
    }),
  };
}

/**
 * @param {Record<string, any>} form form data
 * @param {Record<string, any>} original strategy config the form was created from
 * @returns {Record<string, any>} new strategy config
 */
export function fromForm(form, original) {
  /** @type {Record<string, any>} */
  const config = Object.fromEntries(Object.entries(original).filter(([k]) => !MANAGED.includes(k)));

  if (form.load_home_settings === false) config.load_home_settings = false;
  const pages = Object.fromEntries(
    Object.entries(isPlainObject(form.summary_pages) ? form.summary_pages : {}).filter(([, v]) => typeof v === "string" ? v.trim() : v != null)
  );
  if (Object.keys(pages).length) config.summary_pages = pages;
  const indicators = indicatorsFromForm(form.indicators);
  if (indicators) config.area_indicators = indicators;
  // Own settings are kept while the built-in ones are used, so switching back restores them
  Object.assign(config, homeFromForm(form.home));
  if (form.strip_area_names === false) config.strip_area_names = false;
  if (form.lazy_render === false) config.lazy_render = false;
  if (form.debug === true) config.debug = true;
  const rules = (Array.isArray(form.rules) ? form.rules : []).map(formToRule);
  if (rules.length) config.card_rules = rules;

  /** @type {Record<string, any>} */
  const overrides = {};
  for (const entry of Array.isArray(form.areas) ? form.areas : []) {
    if (!entry?.area) continue;
    const {
      area, badges, badge_entities, show_default_sections, show_other_devices, show_automations, sections,
      t_sensors, t_sensor_classes, t_entities, t_show_names, t_alert_classes, t_alert_entities, t_color, t_name, tile_extra, ...rest
    } = entry;
    /** @type {Record<string, any>} */
    const o = { ...rest };
    /** @type {Record<string, any>} */
    const tile = { ...(isPlainObject(tile_extra) ? tile_extra : {}) };
    if (t_sensors === "custom") tile.sensor_classes = [...(t_sensor_classes || [])];
    if (t_sensors === "entities" && t_entities?.length) {
      tile.entities = [...t_entities];
      if (t_show_names === true) tile.show_names = true;
    }
    if (t_alert_classes?.length) tile.alert_classes = [...t_alert_classes];
    if (t_alert_entities?.length) tile.alert_entities = [...t_alert_entities];
    if (t_color) tile.color = t_color;
    if (t_name) tile.name = t_name;
    if (Object.keys(tile).length) o.tile = tile;
    if (badges === "none") o.badges = false;
    else if (badges === "custom") o.badges = [...(badge_entities || [])];
    if (show_default_sections === true) o.show_default_sections = true;
    if (show_other_devices === false) o.show_other_devices = false;
    if (show_automations === false) o.show_automations = false;
    const list = withoutDefaultOrder((Array.isArray(sections) ? sections : []).map(formToSection));
    if (list.length) o.sections = list;
    // An area without sections and with default options needs no override
    if (Object.keys(o).length) overrides[area] = o;
  }
  if (Object.keys(overrides).length) config.area_overrides = overrides;

  return config;
}
