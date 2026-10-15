// @ts-check
/**
 * Card factory: every card Overview Plus generates for an entity or device goes
 * through here, so user rules (`card_rules`) apply before the card is ever rendered.
 *
 * Rule format:
 *   - match: <match spec>             # see matcher.js; omitted = all entities
 *     contexts: [area, area_other]    # optional, where the rule applies
 *     scope: entity | device          # default: entity
 *     card: { ... } | false           # card config, partial config, or false = hide
 *     tap: { popup: { ... } }         # optional, card shown in a popup instead of more-info
 *     stop: true                      # optional, do not evaluate later rules
 *
 * Entity scope: all matching rules are applied in order.
 *   - `card` with a `type` different from the current card replaces the card.
 *   - `card` without `type` (or with the same type) is merged into the current card.
 *   - `card: false` hides the entity (a later rule with a `type` can bring it back).
 *   - `entity` is set automatically unless the card uses the `$entity` placeholder.
 *
 * Device scope: the first matching rule turns all entities of a device into ONE card.
 *   Placeholders: `$device` (device id), `$entities` (list of entity ids), `$area`.
 *
 * Tap: the popup of the last matching rule is stored on the card config under
 *   `overview_plus.popup` (see popup.js); `tap: false` removes an earlier popup.
 *   `$device`, `$area` and `$entities` are replaced here, `$entity` when the popup opens.
 *   A rule with `tap` may leave out `card` – the card stays as it is.
 *
 * Contexts: `favorites`, `area` (highlighted sections of an area view),
 * `area_other` (remaining devices of an area view), `media`, `devices`.
 */

import { matches } from "./matcher.js";

/** Key on the generated card config that carries the popup (see popup.js). */
export const POPUP_KEY = "overview_plus";

/** @typedef {import("./registry.js").EntityContext} EntityContext */

/**
 * @typedef {Object} CardRule
 * @property {any} [match]
 * @property {string[]} [contexts]
 * @property {"entity" | "device"} [scope]
 * @property {Record<string, any> | false} [card]
 * @property {{ popup?: Record<string, any> } | false} [tap]
 * @property {boolean} [stop]
 */

/**
 * @param {any} value
 * @param {Record<string, any>} vars
 * @returns {any}
 */
export function substitute(value, vars) {
  if (typeof value === "string") {
    if (value === "$entities") return vars.entities ?? [];
    return value.replace(/\$(entity|device|area)\b/g, (m, name) => vars[name] ?? m);
  }
  if (Array.isArray(value)) {
    return value.flatMap((v) => (v === "$entities" ? vars.entities ?? [] : [substitute(v, vars)]));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, vars)]));
  }
  return value;
}

/** @param {any} value @returns {boolean} */
const usesPlaceholder = (value) =>
  typeof value === "string"
    ? /\$entity\b/.test(value)
    : Array.isArray(value)
      ? value.some(usesPlaceholder)
      : !!value && typeof value === "object" && Object.values(value).some(usesPlaceholder);

/**
 * @param {any} rule
 * @param {number} index
 * @returns {rule is CardRule}
 */
function validRule(rule, index) {
  const isObject = (/** @type {any} */ v) => !!v && typeof v === "object" && !Array.isArray(v);
  if (!isObject(rule)) {
    console.warn(`[overview-plus] card_rules[${index}] ignored: not an object.`, rule);
    return false;
  }
  const tapOk = rule.tap === undefined || rule.tap === false || (isObject(rule.tap) && (rule.tap.popup === undefined || popupOk(rule.tap.popup)));
  if (!tapOk) {
    console.warn(`[overview-plus] card_rules[${index}] ignored: "tap.popup" must be a card with a type.`, rule);
    return false;
  }
  const cardOk = rule.card === false || isObject(rule.card) || (rule.card === undefined && rule.tap !== undefined);
  if (!cardOk) console.warn(`[overview-plus] card_rules[${index}] ignored: "card" must be an object or false.`, rule);
  return cardOk;
}

/** @param {any} popup */
const popupOk = (popup) => !!popup && typeof popup === "object" && typeof popup.type === "string" && !!popup.type;

/**
 * Popup of the last matching rule: undefined = no rule says anything, null = removed.
 * @param {CardRule} rule
 * @param {Record<string, any> | null | undefined} current
 */
function nextPopup(rule, current) {
  if (rule.tap === false) return null;
  if (rule.tap?.popup) return rule.tap.popup;
  return current;
}

/**
 * Store the popup on a card config. `$entity` is left for the time the popup opens.
 * @param {Record<string, any>} card
 * @param {Record<string, any> | null | undefined} popup
 * @param {Record<string, any>} vars
 */
function withPopup(card, popup, vars) {
  if (!popup) return card;
  return { ...card, [POPUP_KEY]: { popup: substitute(popup, { ...vars, entity: undefined }) } };
}

/**
 * @param {CardRule[] | undefined} rules
 * @param {string} context
 */
export function createCardFactory(rules, context) {
  const active = (Array.isArray(rules) ? rules : [])
    .filter(validRule)
    .filter((r) => !r.contexts || r.contexts.includes(context));
  const entityRules = active.filter((r) => (r.scope ?? "entity") === "entity");
  const deviceRules = active.filter((r) => r.scope === "device");

  return {
    /**
     * @param {EntityContext} ctx
     * @param {Record<string, any>} defaultCard
     * @returns {Record<string, any> | null} null = hidden
     */
    entity(ctx, defaultCard) {
      /** @type {Record<string, any> | null} */
      let card = defaultCard;
      /** @type {Record<string, any> | null | undefined} */
      let popup;
      for (const rule of entityRules) {
        if (!matches(rule.match, ctx)) continue;
        popup = nextPopup(rule, popup);
        if (rule.card === undefined) {
          // tap only: the card stays
        } else if (rule.card === false) {
          card = null;
        } else if (rule.card.type && rule.card.type !== card?.type) {
          card = { ...rule.card };
        } else if (card) {
          card = { ...card, ...rule.card };
        }
        if (rule.stop) break;
      }
      if (!card) return null;
      const vars = { entity: ctx.entity_id, device: ctx.device?.id, area: ctx.area?.area_id };
      const placeholder = usesPlaceholder(card);
      card = substitute(card, vars);
      if (!placeholder && card.entity === undefined) card.entity = ctx.entity_id;
      return withPopup(card, popup, vars);
    },

    /**
     * @param {any} device
     * @param {EntityContext[]} entities entities of the device to show
     * @returns {Record<string, any> | null | undefined} undefined = no device rule, null = hidden
     */
    device(device, entities) {
      for (const rule of deviceRules) {
        if (!entities.some((ctx) => matches(rule.match, ctx))) continue;
        if (rule.card === false) return null;
        if (!rule.card?.type) {
          console.warn("[overview-plus] card_rules: a rule with scope: device needs a card type – ignored.", rule);
          continue;
        }
        const vars = {
          device: device?.id,
          area: entities[0]?.area?.area_id,
          entities: entities.map((ctx) => ctx.entity_id),
        };
        return withPopup(substitute(rule.card, vars), nextPopup(rule, undefined), vars);
      }
      return undefined;
    },
  };
}
