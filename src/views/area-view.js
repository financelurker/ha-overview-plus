// @ts-check
/**
 * Area view.
 *
 * Without an override this reproduces the area view of the built-in Overview
 * (home-assistant/frontend src/panels/lovelace/strategies/home/home-area-view-strategy.ts):
 * Lights, Climate, Security, Media players, Scenes, then one section per remaining
 * device, then Automations.
 *
 * With `area_overrides.<area_id>.sections` the configured sections are shown in order,
 * followed by all remaining devices of the area (and automations), as in the default
 * view. The standard categories are left out, unless `show_default_sections` is set:
 * then they come first, before the configured sections.
 *
 * An entity is shown only once. The configured sections select first (explicit
 * configuration wins), in their order; the standard categories take what is left;
 * entities of a device that no section shows appear in that device's card below.
 *
 * The heading of a configured section leads to its devices: to the device page if it
 * shows one device, to a list of its devices (device-list.js) if it shows several.
 */

import { createCardFactory } from "../card-factory.js";
import { DEVICE_LIST_KEY } from "../device-list.js";
import { summaryPage } from "../summary-pages.js";
import { findEntities, simpleFilter, SUMMARY_FILTERS, SUMMARY_ICONS } from "../entity-filter.js";
import { t } from "../i18n.js";
import { matches } from "../matcher.js";
import { areaEntities, deviceClass, deviceName, displayName, entityCategory, stripAreaName, supportsFeature } from "../registry.js";

/** @typedef {import("../registry.js").EntityContext} EntityContext */

/**
 * @typedef {Object} EntitySelection
 * @property {string[]} [include_domains]
 * @property {string[]} [exclude_domains]
 * @property {string[]} [include_categories]   default: ["none", "diagnostic"]
 * @property {string[]} [exclude_device_classes]
 * @property {string[]} [exclude]               entity ids
 * @property {HideRule[] | string[]} [hide_states]  hide an entity's card while it is in one of these states (live)
 */

/**
 * @typedef {Object} OverrideSection
 * @property {string} [default]                  a standard category instead of an own section (see DEFAULT_SECTIONS)
 * @property {boolean} [hidden]                  not shown; its entities appear with the remaining devices
 * @property {string} [title]
 * @property {string} [icon]
 * @property {any} match
 * @property {"tiles" | "devices" | "compact" | "table"} [layout]
 * @property {EntitySelection} [entities]
 * @property {any} [primary]                     match spec for the primary entity (layout compact)
 * @property {SortGroup[]} [sort]                order of the entities: groups by domain (and device class)
 */

/**
 * @typedef {Object} AreaOverride
 * @property {OverrideSection[]} [sections]
 * @property {boolean} [show_default_sections]   default false; true: show the standard categories before the own sections
 * @property {boolean} [show_other_devices]      default true
 * @property {boolean} [show_automations]        default true
 * @property {string[] | false} [badges]         entity ids shown as badges; false = none
 */

/**
 * @typedef {Object} AreaViewOptions
 * @property {any[]} [card_rules]
 * @property {AreaOverride} [override]
 * @property {boolean} [strip_area_names]       default true: remove the area name from card names
 * @property {Record<string, string>} [summary_pages]  pages of the category headings (see summary-pages.js)
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

/** Standard categories that can be placed in the list of sections, in their default order. */
export const DEFAULT_SECTIONS = ["light", "climate", "security", "media_players", "scenes"];

/**
 * Order of the sections in the view: category keys (strings) and own section entries.
 * @param {OverrideSection[]} configured
 * @param {OverrideSection[]} ownList
 * @param {boolean} showCategories
 * @param {boolean} withDefaults
 * @returns {(string | OverrideSection)[]}
 */
function displayOrder(configured, ownList, showCategories, withDefaults) {
  if (!showCategories) return ownList;
  if (!withDefaults) return [...DEFAULT_SECTIONS, ...ownList];
  const placed = configured.filter((s) => !s.default || DEFAULT_SECTIONS.includes(String(s.default)));
  const named = new Set(placed.filter((s) => s.default).map((s) => String(s.default)));
  /** @type {(string | OverrideSection)[]} */
  const order = DEFAULT_SECTIONS.filter((key) => !named.has(key));
  for (const s of placed) order.push(s.default ? String(s.default) : s);
  return [...new Set(order)];
}

