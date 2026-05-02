"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import {
  makeProxy,
  makeRefreshRow,
  openControlCenter,
  spawnAsync,
  spawnSync,
  wifiSignalIcon,
} from "../lib/utils.js";
import VolumeSliderItem from "../lib/volume-slider.js";

const CompactIndicator = GObject.registerClass(
  class CompactIndicator extends PanelMenu.Button {
    _init(settings) {
      super._init(0.0, _("Quick Settings"));
      this._settings = settings;

      this._icon = new St.Icon({
        icon_name: "open-menu-symbolic",
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);

      this._nmProxy = makeProxy(
        Gio.DBus.system,
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager"
      );
      this._btProxy = makeProxy(
        Gio.DBus.system,
        "org.bluez",
        "/org/bluez/hci0",
        "org.bluez.Adapter1"
      );
      this._upProxy = makeProxy(
        Gio.DBus.system,
        "org.freedesktop.UPower",
        "/org/freedesktop/UPower/devices/DisplayDevice",
        "org.freedesktop.UPower.Device"
      );

      this._volume = 1.0;
      this._muted = false;

      this._buildMenu();
      this.menu.connect("open-state-changed", (_m, open) => {
        if (open) this._refreshAll();
      });
    }

    _buildMenu() {
      const wifiHeader = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
      });
      wifiHeader.set_style("padding: 4px 16px 0;");
      const wifiHeaderBox = new St.BoxLayout({ x_expand: true });
      wifiHeaderBox.add_child(
        new St.Icon({
          icon_name: "network-wireless-signal-excellent-symbolic",
          style_class: "popup-menu-icon",
        })
      );
      const wifiIcon = wifiHeaderBox.get_last_child();
      if (wifiIcon) wifiIcon.set_style("margin-right: 8px;");
      wifiHeaderBox.add_child(
        new St.Label({
          text: _("Wi-Fi"),
          y_align: Clutter.ActorAlign.CENTER,
        })
      );
      const wifiLabel = wifiHeaderBox.get_last_child();
      if (wifiLabel)
        wifiLabel.set_style("font-weight: bold; font-size: 1.05em; flex: 1;");
      this._wifiSwitch = new St.Button({
        style_class: "toggle-switch",
        toggle_mode: true,
        checked: false,
      });
      this._wifiSwitch.connect("clicked", () => {
        this._setWifi(this._wifiSwitch.checked);
      });
      wifiHeaderBox.add_child(this._wifiSwitch);
      wifiHeader.add_child(wifiHeaderBox);
      this.menu.addMenuItem(wifiHeader);

      this._wifiSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._wifiSection);

      const wifiRefresh = makeRefreshRow((done) => {
        this._scanWifi();
        done();
      });
      this.menu.addMenuItem(wifiRefresh);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const btHeader = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
      });
      btHeader.set_style("padding: 4px 16px 0;");
      const btHeaderBox = new St.BoxLayout({ x_expand: true });
      btHeaderBox.add_child(
        new St.Icon({
          icon_name: "bluetooth-active-symbolic",
          style_class: "popup-menu-icon",
        })
      );
      const btIcon = btHeaderBox.get_last_child();
      if (btIcon) btIcon.set_style("margin-right: 8px;");
      btHeaderBox.add_child(
        new St.Label({
          text: _("Bluetooth"),
          y_align: Clutter.ActorAlign.CENTER,
        })
      );
      const btLabel = btHeaderBox.get_last_child();
      if (btLabel)
        btLabel.set_style("font-weight: bold; font-size: 1.05em; flex: 1;");
      this._btSwitch = new St.Button({
        style_class: "toggle-switch",
        toggle_mode: true,
        checked: false,
      });
      this._btSwitch.connect("clicked", () => {
        this._setBt(this._btSwitch.checked);
      });
      btHeaderBox.add_child(this._btSwitch);
      btHeader.add_child(btHeaderBox);
      this.menu.addMenuItem(btHeader);

      this._btSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._btSection);

      const btRefresh = makeRefreshRow((done) => {
        this._listBt();
        done();
      });
      this.menu.addMenuItem(btRefresh);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const sndHeader = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
      });
      sndHeader.set_style("padding: 4px 16px 0;");
      const sndHeaderBox = new St.BoxLayout({ x_expand: true });
      sndHeaderBox.add_child(
        new St.Icon({
          icon_name: "audio-volume-high-symbolic",
          style_class: "popup-menu-icon",
        })
      );
      const sndIcon = sndHeaderBox.get_last_child();
      if (sndIcon) sndIcon.set_style("margin-right: 8px;");
      sndHeaderBox.add_child(
        new St.Label({
          text: _("Sound"),
          y_align: Clutter.ActorAlign.CENTER,
        })
      );
      const sndLabel = sndHeaderBox.get_last_child();
      if (sndLabel) sndLabel.set_style("font-weight: bold; font-size: 1.05em;");
      sndHeader.add_child(sndHeaderBox);
      this.menu.addMenuItem(sndHeader);

      this._compactSlider = new VolumeSliderItem();
      this._compactSlider.value = this._volume;
      this._compactSlider.connect("value-changed", (_i, v) => {
        this._volume = v;
        this._muted = v === 0;
        spawnAsync([
          "pactl",
          "set-sink-volume",
          "@DEFAULT_SINK@",
          `${Math.round(v * 100)}%`,
        ]);
        spawnAsync([
          "pactl",
          "set-sink-mute",
          "@DEFAULT_SINK@",
          v === 0 ? "1" : "0",
        ]);
        if (this._compactMuteItem)
          this._compactMuteItem.setToggleState(this._muted);
      });
      this.menu.addMenuItem(this._compactSlider);

      this._compactMuteItem = new PopupMenu.PopupSwitchMenuItem(
        _("Mute"),
        false
      );
      this._compactMuteItem.connect("toggled", (_i, state) => {
        this._muted = state;
        spawnAsync([
          "pactl",
          "set-sink-mute",
          "@DEFAULT_SINK@",
          state ? "1" : "0",
        ]);
        this._compactSlider.value = state ? 0 : this._volume;
      });
      this.menu.addMenuItem(this._compactMuteItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const batHeader = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
      });
      batHeader.set_style("padding: 4px 16px 0;");
      const batHeaderBox = new St.BoxLayout({ x_expand: true });
      batHeaderBox.add_child(
        new St.Icon({
          icon_name: "battery-full-symbolic",
          style_class: "popup-menu-icon",
        })
      );
      const batIcon = batHeaderBox.get_last_child();
      if (batIcon) batIcon.set_style("margin-right: 8px;");
      batHeaderBox.add_child(
        new St.Label({
          text: _("Battery"),
          y_align: Clutter.ActorAlign.CENTER,
        })
      );
      const batLabel = batHeaderBox.get_last_child();
      if (batLabel) batLabel.set_style("font-weight: bold; font-size: 1.05em;");
      batHeader.add_child(batHeaderBox);
      this.menu.addMenuItem(batHeader);

      this._batStatusItem = new PopupMenu.PopupMenuItem("", {
        reactive: false,
      });
      this.menu.addMenuItem(this._batStatusItem);
      this._batTimeItem = new PopupMenu.PopupMenuItem("", { reactive: false });
      this._batTimeItem.label.set_style("opacity: 0.65;");
      this.menu.addMenuItem(this._batTimeItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const settingsRow = new PopupMenu.PopupBaseMenuItem({});
      settingsRow.set_style("padding: 2px 8px;");
      const settingsBox = new St.BoxLayout({
        x_expand: true,
      });
      settingsBox.set_style("spacing: 6px;");

      for (const [icon, panel, tip] of [
        ["network-wireless-signal-excellent-symbolic", "wifi", _("Wi-Fi")],
        ["bluetooth-active-symbolic", "bluetooth", _("Bluetooth")],
        ["audio-volume-high-symbolic", "sound", _("Sound")],
        ["battery-full-symbolic", "power", _("Power")],
      ]) {
        const b = new St.Button({
          style_class: "button",
          x_expand: true,
          accessible_name: tip,
        });
        b.set_style("min-height: 28px;");
        b.set_child(new St.Icon({ icon_name: icon, icon_size: 16 }));
        b.connect("clicked", () => openControlCenter(panel));
        settingsBox.add_child(b);
      }
      settingsRow.add_child(settingsBox);
      this.menu.addMenuItem(settingsRow);
    }

    _refreshAll() {
      const wifiOn =
        this._nmProxy?.get_cached_property("WirelessEnabled")?.unpack() ??
        false;
      this._wifiSwitch.checked = wifiOn;
      this._scanWifi();

      const btOn =
        this._btProxy?.get_cached_property("Powered")?.unpack() ?? false;
      this._btSwitch.checked = btOn;
      this._listBt();

      const volOut = spawnSync(["pactl", "get-sink-volume", "@DEFAULT_SINK@"]);
      if (volOut) {
        const m = volOut.match(/(\d+)%/);
        if (m) this._volume = parseInt(m[1]) / 100;
      }
      const muteOut = spawnSync(["pactl", "get-sink-mute", "@DEFAULT_SINK@"]);
      if (muteOut) this._muted = muteOut.includes("yes");
      this._compactSlider.value = this._muted ? 0 : this._volume;
      this._compactMuteItem.setToggleState(this._muted);

      this._updateBattery();
    }

    _scanWifi() {
      this._wifiSection.removeAll();
      const ph = new PopupMenu.PopupMenuItem(_("Scanning…"), {
        reactive: false,
      });
      ph.label.style = "font-style: italic; opacity: 0.55;";
      this._wifiSection.addMenuItem(ph);

      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._wifiSection.removeAll();
        const out = spawnSync([
          "nmcli",
          "-t",
          "-f",
          "SSID,SIGNAL,SECURITY,IN-USE",
          "dev",
          "wifi",
          "list",
        ]);
        if (!out) {
          this._wifiSection.addMenuItem(
            new PopupMenu.PopupMenuItem(_("Wi-Fi unavailable"), {
              reactive: false,
            })
          );
          return GLib.SOURCE_REMOVE;
        }
        const seen = new Set();
        let count = 0;
        for (const line of out.trim().split("\n")) {
          if (!line || count >= 8) continue;
          const parts = line.split(":");
          if (parts.length < 4) continue;
          const ssid = parts[0].trim();
          const signal = parseInt(parts[1]) || 0;
          const security = parts[2].trim();
          const inUse = parts[3].trim() === "*";
          if (!ssid || seen.has(ssid)) continue;
          seen.add(ssid);
          count++;
          this._wifiSection.addMenuItem(
            this._makeNetworkRow(ssid, signal, security, inUse)
          );
        }
        if (count === 0)
          this._wifiSection.addMenuItem(
            new PopupMenu.PopupMenuItem(_("No networks found"), {
              reactive: false,
            })
          );
        return GLib.SOURCE_REMOVE;
      });
    }

    _makeNetworkRow(ssid, signal, security, inUse) {
      const item = new PopupMenu.PopupBaseMenuItem();

      const wifiIcon = new St.Icon({
        icon_name: wifiSignalIcon(signal),
        style_class: "popup-menu-icon",
      });
      item.add_child(wifiIcon);

      const label = new St.Label({
        text: ssid,
        y_align: Clutter.ActorAlign.CENTER,
        x_expand: true,
      });
      if (inUse) label.set_style("font-weight: bold;");
      item.add_child(label);

      if (security && security !== "--")
        item.add_child(
          new St.Icon({
            icon_name: "channel-secure-symbolic",
            style_class: "popup-menu-icon",
          })
        );

      if (inUse)
        item.add_child(
          new St.Icon({
            icon_name: "object-select-symbolic",
            style_class: "popup-menu-icon",
          })
        );

      item.connect("activate", () => {
        if (!inUse) spawnAsync(["nmcli", "dev", "wifi", "connect", ssid]);
      });
      return item;
    }

    _listBt() {
      this._btSection.removeAll();
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
            new St.Label({ text: name, y_align: Clutter.ActorAlign.CENTER })
          );
          item.connect("activate", () =>
            spawnAsync(["bluetoothctl", "connect", mac])
          );
          this._btSection.addMenuItem(item);
          count++;
        }
      }
      if (count === 0)
        this._btSection.addMenuItem(
          new PopupMenu.PopupMenuItem(_("No paired devices"), {
            reactive: false,
          })
        );
    }

    _updateBattery() {
      try {
        const pct = Math.round(
          this._upProxy?.get_cached_property("Percentage")?.unpack() ?? 0
        );
        const state =
          this._upProxy?.get_cached_property("State")?.unpack() ?? 0;
        const charging = state === 1;
        const stateStr =
          { 1: _("Charging"), 2: _("Discharging"), 4: _("Fully charged") }[
            state
          ] ?? _("Unknown");
        if (this._batStatusItem)
          this._batStatusItem.label.text = `${pct}%  —  ${stateStr}`;
        if (this._batTimeItem) {
          const secs =
            (charging
              ? this._upProxy?.get_cached_property("TimeToFull")
              : this._upProxy?.get_cached_property("TimeToEmpty")
            )?.unpack() ?? 0;
          if (secs > 0) {
            const h = Math.floor(secs / 3600);
            const m = Math.floor((secs % 3600) / 60);
            const suffix = charging ? _("until full") : _("remaining");
            this._batTimeItem.label.text =
              h > 0 ? `${h}h ${m}m ${suffix}` : `${m}m ${suffix}`;
          } else {
            this._batTimeItem.label.text = "";
          }
        }
      } catch (_e) {}
    }

    _setWifi(enabled) {
      try {
        this._nmProxy?.call(
          "org.freedesktop.DBus.Properties.Set",
          new GLib.Variant("(ssv)", [
            "org.freedesktop.NetworkManager",
            "WirelessEnabled",
            new GLib.Variant("b", enabled),
          ]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          null
        );
      } catch (_e) {}
    }

    _setBt(enabled) {
      try {
        this._btProxy?.call(
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

    destroy() {
      this._nmProxy = null;
      this._btProxy = null;
      this._upProxy = null;
      super.destroy();
    }
  }
);

export default CompactIndicator;
