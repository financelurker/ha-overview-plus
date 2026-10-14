// @ts-check
/**
 * User-facing strings. Where the Home Assistant frontend already has a translation,
 * its key is used via hass.localize; the local dictionary is the fallback.
 */

/** @type {Record<string, Record<string, string>>} */
const STRINGS = {
  en: {
    dashboard_title: "Overview Plus",
    light: "Lights",
    light_on: "On",
    light_off: "Off",
    climate: "Climate",
    security: "Security",
    media_players: "Media players",
    scenes: "Scenes",
    automations: "Automations",
    devices: "Devices",
    others: "Others",
    unnamed_device: "Unnamed device",
    no_devices_title: "This is a blank canvas",
    no_devices_content: "Add your smart lights, switches, or sensors to this area to get started.",
    error_title: "Overview Plus could not build this view",
    unknown_area: "Unknown area: {area}",
  },
  de: {
    dashboard_title: "Overview Plus",
    light: "Licht",
    light_on: "An",
    light_off: "Aus",
    climate: "Klima",
    security: "Sicherheit",
    media_players: "Medienplayer",
    scenes: "Szenen",
    automations: "Automationen",
    devices: "Geräte",
    others: "Sonstige",
    unnamed_device: "Unbenanntes Gerät",
    no_devices_title: "Hier ist noch nichts",
    no_devices_content: "Füge diesem Bereich Lichter, Schalter oder Sensoren hinzu.",
    error_title: "Overview Plus konnte diese Ansicht nicht erstellen",
    unknown_area: "Unbekannter Bereich: {area}",
  },
};

/** Translation keys of the HA frontend for strings it already provides. */
const HA_KEYS = {
  light: "panel.light",
  light_on: "ui.panel.lovelace.strategy.light.on",
  light_off: "ui.panel.lovelace.strategy.light.off",
  climate: "panel.climate",
  security: "panel.security",
  media_players: "ui.panel.lovelace.strategy.home.summary_list.media_players",
  scenes: "ui.panel.lovelace.strategy.home.scenes",
  automations: "ui.panel.lovelace.strategy.home.automations",
  devices: "ui.panel.lovelace.strategy.home.devices",
  others: "ui.panel.lovelace.strategy.home.others",
  unnamed_device: "ui.panel.lovelace.strategy.home.unnamed_device",
  no_devices_title: "ui.panel.lovelace.strategy.home-area.no_devices_title",
  no_devices_content: "ui.panel.lovelace.strategy.home-area.no_devices_content",
};

/**
 * @param {any} hass
 * @param {string} key
 * @param {Record<string, string>} [params]
 */
export function t(hass, key, params = {}) {
  const haKey = HA_KEYS[key];
  let text = haKey && typeof hass?.localize === "function" ? hass.localize(haKey) : "";
  if (!text) {
    const lang = String(hass?.locale?.language || hass?.language || "en").split("-")[0];
    text = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  }
  return text.replace(/\{(\w+)\}/g, (_, p) => params[p] ?? "");
}
