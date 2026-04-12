"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import {
  Extension,
  gettext as _,
} from "resource:///org/gnome/shell/extensions/extension.js";

// ─── Helpers ───────────────────────────────────────────────────────────────

function spawnSync(argv) {
  try {
    const [ok, stdout] = GLib.spawn_sync(
      null,
      argv,
      null,
      GLib.SpawnFlags.SEARCH_PATH,
      null
    );
    if (ok && stdout) return new TextDecoder().decode(stdout);
  } catch (_e) {}
  return null;
}

function spawnAsync(argv) {
  try {
    GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
  } catch (_e) {}
}

function openControlCenter(panel) {
  spawnAsync(["gnome-control-center", panel]);
}

function makeProxy(bus, name, path, iface) {
  try {
    const p = new Gio.DBusProxy({
      g_connection: bus,
      g_name: name,
      g_object_path: path,
      g_interface_name: iface,
      g_flags: Gio.DBusProxyFlags.NONE,
    });
    p.init(null);
    return p;
  } catch (_e) {
    return null;
  }
}

// Map signal strength (0-100) to a symbolic icon name
function wifiSignalIcon(signal, secure) {
  // GNOME uses network-wireless-signal-{none,weak,ok,good,excellent}-symbolic
  let strength;
  if (signal > 80) strength = "excellent";
  else if (signal > 55) strength = "good";
  else if (signal > 30) strength = "ok";
  else if (signal > 5) strength = "weak";
  else strength = "none";
  return `network-wireless-signal-${strength}-symbolic`;
}

// ─── Refresh button row helper ─────────────────────────────────────────────
// Returns a PopupBaseMenuItem containing a centred "Refresh" button.
function makeRefreshRow(onRefresh) {
  const row = new PopupMenu.PopupBaseMenuItem({
    activate: false,
    can_focus: false,
  });
  row.set_style("padding: 2px 8px;");

  const btn = new St.Button({
    label: _("Refresh"),
    style_class: "button",
    x_expand: true,
    x_align: Clutter.ActorAlign.CENTER,
  });
  btn.set_style("min-height: 24px; padding: 2px 18px;");

  // Prepend a refresh icon to the button
  const btnBox = new St.BoxLayout({});
  btnBox.set_style("spacing: 6px;");
  btnBox.add_child(
    new St.Icon({
      icon_name: "view-refresh-symbolic",
      icon_size: 14,
    })
  );
  btnBox.add_child(
    new St.Label({
      text: _("Refresh"),
      y_align: Clutter.ActorAlign.CENTER,
    })
  );
  btn.set_child(btnBox);

  btn.connect("clicked", () => {
    btn.reactive = false;
    btn.opacity = 160;
    onRefresh(() => {
      btn.reactive = true;
      btn.opacity = 255;
    });
  });
  row.add_child(btn);
  return row;
}

// ─── Volume Slider ─────────────────────────────────────────────────────────

