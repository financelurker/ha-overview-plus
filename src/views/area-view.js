// @ts-check
/**
 * Area view.
 *
 * Without an override this reproduces the area view of the built-in Overview
 * (home-assistant/frontend src/panels/lovelace/strategies/home/home-area-view-strategy.ts):
 * Lights, Climate, Security, Media players, Scenes, then one section per remaining
 * device, then Automations.
 *
 * With `area_overrides.<area_id>.sections` the standard categories are not built.
 * Instead the configured sections come first, in order, followed by all remaining
 * devices of the area (and automations), as in the default view.
 */

import { createCardFactory } from "../card-factory.js";
import { findEntities, simpleFilter, SUMMARY_FILTERS, SUMMARY_ICONS } from "../entity-filter.js";
import { t } from "../i18n.js";
import { matches } from "../matcher.js";
import { areaEntities, deviceClass, deviceName, entityCategory, supportsFeature } from "../registry.js";

/** @typedef {import("../registry.js").EntityContext} EntityContext */

/**
 * @typedef {Object} EntitySelection
 * @property {string[]} [include_domains]
 * @property {string[]} [exclude_domains]
 * @property {string[]} [include_categories]   default: ["none", "diagnostic"]
 * @property {string[]} [exclude_device_classes]
 * @property {string[]} [exclude]               entity ids
 */

/**
 * @typedef {Object} OverrideSection
 * @property {string} [title]
 * @property {string} [icon]
 * @property {any} match
 * @property {"tiles" | "devices" | "compact" | "table"} [layout]
 * @property {EntitySelection} [entities]
 * @property {any} [primary]                     match spec for the primary entity (layout compact)
 */

/**
 * @typedef {Object} AreaOverride
 * @property {OverrideSection[]} [sections]
 * @property {boolean} [show_other_devices]      default true
 * @property {boolean} [show_automations]        default true
 * @property {string[] | false} [badges]         entity ids shown as badges; false = none
 */

/**
 * @typedef {Object} AreaViewOptions
 * @property {any[]} [card_rules]
 * @property {AreaOverride} [override]
 */

const LIGHT_BRIGHTNESS_MODES = ["brightness", "color_temp", "hs", "xy", "rgb", "rgbw", "rgbww", "white"];

/**
 * Default card for an entity in an area view.
 * Mirrors computeAreaTileCardConfig(hass, true) in areas-strategy-helper.ts.
 * @param {EntityContext} ctx
 * @returns {Record<string, any>}
 */
export function defaultEntityCard(ctx) {
  const { domain, state, entity_id: entity } = ctx;
  if (domain === "camera") {
    return { type: "picture-entity", entity, show_state: false, show_name: false, grid_options: { columns: 6, rows: 2 } };
  }
  let feature;
  const modes = state?.attributes?.supported_color_modes || [];
  if (domain === "light" && modes.some((/** @type {string} */ m) => LIGHT_BRIGHTNESS_MODES.includes(m))) {
    feature = "light-brightness";
  } else if (domain === "cover" && (supportsFeature(state, 1) || supportsFeature(state, 2))) {
    feature = "cover-open-close";
  } else if (
    (domain === "climate" && (supportsFeature(state, 1) || supportsFeature(state, 2))) ||
    (domain === "water_heater" && supportsFeature(state, 1))
  ) {
    feature = "target-temperature";
  } else if (domain === "fan" && supportsFeature(state, 1)) {
    feature = "fan-speed";
  } else if (domain === "alarm_control_panel") {
    feature = "alarm-modes";
  } else if (domain === "lock") {
    feature = "lock-commands";
  }
  return feature ? { type: "tile", entity, features: [{ type: feature }] } : { type: "tile", entity };
}

/**
 * @param {string} heading
 * @param {string | undefined} icon
 * @param {Record<string, any>} [extra]
 */
const headingCard = (heading, icon, extra = {}) => {
  /** @type {Record<string, any>} */
  const card = { type: "heading", heading };
  if (icon) card.icon = icon;
  return { ...card, ...extra };
};

/** @param {string} path */
const navigate = (path) => ({ action: "navigate", navigation_path: path });

/**
 * @param {any} hass
 * @param {any} device
 */
const deviceTapAction = (hass, device) =>
  hass.user?.is_admin && device ? navigate(`/config/devices/device/${device.id}`) : undefined;

/**
 * Group entity contexts by device; entities without device are grouped under "".
 * @param {EntityContext[]} entities
 * @returns {Map<string, EntityContext[]>}
 */
