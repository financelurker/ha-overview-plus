// @ts-check
/**
 * Area indicators: states of an area shown on its tile on the overview page,
 * e.g. "occupied", "heating", "humidifying".
 *
 * An indicator is a condition on entities of the area, with an icon and a color.
 * Presets fill in the detection; every field can be overridden, and indicators
 * without preset are free (entity + state or attribute).
 *
 *   area_indicators:                 # order = importance
 *     - preset: occupied             # style: tile (default of this preset)
 *     - preset: heating
 *     - name: Washing machine
 *       entity: sensor.washer_status
 *       state: running
 *       icon: mdi:washing-machine
 *       color: purple
 *
 * Detection without `entity`: all entities of the area that fit the preset (domain,
 * device class); the indicator is active if ANY of them is in the active state.
 * With `entity` (one or a list): only those entities.
 *
 * style: "tile" colors the whole tile (the first active tile indicator wins),
 *        "icon" shows a colored icon on the tile (several at once).
 */

import { deviceAreaId } from "./registry.js";

/**
 * @typedef {Object} IndicatorPreset
 * @property {string} icon
 * @property {string} color          theme color name (red, blue, …) or CSS color
 * @property {"tile" | "icon"} style
 * @property {string} domain
 * @property {string[]} [device_classes]
 * @property {string} [attribute]    compare this attribute instead of the state
 * @property {string[]} states       active values
 * @property {Record<string, string>} [icons]  icon by device class of the active entity
 */

/** @type {Record<string, IndicatorPreset>} */
export const INDICATOR_PRESETS = {
  occupied: { icon: "mdi:account", color: "blue", style: "tile", domain: "binary_sensor", device_classes: ["occupancy", "presence"], states: ["on"] },
  problem: {
    icon: "mdi:alert", color: "red", style: "icon", domain: "binary_sensor",
    device_classes: ["problem", "moisture", "smoke", "gas", "carbon_monoxide", "safety"], states: ["on"],
    icons: { moisture: "mdi:water-alert", smoke: "mdi:smoke-detector-alert", gas: "mdi:gas-cylinder", carbon_monoxide: "mdi:molecule-co" },
  },
  heating: { icon: "mdi:fire", color: "deep-orange", style: "icon", domain: "climate", attribute: "hvac_action", states: ["heating", "preheating"] },
  cooling: { icon: "mdi:snowflake", color: "light-blue", style: "icon", domain: "climate", attribute: "hvac_action", states: ["cooling"] },
  humidifying: { icon: "mdi:water", color: "teal", style: "icon", domain: "humidifier", attribute: "action", states: ["humidifying"] },
  drying: { icon: "mdi:water-off", color: "brown", style: "icon", domain: "humidifier", attribute: "action", states: ["drying"] },
  window_open: {
    icon: "mdi:window-open-variant", color: "amber", style: "icon", domain: "binary_sensor",
    device_classes: ["window", "door", "opening", "garage_door"], states: ["on"],
    icons: { door: "mdi:door-open", garage_door: "mdi:garage-open" },
  },
  unlocked: { icon: "mdi:lock-open-variant", color: "orange", style: "icon", domain: "lock", states: ["unlocked", "open"] },
  lights_on: { icon: "mdi:lightbulb", color: "yellow", style: "icon", domain: "light", states: ["on"] },
  media_playing: {
    icon: "mdi:play", color: "purple", style: "icon", domain: "media_player", states: ["playing"],
    icons: { tv: "mdi:television-play", speaker: "mdi:speaker-play", receiver: "mdi:audio-video" },
  },
  fan_on: { icon: "mdi:fan", color: "cyan", style: "icon", domain: "fan", states: ["on"] },
  cleaning: { icon: "mdi:robot-vacuum", color: "green", style: "icon", domain: "vacuum", states: ["cleaning"] },
};

/** @param {any} v @returns {any[]} */
const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

/**
 * Theme color name → CSS color, as Home Assistant's computeCssColor does.
 * @param {string | undefined} color
 */
export function indicatorColor(color) {
  if (!color) return undefined;
  return /^[a-z-]+$/.test(color) && !["none", "inherit", "transparent"].includes(color) ? `var(--${color}-color)` : color;
}

/**
 * Area of an entity: its own, otherwise its device's (or the parent device's).
 * @param {any} hass
 * @param {string} entityId
 */
export function entityAreaId(hass, entityId) {
  const entry = hass.entities?.[entityId];
  if (!entry) return undefined;
  if (entry.area_id) return entry.area_id;
  const device = entry.device_id ? hass.devices?.[entry.device_id] : undefined;
  return device ? deviceAreaId(device, hass.devices || {}) : undefined;
}

/** YAML 1.1 reads an unquoted on / off as a boolean. @param {any} v */
const stateText = (v) => (v === true ? "on" : v === false ? "off" : String(v));

