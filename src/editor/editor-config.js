// @ts-check
/**
 * Conversion between the strategy config (YAML shape) and the data edited by the
 * visual editor (ha-form shape). The conversion is lossless: options the form does
 * not know are carried over unchanged. Everything the form can represent is shown
 * as form fields; only constructs it cannot represent (e.g. OR lists of selections)
 * are kept in a YAML fallback field (`m_yaml`, `e_yaml`, `p_yaml`).
 *
 * Form shape:
 *   load_home_settings: boolean
 *   debug: boolean
 *   rules: [{ r_action, r_type, r_name, r_icon, r_color, r_options, r_scope, r_contexts, r_stop, m_* }]
 *   areas: [{
 *     area, badges: "default" | "none" | "custom", badge_entities, show_other_devices, show_automations,
 *     sections: [{ title, icon, layout, m_*, e_*, p_* }]
 *   }]
 *
 * Selection fields (m_*): m_label, m_integration, m_domain, m_device_class, m_entity_category,
 * m_manufacturer, m_model, m_device, m_device_name, m_entity, m_area, m_floor and the exclusions
 * m_not_label, m_not_integration, m_not_domain, m_not_device_class, m_not_entity_category, m_not_entity.
 */

/** Keys of the strategy config managed by the form. */
const MANAGED = ["load_home_settings", "debug", "card_rules", "area_overrides"];

/** Selection criteria editable as fields; device_name is a single pattern. */
export const MATCH_FIELDS = [
  "label", "integration", "domain", "device_class", "entity_category",
  "manufacturer", "model", "device", "device_name", "entity", "area", "floor",
];
export const NOT_FIELDS = ["label", "integration", "domain", "device_class", "entity_category", "entity"];
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
      return isPlainObject(value) && Object.entries(value).every(([k, v]) => NOT_FIELDS.includes(k) && isStringOrList(v));
    }
    if (key === "device_name") return typeof value === "string";
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
    fields[`m_${key}`] = key === "device_name" ? match[key] : toList(match[key]);
  }
  for (const key of NOT_FIELDS) {
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
    const value = key === "device_name" ? fields[`m_${key}`] || undefined : fromList(fields[`m_${key}`]);
    if (value !== undefined) match[key] = value;
  }
  /** @type {Record<string, any>} */
  const not = {};
  for (const key of NOT_FIELDS) {
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
  const ok = isPlainObject(primary) && Object.entries(primary).every(([k, v]) => ["domain", "device_class"].includes(k) && typeof v === "string");
  if (!ok) return { p_yaml: primary };
  return { p_domain: primary.domain, p_device_class: primary.device_class };
}

/** @param {Record<string, any>} fields */
function fieldsToPrimary(fields) {
  if (!isEmpty(fields.p_yaml)) return fields.p_yaml;
  const out = dropEmpty({ domain: fields.p_domain, device_class: fields.p_device_class });
  return Object.keys(out).length ? out : undefined;
}

// ---------------------------------------------------------------- sections

/** @param {any} section */
function sectionToForm(section) {
  const { match, entities, primary, ...rest } = isPlainObject(section) ? section : {};
  return { ...rest, ...matchToFields(match), ...entitiesToFields(entities), ...primaryToFields(primary) };
}

/** @param {Record<string, any>} form */
function formToSection(form) {
  const rest = withoutPrefix(withoutPrefix(withoutPrefix(form || {}, "m_"), "e_"), "p_");
  return dropEmpty({
    ...rest,
    match: fieldsToMatch(form || {}),
    entities: fieldsToEntities(form || {}),
    primary: fieldsToPrimary(form || {}),
  });
}

// -------------------------------------------------------------- card rules

/** @param {any} rule */
function ruleToForm(rule) {
  const { match, card, scope, contexts, stop, ...rest } = isPlainObject(rule) ? rule : {};
  /** @type {Record<string, any>} */
  const form = { ...rest, ...matchToFields(match) };
  if (card === false) {
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
  if (form.r_action === "hide") {
    rule.card = false;
  } else {
    rule.card = dropEmpty({
      ...(form.r_action === "replace" && form.r_type ? { type: form.r_type } : {}),
      ...(isPlainObject(form.r_options) ? form.r_options : {}),
      ...Object.fromEntries(CARD_FIELDS.map((k) => [k, form[`r_${k}`]])),
    });
  }
  if (form.r_stop === true) rule.stop = true;
  return rule;
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
    debug: config.debug === true,
    rules: (Array.isArray(config.card_rules) ? config.card_rules : []).map(ruleToForm),
    areas: Object.entries(overrides).map(([area, o]) => {
      const { sections, badges, show_other_devices, show_automations, ...rest } = isPlainObject(o) ? o : {};
      return {
        ...rest,
        area,
        badges: badges === false ? "none" : Array.isArray(badges) ? "custom" : "default",
        badge_entities: Array.isArray(badges) ? [...badges] : [],
        show_other_devices: show_other_devices !== false,
        show_automations: show_automations !== false,
        sections: (Array.isArray(sections) ? sections : []).map(sectionToForm),
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
  if (form.debug === true) config.debug = true;
  const rules = (Array.isArray(form.rules) ? form.rules : []).map(formToRule);
  if (rules.length) config.card_rules = rules;

  /** @type {Record<string, any>} */
  const overrides = {};
  for (const entry of Array.isArray(form.areas) ? form.areas : []) {
    if (!entry?.area) continue;
    const { area, badges, badge_entities, show_other_devices, show_automations, sections, ...rest } = entry;
    /** @type {Record<string, any>} */
    const o = { ...rest };
    if (badges === "none") o.badges = false;
    else if (badges === "custom") o.badges = [...(badge_entities || [])];
    if (show_other_devices === false) o.show_other_devices = false;
    if (show_automations === false) o.show_automations = false;
    const list = (Array.isArray(sections) ? sections : []).map(formToSection);
    if (list.length) o.sections = list;
    // An area without sections and with default options needs no override
    if (Object.keys(o).length) overrides[area] = o;
  }
  if (Object.keys(overrides).length) config.area_overrides = overrides;

  return config;
}
