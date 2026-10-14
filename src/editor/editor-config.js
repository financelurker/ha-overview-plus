// @ts-check
/**
 * Conversion between the strategy config (YAML shape) and the data edited by the
 * visual editor (ha-form shape). The conversion is lossless: options the form does
 * not know are carried over unchanged, complex match specs stay as YAML.
 *
 * Form shape:
 *   load_home_settings: boolean
 *   debug: boolean
 *   card_rules: any[]                       (edited as YAML)
 *   areas: [{
 *     area: string
 *     badges: "default" | "none" | "custom"
 *     badge_entities: string[]
 *     show_other_devices: boolean
 *     show_automations: boolean
 *     sections: [{ title, icon, layout, labels: string[], match, entities, primary }]
 *     ...other keys of the area override, unchanged
 *   }]
 */

/** Keys of the strategy config managed by the form. */
const MANAGED = ["load_home_settings", "debug", "card_rules", "area_overrides"];

/** @param {any} v */
const isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** @param {any} v */
const isEmpty = (v) =>
  v === undefined || v === null || v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (isPlainObject(v) && Object.keys(v).length === 0);

/** @param {Record<string, any>} obj */
const dropEmpty = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => !isEmpty(v)));

/**
 * A match spec is shown as label shortcut if it consists of `label` only.
 * @param {any} match
 * @returns {{ labels: string[], match: any }}
 */
function splitMatch(match) {
  if (isPlainObject(match) && Object.keys(match).length === 1 && "label" in match) {
    return { labels: Array.isArray(match.label) ? [...match.label] : [match.label], match: undefined };
  }
  return { labels: [], match };
}

/**
 * @param {string[] | undefined} labels
 * @param {any} advanced
 */
function joinMatch(labels, advanced) {
  const list = (labels || []).filter(Boolean);
  const label = list.length === 1 ? list[0] : list;
  if (isEmpty(advanced)) return list.length ? { label } : undefined;
  // Labels are AND-combined with an advanced object; an advanced list (OR) is kept as is
  if (isPlainObject(advanced) && list.length) return { ...advanced, label };
  return advanced;
}

/**
 * @param {Record<string, any>} config strategy config
 * @returns {Record<string, any>} form data
 */
export function toForm(config) {
  const overrides = isPlainObject(config.area_overrides) ? config.area_overrides : {};
  return {
    load_home_settings: config.load_home_settings !== false,
    debug: config.debug === true,
    card_rules: config.card_rules,
    areas: Object.entries(overrides).map(([area, o]) => {
      const { sections, badges, show_other_devices, show_automations, ...rest } = isPlainObject(o) ? o : {};
      return {
        ...rest,
        area,
        badges: badges === false ? "none" : Array.isArray(badges) ? "custom" : "default",
        badge_entities: Array.isArray(badges) ? [...badges] : [],
        show_other_devices: show_other_devices !== false,
        show_automations: show_automations !== false,
        sections: (Array.isArray(sections) ? sections : []).map((s) => {
          const { match, ...sectionRest } = isPlainObject(s) ? s : {};
          const split = splitMatch(match);
          return { ...sectionRest, labels: split.labels, match: split.match };
        }),
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
  if (!isEmpty(form.card_rules)) config.card_rules = form.card_rules;

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
    const list = (Array.isArray(sections) ? sections : []).map((s) => {
      const { labels, match, ...sectionRest } = s || {};
      return dropEmpty({ ...sectionRest, match: joinMatch(labels, match) });
    });
    if (list.length) o.sections = list;
    // An area without sections and with default options needs no override
    if (Object.keys(o).length) overrides[area] = o;
  }
  if (Object.keys(overrides).length) config.area_overrides = overrides;

  return config;
}
