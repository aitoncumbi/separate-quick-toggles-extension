"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { spawnAsync } from "../lib/utils.js";

const NotificationIndicator = GObject.registerClass(
  class NotificationIndicator extends PanelMenu.Button {
    _init() {
      super._init(0.0, _("Notifications"));

      this._count = 0;

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

export default NotificationIndicator;
