// @ts-check
/**
 * Re-implementation of the entity filters the built-in Overview uses to build its
 * area sections. Semantics follow home-assistant/frontend:
 *   src/common/entity/entity_filter.ts            (generateEntityFilter, findEntities)
 *   src/panels/light/strategies/light-view-strategy.ts
 *   src/panels/climate/strategies/climate-view-strategy.ts
 *   src/panels/security/strategies/security-view-strategy.ts
 *   src/panels/lovelace/strategies/home/helpers/home-summaries.ts
 */

import { deviceClass, entityCategory } from "./registry.js";

/**
 * @typedef {Object} SimpleFilter
 * @property {string | string[]} [domain]
 * @property {string | string[]} [device_class]
 * @property {string | string[]} [entity_category]
 */

/** @param {any} v */
const asSet = (v) => (v === undefined ? undefined : new Set(Array.isArray(v) ? v : [v]));

/**
 * @param {SimpleFilter} filter
 * @returns {(ctx: import("./registry.js").EntityContext) => boolean}
 */
export const simpleFilter = (filter) => {
  const domains = asSet(filter.domain);
  const classes = asSet(filter.device_class);
  const categories = asSet(filter.entity_category);
  return (ctx) =>
    !!ctx.state &&
    !ctx.entity?.hidden &&
    (!domains || domains.has(ctx.domain)) &&
    (!classes || classes.has(deviceClass(ctx))) &&
    (!categories || categories.has(entityCategory(ctx)));
};

/**
 * Entities matching any of the filters, ordered by filter first (like upstream findEntities).
 * @param {import("./registry.js").EntityContext[]} entities
 * @param {SimpleFilter[]} filters
 */
export const findEntities = (entities, filters) => {
  const seen = new Set();
  const out = [];
  for (const f of filters.map(simpleFilter)) {
    for (const ctx of entities) {
      if (!seen.has(ctx.entity_id) && f(ctx)) {
        seen.add(ctx.entity_id);
        out.push(ctx);
      }
    }
  }
  return out;
};

/** @type {Record<string, SimpleFilter[]>} */
export const SUMMARY_FILTERS = {
  light: [{ domain: "light", entity_category: "none" }],
  climate: [
    { domain: "climate", entity_category: "none" },
    { domain: "humidifier", entity_category: "none" },
    { domain: "fan", entity_category: "none" },
    { domain: "water_heater", entity_category: "none" },
    {
      domain: "cover",
      device_class: ["awning", "blind", "curtain", "shade", "shutter", "window", "none"],
      entity_category: "none",
    },
    { domain: "binary_sensor", device_class: ["window"], entity_category: "none" },
  ],
  security: [
    { domain: "camera", entity_category: "none" },
    { domain: "alarm_control_panel", entity_category: "none" },
    { domain: "lock", entity_category: "none" },
    { domain: "cover", device_class: ["door", "garage", "gate", "window"], entity_category: "none" },
    {
      domain: "binary_sensor",
      device_class: [
        "lock", "door", "window", "garage_door", "opening",
        "carbon_monoxide", "gas", "glass_break", "moisture", "safety", "smoke", "tamper",
      ],
      entity_category: "none",
    },
    { domain: "binary_sensor", device_class: ["tamper"], entity_category: "diagnostic" },
  ],
  media_players: [{ domain: "media_player", entity_category: "none" }],
};

export const SUMMARY_ICONS = {
  light: "mdi:lamps",
  climate: "mdi:home-thermometer",
  security: "mdi:security",
  media_players: "mdi:multimedia",
  scenes: "mdi:palette",
  automations: "mdi:robot",
};
