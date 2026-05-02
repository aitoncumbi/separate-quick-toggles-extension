"use strict";

import Shell from "gi://Shell";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as AppFavorites from "resource:///org/gnome/shell/ui/appFavorites.js";
import { getAppAccentColor } from "../lib/utils.js";

export default class AppDock {
  constructor(settings, pocket = null) {
    this._settings = settings;
    this._pocket = pocket;
    this._favorites = AppFavorites.getAppFavorites();
    this._appSystem = Shell.AppSystem.get_default();
    this._favoritesSignalId = 0;
    this._appSystemSignalId = 0;
    this._settingsSignalId = 0;
    this._position = this._settings?.get_string("app-dock-position") ?? "right";

    this._actor = new St.BoxLayout({
      style_class: "sqt-app-dock",
      reactive: false,
      track_hover: false,
    });

    this._items = new St.BoxLayout({
      style_class: "sqt-app-dock-items",
      reactive: false,
      track_hover: false,
    });

    this._actor.add_child(this._items);
    this._attachToPanel();

    this._favoritesSignalId = this._favorites.connect("changed", () =>
      this._rebuild()
    );
    this._appSystemSignalId = this._appSystem.connect("installed-changed", () =>
      this._rebuild()
    );
    if (this._settings) {
      this._settingsSignalId = this._settings.connect(
        "changed::app-dock-position",
        () => {
          this._position = this._settings.get_string("app-dock-position");
          this._attachToPanel();
        }
      );
    }

    this._rebuild();
  }

  _getPanelBox() {
    switch (this._position) {
      case "left":
        return Main.panel?._leftBox;
      case "center":
        return Main.panel?._centerBox;
      case "right":
      default:
        return Main.panel?._rightBox;
    }
  }

  _attachToPanel() {
    const panelBox = this._getPanelBox();
    if (!panelBox || this._actor.get_parent() === panelBox) return;

    this._actor.get_parent()?.remove_child(this._actor);
    panelBox.add_child(this._actor);
  }

  _showPocket(app, iconActor) {
    if (!this._pocket || !app) return;

    const appName = app.get_name?.() ?? "";
    const appInfo = app.get_description?.() ?? app.get_id?.() ?? "";
    const accentColor = getAppAccentColor(app);

    this._pocket.cancelHide();
    this._pocket.show(iconActor, appName, appInfo, accentColor);
  }

  _clearItems() {
    let child = this._items.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._items.remove_child(child);
      child.destroy();
      child = next;
    }
  }

  _rebuild() {
    this._clearItems();

    const favorites = this._favorites?.getFavorites?.() ?? [];
    for (const app of favorites) {
      const name = app?.get_name?.() ?? "";
      const button = new St.Button({
        style_class: "panel-button sqt-app-dock-button",
        reactive: true,
        can_focus: true,
        track_hover: true,
        accessible_name: name,
      });

      const icon = app?.create_icon_texture?.(16);
      if (icon) button.set_child(icon);

      button.connect("clicked", () => {
        try {
          if (app?.can_open_new_window?.()) app.open_new_window(-1);
          else app.activate();
        } catch (_error) {}
      });
      button.connect("enter-event", () => {
        this._showPocket(app, button);
      });
      button.connect("leave-event", () => {
        this._pocket?.hide();
      });

      this._items.add_child(button);
    }

    this._actor.visible = favorites.length > 0;
  }

  destroy() {
    if (this._favorites && this._favoritesSignalId) {
      this._favorites.disconnect(this._favoritesSignalId);
      this._favoritesSignalId = 0;
    }
    if (this._appSystem && this._appSystemSignalId) {
      this._appSystem.disconnect(this._appSystemSignalId);
      this._appSystemSignalId = 0;
    }
    if (this._settings && this._settingsSignalId) {
      this._settings.disconnect(this._settingsSignalId);
      this._settingsSignalId = 0;
    }

    this._actor?.get_parent()?.remove_child(this._actor);
    this._actor?.destroy();
    this._actor = null;
    this._items = null;
    this._favorites = null;
    this._appSystem = null;
    this._pocket = null;
    this._settings = null;
  }
}
