// @ts-check
/**
 * overview-plus – configurable Overview dashboard strategy for Home Assistant.
 *
 * Usage (dashboard YAML):
 *   strategy:
 *     type: custom:overview-plus
 *
 * This is the scaffold. The generators (overview, area views, media, devices),
 * the matcher and the card factory follow in subsequent pull requests.
 */

export const VERSION = "0.0.0";

const LOG_PREFIX = "[overview-plus]";

class OverviewPlusDashboardStrategy {
  /**
   * @param {Record<string, any>} _config strategy config from the dashboard YAML
   * @param {any} _hass Home Assistant object
   */
  static async generate(_config, _hass) {
    return {
      views: [
        {
          title: "Overview Plus",
          path: "overview",
          cards: [
            {
              type: "markdown",
              content: `**overview-plus ${VERSION}** is installed. Dashboard generation is not implemented yet.`,
            },
          ],
        },
      ],
    };
  }
}

const TAG = "ll-strategy-dashboard-overview-plus";
if (!customElements.get(TAG)) {
  customElements.define(TAG, /** @type {any} */ (OverviewPlusDashboardStrategy));
  console.info(`${LOG_PREFIX} ${VERSION} loaded`);
}