/**
 * Tap action of a configured section's title: the device page if the section shows one
 * device, the list of its devices if it shows several (opened by device-list.js), none
 * without devices or for users who cannot open device pages.
 * @param {any} hass
 * @param {OverrideSection} section
 * @param {EntityContext[]} shown
 * @param {any} [stripArea]
 * @returns {Record<string, any> | undefined}
 */
function sectionTapAction(hass, section, shown, stripArea) {
  if (!hass.user?.is_admin) return undefined;
  const devices = [...new Map(shown.filter((ctx) => ctx.device).map((ctx) => [ctx.device.id, ctx.device])).values()];
  if (devices.length === 1) return deviceTapAction(hass, devices[0]);
  if (!devices.length) return undefined;
  return {
    action: "fire-dom-event",
    [DEVICE_LIST_KEY]: {
      title: section.title ?? "",
      devices: devices.map((device) => ({ id: device.id, name: stripAreaName(deviceName(device), stripArea) || t(hass, "unnamed_device") })),
    },
  };
}

/**
 * Row name in a table (entities card under the device's name): the entity's own part of
 * its name – "Storeroom Freezer Sensor Temperature" → "Temperature" in the area
 * "Storeroom" under "Freezer Sensor". The area name is only removed if `stripArea` is set.
 * @param {any} hass
 * @param {EntityContext} ctx
 * @param {string} full the name the card would show
 * @param {any} device
 * @param {any} [stripArea]
 */
function tableRowName(hass, ctx, full, device, stripArea) {
  let name = stripArea ? stripAreaName(full, stripArea) : full;
  if (device) {
    // Home Assistant's own split into device and entity name, if it has one
    const own = displayName(hass, ctx, { type: "entity" });
    if (own && own !== full) name = stripArea ? stripAreaName(own, stripArea) : own;
    else {
      const device_ = deviceName(device);
      for (const prefix of new Set([device_, stripAreaName(device_, stripArea)])) name = stripAreaName(name, { name: prefix });
    }
  }
  return name || full;
}

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
 * @typedef {Object} SortGroup
 * @property {string | string[]} [domain]
 * @property {string | string[]} [device_class]  optional, narrows the group
 */

/**
 * Entities in the order of the section's `sort` groups: each entity goes to the first
 * group it fits, in the default order within a group; entities of no group follow in
 * the default order. The default order is Home Assistant's (as in the built-in area
 * view, which takes the categories' filters in turn the same way).
 * @param {EntityContext[]} list
 * @param {any} groups
 * @returns {EntityContext[]}
 */
export function sortEntities(list, groups) {
  const rules = asList(groups)
    // a plain string is a domain: `sort: [light, switch]`
    .map((g) => (typeof g === "string" ? { domain: g } : g))
    .filter((g) => g && typeof g === "object" && !Array.isArray(g))
    .map((g) => ({ domains: asList(g.domain).map(String), deviceClasses: asList(g.device_class).map(String) }))
    .filter((g) => g.domains.length || g.deviceClasses.length);
  if (!rules.length) return list;
  const seen = new Set();
  /** @type {EntityContext[]} */
  const out = [];
  for (const rule of rules) {
    for (const ctx of list) {
      if (seen.has(ctx.entity_id)) continue;
      if (rule.domains.length && !rule.domains.includes(ctx.domain)) continue;
      if (rule.deviceClasses.length && !rule.deviceClasses.includes(deviceClass(ctx))) continue;
      seen.add(ctx.entity_id);
      out.push(ctx);
    }
  }
  for (const ctx of list) if (!seen.has(ctx.entity_id)) out.push(ctx);
  return out;
}

/**
 * @typedef {Object} HideRule
 * @property {string | string[]} [domain]        none: every entity of the section
 * @property {string | string[]} [device_class]  optional, narrows the rule
 * @property {any} states                        hidden while the state is one of these
 */