const VolumeSliderItem = GObject.registerClass(
  {
    Signals: { "value-changed": { param_types: [GObject.TYPE_DOUBLE] } },
  },
  class VolumeSliderItem extends PopupMenu.PopupBaseMenuItem {
    _init() {
      super._init({ activate: false, can_focus: false });
      this._value = 1.0;
      this._dragging = false;

      const box = new St.BoxLayout({ x_expand: true });
      box.set_style("spacing: 10px;");
      this.add_child(box);

      this._icon = new St.Icon({
        icon_name: "audio-volume-high-symbolic",
        style_class: "popup-menu-icon",
      });
      box.add_child(this._icon);

      const trackBin = new St.Bin({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._track = new St.DrawingArea({
        x_expand: true,
        height: 20,
        reactive: true,
      });
      this._track.connect("repaint", this._repaint.bind(this));
      this._track.connect("button-press-event", this._onPress.bind(this));
      this._track.connect("button-release-event", this._onRelease.bind(this));
      this._track.connect("motion-event", this._onMotion.bind(this));
      this._track.connect("scroll-event", this._onScroll.bind(this));
      trackBin.set_child(this._track);
      box.add_child(trackBin);

      this._label = new St.Label({
        text: "100%",
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._label.set_style("min-width: 44px; text-align: right;");
      box.add_child(this._label);
    }

    _repaint(area) {
      const cr = area.get_context();
      const [w, h] = area.get_surface_size();
      const knobR = 7,
        trackY = h / 2,
        trackH = 4;
      const filled = Math.min(this._value / 1.5, 1.0) * (w - knobR * 2) + knobR;

      cr.setSourceRGBA(1, 1, 1, 0.18);
      this._roundRect(
        cr,
        knobR,
        trackY - trackH / 2,
        w - knobR * 2,
        trackH,
        trackH / 2
      );
      cr.fill();

      if (filled > knobR) {
        cr.setSourceRGBA(1, 1, 1, 0.85);
        this._roundRect(
          cr,
          knobR,
          trackY - trackH / 2,
          filled - knobR,
          trackH,
          trackH / 2
        );
        cr.fill();
      }

      const kx = Math.max(knobR, Math.min(filled, w - knobR));
      cr.setSourceRGBA(1, 1, 1, 1);
      cr.arc(kx, trackY, knobR, 0, 2 * Math.PI);
      cr.fill();
      cr.setSourceRGBA(0, 0, 0, 0.2);
      cr.setLineWidth(1);
      cr.arc(kx, trackY, knobR, 0, 2 * Math.PI);
      cr.stroke();
      cr.$dispose();
    }

    _roundRect(cr, x, y, w, h, r) {
      if (w <= 0) return;
      r = Math.min(r, w / 2, h / 2);
      cr.newPath();
      cr.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2);
      cr.arc(x + w - r, y + r, r, (3 * Math.PI) / 2, 0);
      cr.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
      cr.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
      cr.closePath();
    }

    _xToValue(stageX) {
      const [tx] = this._track.get_transformed_position();
      const tw = this._track.width,
        knobR = 7;
      return Math.max(
        0,
        Math.min(1.5, ((stageX - tx - knobR) / (tw - knobR * 2)) * 1.5)
      );
    }

    _onPress(actor, event) {
      this._dragging = true;
      this.value = this._xToValue(event.get_coords()[0]);
      this.emit("value-changed", this._value);
      return Clutter.EVENT_STOP;
    }

    _onRelease(actor, event) {
      if (this._dragging) {
        this._dragging = false;
        this.value = this._xToValue(event.get_coords()[0]);
        this.emit("value-changed", this._value);
      }
      return Clutter.EVENT_STOP;
    }

    _onMotion(actor, event) {
      if (this._dragging) {
        this.value = this._xToValue(event.get_coords()[0]);
        this.emit("value-changed", this._value);
      }
      return Clutter.EVENT_PROPAGATE;
    }

    _onScroll(actor, event) {
      const dir = event.get_scroll_direction();
      this.value = Math.max(
        0,
        Math.min(
          1.5,
          this._value + (dir === Clutter.ScrollDirection.UP ? 0.05 : -0.05)
        )
      );
      this.emit("value-changed", this._value);
      return Clutter.EVENT_STOP;
    }

    get value() {
      return this._value;
    }

    set value(v) {
      this._value = v;
      this._label.text = `${Math.round(v * 100)}%`;
      if (v === 0) this._icon.icon_name = "audio-volume-muted-symbolic";
      else if (v < 0.35) this._icon.icon_name = "audio-volume-low-symbolic";
      else if (v < 0.7) this._icon.icon_name = "audio-volume-medium-symbolic";
      else this._icon.icon_name = "audio-volume-high-symbolic";
      this._track.queue_repaint();
    }
  }
);

// ─── iOS-style compact panel button ───────────────────────────────────────
//
// When "compact mode" is enabled in settings, a single panel button replaces
// the four individual indicators. It shows just one icon (the GNOME quick-
// settings icon) and opens a single menu containing all four sections.

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

      // Proxies
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
      // ── Wi-Fi section ──────────────────────────────────────────────
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
      this._wifiSwitch = new St.Button({ style_class: "toggle-switch" });
      this._wifiSwitchState = false;
      this._wifiSwitch.connect("clicked", () => {
        this._wifiSwitchState = !this._wifiSwitchState;
        this._wifiSwitch.checked = this._wifiSwitchState;
        this._setWifi(this._wifiSwitchState);
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

      // ── Bluetooth section ──────────────────────────────────────────
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
      this._btSwitch = new St.Button({ style_class: "toggle-switch" });
      this._btSwitchState = false;
      this._btSwitch.connect("clicked", () => {
        this._btSwitchState = !this._btSwitchState;
        this._btSwitch.checked = this._btSwitchState;
        this._setBt(this._btSwitchState);
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

      // ── Sound section ──────────────────────────────────────────────
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

      // ── Battery section ────────────────────────────────────────────
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

      // Settings shortcuts
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
      // Wi-Fi
      const wifiOn =
        this._nmProxy?.get_cached_property("WirelessEnabled")?.unpack() ??
        false;
      this._wifiSwitchState = wifiOn;
      this._wifiSwitch.checked = wifiOn;
      this._scanWifi();

      // Bluetooth
      const btOn =
        this._btProxy?.get_cached_property("Powered")?.unpack() ?? false;
      this._btSwitchState = btOn;
      this._btSwitch.checked = btOn;
      this._listBt();

      // Volume
      const volOut = spawnSync(["pactl", "get-sink-volume", "@DEFAULT_SINK@"]);
      if (volOut) {
        const m = volOut.match(/(\d+)%/);
        if (m) this._volume = parseInt(m[1]) / 100;
      }
      const muteOut = spawnSync(["pactl", "get-sink-mute", "@DEFAULT_SINK@"]);
      if (muteOut) this._muted = muteOut.includes("yes");
      this._compactSlider.value = this._muted ? 0 : this._volume;
      this._compactMuteItem.setToggleState(this._muted);

      // Battery
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
          const ssid = parts[0].trim(),
            signal = parseInt(parts[1]) || 0;
          const security = parts[2].trim(),
            inUse = parts[3].trim() === "*";
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
          const m = line.match(/^Device\s+[\w:]+\s+(.+)$/);
          if (!m) continue;
          const name = m[1].trim();
          if (!name) continue;
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
            const h = Math.floor(secs / 3600),
              m = Math.floor((secs % 3600) / 60);
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

// ─── Wi-Fi Indicator ───────────────────────────────────────────────────────

const WifiIndicator = GObject.registerClass(
  class WifiIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, _("Wi-Fi"));
      this._icon = new St.Icon({
        icon_name: "network-wireless-offline-symbolic",
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);

      this._proxy = makeProxy(
        Gio.DBus.system,
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager"
      );
      if (this._proxy) {
        this._proxy.connect("g-properties-changed", () => this._updateIcon());
        this._updateIcon();
      }
      this._buildMenu();
    }

    _updateIcon() {
      const wifiOn =
        this._proxy?.get_cached_property("WirelessEnabled")?.unpack() ?? false;
      const state = this._proxy?.get_cached_property("State")?.unpack() ?? 0;

      if (!wifiOn) {
        this._icon.icon_name = "network-wireless-offline-symbolic";
      } else if (state === 100) {
        // Connected - get signal strength from active AP
        const activeApPath = this._proxy
          ?.get_cached_property("ActiveAccessPoint")
          ?.unpack();
        if (activeApPath && activeApPath !== "/") {
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
              const apProxy = makeProxy(
                Gio.DBus.system,
                "org.freedesktop.NetworkManager",
                activeApPath,
                "org.freedesktop.NetworkManager.AccessPoint"
              );
              if (apProxy) {
                const strength =
                  apProxy.get_cached_property("Strength")?.unpack() ?? 0;
                this._icon.icon_name = wifiSignalIcon(strength, true);
                apProxy = null;
              }
            } catch (_e) {}
            return GLib.SOURCE_REMOVE;
          });
        } else {
          this._icon.icon_name = "network-wireless-connected-symbolic";
        }
      } else if (state >= 40) {
        this._icon.icon_name = "network-wireless-signal-good-symbolic";
      } else {
        this._icon.icon_name = "network-wireless-disconnected-symbolic";
      }
    }

    _buildMenu() {
      // Header row with title + refresh button
      const headerRow = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
      });
      headerRow.set_style("padding: 4px 12px;");
      const headerBox = new St.BoxLayout({ x_expand: true });
      headerBox.add_child(
        new St.Label({
          text: _("Wi-Fi"),
          y_align: Clutter.ActorAlign.CENTER,
          x_expand: true,
        })
      );
      const wifiLabel = headerBox.get_last_child();
      if (wifiLabel)
        wifiLabel.set_style("font-weight: bold; font-size: 1.05em;");
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
        this._scanNetworks(() => {
          refreshBtn.reactive = true;
        });
      });
      headerBox.add_child(refreshBtn);
      headerRow.add_child(headerBox);
      this.menu.addMenuItem(headerRow);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._toggleItem = new PopupMenu.PopupSwitchMenuItem(_("Wi-Fi"), false);
      this._toggleItem.connect("toggled", (_i, s) => this._setWifi(s));
      this.menu.addMenuItem(this._toggleItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this._netSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._netSection);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const s = new PopupMenu.PopupMenuItem(_("Network Settings…"));
      s.connect("activate", () => openControlCenter("wifi"));
      this.menu.addMenuItem(s);

      this.menu.connect("open-state-changed", (_m, open) => {
        if (open) this._refresh();
      });
    }

    _refresh() {
      const wifiOn =
        this._proxy?.get_cached_property("WirelessEnabled")?.unpack() ?? false;
      this._toggleItem.setToggleState(wifiOn);
      this._scanNetworks();
    }

    _setWifi(enabled) {
      try {
        this._proxy?.call(
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

    _scanNetworks(done) {
      this._netSection.removeAll();
      const ph = new PopupMenu.PopupMenuItem(_("Scanning…"), {
        reactive: false,
      });
      ph.label.style = "font-style: italic; opacity: 0.55;";
      this._netSection.addMenuItem(ph);

      GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        this._netSection.removeAll();
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
          this._netSection.addMenuItem(
            new PopupMenu.PopupMenuItem(_("Wi-Fi unavailable"), {
              reactive: false,
            })
          );
          done?.();
          return GLib.SOURCE_REMOVE;
        }

        const seen = new Set();
        let count = 0;
        for (const line of out.trim().split("\n")) {
          if (!line || count >= 10) continue;
          const parts = line.split(":");
          if (parts.length < 4) continue;
          const ssid = parts[0].trim(),
            signal = parseInt(parts[1]) || 0;
          const security = parts[2].trim(),
            inUse = parts[3].trim() === "*";
          if (!ssid || seen.has(ssid)) continue;
          seen.add(ssid);
          count++;

          const item = new PopupMenu.PopupBaseMenuItem();

          // Wi-Fi signal strength icon
          item.add_child(
            new St.Icon({
              icon_name: wifiSignalIcon(signal),
              style_class: "popup-menu-icon",
            })
          );

          // SSID label
          item.add_child(
            new St.Label({
              text: ssid,
              y_align: Clutter.ActorAlign.CENTER,
              x_expand: true,
              style: inUse ? "font-weight: bold;" : "",
            })
          );

          // Lock icon
          if (security && security !== "--")
            item.add_child(
              new St.Icon({
                icon_name: "channel-secure-symbolic",
                style_class: "popup-menu-icon",
              })
            );

          // Connected checkmark
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
          this._netSection.addMenuItem(item);
        }

        if (count === 0)
          this._netSection.addMenuItem(
            new PopupMenu.PopupMenuItem(_("No networks found"), {
              reactive: false,
            })
          );

        done?.();
        return GLib.SOURCE_REMOVE;
      });
    }

    destroy() {
      this._proxy = null;
      super.destroy();
    }
  }
);

