"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { makeProxy, openControlCenter } from "../lib/utils.js";

const BatteryIndicator = GObject.registerClass(
  class BatteryIndicator extends PanelMenu.Button {
    _init(showPct, pocket = null) {
      super._init(0.0, _("Battery"));
      this._pocket = pocket;
      this._signalIds = [];
      this._icon = new St.Icon({
        icon_name: "battery-good-symbolic",
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);
      this._pctLabel = new St.Label({
        text: "",
        y_align: Clutter.ActorAlign.CENTER,
        visible: showPct,
      });
      this._pctLabel.set_style("margin-left: 3px;");
      this.add_child(this._pctLabel);

      this._proxy = makeProxy(
        Gio.DBus.system,
        "org.freedesktop.UPower",
        "/org/freedesktop/UPower/devices/DisplayDevice",
        "org.freedesktop.UPower.Device"
      );
      if (this._proxy) {
        this._proxySignalId = this._proxy.connect("g-properties-changed", () =>
          this._update()
        );
        this._update();
      }
      if (this._pocket) {
        this._signalIds.push(
          this.connect("enter-event", () => {
            this._pocket.cancelHide();
            this._pocket.show(
              this,
              _("Battery"),
              this._getPocketValue(),
              "#facc15"
            );
          })
        );
        this._signalIds.push(
          this.connect("leave-event", () => {
            this._pocket.hide();
          })
        );
      }
      this._buildMenu();
    }

    set showPercentage(v) {
      this._pctLabel.visible = v;
    }

    _update() {
      try {
        const pct = Math.round(
          this._proxy.get_cached_property("Percentage")?.unpack() ?? 0
        );
        const state = this._proxy.get_cached_property("State")?.unpack() ?? 0;
        const charging = state === 1;
        this._pctLabel.text = `${pct}%`;
        if (charging)
          this._icon.icon_name =
            pct > 90
              ? "battery-full-charging-symbolic"
              : "battery-good-charging-symbolic";
        else if (pct <= 10) this._icon.icon_name = "battery-caution-symbolic";
        else if (pct <= 25) this._icon.icon_name = "battery-low-symbolic";
        else if (pct <= 60) this._icon.icon_name = "battery-good-symbolic";
        else this._icon.icon_name = "battery-full-symbolic";
        this._updateMenuContent(pct, charging, state);
      } catch (_e) {}
    }

    _buildMenu() {
      const header = new PopupMenu.PopupMenuItem(_("Battery"), {
        reactive: false,
      });
      header.label.style = "font-weight: bold; font-size: 1.05em;";
      this.menu.addMenuItem(header);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this._statusItem = new PopupMenu.PopupMenuItem("", { reactive: false });
      this.menu.addMenuItem(this._statusItem);
      this._timeItem = new PopupMenu.PopupMenuItem("", { reactive: false });
      this._timeItem.label.style = "opacity: 0.65;";
      this.menu.addMenuItem(this._timeItem);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const s = new PopupMenu.PopupMenuItem(_("Power Settings…"));
      s.connect("activate", () => openControlCenter("power"));
      this.menu.addMenuItem(s);
      this.menu.connect("open-state-changed", (_m, open) => {
        if (open) this._update();
      });
    }

    _updateMenuContent(pct, charging, state) {
      if (!this._statusItem) return;
      const stateStr =
        { 1: _("Charging"), 2: _("Discharging"), 4: _("Fully charged") }[
          state
        ] ?? _("Unknown");
      this._statusItem.label.text = `${pct}%  —  ${stateStr}`;
      try {
        const secs =
          (charging
            ? this._proxy.get_cached_property("TimeToFull")
            : this._proxy.get_cached_property("TimeToEmpty")
          )?.unpack() ?? 0;
        if (secs > 0) {
          const h = Math.floor(secs / 3600);
          const m = Math.floor((secs % 3600) / 60);
          const suffix = charging ? _("until full") : _("remaining");
          this._timeItem.label.text =
            h > 0 ? `${h}h ${m}m ${suffix}` : `${m}m ${suffix}`;
        } else {
          this._timeItem.label.text = "";
        }
      } catch (_e) {
        this._timeItem.label.text = "";
      }
    }

    _getPocketValue() {
      try {
        const pct = Math.round(
          this._proxy?.get_cached_property("Percentage")?.unpack() ?? 0
        );
        const state = this._proxy?.get_cached_property("State")?.unpack() ?? 0;
        const charging = state === 1;

        if (charging) return `${pct}% · ${_("Charging")}`;

        const timeToEmpty =
          this._proxy?.get_cached_property("TimeToEmpty")?.unpack() ?? 0;
        if (timeToEmpty > 0) {
          const h = Math.floor(timeToEmpty / 3600);
          const m = Math.floor((timeToEmpty % 3600) / 60);
          if (h > 0) return `${pct}% · ${h}h ${m}m ${_("left")}`;
          return `${pct}% · ${m}m ${_("left")}`;
        }

        if (state === 4) return `${pct}% · ${_("Full")}`;
        return `${pct}%`;
      } catch (_e) {
        return _("Battery status unavailable");
      }
    }

    destroy() {
      for (const id of this._signalIds) {
        if (id) this.disconnect(id);
      }
      this._signalIds = [];
      if (this._proxy && this._proxySignalId) {
        this._proxy.disconnect(this._proxySignalId);
        this._proxySignalId = 0;
      }
      this._proxy = null;
      this._pocket = null;
      super.destroy();
    }
  }
);

export default BatteryIndicator;