function groupByDevice(entities) {
  const groups = new Map();
  for (const ctx of entities) {
    const key = ctx.device?.id ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ctx);
  }
  // Entities without a device go last, like upstream ("Others")
  if (groups.has("")) {
    const rest = groups.get("");
    groups.delete("");
    groups.set("", rest);
  }
  return groups;
}

/**
 * @param {EntitySelection | undefined} sel
 * @returns {(ctx: EntityContext) => boolean}
 */
function selectionFilter(sel = {}) {
  const categories = sel.include_categories ?? ["none", "diagnostic"];
  return (ctx) =>
    (!sel.include_domains || sel.include_domains.includes(ctx.domain)) &&
    (!sel.exclude_domains || !sel.exclude_domains.includes(ctx.domain)) &&
    categories.includes(entityCategory(ctx)) &&
    (!sel.exclude_device_classes || !sel.exclude_device_classes.includes(deviceClass(ctx))) &&
    (!sel.exclude || !sel.exclude.includes(ctx.entity_id));
}

const PRIMARY_PRIORITY = [
  { domain: "binary_sensor", device_class: "running" },
  { domain: "binary_sensor", device_class: "connectivity" },
  { domain: "binary_sensor", device_class: "power" },
  { domain: "switch" },
  { domain: "binary_sensor" },
  { domain: "sensor" },
];

/**
 * @param {EntityContext[]} entities
 * @param {any} spec
 */
function primaryEntity(entities, spec) {
  if (spec) return entities.find((ctx) => matches(spec, ctx));
  const primary = entities.filter((ctx) => entityCategory(ctx) === "none");
  for (const p of PRIMARY_PRIORITY) {
    const found = primary.find((ctx) => matches(p, ctx));
    if (found) return found;
  }
  return primary[0] ?? entities[0];
}

/**
 * @param {any} hass
 * @param {string} areaId
 * @param {AreaViewOptions} [options]
 * @returns {{ view: Record<string, any>, report: Record<string, any> }}
 */
