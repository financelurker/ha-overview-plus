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
 * Labels of an entity, optionally including the labels of its device.
 * @param {EntityContext} ctx
 * @param {boolean} [withDevice]
 * @returns {string[]}
 */
export const labelsOf = (ctx, withDevice = true) => {
  const labels = [...(ctx.entity?.labels || [])];
  if (withDevice && ctx.device?.labels) labels.push(...ctx.device.labels);
  return labels;
};

/**
 * All entity ids (with a state) whose effective area is `areaId`, excluding hidden entities.
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
