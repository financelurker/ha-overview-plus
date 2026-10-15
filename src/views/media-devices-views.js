// @ts-check
/**
 * Media players view and devices view (devices without area).
 *
 * Re-implemented from home-assistant/frontend:
 *   src/panels/lovelace/strategies/home/home-media-players-view-strategy.ts
 *   src/panels/lovelace/strategies/home/home-other-devices-view-strategy.ts
 *   src/panels/lovelace/strategies/home/helpers/other-devices-filters.ts
 *
 * Additions: card rules (contexts "media" and "devices") and area names removed from
 * card names in the media view's area groups.
 */

import { createCardFactory } from "../card-factory.js";
import { findEntities, isOtherDeviceEntity, SUMMARY_FILTERS } from "../entity-filter.js";
import { t } from "../i18n.js";
import { deviceName, displayName, entityCategory, entityContext, stripAreaName } from "../registry.js";
import { floorHierarchy, floorIcon } from "./overview-view.js";

/** @typedef {import("../registry.js").EntityContext} EntityContext */

/**
 * @param {any} hass
 * @param {{ card_rules?: any[], strip_area_names?: boolean }} [options]
 */
export function generateMediaPlayersView(hass, options = {}) {
  const factory = createCardFactory(options.card_rules, "media");
  const strip = options.strip_area_names !== false;
  const all = Object.keys(hass.states || {}).map((id) => entityContext(hass, id));
  const players = findEntities(all, SUMMARY_FILTERS.media_players);
  const home = floorHierarchy(hass);
  const floorCount = home.floors.length + (home.areas.length ? 1 : 0);

  /**
   * @param {EntityContext} ctx
   * @param {any} [area]
   */
  const card = (ctx, area) => {
    /** @type {Record<string, any>} */
    const base = { type: "media-control", entity: ctx.entity_id };
    if (strip && area) {
      const shown = displayName(hass, ctx, undefined);
      const short = stripAreaName(shown, area);
      if (short !== shown) base.name = short;
    }
    const result = factory.entity(ctx, base);
    if (result && base.name && result.name === undefined && result.entity === ctx.entity_id) result.name = base.name;
    return result;
  };

  /** @param {string[]} areaIds */
  const areaCards = (areaIds) => {
    /** @type {Record<string, any>[]} */
    const cards = [];
    for (const areaId of areaIds) {
      const area = hass.areas?.[areaId];
      if (!area) continue;
      const inArea = players.map((ctx) => (ctx.area?.area_id === areaId ? card(ctx, area) : null)).filter(Boolean);
      if (!inArea.length) continue;
      cards.push({
        heading_style: "subtitle",
        type: "heading",
        heading: area.name,
        tap_action: { action: "navigate", navigation_path: `areas-${area.area_id}` },
      });
      cards.push(.../** @type {Record<string, any>[]} */ (inArea));
    }
    return cards;
  };

  /** @type {Record<string, any>[]} */
  const sections = [];
  for (const { id, areas } of home.floors) {
    const cards = areaCards(areas);
    if (!cards.length) continue;
    const floor = hass.floors[id];
    sections.push({
      type: "grid",
      column_span: 2,
      cards: [{ type: "heading", heading: floorCount > 1 ? floor.name : t(hass, "areas"), icon: floorIcon(floor) }, ...cards],
    });
  }
  if (home.areas.length) {
    const cards = areaCards(home.areas);
    if (cards.length) {
      sections.push({
        type: "grid",
        column_span: 2,
        cards: [{ type: "heading", heading: floorCount > 1 ? t(hass, "other_areas") : t(hass, "areas") }, ...cards],
      });
    }
  }
  const unassigned = players.filter((ctx) => !ctx.area).map((ctx) => card(ctx)).filter(Boolean);
  if (unassigned.length) {
    sections.push({
      type: "grid",
      column_span: 2,
      cards: [
        { type: "heading", heading: sections.length ? t(hass, "other_media_players") : t(hass, "media_players") },
        ...unassigned,
      ],
    });
  }
  return { type: "sections", max_columns: 2, sections };
}

/**
 * @param {any} hass
 * @param {{ card_rules?: any[] }} [options]
 */
export function generateOtherDevicesView(hass, options = {}) {
  const factory = createCardFactory(options.card_rules, "devices");
  /** @type {Map<string, EntityContext[]>} */
  const byDevice = new Map();
  for (const id of Object.keys(hass.states || {})) {
    const ctx = entityContext(hass, id);
    if (!ctx.device || !isOtherDeviceEntity(ctx)) continue;
    if (!byDevice.has(ctx.device.id)) byDevice.set(ctx.device.id, []);
    /** @type {EntityContext[]} */ (byDevice.get(ctx.device.id)).push(ctx);
  }

  /** @type {Record<string, any>[]} */
  const sections = [];
  for (const [deviceId, list] of byDevice) {
    const primary = list.filter((ctx) => entityCategory(ctx) === "none");
    if (!primary.length) continue;
    const device = hass.devices[deviceId];
    const custom = factory.device(device, primary);
    if (custom === null) continue;
    // Entity rules: only hiding applies to the rows of the entities card
    const rows = primary.filter((ctx) => factory.entity(ctx, { type: "entities-row", entity: ctx.entity_id }) !== null);
    if (!custom && !rows.length) continue;
    sections.push({
      type: "grid",
      cards: [
        {
          type: "heading",
          heading: deviceName(device) || t(hass, "unnamed_device"),
          tap_action: hass.user?.is_admin ? { action: "navigate", navigation_path: `/config/devices/device/${deviceId}` } : { action: "none" },
          badges: [],
        },
        custom ?? { type: "entities", entities: rows.map((ctx) => ({ entity: ctx.entity_id, name: { type: "entity" } })) },
      ],
    });
  }

  if (!sections.length) {
    return {
      type: "panel",
      cards: [
        {
          type: "empty-state",
          icon: "mdi:check-all",
          content_only: true,
          title: t(hass, "all_organized_title"),
          content: t(hass, "all_organized_content"),
        },
      ],
    };
  }
  if (sections.length === 1) sections[0].column_span = 2;
  return {
    type: "sections",
    header: { badges_position: "bottom" },
    max_columns: Math.min(Math.max(sections.length, 2), 3),
    sections,
  };
}
