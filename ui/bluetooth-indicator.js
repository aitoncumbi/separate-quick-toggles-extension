"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { makeProxy, openControlCenter, spawnAsync, spawnSync } from "../lib/utils.js";

const BluetoothIndicator = GObject.registerClass(
  class BluetoothIndicator extends PanelMenu.Button {
    _init(pocket = null) {
      super._init(0.0, _("Bluetooth"));
      this._pocket = pocket;
      this._signalIds = [];
      this._icon = new St.Icon({
        icon_name: "bluetooth-active-symbolic",
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);

      this._proxy = makeProxy(
        Gio.DBus.system,
        "org.bluez",
        "/org/bluez/hci0",
        "org.bluez.Adapter1"
      );
      if (this._proxy) {
        this._proxySignalId = this._proxy.connect("g-properties-changed", () =>
          this._updateIcon()
        );
        this._updateIcon();
      }
      if (this._pocket) {
        this._signalIds.push(
          this.connect("enter-event", () => {
            this._pocket.cancelHide();
            this._pocket.show(
              this,
              _("Bluetooth"),
              this._getPocketValue(),
              "#60a5fa"
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

    _getPocketValue() {
      const on = this._proxy?.get_cached_property("Powered")?.unpack() ?? false;
      if (!on) return _("Off");

      const out = spawnSync(["bluetoothctl", "devices", "Connected"]);
      if (!out) return _("On · No connected devices");

      const cleanOut = this._stripAnsi(out);
      const line = cleanOut
        .trim()
        .split("\n")
        .find((entry) => entry.startsWith("Device "));
      if (!line) return _("On · No connected devices");

      const match = line.match(/^Device\s+([\w:]+)\s+(.+)$/);
      if (!match) return _("On");

      const [, mac, name] = match;
      const info = this._stripAnsi(
        spawnSync(["bluetoothctl", "info", mac]) ?? ""
      );
      const batteryMatch = info.match(
        /Battery Percentage:\s*(?:0x[0-9a-f]+\s*)?\(?\s*(\d{1,3})\s*(?:%|\))?/i
      );
      if (batteryMatch) return `${name} · ${batteryMatch[1]}%`;
      return name;
    }

    _stripAnsi(text) {
      return text.replace(/\x1b\[[0-9;]*m/g, "");
    }

    _updateIcon() {
      const on = this._proxy?.get_cached_property("Powered")?.unpack() ?? false;
      this._icon.icon_name = on
        ? "bluetooth-active-symbolic"
        : "bluetooth-disabled-symbolic";
    }

    _buildMenu() {
      const headerRow = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
      });
      headerRow.set_style("padding: 4px 12px;");
      const headerBox = new St.BoxLayout({ x_expand: true });
      headerBox.add_child(
        new St.Label({
          text: _("Bluetooth"),
          y_align: Clutter.ActorAlign.CENTER,
          x_expand: true,
        })
      );
      const btLabel = headerBox.get_last_child();
      if (btLabel) btLabel.set_style("font-weight: bold; font-size: 1.05em;");

      this._btSwitch = new St.Button({
        style_class: "toggle-switch",
        toggle_mode: true,
        checked: false,
      });
      this._btSwitch.set_style("margin-right: 8px;");
      this._btSwitch.connect("clicked", () => {
        this._setBt(this._btSwitch.checked);
      });
      headerBox.add_child(this._btSwitch);

      const refreshBtn = new St.Button({
        style_class: "icon-button",
        child: new St.Icon({
          icon_name: "view-refresh-symbolic",
          icon_size: 14,
        }),
      });
      refreshBtn.set_style("padding: 4px;");
      refreshBtn.connect("clicked", () => {
        refreshBtn.reactive = false;
        this._listDevices();
        refreshBtn.reactive = true;
      });
      headerBox.add_child(refreshBtn);
      headerRow.add_child(headerBox);
      this.menu.addMenuItem(headerRow);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._devSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._devSection);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const s = new PopupMenu.PopupMenuItem(_("Bluetooth Settings…"));
      s.connect("activate", () => openControlCenter("bluetooth"));
      this.menu.addMenuItem(s);

      this.menu.connect("open-state-changed", (_m, open) => {
        if (open) this._refresh();
      });
    }

    _refresh() {
      const on = this._proxy?.get_cached_property("Powered")?.unpack() ?? false;
      this._btSwitch.checked = on;
      this._listDevices();
    }

    _setBt(enabled) {
      try {
        this._proxy?.call(
          "org.freedesktop.DBus.Properties.Set",
          new GLib.Variant("(ssv)", [
            "org.bluez.Adapter1",
            "Powered",
            new GLib.Variant("b", enabled),
          ]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          null
        );
      } catch (_e) {}
    }

    _listDevices() {
      this._devSection.removeAll();
      const out = spawnSync(["bluetoothctl", "devices"]);
      let count = 0;
      if (out) {
        for (const line of out.trim().split("\n")) {
          const m = line.match(/^Device\s+([\w:]+)\s+(.+)$/);
          if (!m) continue;
          const mac = m[1].trim();
          const name = m[2].trim();
          if (!name || !mac) continue;
          const item = new PopupMenu.PopupBaseMenuItem();
          item.add_child(
            new St.Icon({
              icon_name: "bluetooth-active-symbolic",
              style_class: "popup-menu-icon",
            })
          );
          item.add_child(
            new St.Label({
              text: name,
              y_align: Clutter.ActorAlign.CENTER,
              x_expand: true,
            })
          );
          item.connect("activate", () =>
            spawnAsync(["bluetoothctl", "connect", mac])
          );
          this._devSection.addMenuItem(item);
          count++;
        }
      }
      if (count === 0)
        this._devSection.addMenuItem(
          new PopupMenu.PopupMenuItem(_("No paired devices"), {
            reactive: false,
          })
        );
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

export default BluetoothIndicator;
