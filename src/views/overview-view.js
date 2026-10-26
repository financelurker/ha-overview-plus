// @ts-check
/**
 * Overview page (start page) of the dashboard.
 *
 * Reproduces the overview view of the built-in Overview
 * (home-assistant/frontend src/panels/lovelace/strategies/home/home-overview-view-strategy.ts
 * and the helpers it uses: usage_prediction/common-controls-section-strategy.ts,
 * helpers/favorite-cards.ts, data/home_shortcuts.ts, security/strategies/security-alerts.ts,
 * common/areas/areas-floor-hierarchy.ts) and adds:
 *   - card rules for favorites and suggested entities (context "favorites")
 *   - per-area options for the area tiles (`area_overrides.<area>.tile`)
 */

import { AREA_TILE_TYPE } from "../area-tile-card.js";
import { createCardFactory } from "../card-factory.js";
import { findEntities, isOtherDeviceEntity, simpleFilter, SUMMARY_FILTERS } from "../entity-filter.js";
import { resolveShortcutItems } from "../home-settings.js";
import { hasOwnSummaryPage, summaryPage } from "../summary-pages.js";
import { t } from "../i18n.js";
import { domainOf, entityContext, entityCategory } from "../registry.js";

/** @typedef {import("../registry.js").EntityContext} EntityContext */

/**
 * @typedef {Object} OverviewOptions
 * @property {any[]} [card_rules]
 * @property {Record<string, any>} [area_overrides]
 * @property {{ entity: string, severity?: string }[]} [alert_entities]
 * @property {string[]} [favorite_entities]
 * @property {boolean} [hide_welcome_message]
 * @property {boolean} [hide_suggested_entities]
 * @property {any[]} [shortcuts]
 * @property {any[]} [area_indicators]  states shown on the area tiles (see area-indicators.js)
 * @property {Record<string, string>} [summary_pages]  pages the summaries lead to (see summary-pages.js)
 */

const MAX_COLUMNS = 3;
const LARGE_SCREEN = { condition: "view_columns", min: 2 };
const SMALL_SCREEN = { condition: "view_columns", max: 1 };

const MAINTENANCE_FILTERS = [
  { domain: "sensor", device_class: ["battery"] },
  { domain: "binary_sensor", device_class: ["battery"] },
];

const DANGER_BINARY_SENSOR_CLASSES = new Set(["carbon_monoxide", "gas", "glass_break", "moisture", "safety", "smoke"]);

/** @param {any} hass @param {string} component */
const isLoaded = (hass, component) => !!hass.config?.components?.includes(component);

/** @param {string} path */
const navigate = (path) => ({ action: "navigate", navigation_path: path });

// ------------------------------------------------------------ helpers

/**
 * Floors with their areas (registry order), plus areas without floor.
 * @param {any} hass
 */
export function floorHierarchy(hass) {
  /** @type {Map<string, string[]>} */
  const byFloor = new Map();
  /** @type {string[]} */
  const unassigned = [];
  for (const area of Object.values(hass.areas || {})) {
    if (area.floor_id) {
      if (!byFloor.has(area.floor_id)) byFloor.set(area.floor_id, []);
      /** @type {string[]} */ (byFloor.get(area.floor_id)).push(area.area_id);
    } else unassigned.push(area.area_id);
  }
  return {
    floors: Object.values(hass.floors || {}).map((floor) => ({ id: floor.floor_id, areas: byFloor.get(floor.floor_id) || [] })),
    areas: unassigned,
  };
}

/** @param {any} floor */
export function floorIcon(floor) {
  if (floor.icon) return floor.icon;
  switch (floor.level) {
    case 0: return "mdi:home-floor-0";
    case 1: return "mdi:home-floor-1";
    case 2: return "mdi:home-floor-2";
    case 3: return "mdi:home-floor-3";
    case -1: return "mdi:home-floor-negative-1";
    default: return "mdi:home";
  }
}

/** @param {any} stateObj */
function defaultAlertSeverity(stateObj) {
  if (!stateObj) return "warning";
  const domain = domainOf(stateObj.entity_id);
  if (domain === "alarm_control_panel") return "alert";
  if (domain === "binary_sensor") {
    return DANGER_BINARY_SENSOR_CLASSES.has(stateObj.attributes?.device_class) ? "alert" : "warning";
  }
  return "warning";
}

/** @param {{ entity: string, severity?: string }} alertEntity @param {any} stateObj */
export const alertSeverity = (alertEntity, stateObj) => alertEntity.severity ?? defaultAlertSeverity(stateObj);

/** @param {string} entityId */
function alertVisibility(entityId) {
  /** @type {Record<string, any>} */
  const condition = { condition: "state", entity: entityId };
  switch (domainOf(entityId)) {
    case "alarm_control_panel": condition.state = "triggered"; break;
    case "cover": condition.state = "open"; break;
    case "lock": condition.state = ["jammed", "unlocked", "open"]; break;
    default: condition.state = "on";
  }
  return [condition];
}

