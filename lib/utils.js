"use strict";

import Gdk from "gi://Gdk";
import GdkPixbuf from "gi://GdkPixbuf";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

const DEFAULT_APP_ACCENT = "#60a5fa";

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

export function getAppAccentColor(app, size = 48) {
  try {
    const appInfo = app?.get_app_info?.();
    const gicon = appInfo?.get_icon?.() ?? app?.get_icon?.() ?? null;
    if (!gicon) return DEFAULT_APP_ACCENT;

    const display = Gdk.Display.get_default();
    if (!display) return DEFAULT_APP_ACCENT;

    const theme = Gtk.IconTheme.get_for_display(display);
    const paintable = theme.lookup_by_gicon(
      gicon,
      size,
      1,
      Gtk.TextDirection.NONE,
      Gtk.IconLookupFlags.FORCE_SIZE
    );

    if (paintable?.is_symbolic?.()) return DEFAULT_APP_ACCENT;

    const file = paintable?.get_file?.() ?? gicon.get_file?.() ?? null;
    const path = file?.get_path?.() ?? null;
    if (!path) return DEFAULT_APP_ACCENT;

    const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(
      path,
      size,
      size,
      true
    );
    if (!pixbuf) return DEFAULT_APP_ACCENT;

    return getPixbufDominantColor(pixbuf);
  } catch (_error) {
    return DEFAULT_APP_ACCENT;
  }
}

function getPixbufDominantColor(pixbuf) {
  try {
    const width = pixbuf.get_width();
    const height = pixbuf.get_height();
    const channels = pixbuf.get_n_channels();
    const hasAlpha = pixbuf.get_has_alpha();
    const rowstride = pixbuf.get_rowstride();
    const bytes = pixbuf.read_pixel_bytes();
    const pixels = bytes.get_data?.() ?? bytes;

    if (!width || !height || !channels || !pixels) return DEFAULT_APP_ACCENT;

    const stepX = Math.max(1, Math.floor(width / 24));
    const stepY = Math.max(1, Math.floor(height / 24));
    let redSum = 0;
    let greenSum = 0;
    let blueSum = 0;
    let weightSum = 0;

    for (let y = 0; y < height; y += stepY) {
      const rowOffset = y * rowstride;
      for (let x = 0; x < width; x += stepX) {
        const index = rowOffset + x * channels;
        const red = pixels[index];
        const green = pixels[index + 1];
        const blue = pixels[index + 2];
        const alpha = hasAlpha ? pixels[index + 3] : 255;
        if (alpha < 24) continue;

        const maxChannel = Math.max(red, green, blue);
        const minChannel = Math.min(red, green, blue);
        const saturation = (maxChannel - minChannel) / 255;
        const weight = (alpha / 255) * Math.max(0.15, saturation);

        redSum += red * weight;
        greenSum += green * weight;
        blueSum += blue * weight;
        weightSum += weight;
      }
    }

    if (weightSum <= 0) return DEFAULT_APP_ACCENT;

    return rgbToHex(
      Math.round(redSum / weightSum),
      Math.round(greenSum / weightSum),
      Math.round(blueSum / weightSum)
    );
  } catch (_error) {
    return DEFAULT_APP_ACCENT;
  }
}

function rgbToHex(red, green, blue) {
  const clamp = (value) => Math.max(0, Math.min(255, value));
  return `#${[clamp(red), clamp(green), clamp(blue)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
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