const warned = new Set();
/** @param {string} preset */
function warnUnknown(preset) {
  if (warned.has(preset)) return;
  warned.add(preset);
  console.warn(`[overview-plus] area_indicators: unknown preset "${preset}" – ignored.`);
}

/**
 * Indicator config with its preset filled in; values normalized.
 * @param {any} config
 */
export function resolveIndicator(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return undefined;
  const preset = config.preset ? INDICATOR_PRESETS[config.preset] : undefined;
  if (config.preset && !preset) {
    warnUnknown(String(config.preset));
    return undefined;
  }
  const merged = { ...(preset || {}), ...config };
  const states = config.state !== undefined ? list(config.state) : list(merged.states);
  merged.states = (states.length ? states : ["on"]).map(stateText);
  merged.device_classes = list(merged.device_classes).map(String);
  merged.entity = list(merged.entity).filter((e) => typeof e === "string");
  merged.style = merged.style === "tile" ? "tile" : "icon";
  merged.icon = merged.icon || "mdi:circle-medium";
  merged.key = config.preset || config.name || merged.entity[0] || "custom";
  return merged;
}

/**
 * The indicators of an area, prepared for evaluation: each resolved indicator with
 * its candidate entities (explicit ones, or the entities of its domain in the area).
 * Depends on the registries only – cache it until hass.entities / devices change.
 * Device classes are checked when evaluating, since states may arrive later.
 * @param {any} hass
 * @param {string} areaId
 * @param {any[]} configs
 * @returns {{ indicator: any, config: any, candidates: string[] }[]}
 */
export function prepareIndicators(hass, areaId, configs) {
  const resolved = list(configs).map((config) => ({ config, indicator: resolveIndicator(config) })).filter((r) => r.indicator);
  if (!resolved.length) return [];
  // One pass over the registry for all domains the area search needs
  const domains = new Set(resolved.filter((r) => !r.indicator.entity.length && r.indicator.domain).map((r) => r.indicator.domain));
  /** @type {Record<string, string[]>} */
  const byDomain = {};
  if (domains.size) {
    for (const [id, entry] of Object.entries(hass.entities || {})) {
      const domain = id.slice(0, id.indexOf("."));
      if (!domains.has(domain) || entry?.hidden || entry?.entity_category) continue;
      if (entityAreaId(hass, id) !== areaId) continue;
      (byDomain[domain] ||= []).push(id);
    }
  }
  return resolved.map(({ config, indicator }) => ({
    config,
    indicator,
    candidates: indicator.entity.length ? indicator.entity : indicator.domain ? byDomain[indicator.domain] || [] : [],
  }));
}

/**
 * Whether an entity is in the indicator's active state.
 * @param {any} indicator
 * @param {any} stateObj
 */
function isActive(indicator, stateObj) {
  if (!stateObj) return false;
  if (!indicator.entity.length && indicator.device_classes.length && !indicator.device_classes.includes(stateObj.attributes?.device_class)) {
    return false;
  }
  const value = indicator.attribute ? stateObj.attributes?.[indicator.attribute] : stateObj.state;
  return value !== undefined && value !== null && indicator.states.includes(stateText(value));
}

/**
 * Active indicators, in config order.
 * @param {any} hass
 * @param {{ indicator: any, config: any, candidates: string[] }[]} prepared from prepareIndicators
 * @returns {{ key: string, name?: string, icon: string, color?: string, style: "tile" | "icon", entities: string[] }[]}
 */
export function evaluateIndicators(hass, prepared) {
  const result = [];
  for (const { indicator, config, candidates } of prepared) {
    const entities = candidates.filter((id) => isActive(indicator, hass.states?.[id]));
    if (!entities.length) continue;
    // Icon by the kind of device, e.g. a TV or a speaker playing (unless an icon is configured)
    const deviceClass = hass.states?.[entities[0]]?.attributes?.device_class;
    const icon = (!config.icon && indicator.icons?.[deviceClass]) || indicator.icon;
    result.push({ key: indicator.key, name: indicator.name, icon, color: indicator.color, style: indicator.style, entities });
  }
  return result;
}

/**
 * Active indicators of an area, in config order.
 * @param {any} hass
 * @param {string} areaId
 * @param {any[]} configs
 */
export function activeIndicators(hass, areaId, configs) {
  return evaluateIndicators(hass, prepareIndicators(hass, areaId, configs));
}

/**
 * What a tile has to watch for re-rendering: candidate entities and the attributes
 * the indicators compare.
 * @param {{ indicator: any, candidates: string[] }[]} prepared
 */
export function watchedIndicators(prepared) {
  return {
    entities: [...new Set(prepared.flatMap((p) => p.candidates))],
    attributes: [...new Set(prepared.map((p) => p.indicator.attribute).filter(Boolean))],
  };
}
