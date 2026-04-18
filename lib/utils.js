"use strict";

import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

export function spawnSync(argv) {
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

export function spawnAsync(argv) {
  try {
    GLib.spawn_async(null, argv, null, GLib.SpawnFlags.SEARCH_PATH, null);
  } catch (_e) {}
}

export function openControlCenter(panel) {
  spawnAsync(["gnome-control-center", panel]);
}

export function makeProxy(bus, name, path, iface) {
  try {
    const proxy = new Gio.DBusProxy({
      g_connection: bus,
      g_name: name,
      g_object_path: path,
      g_interface_name: iface,
      g_flags: Gio.DBusProxyFlags.NONE,
    });
    proxy.init(null);
    return proxy;
  } catch (_e) {
    return null;
  }
}

// Map signal strength (0-100) to a symbolic icon name.
export function wifiSignalIcon(signal, secure) {
  void secure;
  let strength;
  if (signal > 80) strength = "excellent";
  else if (signal > 55) strength = "good";
  else if (signal > 30) strength = "ok";
  else if (signal > 5) strength = "weak";
  else strength = "none";
  return `network-wireless-signal-${strength}-symbolic`;
}

// Returns a PopupBaseMenuItem containing a centered Refresh button.
export function makeRefreshRow(onRefresh) {
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
