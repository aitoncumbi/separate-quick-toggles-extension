"use strict";

import Gtk from "gi://Gtk";
import Gdk from "gi://Gdk";
import GObject from "gi://GObject";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Adw from "gi://Adw";

import {
  ExtensionPreferences,
  gettext as _,
} from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

// ── Drag-and-drop row for ordering indicators ────────────────────────────────

const IndicatorRow = GObject.registerClass(
  {
    GTypeName: "SQTIndicatorRow",
    Properties: {
      "indicator-id": GObject.ParamSpec.string(
        "indicator-id",
        "",
        "",
        GObject.ParamFlags.READWRITE,
        ""
      ),
      "indicator-label": GObject.ParamSpec.string(
        "indicator-label",
        "",
        "",
        GObject.ParamFlags.READWRITE,
        ""
      ),
      "indicator-icon": GObject.ParamSpec.string(
        "indicator-icon",
        "",
        "",
        GObject.ParamFlags.READWRITE,
        ""
      ),
      "indicator-enabled": GObject.ParamSpec.boolean(
        "indicator-enabled",
        "",
        "",
        GObject.ParamFlags.READWRITE,
        true
      ),
    },
  },
  class IndicatorRow extends GObject.Object {
    _init(id, label, icon, enabled) {
      super._init({
        "indicator-id": id,
        "indicator-label": label,
        "indicator-icon": icon,
        "indicator-enabled": enabled,
      });
    }
  }
);