/** YAML 1.1 reads an unquoted off / on as false / true. @param {any} v */
const stateText = (v) => (v === true ? "on" : v === false ? "off" : String(v));

/** @param {any} v @returns {any[]} */
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]);

/**
 * The hide rules of a section (`entities.hide_states`): a list of rules, or – short form –
 * a list of states for every entity.
 * @param {EntitySelection | undefined} sel
 * @returns {{ domains: string[], deviceClasses: string[], states: string[] }[]}
 */
export function hideRulesOf(sel) {
  const raw = asList(sel?.hide_states);
  const isRule = (/** @type {any} */ r) => r && typeof r === "object" && !Array.isArray(r);
  // Plain states (also mixed with rules) form one rule for every entity
  const plain = raw.filter((r) => !isRule(r) && r !== null && r !== undefined).map(stateText).filter(Boolean);
  return [
    ...(plain.length ? [{ domains: [], deviceClasses: [], states: plain }] : []),
    ...raw.filter(isRule)
    .map((r) => ({
      domains: asList(r.domain).map(String),
      deviceClasses: asList(r.device_class).map(String),
      states: asList(r.states ?? r.state).map(stateText).filter(Boolean),
    }))
    .filter((r) => r.states.length),
  ];
}

/**
 * States in which an entity's card is hidden: those of all rules that fit it.
 * @param {ReturnType<typeof hideRulesOf>} rules
 * @param {EntityContext} ctx
 * @returns {string[]}
 */
function hiddenStates(rules, ctx) {
  const states = new Set();
  for (const rule of rules) {
    if (rule.domains.length && !rule.domains.includes(ctx.domain)) continue;
    if (rule.deviceClasses.length && !rule.deviceClasses.includes(deviceClass(ctx))) continue;
    for (const st of rule.states) states.add(st);
  }
  return [...states];
}

/**
 * Visibility condition "shown while one of these entities is not in a hidden state";
 * undefined if one of them is never hidden. Evaluated live by Home Assistant, so cards
 * come back as soon as the state changes.
 * @param {ReturnType<typeof hideRulesOf>} rules
 * @param {EntityContext[]} list
 */
function shownWhile(rules, list) {
  if (!rules.length || !list.length) return undefined;
  const conditions = [];
  for (const ctx of list) {
    const states = hiddenStates(rules, ctx);
    if (!states.length) return undefined;
    conditions.push({ condition: "state", entity: ctx.entity_id, state_not: states });
  }
  return conditions.length === 1 ? conditions[0] : { condition: "or", conditions };
}

/**
 * Add the visibility condition to a card or section (kept with existing ones).
 * @param {Record<string, any> | null | undefined} target
 * @param {ReturnType<typeof hideRulesOf>} rules
 * @param {EntityContext[]} list the entities whose states decide
 */
