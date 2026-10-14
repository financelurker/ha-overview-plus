// @ts-check
/**
 * User-facing match specifications, shared by `card_rules` and `area_overrides`.
 *
 * A match spec is an object (all criteria must match = AND) or a list of objects
 * (any object must match = OR). Every criterion accepts a single value or a list
 * (any value matches). String criteria marked "regex" are case-insensitive regular
 * expressions.
 *
 *   entity           entity id                                   climate.bath
 *   domain           entity domain                               climate
 *   device_class     device class ("none" if unset)              temperature
 *   integration      integration (entity platform)               better_thermostat
 *   entity_category  "none" | "config" | "diagnostic"            diagnostic
 *   label            label id on the entity OR its device        virt-guest
 *   entity_label     label id on the entity only
 *   device_label     label id on the device only
 *   device           device id
 *   device_name      device name (regex)                         ^pve
 *   manufacturer     device manufacturer (regex)                 Proxmox
 *   model            device model (regex)
 *   area             area id                                     proxmox
 *   floor            floor id                                    virtual
 *   not              nested match spec that must NOT match
 */

import { deviceClass, deviceName, entityCategory } from "./registry.js";

/** @typedef {import("./registry.js").EntityContext} EntityContext */
/** @typedef {Record<string, any> | Record<string, any>[]} MatchSpec */

export const MATCH_KEYS = [
  "entity", "domain", "device_class", "integration", "entity_category",
  "label", "entity_label", "device_label", "device",
  "device_name", "manufacturer", "model", "area", "floor", "not",
];

/** @param {any} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : [v]);

/** @param {any} expected @param {any} actual */
const isOneOf = (expected, actual) => list(expected).some((e) => e === actual);

/** @param {any} expected @param {string[]} actual */
const intersects = (expected, actual) => list(expected).some((e) => actual.includes(e));

/** @type {Map<string, RegExp | null>} */
const regexCache = new Map();

/** @param {string} pattern */
const toRegex = (pattern) => {
  if (!regexCache.has(pattern)) {
    try {
      regexCache.set(pattern, new RegExp(pattern, "i"));
    } catch (err) {
      console.warn(`[overview-plus] Invalid regular expression "${pattern}" in match spec.`, err);
      regexCache.set(pattern, null);
    }
  }
  return regexCache.get(pattern);
};

/** @param {any} expected @param {string | undefined | null} actual */
const regexMatch = (expected, actual) =>
  actual != null && list(expected).some((p) => toRegex(String(p))?.test(actual) ?? false);

/** @type {Record<string, (expected: any, ctx: EntityContext) => boolean>} */
const CRITERIA = {
  entity: (e, ctx) => isOneOf(e, ctx.entity_id),
  domain: (e, ctx) => isOneOf(e, ctx.domain),
  device_class: (e, ctx) => isOneOf(e, deviceClass(ctx)),
  integration: (e, ctx) => isOneOf(e, ctx.entity?.platform),
  entity_category: (e, ctx) => isOneOf(e, entityCategory(ctx)),
  label: (e, ctx) => intersects(e, [...(ctx.entity?.labels || []), ...(ctx.device?.labels || [])]),
  entity_label: (e, ctx) => intersects(e, ctx.entity?.labels || []),
  device_label: (e, ctx) => intersects(e, ctx.device?.labels || []),
  device: (e, ctx) => isOneOf(e, ctx.device?.id),
  device_name: (e, ctx) => !!ctx.device && regexMatch(e, deviceName(ctx.device)),
  manufacturer: (e, ctx) => regexMatch(e, ctx.device?.manufacturer),
  model: (e, ctx) => regexMatch(e, ctx.device?.model),
  area: (e, ctx) => isOneOf(e, ctx.area?.area_id),
  floor: (e, ctx) => isOneOf(e, ctx.floor?.floor_id),
  not: (e, ctx) => !matches(e, ctx),
};

/**
 * @param {MatchSpec | undefined | null} spec
 * @param {EntityContext} ctx
 * @returns {boolean} true if the entity matches; an empty/missing spec matches everything
 */
export function matches(spec, ctx) {
  if (spec == null) return true;
  if (Array.isArray(spec)) return spec.length === 0 || spec.some((s) => matches(s, ctx));
  for (const [key, expected] of Object.entries(spec)) {
    const test = CRITERIA[key];
    if (!test) {
      console.warn(`[overview-plus] Unknown match criterion "${key}" – ignored.`);
      continue;
    }
    if (!test(expected, ctx)) return false;
  }
  return true;
}
