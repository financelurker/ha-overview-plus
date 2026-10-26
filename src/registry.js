// @ts-check
/**
 * Helpers around the registry data that the frontend exposes on `hass`.
 *
 * Behaviour mirrors home-assistant/frontend:
 *   src/common/entity/context/get_entity_context.ts
 *   src/common/entity/context/get_device_context.ts
 *   src/common/entity/compute_device_name.ts
 */

/**
 * @typedef {Object} EntityContext
 * @property {string} entity_id
 * @property {string} domain
 * @property {any} state            state object from hass.states (may be undefined)
 * @property {any} entity           entity registry display entry (may be null)
 * @property {any} device           device registry entry (may be null)
 * @property {any} area             area registry entry (may be null)
 * @property {any} floor            floor registry entry (may be null)
 */

/** @param {string} entityId */
export const domainOf = (entityId) => entityId.slice(0, entityId.indexOf("."));

/**
 * Effective area of a device: a child device without an area inherits the parent's area.
 * @param {any} device
 * @param {Record<string, any>} devices
 * @returns {string | undefined}
 */
export const deviceAreaId = (device, devices) => {
  if (device.area_id) return device.area_id;
  if (device.parent_device_id) return devices[device.parent_device_id]?.area_id ?? undefined;
  return undefined;
};

/**
 * @param {any} hass
 * @param {string} entityId
 * @returns {EntityContext}
 */
export const entityContext = (hass, entityId) => {
  const state = hass.states?.[entityId];
  const entity = hass.entities?.[entityId] ?? null;
  const device = entity?.device_id ? hass.devices?.[entity.device_id] ?? null : null;
  const areaId = entity?.area_id || (device ? deviceAreaId(device, hass.devices || {}) : undefined);
  const area = areaId ? hass.areas?.[areaId] ?? null : null;
  const floor = area?.floor_id ? hass.floors?.[area.floor_id] ?? null : null;
  return { entity_id: entityId, domain: domainOf(entityId), state, entity, device, area, floor };
};

/** @param {any} device */
export const deviceName = (device) => (device?.name_by_user || device?.name || "").trim();

/** @param {EntityContext} ctx */
export const entityCategory = (ctx) => ctx.entity?.entity_category || "none";

/** @param {EntityContext} ctx */
export const deviceClass = (ctx) => ctx.state?.attributes?.device_class || "none";

/**
 * Contexts of the entities (with a state) whose effective area is `areaId`, excluding hidden entities.
 * @param {any} hass
 * @param {string} areaId
 * @returns {EntityContext[]}
 */
export const areaEntities = (hass, areaId) =>
  Object.keys(hass.states || {})
    .map((id) => entityContext(hass, id))
    .filter((ctx) => ctx.area?.area_id === areaId && !ctx.entity?.hidden);

/**
 * Supported-feature check, see home-assistant/frontend src/common/entity/supports-feature.ts
 * @param {any} state
 * @param {number} feature
 */
export const supportsFeature = (state, feature) =>
  ((state?.attributes?.supported_features ?? 0) & feature) !== 0;

const SEPARATORS = "[\\s\\-–—:·|/_,.]+";

/** @param {string} s */
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Remove an area name (or one of its aliases) from the start or end of a name,
 * together with the separator next to it. Case-insensitive. Returns the name
 * unchanged if nothing would be left.
 * Example: "Wohnzimmer Deckenlicht" in area "Wohnzimmer" → "Deckenlicht".
 * @param {string} name
 * @param {any} area area registry entry
 * @returns {string}
 */
export function stripAreaName(name, area) {
  if (!name || !area) return name;
  const names = [area.name, ...(area.aliases || [])].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const areaName of names) {
    const a = escapeRegex(String(areaName).trim());
    if (!a) continue;
    const stripped = name
      .replace(new RegExp(`^${a}(?:${SEPARATORS}|$)`, "i"), "")
      .replace(new RegExp(`(?:^|${SEPARATORS})${a}$`, "i"), "")
      .trim();
    if (stripped && stripped !== name.trim()) {
      // "Living room lamp" → "Lamp", but keep identifiers like hostnames as they are ("pve1")
      const firstWord = stripped.split(/\s/)[0];
      return /^[\p{L}]+$/u.test(firstWord) ? stripped.charAt(0).toUpperCase() + stripped.slice(1) : stripped;
    }
  }
  return name;
}

/**
 * The name a card shows for an entity, computed like the tile card does
 * (hass.formatEntityName with the card's name config).
 * @param {any} hass
 * @param {EntityContext} ctx
 * @param {any} [nameConfig] the card's `name` option
 * @returns {string}
 */
export function displayName(hass, ctx, nameConfig) {
  if (typeof nameConfig === "string") return nameConfig;
  if (ctx.state && typeof hass.formatEntityName === "function") {
    try {
      const name = hass.formatEntityName(ctx.state, nameConfig);
      if (name) return name;
    } catch {
      // fall through to the fallbacks below
    }
  }
  const isEntityOnly = nameConfig && !Array.isArray(nameConfig) && nameConfig.type === "entity";
  if (isEntityOnly && ctx.entity?.name) return ctx.entity.name;
  return ctx.state?.attributes?.friendly_name || ctx.entity_id;
}