/**
 * Default card of a favorite / suggested entity.
 * @param {string} entityId
 */
export function favoriteCard(entityId) {
  if (domainOf(entityId) === "camera") {
    return { type: "picture-entity", entity: entityId, show_name: false, show_state: false, grid_options: { columns: 6, rows: 2 } };
  }
  return { type: "tile", entity: entityId, state_content: ["state", "area_name"], show_entity_picture: true };
}

/**
 * Area tile; `tile` options from area_overrides are merged in. With selected entities
 * (`tile.entities` / `tile.alert_entities`) or area indicators the Overview Plus area
 * tile is used, since the area card can only show values combined by device class and
 * has no indicators.
 * @param {any} hass
 * @param {string} areaId
 * @param {Record<string, any> | undefined} tile
 * @param {any[] | undefined} [indicators] `area_indicators` of the config
 */
function areaCard(hass, areaId, tile, indicators) {
  const area = hass.areas?.[areaId];
  /** @type {Record<string, any>} */
  const card = {
    type: "area",
    area: areaId,
    display_type: "compact",
    sensor_classes: area?.temperature_entity_id ? ["temperature"] : [],
    tap_action: navigate(`areas-${areaId}`),
    vertical: true,
    grid_options: { rows: 2, columns: 4 },
  };
  const own = tile && typeof tile === "object" ? tile : {};
  const hasIndicators = Array.isArray(indicators) && indicators.length > 0;
  const custom = (Array.isArray(own.entities) && own.entities.length) || (Array.isArray(own.alert_entities) && own.alert_entities.length);
  // An area card set up as picture / camera or with features stays the area card –
  // without area states, since only the Overview Plus tile can show them
  const areaCardOnly = (own.display_type && own.display_type !== "compact") || own.features !== undefined;
  if (custom || (hasIndicators && !areaCardOnly)) {
    // The area card cannot show these: the Overview Plus area tile looks the same and can
    const { display_type: _d, sensor_classes: _s, ...base } = card;
    /** @type {Record<string, any>} */
    const tileCard = { ...base, ...own, type: AREA_TILE_TYPE, area: areaId };
    if (hasIndicators) tileCard.indicators = indicators;
    return tileCard;
  }
  return { ...card, ...own, type: "area", area: areaId };
}

// ---------------------------------------------------------------- generator

/**
 * @param {any} hass
 * @param {OverviewOptions} [options]
 * @returns {Promise<{ view: Record<string, any>, report: Record<string, any> }>}
 */