export function generateAreaView(hass, areaId, options = {}) {
  const area = hass.areas?.[areaId];
  if (!area) throw new Error(t(hass, "unknown_area", { area: areaId }));

  const override = options.override;
  const hasOverride = Array.isArray(override?.sections) && override.sections.length > 0;
  const highlight = createCardFactory(options.card_rules, "area");
  const other = createCardFactory(options.card_rules, "area_other");

  /** @type {Record<string, any>} */
  const report = { area: areaId, override: hasOverride, sections: [], hidden: [] };

  /**
   * @param {ReturnType<typeof createCardFactory>} factory
   * @param {EntityContext} ctx
   * @param {Record<string, any>} [extra]
   */
  const card = (factory, ctx, extra = {}) => {
    const result = factory.entity(ctx, { ...defaultEntityCard(ctx), ...extra });
    if (!result) report.hidden.push(ctx.entity_id);
    return result;
  };
  /** @param {(Record<string, any> | null | undefined)[]} cards */
  const compact = (cards) => /** @type {Record<string, any>[]} */ (cards.filter(Boolean));

  const all = areaEntities(hass, areaId);
  /** @type {Record<string, any>[]} */
  const sections = [];
  /** @type {Set<string>} entity ids already shown or intentionally consumed */
  const consumed = new Set();

  // ---------------------------------------------------------------- badges
  let badgeEntities;
  if (override?.badges === false) badgeEntities = [];
  else if (Array.isArray(override?.badges)) badgeEntities = override.badges.map((e) => ({ entity: e }));
  else {
    badgeEntities = [];
    if (area.temperature_entity_id) badgeEntities.push({ entity: area.temperature_entity_id, color: "red" });
    if (area.humidity_entity_id) badgeEntities.push({ entity: area.humidity_entity_id, color: "indigo" });
  }
  const badges = badgeEntities.map((b) => ({ type: "entity", ...b }));

  // ---------------------------------------------------- highlighted sections
  if (hasOverride) {
    /** @type {Set<string>} */
    const claimedDevices = new Set();
    for (const [index, section] of /** @type {OverrideSection[]} */ (override.sections).entries()) {
      // A section without selection matches nothing (not everything), so an empty
      // section added in the editor does not swallow the whole area.
      const hasMatch =
        section.match != null &&
        !(Array.isArray(section.match) && section.match.length === 0) &&
        !(typeof section.match === "object" && !Array.isArray(section.match) && Object.keys(section.match).length === 0);
      const matched = hasMatch
        ? all.filter(
            (ctx) => !consumed.has(ctx.entity_id) && !(ctx.device && claimedDevices.has(ctx.device.id)) && matches(section.match, ctx)
          )
        : [];
      // A device belongs to the first section that matches any of its entities
      for (const ctx of matched) {
        consumed.add(ctx.entity_id);
        if (ctx.device) claimedDevices.add(ctx.device.id);
      }
      for (const ctx of all) if (ctx.device && claimedDevices.has(ctx.device.id)) consumed.add(ctx.entity_id);

      const shown = matched.filter(selectionFilter(section.entities));
      const built = buildOverrideSection(hass, section, shown, highlight, card, compact);
      report.sections.push({
        title: section.title ?? `#${index + 1}`,
        layout: section.layout ?? "tiles",
        devices: [...new Set(shown.map((ctx) => (ctx.device ? deviceName(ctx.device) : ctx.entity_id)))],
        entities: shown.length,
      });
      sections.push(...built);
    }
  } else {
    const bySummary = Object.fromEntries(
      Object.entries(SUMMARY_FILTERS).map(([key, filters]) => [key, findEntities(all, filters)])
    );
    for (const list of Object.values(bySummary)) for (const ctx of list) consumed.add(ctx.entity_id);

    const { light, climate, security, media_players: media } = bySummary;

    if (light.length) {
      const anyOn = {
        condition: "or",
        conditions: light.map((ctx) => ({ condition: "state", entity: ctx.entity_id, state: "on" })),
      };
      sections.push({
        type: "grid",
        cards: [
          headingCard(t(hass, "light"), SUMMARY_ICONS.light, {
            tap_action: hass.panels?.light ? navigate("/light?historyBack=1") : undefined,
            badges: [
              {
                type: "button", icon: "mdi:power", text: t(hass, "light_off"),
                tap_action: { action: "perform-action", perform_action: "light.turn_on", target: { area_id: areaId } },
                visibility: [{ condition: "not", conditions: [anyOn] }],
              },
              {
                type: "button", icon: "mdi:power", color: "orange", text: t(hass, "light_on"),
                tap_action: { action: "perform-action", perform_action: "light.turn_off", target: { area_id: areaId } },
                visibility: [anyOn],
              },
            ],
          }),
          ...compact(light.map((ctx) => card(highlight, ctx))),
        ],
      });
    }
    /** @type {[EntityContext[], string, string | undefined][]} */
    const simple = [
      [climate, "climate", hass.panels?.climate ? "/climate?historyBack=1" : undefined],
      [security, "security", hass.panels?.security ? "/security?historyBack=1" : undefined],
      [media, "media_players", "media-players?historyBack=1"],
    ];
    for (const [list, key, path] of simple) {
      if (!list.length) continue;
      sections.push({
        type: "grid",
        cards: [
          headingCard(t(hass, key), SUMMARY_ICONS[key], { tap_action: path ? navigate(path) : undefined }),
          ...compact(list.map((ctx) => card(highlight, ctx))),
        ],
      });
    }

    const scenes = all.filter(simpleFilter({ domain: "scene", entity_category: "none" }));
    for (const ctx of scenes) consumed.add(ctx.entity_id);
    if (scenes.length) {
      sections.push({
        type: "grid",
        cards: [
          headingCard(t(hass, "scenes"), SUMMARY_ICONS.scenes, {
            tap_action: hass.user?.is_admin ? navigate("/config/scene/dashboard") : undefined,
          }),
          ...compact(scenes.map((ctx) => card(highlight, ctx))),
        ],
      });
    }
  }

  // ------------------------------------------------------ remaining devices
  const automations = all.filter(simpleFilter({ domain: "automation", entity_category: "none" }));
  for (const ctx of automations) consumed.add(ctx.entity_id);

  if (override?.show_other_devices !== false) {
    const battery = simpleFilter({ domain: "sensor", device_class: "battery" });
    const rest = all.filter((ctx) => !consumed.has(ctx.entity_id));
    const deviceSections = [];
    for (const [deviceId, entities] of groupByDevice(rest)) {
      const device = deviceId ? hass.devices?.[deviceId] : undefined;
      const batteries = entities.filter(battery);
      const primary = entities.filter((ctx) => !battery(ctx) && entityCategory(ctx) === "none");
      if (!primary.length) continue;

      const heading = device ? deviceName(device) || t(hass, "unnamed_device") : t(hass, "others");
      const custom = device ? other.device(device, primary) : undefined;
      if (custom === null) continue;
      deviceSections.push({
        type: "grid",
        cards: [
          headingCard(heading, undefined, {
            tap_action: deviceTapAction(hass, device),
            badges: batteries.slice(0, 1).map((ctx) => ({ type: "entity", entity: ctx.entity_id, tap_action: { action: "more-info" } })),
          }),
          ...(custom ? [custom] : compact(primary.map((ctx) => card(other, ctx, { name: { type: "entity" } })))),
        ],
      });
    }
    if (deviceSections.length) {
      sections.push({ type: "grid", column_span: 3, cards: [{ type: "heading", heading_style: "subtitle", heading: "" }] });
      sections.push(...deviceSections);
    }
  }

  if (automations.length && override?.show_automations !== false) {
    sections.push({
      type: "grid",
      cards: [
        headingCard(t(hass, "automations"), SUMMARY_ICONS.automations, {
          tap_action: hass.user?.is_admin ? navigate("/config/automation/dashboard") : undefined,
        }),
        ...compact(automations.map((ctx) => card(highlight, ctx))),
      ],
    });
  }

  // Clean up undefined values (e.g. tap_action) so the YAML view stays readable
  const clean = /** @type {any} */ (JSON.parse(JSON.stringify(sections)));

  if (!clean.length) {
    return {
      report,
      view: {
        type: "panel",
        cards: [
          {
            type: "empty-state",
            icon: area.icon || "mdi:shape-square-rounded-plus",
            content_only: true,
            title: t(hass, "no_devices_title"),
            content: t(hass, "no_devices_content"),
          },
        ],
      },
    };
  }

  if (clean.length === 1) clean[0].column_span = 2;

  return {
    report,
    view: {
      type: "sections",
      header: { badges_position: "bottom" },
      max_columns: Math.min(Math.max(clean.length, 2), 3),
      sections: clean,
      badges,
    },
  };
}

