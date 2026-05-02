"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

const NotificationIndicator = GObject.registerClass(
  class NotificationIndicator extends PanelMenu.Button {
    _init() {
      // dontCreateMenu = true — we don't open our own popup;
      // clicks are handled in vfunc_event to toggle the date menu instead.
      super._init(0.0, _("Notifications"), true);

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

      this._update();
    }

    // Override PanelMenu.Button's vfunc_event so that a click opens the
    // date menu (which contains the real GNOME notification panel) rather
    // than any popup of our own.
    vfunc_event(event) {
      if (
        event.type() === Clutter.EventType.TOUCH_BEGIN ||
        event.type() === Clutter.EventType.BUTTON_PRESS
      ) {
        Main.panel.statusArea.dateMenu?.menu.toggle();
      }
      return Clutter.EVENT_PROPAGATE;
    }

    _update() {
      const sources = this._tray.getSources ? this._tray.getSources() : [];
      let total = 0;
      for (const src of sources) {
        total += Array.isArray(src.notifications)
          ? src.notifications.length
          : (src.unseenCount ?? src.count ?? 0);
      }
      this._badge.text = total > 99 ? "99+" : `${total}`;
      this._badge.visible = total > 0;
    }

    destroy() {
      if (this._sourceAddedId) this._tray.disconnect(this._sourceAddedId);
      if (this._sourceRemovedId) this._tray.disconnect(this._sourceRemovedId);
      super.destroy();
    }
  }
);

export default NotificationIndicator;
