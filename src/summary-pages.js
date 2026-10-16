// @ts-check
/**
 * Pages the summaries lead to: the summary tiles on the overview page and the
 * category headings of an area view (Lights, Climate, Security, Media players).
 *
 * By default these are Home Assistant's own pages (/light, /climate, /security,
 * /maintenance, /energy) and the media players view of Overview Plus. With
 * `summary_pages` each one can lead to a dashboard of your own instead:
 *
 *   summary_pages:
 *     light: /lights-plus/overview
 *     security: /dashboard-security
 */

/** Summaries whose page can be chosen. */
export const SUMMARY_PAGE_KEYS = ["light", "climate", "security", "media_players", "maintenance", "energy"];

/**
 * Built-in page of a summary, or undefined when Home Assistant does not have it.
 * @param {any} hass
 * @param {string} key
 * @param {boolean} [inArea] from an area view (media players view is a sibling subview)
 */
export function defaultSummaryPage(hass, key, inArea = false) {
  if (key === "media_players") return inArea ? "media-players?historyBack=1" : "media-players";
  return hass.panels?.[key] ? `/${key}?historyBack=1` : undefined;
}

/**
 * Page a summary leads to: the configured one, otherwise the built-in one.
 * @param {any} hass
 * @param {Record<string, string> | undefined} pages `summary_pages` of the config
 * @param {string} key
 * @param {boolean} [inArea]
 * @returns {string | undefined}
 */
export function summaryPage(hass, pages, key, inArea = false) {
  const own = pages?.[key];
  if (typeof own === "string" && own.trim()) return own.trim();
  return defaultSummaryPage(hass, key, inArea);
}

/**
 * Whether a summary has a page of its own configured (then Home Assistant's page is not needed).
 * @param {Record<string, string> | undefined} pages
 * @param {string} key
 */
export const hasOwnSummaryPage = (pages, key) => typeof pages?.[key] === "string" && !!pages[key].trim();