function hideWhile(target, rules, list) {
  const condition = target ? shownWhile(rules, list) : undefined;
  if (!target || !condition) return target;
  return { ...target, visibility: [...asList(target.visibility), condition] };
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
  const configured = Array.isArray(override?.sections) ? override.sections.filter((s) => s && typeof s === "object") : [];
  /** @type {OverrideSection[]} own sections (entries with `default` stand for a standard category) */
  const ownList = configured.filter((s) => !s.default);
  const hasOverride = ownList.length > 0;
  const withDefaults = override?.show_default_sections === true;
  const highlight = createCardFactory(options.card_rules, "area");
  const other = createCardFactory(options.card_rules, "area_other");

  /** @type {Record<string, any>} */
  const report = { area: areaId, override: hasOverride, sections: [], hidden: [] };

  const stripNames = options.strip_area_names !== false;
  /** @param {string} key */
  const pageAction = (key) => {
    const path = summaryPage(hass, options.summary_pages, key, true);
    return path ? navigate(path) : undefined;
  };
  /**
   * @param {ReturnType<typeof createCardFactory>} factory
   * @param {EntityContext} ctx
   * @param {Record<string, any>} [extra]
   */
  const card = (factory, ctx, extra = {}) => {
    /** @type {Record<string, any>} */
    const base = { ...defaultEntityCard(ctx), ...extra };
    // The area is the context of the whole view: drop its name from the card name,
    // e.g. "Living room Ceiling light" → "Ceiling light"
    let shortName;
    if (stripNames && base.show_name !== false) {
      const shown = displayName(hass, ctx, base.name);
      const stripped = stripAreaName(shown, area);
      if (stripped !== shown) shortName = stripped;
    }
    const result = factory.entity(ctx, shortName ? { ...base, name: shortName } : base);
    if (!result) report.hidden.push(ctx.entity_id);
    // A replacement card from a rule gets the short name too, unless the rule sets one
    else if (shortName && result.name === undefined && result.entity === ctx.entity_id && result.show_name !== false) {
      result.name = shortName;
    }
    return result;
  };
  /** @param {(Record<string, any> | null | undefined)[]} cards */
  const compact = (cards) => /** @type {Record<string, any>[]} */ (cards.filter(Boolean));

  const all = areaEntities(hass, areaId);
  /** @type {Record<string, any>[]} */
  const sections = [];
  /** @type {Set<string>} entity ids already shown or intentionally consumed */
  const consumed = new Set();
  /** @type {Map<any, Record<string, any>[]>} built own sections, by their config entry */
  const ownBuilt = new Map();
  /** @type {Record<string, Record<string, any>>} built standard categories, by key */
  const categoryBuilt = {};

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
  // Own sections select first (explicit configuration wins), in their order; hidden ones
  // select nothing, so their entities appear with the remaining devices.
  for (const [index, section] of ownList.entries()) {
    if (section.hidden === true) continue;
    // A section without selection matches nothing (not everything), so an empty
    // section added in the editor does not swallow the whole area.
    const hasMatch =
      section.match != null &&
      !(Array.isArray(section.match) && section.match.length === 0) &&
      !(typeof section.match === "object" && !Array.isArray(section.match) && Object.keys(section.match).length === 0);
    const matched = hasMatch
      ? all.filter((ctx) => !consumed.has(ctx.entity_id) && matches(section.match, ctx))
      : [];
    // An entity belongs to the first section that shows it. Other entities of the same
    // device stay available for later sections and the remaining devices below, as in
    // the built-in area view (where the categories take single entities of a device).
    const shown = matched.filter(selectionFilter(section.entities));
    for (const ctx of shown) consumed.add(ctx.entity_id);
    const built = buildOverrideSection(hass, section, shown, highlight, card, compact, stripNames ? area : undefined, sectionTapAction(hass, section, shown, stripNames ? area : undefined));
    report.sections.push({
      title: section.title ?? `#${index + 1}`,
      layout: section.layout ?? "tiles",
      devices: [...new Set(shown.map((ctx) => (ctx.device ? deviceName(ctx.device) : ctx.entity_id)))],
      entities: shown.length,
    });
    ownBuilt.set(section, built);
  }

  // ------------------------------------------------------ standard categories
  // Shown without own sections (the default view) or with show_default_sections. They take
  // what the own sections left; a hidden one takes nothing.
  const showCategories = !hasOverride || withDefaults;
  if (showCategories) {
    // The first entry of a category counts, as for the order
    /** @type {Map<string, any>} */
    const firstEntry = new Map();
    for (const s of configured) if (s.default && !firstEntry.has(String(s.default))) firstEntry.set(String(s.default), s);
    const hiddenKeys = new Set(withDefaults ? [...firstEntry].filter(([, s]) => s.hidden === true).map(([key]) => key) : []);
    const free = all.filter((ctx) => !consumed.has(ctx.entity_id));
    const bySummary = Object.fromEntries(
      Object.entries(SUMMARY_FILTERS).map(([key, filters]) => [key, hiddenKeys.has(key) ? [] : findEntities(free, filters)])
    );
    for (const list of Object.values(bySummary)) for (const ctx of list) consumed.add(ctx.entity_id);

    const { light, climate, security, media_players: media } = bySummary;

    if (light.length) {
      // The buttons switch the lights of the section: the whole area, unless own sections
      // took some of its lights – then only the lights shown here
      const lightTarget = light.length === findEntities(all, SUMMARY_FILTERS.light).length
        ? { area_id: areaId }
        : { entity_id: light.map((ctx) => ctx.entity_id) };
      const anyOn = {
        condition: "or",
        conditions: light.map((ctx) => ({ condition: "state", entity: ctx.entity_id, state: "on" })),
      };
      categoryBuilt.light = {
        type: "grid",
        cards: [
          headingCard(t(hass, "light"), SUMMARY_ICONS.light, {
            tap_action: pageAction("light"),
            badges: [
              {
                type: "button", icon: "mdi:power", text: t(hass, "light_off"),
                tap_action: { action: "perform-action", perform_action: "light.turn_on", target: lightTarget },
                visibility: [{ condition: "not", conditions: [anyOn] }],
              },
              {
                type: "button", icon: "mdi:power", color: "orange", text: t(hass, "light_on"),
                tap_action: { action: "perform-action", perform_action: "light.turn_off", target: lightTarget },
                visibility: [anyOn],
              },
            ],
          }),
          ...compact(light.map((ctx) => card(highlight, ctx))),
        ],
      };
    }
    /** @type {[EntityContext[], string][]} */
    const simple = [
      [climate, "climate"],
      [security, "security"],
      [media, "media_players"],
    ];
    for (const [list, key] of simple) {
      if (!list.length) continue;
      categoryBuilt[key] = {
        type: "grid",
        cards: [
          headingCard(t(hass, key), SUMMARY_ICONS[key], { tap_action: pageAction(key) }),
          ...compact(list.map((ctx) => card(highlight, ctx))),
        ],
      };
    }

    const scenes = hiddenKeys.has("scenes") ? [] : free.filter(simpleFilter({ domain: "scene", entity_category: "none" }));
    for (const ctx of scenes) consumed.add(ctx.entity_id);
    if (scenes.length) {
      categoryBuilt.scenes = {
        type: "grid",
        cards: [
          headingCard(t(hass, "scenes"), SUMMARY_ICONS.scenes, {
            tap_action: hass.user?.is_admin ? navigate("/config/scene/dashboard") : undefined,
          }),
          ...compact(scenes.map((ctx) => card(highlight, ctx))),
        ],
      };
    }
  }

  // Display order: the configured list (standard categories it does not name come first),
  // or the standard categories followed by the own sections
  for (const entry of displayOrder(configured, ownList, showCategories, withDefaults)) {
    if (typeof entry === "string") {
      if (categoryBuilt[entry]) sections.push(categoryBuilt[entry]);
    } else sections.push(...(ownBuilt.get(entry) || []));
  }

  // ------------------------------------------------------ remaining devices
  // Automations an own section already shows are not repeated
  const automations = all.filter((ctx) => !consumed.has(ctx.entity_id)).filter(simpleFilter({ domain: "automation", entity_category: "none" }));
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

      const heading = device
        ? (stripNames ? stripAreaName(deviceName(device), area) : deviceName(device)) || t(hass, "unnamed_device")
        : t(hass, "others");
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
 * @param {any} [stripArea] area whose name is removed from device names (headings, titles, compact tiles)
 * @param {Record<string, any>} [tapAction] of the section title
 * @returns {Record<string, any>[]}
 */
function buildOverrideSection(hass, section, shown, factory, card, compact, stripArea, tapAction) {
  if (!shown.length) return [];
  const layout = section.layout ?? "tiles";
  const title = headingCard(section.title ?? "", section.icon, tapAction ? { tap_action: tapAction } : {});
  // "Hide while in state …": every card, and a heading or section with nothing left to show
  const rules = hideRulesOf(section.entities);
  /** @param {Record<string, any> | null | undefined} target @param {EntityContext[]} list */
  const hide = (target, list) => hideWhile(target, rules, list);

  if (layout === "tiles") {
    // only entities that have a card decide whether the section is shown
    const built = sortEntities(shown, section.sort).map((ctx) => /** @type {[EntityContext, any]} */ ([ctx, card(factory, ctx)])).filter(([, c]) => c);
    return [hide({ type: "grid", cards: [title, ...built.map(([ctx, c]) => hide(c, [ctx]))] }, built.map(([ctx]) => ctx))];
  }

  // Devices in the default order, the entities of each device in the section's order
  // (compact shows one entity per device: its choice must not depend on the order)
  const groups = [...groupByDevice(shown)].map(([id, list]) =>
    /** @type {[string, EntityContext[]]} */ ([id, layout === "compact" ? list : sortEntities(list, section.sort)]));

  if (layout === "devices") {
    /** @type {EntityContext[]} entities that have a card: they decide whether the title is shown */
    const deciding = [];
    const blocks = groups.flatMap(([deviceId, entities]) => {
      const device = deviceId ? hass.devices?.[deviceId] : undefined;
      const custom = device ? factory.device(device, entities) : undefined;
      if (custom === null) return [];
      const built = custom
        ? [/** @type {[EntityContext[], any]} */ ([entities, custom])]
        : entities.map((ctx) => /** @type {[EntityContext[], any]} */ ([[ctx], card(factory, ctx, { name: { type: "entity" } })])).filter(([, c]) => c);
      if (!built.length) return [];
      const own = built.flatMap(([list]) => list);
      deciding.push(...own);
      return [hide({
        type: "grid",
        cards: [
          headingCard(device ? stripAreaName(deviceName(device), stripArea) || t(hass, "unnamed_device") : t(hass, "others"), undefined, {
            heading_style: "subtitle",
            tap_action: deviceTapAction(hass, device),
          }),
          ...built.map(([list, c]) => hide(c, list)),
        ],
      }, own)];
    });
    return [hide({ type: "grid", column_span: 3, cards: [{ ...title, heading_style: "title" }] }, deciding), ...blocks];
  }

  if (layout === "table") {
    const cards = groups.map(([deviceId, entities]) => {
      const device = deviceId ? hass.devices?.[deviceId] : undefined;
      const custom = device ? factory.device(device, entities) : undefined;
      if (custom !== undefined) return hide(custom, entities);
      return hide({
        type: "entities",
        title: device ? stripAreaName(deviceName(device), stripArea) || t(hass, "unnamed_device") : t(hass, "others"),
        // The card's title names the device: rows without area and device name
        entities: entities.map((ctx) => {
          const full = displayName(hass, ctx);
          const name = tableRowName(hass, ctx, full, device, stripArea);
          const row = name === full ? ctx.entity_id : { entity: ctx.entity_id, name };
          // a row of a hidden state disappears, the others stay
          const condition = shownWhile(rules, [ctx]);
          return condition ? { type: "conditional", conditions: [condition], row: typeof row === "string" ? { entity: row } : row } : row;
        }),
      }, entities);
    });
    return [hide({ type: "grid", cards: [title, ...compact(cards)] }, shown)];
  }

  // compact: one card per device, showing its primary entity
  /** @type {EntityContext[]} the entities whose states decide whether the cards are shown */
  const deciding = [];
  const cards = groups.flatMap(([deviceId, entities]) => {
    const device = deviceId ? hass.devices?.[deviceId] : undefined;
    if (!device) {
      const built = entities.map((ctx) => /** @type {[EntityContext, any]} */ ([ctx, card(factory, ctx)])).filter(([, c]) => c);
      deciding.push(...built.map(([ctx]) => ctx));
      return built.map(([ctx, c]) => hide(c, [ctx]));
    }
    const custom = factory.device(device, entities);
    if (custom !== undefined) {
      if (custom) deciding.push(...entities);
      return [hide(custom, entities)];
    }
    const primary = primaryEntity(entities, section.primary);
    if (!primary) return [];
    const tile = card(factory, primary, {
      name: stripAreaName(deviceName(device), stripArea) || t(hass, "unnamed_device"),
      ...(hass.user?.is_admin ? { tap_action: navigate(`/config/devices/device/${device.id}`) } : {}),
    });
    if (!tile) return [];
    deciding.push(primary);
    return [hide(tile, [primary])];
  });
  // the section disappears when none of its cards is left
  return [hide({ type: "grid", cards: [title, ...compact(cards)] }, deciding)];
}