// ─── Bluetooth Indicator ───────────────────────────────────────────────────

const BluetoothIndicator = GObject.registerClass(
  class BluetoothIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, _("Bluetooth"));
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
        this._proxy.connect("g-properties-changed", () => this._updateIcon());
        this._updateIcon();
      }
      this._buildMenu();
    }

    _updateIcon() {
      const on = this._proxy?.get_cached_property("Powered")?.unpack() ?? false;
      this._icon.icon_name = on
        ? "bluetooth-active-symbolic"
        : "bluetooth-disabled-symbolic";
    }

    _buildMenu() {
      // Header row with title + inline refresh button
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

      this._toggleItem = new PopupMenu.PopupSwitchMenuItem(
        _("Bluetooth"),
        true
      );
      this._toggleItem.connect("toggled", (_i, s) => this._setBt(s));
      this.menu.addMenuItem(this._toggleItem);

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
      this._toggleItem.setToggleState(on);
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
          const m = line.match(/^Device\s+[\w:]+\s+(.+)$/);
          if (!m) continue;
          const name = m[1].trim();
          if (!name) continue;
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
      this._proxy = null;
      super.destroy();
    }
  }
);

// ─── Sound Indicator ───────────────────────────────────────────────────────

const SoundIndicator = GObject.registerClass(
  class SoundIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, _("Sound"));
      this._volume = 1.0;
      this._muted = false;

      this._icon = new St.Icon({
        icon_name: "audio-volume-high-symbolic",
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);
      this._buildMenu();
      this._readState();
    }

    _readState() {
      const volOut = spawnSync(["pactl", "get-sink-volume", "@DEFAULT_SINK@"]);
      if (volOut) {
        const m = volOut.match(/(\d+)%/);
        if (m) this._volume = parseInt(m[1]) / 100;
      }
      const muteOut = spawnSync(["pactl", "get-sink-mute", "@DEFAULT_SINK@"]);
      if (muteOut) this._muted = muteOut.includes("yes");
      this._syncUI();
    }

    _buildMenu() {
      const header = new PopupMenu.PopupMenuItem(_("Sound"), {
        reactive: false,
      });
      header.label.style = "font-weight: bold; font-size: 1.05em;";
      this.menu.addMenuItem(header);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const outLabel = new PopupMenu.PopupMenuItem(_("Output Volume"), {
        reactive: false,
      });
      outLabel.label.style = "opacity: 0.7; font-size: 0.9em;";
      this.menu.addMenuItem(outLabel);

      this._slider = new VolumeSliderItem();
      this._slider.value = this._volume;
      this._slider.connect("value-changed", (_i, v) => {
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
        this._updatePanelIcon();
        if (this._muteItem) this._muteItem.setToggleState(this._muted);
      });
      this.menu.addMenuItem(this._slider);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._muteItem = new PopupMenu.PopupSwitchMenuItem(
        _("Mute"),
        this._muted
      );
      this._muteItem.connect("toggled", (_i, state) => {
        this._muted = state;
        spawnAsync([
          "pactl",
          "set-sink-mute",
          "@DEFAULT_SINK@",
          state ? "1" : "0",
        ]);
        this._updatePanelIcon();
        this._slider.value = state ? 0 : this._volume;
      });
      this.menu.addMenuItem(this._muteItem);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const s = new PopupMenu.PopupMenuItem(_("Sound Settings…"));
      s.connect("activate", () => openControlCenter("sound"));
      this.menu.addMenuItem(s);

      this.menu.connect("open-state-changed", (_m, open) => {
        if (open) this._readState();
      });
    }

    _syncUI() {
      if (this._slider) this._slider.value = this._muted ? 0 : this._volume;
      if (this._muteItem) this._muteItem.setToggleState(this._muted);
      this._updatePanelIcon();
    }

    _updatePanelIcon() {
      if (this._muted || this._volume === 0)
        this._icon.icon_name = "audio-volume-muted-symbolic";
      else if (this._volume < 0.35)
        this._icon.icon_name = "audio-volume-low-symbolic";
      else if (this._volume < 0.7)
        this._icon.icon_name = "audio-volume-medium-symbolic";
      else this._icon.icon_name = "audio-volume-high-symbolic";
    }

    destroy() {
      super.destroy();
    }
  }
);