/**
 * @param {any} hass
 * @param {OverrideSection} section
 * @param {EntityContext[]} shown
 * @param {ReturnType<typeof createCardFactory>} factory
 * @param {(f: ReturnType<typeof createCardFactory>, ctx: EntityContext, extra?: Record<string, any>) => Record<string, any> | null} card
 * @param {(cards: (Record<string, any> | null | undefined)[]) => Record<string, any>[]} compact
 * @returns {Record<string, any>[]}
 */
function buildOverrideSection(hass, section, shown, factory, card, compact) {
  if (!shown.length) return [];
  const layout = section.layout ?? "tiles";
  const title = headingCard(section.title ?? "", section.icon);

  if (layout === "tiles") {
    return [{ type: "grid", cards: [title, ...compact(shown.map((ctx) => card(factory, ctx)))] }];
  }

  const groups = [...groupByDevice(shown)];

  if (layout === "devices") {
    return [
      { type: "grid", column_span: 3, cards: [{ ...title, heading_style: "title" }] },
      ...groups.flatMap(([deviceId, entities]) => {
        const device = deviceId ? hass.devices?.[deviceId] : undefined;
        const custom = device ? factory.device(device, entities) : undefined;
        if (custom === null) return [];
        return [{
          type: "grid",
          cards: [
            headingCard(device ? deviceName(device) || t(hass, "unnamed_device") : t(hass, "others"), undefined, {
              heading_style: "subtitle",
              tap_action: deviceTapAction(hass, device),
            }),
            ...(custom ? [custom] : compact(entities.map((ctx) => card(factory, ctx, { name: { type: "entity" } })))),
          ],
        }];
      }),
    ];
  }

  if (layout === "table") {
    const cards = groups.map(([deviceId, entities]) => {
      const device = deviceId ? hass.devices?.[deviceId] : undefined;
      const custom = device ? factory.device(device, entities) : undefined;
      if (custom !== undefined) return custom;
      return {
        type: "entities",
        title: device ? deviceName(device) || t(hass, "unnamed_device") : t(hass, "others"),
        entities: entities.map((ctx) => ctx.entity_id),
      };
    });
    return [{ type: "grid", cards: [title, ...compact(cards)] }];
  }

  // compact: one card per device, showing its primary entity
  const cards = groups.flatMap(([deviceId, entities]) => {
    const device = deviceId ? hass.devices?.[deviceId] : undefined;
    if (!device) return entities.map((ctx) => card(factory, ctx));
    const custom = factory.device(device, entities);
    if (custom !== undefined) return [custom];
    const primary = primaryEntity(entities, section.primary);
    if (!primary) return [];
    return [card(factory, primary, {
      name: deviceName(device) || t(hass, "unnamed_device"),
      ...(hass.user?.is_admin ? { tap_action: navigate(`/config/devices/device/${device.id}`) } : {}),
    })];
  });
  return [{ type: "grid", cards: [title, ...compact(cards)] }];
}
