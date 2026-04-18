"use strict";

import GObject from "gi://GObject";
import St from "gi://St";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { openControlCenter, spawnAsync, spawnSync } from "../lib/utils.js";
import VolumeSliderItem from "../lib/volume-slider.js";

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

export default SoundIndicator;
