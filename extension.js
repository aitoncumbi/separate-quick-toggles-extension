"use strict";

import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import CompactIndicator from "./ui/compact-indicator.js";
import { createIndicator } from "./ui/indicators.js";
import Pocket from "./ui/pocket.js";

// ─── Main Extension ────────────────────────────────────────────────────────

export default class SeparateQuickToggles extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._indicators = {};
    this._connections = [];
    this._sqtPatched = false;
    this._pocket = new Pocket(this._settings);

    this._build();

    const rebuildKeys = [
      "indicator-order",
      "show-wifi",
      "show-bluetooth",
      "show-sound",
      "show-battery",
      "show-notification",
      "compact-mode",
    ];
    for (const key of rebuildKeys)
      this._connections.push(
        this._settings.connect(`changed::${key}`, () => this._build())
      );

    this._connections.push(
      this._settings.connect("changed::show-battery-percentage", () => {
        if (this._indicators.battery)
          this._indicators.battery.showPercentage = this._settings.get_boolean(
            "show-battery-percentage"
          );
      })
    );
  }

  disable() {
    this._destroy();
    this._pocket?.destroy();
    this._pocket = null;
    for (const conn of this._connections) {
      this._settings.disconnect(conn);
    }
    this._connections = [];
    this._settings = null;
    this._indicators = {};
  }

  _build() {
    this._destroy();

    // In compact mode, we only add one button
    if (this._settings.get_boolean("compact-mode")) {
      this._compactIndicator = new CompactIndicator(this._settings);
      Main.panel.addToStatusArea(
        "sqt-compact-indicator",
        this._compactIndicator
      );
      this._patchQuickSettings();
      return;
    }

    // Otherwise, add individual indicators in the user-defined order
    const order = this._settings.get_strv("indicator-order");
    for (const id of order) {
      if (!this._settings.get_boolean(`show-${id}`)) continue;
      const indicator = this._createIndicator(id);
      if (indicator) {
        this._indicators[id] = indicator;
        Main.panel.addToStatusArea(`sqt-${id}-indicator`, indicator);
      }
    }

    this._patchQuickSettings();
  }

  _destroy() {
    for (const id in this._indicators) {
      this._indicators[id].destroy();
      delete this._indicators[id];
    }
    if (this._compactIndicator) {
      this._compactIndicator.destroy();
      this._compactIndicator = null;
    }
    this._unpatchQuickSettings();
  }

  _createIndicator(id) {
    return createIndicator(id, this._settings, this._pocket);
  }

  _patchQuickSettings() {
    const qs = Main.panel.statusArea.quickSettings;
    if (!qs) return;
    const button = qs.actor ?? qs;
    if (!button) return;

    // Store original indicator visibility state
    if (qs._indicators) {
      this._sqtOriginalIndicatorsVisible = !qs._indicators.hidden;
      qs._indicators.hide();
    }

    // Store and remove existing children
    this._sqtOriginalChildren = [];
    let child = button.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._sqtOriginalChildren.push(child);
      button.remove_child(child);
      child = next;
    }

    // Create and add a single gear icon
    if (!this._sqtCustomIcon) {
      this._sqtCustomIcon = new St.Icon({
        icon_name: "emblem-system-symbolic",
        style_class: "system-status-icon",
        icon_size: 16,
      });
      button.add_child(this._sqtCustomIcon);
    }

    button.add_style_class_name("quick-settings-button");
    this._sqtPatched = true;
  }

  _unpatchQuickSettings() {
    const qs = Main.panel.statusArea.quickSettings;
    if (qs && this._sqtPatched) {
      const button = qs.actor ?? qs;
      if (button) {
        button.remove_style_class_name("quick-settings-button");
      }

      // Remove custom icon
      if (this._sqtCustomIcon) {
        button.remove_child(this._sqtCustomIcon);
        this._sqtCustomIcon.destroy();
        this._sqtCustomIcon = null;
      }

      // Restore original children
      if (this._sqtOriginalChildren && this._sqtOriginalChildren.length > 0) {
        for (const child of this._sqtOriginalChildren) {
          button.add_child(child);
        }
        this._sqtOriginalChildren = [];
      }

      // Restore original indicators visibility
      if (qs._indicators && this._sqtOriginalIndicatorsVisible) {
        qs._indicators.show();
      }

      this._sqtPatched = false;
    }
  }
}
