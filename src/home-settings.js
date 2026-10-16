// @ts-check
/**
 * Settings of the overview page: welcome message, favorites, suggested entities,
 * summaries and shortcuts, alert entities.
 *
 * They come either from the built-in Overview (frontend system data "home" and
 * "security", the same storage Home Assistant's "Edit Overview page" dialog writes) or
 * from the Overview Plus config itself (`load_home_settings: false`). Keys and shapes are
 * the same in both places, see home-assistant/frontend src/data/frontend.ts and
 * src/data/home_shortcuts.ts.
 */

/** Keys of the overview page settings in the strategy config. */
export const HOME_KEYS = ["favorite_entities", "hide_welcome_message", "hide_suggested_entities", "shortcuts", "alert_entities"];

/** Built-in summaries in their default order (home_shortcuts.ts DEFAULT_SUMMARY_KEYS). */
export const DEFAULT_SUMMARY_KEYS = ["light", "climate", "security", "media_players", "maintenance", "weather", "energy"];

/** Icons of the summaries, as in Home Assistant's "Edit Overview page" dialog. */
export const SUMMARY_KEY_ICONS = {
  light: "mdi:lamps",
  climate: "mdi:home-thermometer",
  security: "mdi:security",
  media_players: "mdi:multimedia",
  maintenance: "mdi:wrench",
  weather: "mdi:weather-partly-cloudy",
  energy: "mdi:lightning-bolt",
};

/**
 * Built-in summary keys missing from the saved list are appended in default order;
 * unknown and duplicate summary keys are dropped.
 * Mirrors resolveShortcutItems in home-assistant/frontend src/data/home_shortcuts.ts.
 * @param {any[] | undefined} saved
 */
export function resolveShortcutItems(saved) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(saved) ? saved : []) {
    if (item?.type === "summary") {
      if (!DEFAULT_SUMMARY_KEYS.includes(item.key) || seen.has(item.key)) continue;
      seen.add(item.key);
    }
    result.push(item);
  }
  for (const key of DEFAULT_SUMMARY_KEYS) if (!seen.has(key)) result.push({ type: "summary", key });
  return result;
}

/**
 * Settings of the built-in Overview, as Home Assistant's home panel loads them.
 * @param {any} hass
 * @returns {Promise<Record<string, any>>} only the keys that are set
 */
export async function loadHomeSettings(hass) {
  /** @param {string} key */
  const get = async (key) => {
    try {
      const res = await hass.callWS({ type: "frontend/get_system_data", key });
      return res?.value ?? {};
    } catch (err) {
      console.warn(`[overview-plus] System data "${key}" not readable.`, err);
      return {};
    }
  };
  const [home, security] = await Promise.all([get("home"), get("security")]);
  const settings = {
    alert_entities: security.alert_entities,
    favorite_entities: home.favorite_entities,
    hide_welcome_message: home.hide_welcome_message,
    hide_suggested_entities: home.hide_suggested_entities,
    shortcuts: home.shortcuts,
  };
  return Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
}