// ─── Battery Indicator ─────────────────────────────────────────────────────

const BatteryIndicator = GObject.registerClass(
  class BatteryIndicator extends PanelMenu.Button {
    _init(showPct) {
      super._init(0.0, _("Battery"));
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
        this._proxy.connect("g-properties-changed", () => this._update());
        this._update();
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
          const h = Math.floor(secs / 3600),
            m = Math.floor((secs % 3600) / 60);
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

    destroy() {
      this._proxy = null;
      super.destroy();
    }
  }
);

// ─── Notification Indicator ────────────────────────────────────────────────

const NotificationIndicator = GObject.registerClass(
  class NotificationIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, _("Notifications"));

      this._count = 0;

      // Icon + badge box
      const box = new St.BoxLayout({ style: "spacing: 2px;" });

      this._icon = new St.Icon({
        icon_name: "notifications-symbolic",
        style_class: "system-status-icon",
      });
      box.add_child(this._icon);

      this._badge = new St.Label({
        text: "",
        y_align: Clutter.ActorAlign.CENTER,
        style: "font-size: 10px; font-weight: bold; margin-left: 1px;",
        visible: false,
      });
      box.add_child(this._badge);
      this.add_child(box);

      // Watch notification source changes via the MessageTray
      this._tray = Main.messageTray;
      this._sourceAddedId = this._tray.connect("source-added", () =>
        this._update()
      );
      this._sourceRemovedId = this._tray.connect("source-removed", () =>
        this._update()
      );

      this._buildMenu();
      this._update();
    }

    _update() {
      const sources = this._tray.getSources ? this._tray.getSources() : [];
      let total = 0;
      for (const src of sources) {
        total += src.unseenCount ?? src.count ?? 0;
      }
      this._count = total;

      if (total > 0) {
        this._badge.text = total > 99 ? "99+" : `${total}`;
        this._badge.visible = true;
        this._icon.icon_name = "notifications-symbolic";
      } else {
        this._badge.visible = false;
        this._icon.icon_name = "notifications-symbolic";
      }

      this._refreshMenu();
    }

    _buildMenu() {
      const header = new PopupMenu.PopupMenuItem(_("Notifications"), {
        reactive: false,
      });
      header.label.style = "font-weight: bold; font-size: 1.05em;";
      this.menu.addMenuItem(header);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._notifSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._notifSection);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      // Do Not Disturb toggle via gsettings
      this._dndItem = new PopupMenu.PopupSwitchMenuItem(
        _("Do Not Disturb"),
        false
      );
      try {
        this._dndSettings = new Gio.Settings({
          schema_id: "org.gnome.desktop.notifications",
        });
        this._dndItem.setToggleState(
          !this._dndSettings.get_boolean("show-banners")
        );
        this._dndItem.connect("toggled", (_i, state) => {
          this._dndSettings.set_boolean("show-banners", !state);
        });
        this._dndSettingsId = this._dndSettings.connect(
          "changed::show-banners",
          () => {
            this._dndItem.setToggleState(
              !this._dndSettings.get_boolean("show-banners")
            );
          }
        );
      } catch (_e) {}
      this.menu.addMenuItem(this._dndItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      const clearItem = new PopupMenu.PopupMenuItem(_("Clear All"));
      clearItem.connect("activate", () => this._clearAll());
      this.menu.addMenuItem(clearItem);

      const settingsItem = new PopupMenu.PopupMenuItem(
        _("Notification Settings…")
      );
      settingsItem.connect("activate", () =>
        spawnAsync(["gnome-control-center", "notifications"])
      );
      this.menu.addMenuItem(settingsItem);

      this.menu.connect("open-state-changed", (_m, open) => {
        if (open) this._update();
      });
    }

    _refreshMenu() {
      if (!this._notifSection) return;
      this._notifSection.removeAll();

      const sources = this._tray.getSources ? this._tray.getSources() : [];
      let shown = 0;

      for (const src of sources) {
        const count = src.unseenCount ?? src.count ?? 0;
        const title = src.title ?? src.name ?? _("Unknown");
        if (!title) continue;

        const item = new PopupMenu.PopupBaseMenuItem();
        item.add_child(
          new St.Icon({
            icon_name: src.iconName ?? "notifications-symbolic",
            style_class: "popup-menu-icon",
          })
        );
        item.add_child(
          new St.Label({
            text: count > 0 ? `${title}  (${count})` : title,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
          })
        );
        this._notifSection.addMenuItem(item);
        shown++;
      }

      if (shown === 0) {
        const empty = new PopupMenu.PopupMenuItem(_("No notifications"), {
          reactive: false,
        });
        empty.label.style = "font-style: italic; opacity: 0.6;";
        this._notifSection.addMenuItem(empty);
      }
    }

    _clearAll() {
      try {
        const sources = this._tray.getSources
          ? [...this._tray.getSources()]
          : [];
        for (const src of sources) {
          if (src.destroy) src.destroy();
        }
      } catch (_e) {}
      this._update();
    }

    destroy() {
      if (this._sourceAddedId) this._tray.disconnect(this._sourceAddedId);
      if (this._sourceRemovedId) this._tray.disconnect(this._sourceRemovedId);
      if (this._dndSettings && this._dndSettingsId)
        this._dndSettings.disconnect(this._dndSettingsId);
      super.destroy();
    }
  }
);

// ─── Main Extension ────────────────────────────────────────────────────────

export default class SeparateQuickToggles extends Extension {
  enable() {
    this._settings = this.getSettings();
    this._indicators = {};
    this._connections = [];
    this._sqtPatched = false;

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
    switch (id) {
      case "wifi":
        return new WifiIndicator();
      case "bluetooth":
        return new BluetoothIndicator();
      case "sound":
        return new SoundIndicator();
      case "battery":
        return new BatteryIndicator(this._settings);
      case "notification":
        return new NotificationIndicator();
      default:
        return null;
    }
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
