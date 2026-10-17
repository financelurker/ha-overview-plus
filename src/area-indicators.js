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
function areaOf(hass, entityId) {
  const entry = hass.entities?.[entityId];
  if (!entry) return undefined;
  if (entry.area_id) return entry.area_id;
  const device = entry.device_id ? hass.devices?.[entry.device_id] : undefined;
  if (device?.area_id) return device.area_id;
  return device?.parent_device_id ? hass.devices?.[device.parent_device_id]?.area_id : undefined;
}

/**
 * Indicator config with its preset filled in.
 * @param {any} config
 */
export function resolveIndicator(config) {
  const preset = config?.preset ? INDICATOR_PRESETS[config.preset] : undefined;
  if (config?.preset && !preset) return undefined;
  const merged = { ...(preset || {}), ...config };
  if (config?.state !== undefined) merged.states = list(config.state);
  if (!merged.states?.length) merged.states = ["on"];
  merged.style = merged.style === "tile" ? "tile" : "icon";
  merged.icon = merged.icon || "mdi:circle-medium";
  merged.key = config?.preset || config?.name || list(config?.entity)[0] || "custom";
  return merged;
}

/**
 * Entities an indicator watches in an area.
 * @param {any} hass
 * @param {string} areaId
 * @param {any} indicator resolved indicator
 * @returns {string[]}
 */
export function indicatorEntities(hass, areaId, indicator) {
  const explicit = list(indicator.entity);
  if (explicit.length) return explicit;
  if (!indicator.domain) return [];
  return Object.keys(hass.entities || {}).filter((id) => {
    if (!id.startsWith(`${indicator.domain}.`)) return false;
    const entry = hass.entities[id];
    if (entry.hidden || entry.entity_category) return false;
    if (areaOf(hass, id) !== areaId) return false;
    if (indicator.device_classes?.length) return indicator.device_classes.includes(hass.states?.[id]?.attributes?.device_class);
    return true;
  });
}

/**
 * Whether an entity is in the indicator's active state.
 * @param {any} indicator
 * @param {any} stateObj
 */
function isActive(indicator, stateObj) {
  if (!stateObj) return false;
  const value = indicator.attribute ? stateObj.attributes?.[indicator.attribute] : stateObj.state;
  return indicator.states.map(String).includes(String(value));
}

/**
 * Active indicators of an area, in config order.
 * @param {any} hass
 * @param {string} areaId
 * @param {any[]} configs
 * @returns {{ key: string, name?: string, icon: string, color?: string, style: "tile" | "icon", entities: string[] }[]}
 */
export function activeIndicators(hass, areaId, configs) {
  const result = [];
  for (const config of list(configs)) {
    const indicator = resolveIndicator(config);
    if (!indicator) continue;
    const entities = indicatorEntities(hass, areaId, indicator).filter((id) => isActive(indicator, hass.states?.[id]));
    if (entities.length) {
      // Icon by the kind of device, e.g. a TV or a speaker playing (unless an icon is configured)
      const deviceClass = hass.states?.[entities[0]]?.attributes?.device_class;
      const icon = (!config.icon && indicator.icons?.[deviceClass]) || indicator.icon;
      result.push({ key: indicator.key, name: indicator.name, icon, color: indicator.color, style: indicator.style, entities });
    }
  }
  return result;
}

/**
 * All entities whose state matters for the indicators of an area (for re-rendering).
 * @param {any} hass
 * @param {string} areaId
 * @param {any[]} configs
 */
export function watchedIndicatorEntities(hass, areaId, configs) {
  return list(configs).flatMap((config) => {
    const indicator = resolveIndicator(config);
    return indicator ? indicatorEntities(hass, areaId, indicator) : [];
  });
}
