"use strict";

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const SHOW_DURATION_MS = 160;
const HIDE_DURATION_MS = 140;
const HIDE_DEBOUNCE_MS = 300;
const HORIZONTAL_MARGIN = 8;
const DEFAULT_POCKET_COLOR = "#1a1a1f";

export default class Pocket {
  constructor(settings = null) {
    this._settings = settings;
    this._hideSourceId = null;
    this._settingsSignalId = 0;

    this._actor = new St.BoxLayout({
      style_class: "pocket",
      reactive: false,
      track_hover: false,
      visible: false,
      opacity: 0,
      translation_y: -6,
      y: Main.panel.height,
    });

    this._label = new St.Label({
      style_class: "pocket-label",
      text: "",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._separator = new St.Label({
      style_class: "pocket-separator",
      text: "|",
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._valueIcon = new St.Icon({
      style_class: "pocket-inline-icon",
      icon_name: "",
      icon_size: 11,
      visible: false,
      y_align: Clutter.ActorAlign.CENTER,
    });
    this._value = new St.Label({
      style_class: "pocket-value",
      text: "",
      y_align: Clutter.ActorAlign.CENTER,
    });

    this._actor.add_child(this._label);
    this._actor.add_child(this._separator);
    this._actor.add_child(this._valueIcon);
    this._actor.add_child(this._value);

    this._shoulderLeft = new St.Widget({
      style_class: "pocket-shoulder-left",
      visible: false,
      reactive: false,
    });
    this._shoulderRight = new St.Widget({
      style_class: "pocket-shoulder-right",
      visible: false,
      reactive: false,
    });

    Main.layoutManager.uiGroup.add_child(this._actor);
    Main.layoutManager.uiGroup.add_child(this._shoulderLeft);
    Main.layoutManager.uiGroup.add_child(this._shoulderRight);

    this._applyConfiguredColor();
    if (this._settings) {
      this._settingsSignalId = this._settings.connect(
        "changed::pocket-color",
        () => this._applyConfiguredColor()
      );
    }
  }

  show(iconActor, label, value, accentColor = null, options = null) {
    this.cancelHide();

    const iconName = options?.iconName ?? "";

    this._label.text = label ?? "";
    this._value.text = value ?? "";
    this._label.style = accentColor ? `color: ${accentColor};` : "";
    if (iconName) {
      this._valueIcon.icon_name = iconName;
      this._valueIcon.visible = true;
    } else {
      this._valueIcon.visible = false;
      this._valueIcon.icon_name = "";
    }

    this._positionUnder(iconActor);

    this._actor.visible = true;
    this._shoulderLeft.visible = true;
    this._shoulderRight.visible = true;
    this._actor.remove_style_class_name("hidden");
    this._actor.add_style_class_name("visible");

    this._actor.remove_all_transitions();
    this._actor.ease({
      opacity: 255,
      translation_y: 0,
      duration: SHOW_DURATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
  }

  hide() {
    this.cancelHide();
    this._hideSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      HIDE_DEBOUNCE_MS,
      () => {
        this._hideSourceId = null;
        this._animateHide();
        return GLib.SOURCE_REMOVE;
      }
    );
  }

  cancelHide() {
    if (this._hideSourceId !== null) {
      GLib.Source.remove(this._hideSourceId);
      this._hideSourceId = null;
    }
  }

  destroy() {
    this.cancelHide();

    if (this._settings && this._settingsSignalId) {
      this._settings.disconnect(this._settingsSignalId);
      this._settingsSignalId = 0;
    }
    this._settings = null;

    this._actor?.remove_all_transitions();
    this._actor?.destroy();
    this._actor = null;

    this._shoulderLeft?.destroy();
    this._shoulderLeft = null;

    this._shoulderRight?.destroy();
    this._shoulderRight = null;

    this._label = null;
    this._separator = null;
    this._valueIcon = null;
    this._value = null;
  }

  _applyConfiguredColor() {
    const raw = this._settings?.get_string("pocket-color") ?? "";
    const color = this._sanitizeColor(raw);

    if (this._actor)
      this._actor.style = `background-color: ${color}; border-radius: 0 0 12px 12px;`;
    if (this._shoulderLeft)
      this._shoulderLeft.style = `box-shadow: -8px -8px 0 0 ${color};`;
    if (this._shoulderRight)
      this._shoulderRight.style = `box-shadow: 8px -8px 0 0 ${color};`;
  }

  _sanitizeColor(color) {
    const trimmed = (color ?? "").trim();
    if (!trimmed) return DEFAULT_POCKET_COLOR;

    // Accept common hex and rgb/hsl/rgba/hsla formats; fallback to default.
    const colorPattern =
      /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^(rgb|rgba|hsl|hsla)\([^)]*\)$|^[a-zA-Z]+$/;
    return colorPattern.test(trimmed) ? trimmed : DEFAULT_POCKET_COLOR;
  }

  _animateHide() {
    if (!this._actor) return;

    this._actor.remove_style_class_name("visible");
    this._actor.add_style_class_name("hidden");
    this._actor.remove_all_transitions();
    this._actor.ease({
      opacity: 0,
      translation_y: -6,
      duration: HIDE_DURATION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (!this._actor) return;
        this._actor.visible = false;
        if (this._shoulderLeft) this._shoulderLeft.visible = false;
        if (this._shoulderRight) this._shoulderRight.visible = false;
      },
    });
  }

  _positionUnder(iconActor) {
    if (!this._actor || !iconActor) return;

    const [iconX] = iconActor.get_transformed_position();
    const iconWidth = iconActor.width || iconActor.get_width();
    const pocketWidth = this._actor.get_preferred_width(-1)[1];

    const monitor =
      Main.layoutManager.findMonitorForActor?.(iconActor) ||
      Main.layoutManager.primaryMonitor;

    const minX = monitor.x + HORIZONTAL_MARGIN;
    const maxX = monitor.x + monitor.width - pocketWidth - HORIZONTAL_MARGIN;
    const centeredX = Math.round(iconX + iconWidth / 2 - pocketWidth / 2);
    const clampedX = Math.max(minX, Math.min(centeredX, maxX));

    this._actor.x = clampedX;
    this._actor.y = Main.panel.height;

    this._positionShoulders(clampedX, Main.panel.height, pocketWidth);
  }

  _positionShoulders(pocketX, pocketY, pocketWidth) {
    if (!this._shoulderLeft || !this._shoulderRight) return;

    const shoulderWidth = this._shoulderLeft.get_preferred_width(-1)[1] || 12;

    this._shoulderLeft.x = pocketX;
    this._shoulderLeft.y = pocketY;

    this._shoulderRight.x = pocketX + pocketWidth - shoulderWidth;
    this._shoulderRight.y = pocketY;
  }
}