export async function generateOverviewView(hass, options = {}) {
  const factory = createCardFactory(options.card_rules, "favorites");
  const overrides = options.area_overrides || {};
  /** @type {Record<string, any>} */
  const report = { favorites: [], suggested: [], hidden: [] };

  const all = Object.keys(hass.states || {}).map((id) => entityContext(hass, id));
  const home = floorHierarchy(hass);
  const floorCount = home.floors.length + (home.areas.length ? 1 : 0);

  // ---------------------------------------------------------- areas by floor
  // Only show the devices tile if the devices view has content
  const hasOtherDevices = all.some((ctx) => isOtherDeviceEntity(ctx) && entityCategory(ctx) === "none" && !!ctx.device);

  /** @type {Record<string, any>[]} */
  const floorsSections = [];
  for (const { id, areas } of home.floors) {
    if (!areas.length) continue;
    const floor = hass.floors[id];
    floorsSections.push({
      type: "grid",
      column_span: MAX_COLUMNS,
      cards: [
        { type: "heading", heading: floorCount > 1 ? floor.name : t(hass, "areas"), heading_style: "title", icon: floorIcon(floor) },
        ...areas.map((areaId) => areaCard(hass, areaId, overrides[areaId]?.tile, options.area_indicators)),
      ],
    });
  }

  if (home.areas.length > 0 || hasOtherDevices) {
    const cards = home.areas.map((areaId) => areaCard(hass, areaId, overrides[areaId]?.tile, options.area_indicators));
    if (hasOtherDevices) {
      cards.push({
        type: "tile",
        entity: "zone.home",
        vertical: true,
        name: t(hass, "devices"),
        icon: "mdi:devices",
        hide_state: true,
        tap_action: navigate("other-devices"),
        grid_options: { rows: 2, columns: 4 },
      });
    }
    const noOtherAreas = home.areas.length === 0;
    const noFloor = home.floors.length === 0;
    const heading =
      noFloor && noOtherAreas ? undefined
        : noFloor ? t(hass, "areas")
          : noOtherAreas ? t(hass, "devices")
            : t(hass, "other_areas");
    floorsSections.push({
      type: "grid",
      column_span: MAX_COLUMNS,
      cards: [...(heading ? [{ type: "heading", heading, heading_style: "title" }] : []), ...cards],
    });
  }

  // ------------------------------------------------------------- favorites
  const favoriteEntities = (options.favorite_entities || []).filter((id) => hass.states?.[id] !== undefined);
  const limit = Math.max(8, favoriteEntities.length);
  const favoritesHeading = {
    type: "heading",
    heading: t(hass, "favorites"),
    heading_style: "title",
    visibility: [LARGE_SCREEN],
    grid_options: { rows: "auto" },
  };

  /** @type {string[]} */
  let shownEntities = [];
  if (!options.hide_suggested_entities) {
    shownEntities = favoriteEntities.slice(0, limit);
    if (shownEntities.length < limit && isLoaded(hass, "usage_prediction")) {
      try {
        const res = await hass.callWS({ type: "usage_prediction/common_control" });
        const predicted = (res?.entities || []).filter(
          (/** @type {string} */ id) => id in hass.states && !hass.entities?.[id]?.hidden && !shownEntities.includes(id)
        );
        report.suggested = predicted.slice(0, limit - shownEntities.length);
        shownEntities = [...shownEntities, ...predicted].slice(0, limit);
      } catch (err) {
        console.warn("[overview-plus] Suggested entities not available.", err);
      }
    }
  } else {
    shownEntities = favoriteEntities;
  }
  report.favorites = favoriteEntities;

  const favoriteCards = shownEntities
    .map((id) => {
      const card = factory.entity(entityContext(hass, id), favoriteCard(id));
      if (!card) report.hidden.push(id);
      return card;
    })
    .filter(Boolean);
  const favoritesSection = favoriteCards.length
    ? { type: "grid", column_span: MAX_COLUMNS, cards: [favoritesHeading, ...favoriteCards] }
    : undefined;

  // ------------------------------------------------------------- summaries
  const any = (/** @type {any[]} */ filters) => findEntities(all, filters).length > 0;
  const panels = hass.panels || {};
  const pages = options.summary_pages;
  // A summary needs Home Assistant's page only if it leads there
  const reachable = (/** @type {string} */ key) => !!panels[key] || hasOwnSummaryPage(pages, key);
  const page = (/** @type {string} */ key) => navigate(/** @type {string} */ (summaryPage(hass, pages, key)));
  const hasLights = reachable("light") && any(SUMMARY_FILTERS.light);
  const hasMediaPlayers = any(SUMMARY_FILTERS.media_players);
  const hasClimate =
    reachable("climate") &&
    (Object.values(hass.areas || {}).some(
      (area) => (area.temperature_entity_id && hass.states[area.temperature_entity_id]) ||
        (area.humidity_entity_id && hass.states[area.humidity_entity_id])
    ) || any(SUMMARY_FILTERS.climate));
  const hasSecurity = reachable("security") && any(SUMMARY_FILTERS.security);
  const hasMaintenance = reachable("maintenance") && any(MAINTENANCE_FILTERS);

  const alertEntities = options.alert_entities ?? [];
  const alertSeverityEntities = alertEntities.filter((a) => alertSeverity(a, hass.states?.[a.entity]) === "alert");
  const alertActiveConditions = alertSeverityEntities.map((a) => ({ condition: "and", conditions: alertVisibility(a.entity) }));

  const weatherFilter = simpleFilter({ domain: "weather", entity_category: "none" });
  const weatherEntity = all.filter(weatherFilter).map((ctx) => ctx.entity_id).sort()[0];

  let hasEnergy = false;
  if (reachable("energy") && isLoaded(hass, "energy")) {
    try {
      const prefs = await hass.callWS({ type: "energy/get_prefs" });
      hasEnergy = !!prefs?.energy_sources?.some((/** @type {any} */ s) => s.type === "grid" && !!s.stat_energy_from);
    } catch {
      // No energy preferences (e.g. not allowed for this user): no energy summary
    }
  }

  /** @type {Record<string, () => Record<string, any> | undefined>} */
  const summaryBuilders = {
    light: () => (hasLights ? { type: "home-summary", summary: "light", tap_action: page("light") } : undefined),
    climate: () => (hasClimate ? { type: "home-summary", summary: "climate", tap_action: page("climate") } : undefined),
    security: () =>
      hasSecurity
        ? {
            type: "home-summary",
            summary: "security",
            tap_action: page("security"),
            ...(alertEntities.length ? { alert_entities: alertEntities } : {}),
          }
        : undefined,
    media_players: () => (hasMediaPlayers ? { type: "home-summary", summary: "media_players", tap_action: page("media_players") } : undefined),
    maintenance: () =>
      hasMaintenance ? { type: "home-summary", summary: "maintenance", tap_action: page("maintenance") } : undefined,
    weather: () =>
      weatherEntity ? { type: "tile", entity: weatherEntity, name: t(hass, "weather"), state_content: ["temperature", "state"] } : undefined,
    energy: () => (hasEnergy ? { type: "home-summary", summary: "energy", tap_action: page("energy") } : undefined),
  };

  /** @type {Record<string, any>[]} */
  const summaryCards = [
    { type: "repairs", hide_empty: true, tap_action: navigate("/config/repairs?historyBack=1") },
    { type: "updates", hide_empty: true, tap_action: navigate("/config/updates?historyBack=1") },
    { type: "discovered-devices", hide_empty: true },
  ];
  for (const item of resolveShortcutItems(options.shortcuts)) {
    if (item.type === "summary") {
      if (item.hidden) continue;
      const card = summaryBuilders[item.key]?.();
      if (card) summaryCards.push(card);
    } else {
      summaryCards.push({ type: "shortcut", label: item.label, icon: item.icon, color: item.color, tap_action: navigate(item.path) });
    }
  }
  const hasVisibleSummaryCards = summaryCards.some((card) => !card.hide_empty);
  const summaryHeading = { type: "heading", heading: t(hass, "summaries"), heading_style: "title" };

  const alertsCard = alertSeverityEntities.length
    ? {
        type: "home-summary",
        summary: "alerts",
        alert_entities: alertSeverityEntities,
        tap_action: summaryPage(hass, pages, "security") ? page("security") : undefined,
        visibility: [{ condition: "or", conditions: alertActiveConditions }],
      }
    : undefined;

  const mobileAlertsSection = alertsCard
    ? { type: "grid", column_span: MAX_COLUMNS, visibility: [SMALL_SCREEN], cards: [{ ...alertsCard, grid_options: { columns: 6 } }] }
    : undefined;
  const mobileSummarySection = summaryCards.length
    ? {
        type: "grid",
        column_span: MAX_COLUMNS,
        visibility: [SMALL_SCREEN],
        cards: [summaryHeading, ...summaryCards.map((card) => ({ ...card, grid_options: { columns: 6 } }))],
      }
    : undefined;
  const sidebarSection =
    summaryCards.length || alertsCard
      ? {
          type: "grid",
          cards: [
            { ...summaryHeading, grid_options: { rows: "auto" } },
            ...(alertsCard ? [{ ...alertsCard, grid_options: { columns: 12 } }] : []),
            ...summaryCards.map((card) => ({ ...card, grid_options: { columns: 12 } })),
          ],
        }
      : undefined;

  // ----------------------------------------------------------- empty state
  const emptyStateCard = {
    type: "empty-state",
    icon: "mdi:home-assistant",
    content_only: true,
    title: t(hass, "welcome_title"),
    content: t(hass, "welcome_content"),
  };

  if (!floorsSections.length && !alertsCard && !favoritesSection && !hasVisibleSummaryCards) {
    return { report, view: { type: "panel", cards: [emptyStateCard] } };
  }

  const emptyStateSection =
    !floorsSections.length && !favoritesSection && !hasVisibleSummaryCards && alertSeverityEntities.length
      ? {
          type: "grid",
          column_span: MAX_COLUMNS,
          cards: [
            {
              type: "conditional",
              conditions: [{ condition: "not", conditions: [{ condition: "or", conditions: alertActiveConditions }] }],
              card: emptyStateCard,
            },
          ],
        }
      : undefined;

  const sections = [emptyStateSection, mobileAlertsSection, favoritesSection, mobileSummarySection, ...floorsSections].filter(Boolean);

  /** @type {Record<string, any>} */
  const view = { type: "sections", max_columns: MAX_COLUMNS, sections };
  if (!options.hide_welcome_message) {
    view.header = {
      layout: "responsive",
      card: { type: "markdown", text_only: true, content: `## ${t(hass, "welcome_user", { user: "{{ user }}" })}` },
    };
  }
  if (sidebarSection) view.sidebar = { sections: [sidebarSection], visibility: [LARGE_SCREEN] };
  return { report, view };
}

/**
 * Whether the overview has to be regenerated: a registry changed, or the severity
 * of an alert entity changed (it decides between alert and warning).
 * @param {OverviewOptions} options
 * @param {any} oldHass
 * @param {any} newHass
 */
export function overviewShouldRegenerate(options, oldHass, newHass) {
  if (["entities", "devices", "areas", "floors", "panels", "labels"].some((k) => oldHass[k] !== newHass[k])) return true;
  return (options.alert_entities || []).some(
    (a) => alertSeverity(a, oldHass.states?.[a.entity]) !== alertSeverity(a, newHass.states?.[a.entity])
  );
}