export default class SeparateQuickTogglesPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();

    window.set_default_size(600, 700);
    window.set_title(_("Separate Quick Toggles"));

    // ── Page ────────────────────────────────────────────────────────────
    const page = new Adw.PreferencesPage({
      title: _("Settings"),
      icon_name: "preferences-system-symbolic",
    });
    window.add(page);

    // ── Indicators group ─────────────────────────────────────────────────
    const orderGroup = new Adw.PreferencesGroup({
      title: _("Panel Indicators"),
      description: _(
        "Drag rows to reorder icons on the panel. Toggle to show or hide each indicator."
      ),
    });
    page.add(orderGroup);

    // Meta for each indicator
    const INDICATORS = {
      wifi: {
        label: _("Wi-Fi"),
        icon: "network-wireless-signal-excellent-symbolic",
      },
      bluetooth: { label: _("Bluetooth"), icon: "bluetooth-active-symbolic" },
      sound: { label: _("Sound"), icon: "audio-volume-high-symbolic" },
      battery: { label: _("Battery"), icon: "battery-full-symbolic" },
      notification: {
        label: _("Notifications"),
        icon: "notifications-symbolic",
      },
    };

    // Build ordered list from settings
    const makeOrderedList = () => {
      const order = settings.get_strv("indicator-order");
      // Ensure all known keys are present (in case schema adds new ones)
      for (const id of Object.keys(INDICATORS)) {
        if (!order.includes(id)) order.push(id);
      }
      return order.filter((id) => id in INDICATORS);
    };

    // ListBox with drag-and-drop
    const listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.SINGLE,
      css_classes: ["boxed-list"],
      margin_top: 4,
    });

    // We store rows so we can read their order back
    let rowWidgets = []; // array of {id, widget, switch}

    const buildRows = () => {
      // Clear
      rowWidgets = [];
      let child = listBox.get_first_child();
      while (child) {
        const next = child.get_next_sibling();
        listBox.remove(child);
        child = next;
      }

      const order = makeOrderedList();
      for (const id of order) {
        const meta = INDICATORS[id];
        const enabled = settings.get_boolean(`show-${id}`);

        const row = new Adw.ActionRow({
          title: meta.label,
        });

        // Icon
        const icon = new Gtk.Image({
          icon_name: meta.icon,
          pixel_size: 20,
          margin_end: 8,
        });
        row.add_prefix(icon);

        // Drag handle
        const handle = new Gtk.Image({
          icon_name: "list-drag-handle-symbolic",
          css_classes: ["dim-label"],
          margin_start: 4,
        });
        row.add_prefix(handle);

        // Enable/disable switch
        const sw = new Gtk.Switch({
          active: enabled,
          valign: Gtk.Align.CENTER,
        });
        sw.connect("notify::active", () => {
          settings.set_boolean(`show-${id}`, sw.active);
        });
        row.add_suffix(sw);
        row.set_activatable_widget(sw);

        listBox.append(row);
        rowWidgets.push({ id, widget: row, sw });
      }
    };

    buildRows();

    // ── Drag-and-drop via Gtk4 DnD ──────────────────────────────────────
    // We implement a simple click-and-move approach using drag controllers
    let dragSourceRow = null;
    let dragSourceIndex = -1;

    const getDragIndex = (widget) => {
      let i = 0;
      for (const { widget: w } of rowWidgets) {
        if (w === widget) return i;
        i++;
      }
      return -1;
    };

    const saveOrder = () => {
      const order = rowWidgets.map((r) => r.id);
      settings.set_strv("indicator-order", order);
    };

    // Use gesture-based drag for reordering
    const setupDrag = () => {
      for (let i = 0; i < rowWidgets.length; i++) {
        const { widget } = rowWidgets[i];

        const dragSource = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE });
        dragSource.connect("prepare", (src, x, y) => {
          dragSourceRow = widget;
          dragSourceIndex = getDragIndex(widget);
          const val = new GLib.Variant("i", dragSourceIndex);
          return Gdk.ContentProvider.new_for_value(val);
        });
        dragSource.connect("drag-begin", (src, drag) => {
          widget.add_css_class("sqt-dragging");
        });
        dragSource.connect("drag-end", (src, drag, deleteData) => {
          widget.remove_css_class("sqt-dragging");
          dragSourceRow = null;
          dragSourceIndex = -1;
          saveOrder();
        });
        widget.add_controller(dragSource);

        const dropTarget = new Gtk.DropTarget({
          actions: Gdk.DragAction.MOVE,
          formats: Gdk.ContentFormats.new_for_gtype(GLib.Variant),
        });
        dropTarget.connect("drop", (tgt, value, x, y) => {
          if (dragSourceRow === null) return false;
          const fromIdx = dragSourceIndex;
          const toIdx = getDragIndex(widget);
          if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return false;

          // Reorder rowWidgets array
          const [moved] = rowWidgets.splice(fromIdx, 1);
          rowWidgets.splice(toIdx, 0, moved);

          // Rebuild listbox order visually
          for (const { widget: w } of rowWidgets) listBox.remove(w);
          for (const { widget: w } of rowWidgets) listBox.append(w);

          saveOrder();
          return true;
        });
        dropTarget.connect("motion", (tgt, x, y) => {
          return Gdk.DragAction.MOVE;
        });
        widget.add_controller(dropTarget);
      }
    };

    setupDrag();

    const scrolled = new Gtk.ScrolledWindow({
      child: listBox,
      hscrollbar_policy: Gtk.PolicyType.NEVER,
      vscrollbar_policy: Gtk.PolicyType.NEVER,
    });
    orderGroup.add(scrolled);

    // ── Compact mode group ────────────────────────────────────────────────
    const compactGroup = new Adw.PreferencesGroup({
      title: _("Panel Style"),
    });
    page.add(compactGroup);

    const compactRow = new Adw.SwitchRow({
      title: _("Compact mode  (iOS-style)"),
      subtitle: _(
        "Replace the four separate icons with a single ☰ icon that opens one combined menu — like iOS Control Center"
      ),
    });
    settings.bind(
      "compact-mode",
      compactRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT
    );
    compactGroup.add(compactRow);

    // ── Battery group ─────────────────────────────────────────────────────
    const batteryGroup = new Adw.PreferencesGroup({
      title: _("Battery"),
    });
    page.add(batteryGroup);

    const pctRow = new Adw.SwitchRow({
      title: _("Show percentage label"),
      subtitle: _(
        "Display the battery percentage next to the icon in the panel"
      ),
    });
    settings.bind(
      "show-battery-percentage",
      pctRow,
      "active",
      Gio.SettingsBindFlags.DEFAULT
    );
    batteryGroup.add(pctRow);

    // ── Pocket group ──────────────────────────────────────────────────────
    const pocketGroup = new Adw.PreferencesGroup({
      title: _("Pocket"),
    });
    page.add(pocketGroup);

    const colorRow = new Adw.EntryRow({
      title: _("Pocket color"),
      text: settings.get_string("pocket-color"),
    });
    colorRow.set_show_apply_button(true);
    settings.bind(
      "pocket-color",
      colorRow,
      "text",
      Gio.SettingsBindFlags.DEFAULT
    );
    pocketGroup.add(colorRow);

    const colorHintRow = new Adw.ActionRow({
      title: _("Accepted formats"),
      subtitle: _("Hex (#1a1a1f), rgb()/rgba(), hsl()/hsla(), or color names"),
      sensitive: false,
    });
    pocketGroup.add(colorHintRow);

    // ── Hint ─────────────────────────────────────────────────────────────
    const hintGroup = new Adw.PreferencesGroup();
    page.add(hintGroup);

    const hintRow = new Adw.ActionRow({
      title: _("Restart required"),
      subtitle: _(
        "After changing the order or visibility, disable and re-enable the extension (or restart GNOME Shell on X11) for changes to take effect."
      ),
      icon_name: "dialog-information-symbolic",
    });
    hintGroup.add(hintRow);
  }
}
