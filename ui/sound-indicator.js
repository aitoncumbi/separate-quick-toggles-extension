"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import GLib from "gi://GLib";
import Clutter from "gi://Clutter";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { openControlCenter, spawnAsync, spawnSync } from "../lib/utils.js";
import VolumeSliderItem from "../lib/volume-slider.js";

const MEDIA_REFRESH_INTERVAL_SECONDS = 2;
const VISUALIZER_TICK_MS = 180;

const SoundIndicator = GObject.registerClass(
  class SoundIndicator extends PanelMenu.Button {
    _init(pocket = null) {
      super._init(0.0, _("Sound"));
      this._pocket = pocket;
      this._signalIds = [];
      this._pocketRefreshSourceId = 0;
      this._mediaRefreshSourceId = 0;
      this._visualizerSourceId = 0;
      this._currentMedia = null;
      this._isMediaPlaying = false;
      this._visualizerBars = [];
      this._volume = 1.0;
      this._muted = false;

      this._icon = new St.Icon({
        icon_name: "audio-volume-high-symbolic",
        style_class: "system-status-icon",
      });
      this._content = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._visualizer = new St.BoxLayout({
        style_class: "sqt-sound-visualizer",
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
      });
      this._visualizer.set_style(
        "spacing: 2px; min-width: 16px; min-height: 16px;"
      );
      this._buildVisualizer();

      this._iconBox = new St.Bin({ style_class: "system-status-icon" });
      this._iconBox.set_child(this._icon);

      this._content.add_child(this._iconBox);
      this._content.add_child(this._visualizer);
      this.add_child(this._content);
      this._buildMenu();
      this._readState();
      this._refreshMediaState();
      this._startMediaRefresh();

      if (this._pocket) {
        this._signalIds.push(
          this.connect("enter-event", () => {
            this._showPocket();
            this._startPocketRefresh();
          })
        );
        this._signalIds.push(
          this.connect("leave-event", () => {
            this._stopPocketRefresh();
            this._pocket.hide();
          })
        );
      }
    }

    _showPocket() {
      if (!this._pocket) return;

      this._refreshMediaState();

      const media = this._currentMedia;
      const volumePct = Math.round(this._volume * 100);
      let value = this._muted ? _("Muted") : `${volumePct}%`;

      if (media) {
        const title = media.title || _("Unknown title");
        const artist = media.artist || _("Unknown artist");
        value = `${media.player} · ${title} - ${artist}`;
      }

      this._pocket.cancelHide();
      this._pocket.show(this, _("Sound"), value, "#f59e0b", {
        iconName: this._icon.icon_name,
      });
    }

    _startPocketRefresh() {
      if (this._pocketRefreshSourceId) return;
      this._pocketRefreshSourceId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        1,
        () => {
          this._readState();
          this._showPocket();
          return GLib.SOURCE_CONTINUE;
        }
      );
    }

    _stopPocketRefresh() {
      if (!this._pocketRefreshSourceId) return;
      GLib.Source.remove(this._pocketRefreshSourceId);
      this._pocketRefreshSourceId = 0;
    }

    _buildVisualizer() {
      for (let i = 0; i < 5; i++) {
        const bar = new St.Bin({
          style_class: "sqt-sound-visualizer-bar",
          y_align: Clutter.ActorAlign.END,
        });
        bar.set_style(
          "min-width: 2px; min-height: 14px; border-radius: 1px; background-color: currentColor;"
        );
        bar.set_pivot_point(0.5, 1.0);
        bar.scale_y = 0.22;
        this._visualizer.add_child(bar);
        this._visualizerBars.push(bar);
      }
    }

    _startMediaRefresh() {
      if (this._mediaRefreshSourceId) return;
      this._mediaRefreshSourceId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        MEDIA_REFRESH_INTERVAL_SECONDS,
        () => {
          this._refreshMediaState();
          return GLib.SOURCE_CONTINUE;
        }
      );
    }

    _stopMediaRefresh() {
      if (!this._mediaRefreshSourceId) return;
      GLib.Source.remove(this._mediaRefreshSourceId);
      this._mediaRefreshSourceId = 0;
    }

    _refreshMediaState() {
      const media = this._getCurrentMedia();
      this._currentMedia = media;

      const playing = media !== null;
      if (playing === this._isMediaPlaying) return;

      this._isMediaPlaying = playing;
      this._syncVisualizerState();
    }

    _syncVisualizerState() {
      if (this._isMediaPlaying) {
        this._iconBox.visible = false;
        this._visualizer.visible = true;
        this._startVisualizerAnimation();
        return;
      }

      this._stopVisualizerAnimation();
      this._visualizer.visible = false;
      this._iconBox.visible = true;
      this._resetVisualizer();
    }

    _startVisualizerAnimation() {
      if (this._visualizerSourceId) return;

      this._tickVisualizer();
      this._visualizerSourceId = GLib.timeout_add(
        GLib.PRIORITY_DEFAULT,
        VISUALIZER_TICK_MS,
        () => {
          if (!this._isMediaPlaying) {
            this._visualizerSourceId = 0;
            return GLib.SOURCE_REMOVE;
          }

          this._tickVisualizer();
          return GLib.SOURCE_CONTINUE;
        }
      );
    }

    _stopVisualizerAnimation() {
      if (!this._visualizerSourceId) return;
      GLib.Source.remove(this._visualizerSourceId);
      this._visualizerSourceId = 0;
    }

    _tickVisualizer() {
      const profile = [0.42, 0.72, 1.0, 0.72, 0.42];
      const amplitude = this._muted ? 0.2 : Math.max(0.35, this._volume);

      for (let i = 0; i < this._visualizerBars.length; i++) {
        const bar = this._visualizerBars[i];
        const jitter = 0.55 + Math.random() * 0.9;
        const targetScale = Math.max(
          0.15,
          Math.min(1, profile[i] * amplitude * jitter)
        );
        bar.remove_all_transitions();
        bar.ease({
          scale_y: targetScale,
          duration: VISUALIZER_TICK_MS - 20,
          mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
      }
    }

    _resetVisualizer() {
      for (const bar of this._visualizerBars) {
        bar.remove_all_transitions();
        bar.scale_y = 0.22;
      }
    }

    _getCurrentMedia() {
      const out = spawnSync([
        "gdbus",
        "call",
        "--session",
        "--dest",
        "org.freedesktop.DBus",
        "--object-path",
        "/org/freedesktop/DBus",
        "--method",
        "org.freedesktop.DBus.ListNames",
      ]);
      if (!out) return null;

      const names = out.match(/'org\.mpris\.MediaPlayer2\.[^']+'/g) ?? [];
      if (names.length === 0) return null;

      const players = names.map((name) => name.slice(1, -1));

      for (const player of players) {
        const statusOut = spawnSync([
          "gdbus",
          "call",
          "--session",
          "--dest",
          player,
          "--object-path",
          "/org/mpris/MediaPlayer2",
          "--method",
          "org.freedesktop.DBus.Properties.Get",
          "org.mpris.MediaPlayer2.Player",
          "PlaybackStatus",
        ]);

        if (!statusOut || !statusOut.includes("Playing")) continue;

        const metadataOut = spawnSync([
          "gdbus",
          "call",
          "--session",
          "--dest",
          player,
          "--object-path",
          "/org/mpris/MediaPlayer2",
          "--method",
          "org.freedesktop.DBus.Properties.Get",
          "org.mpris.MediaPlayer2.Player",
          "Metadata",
        ]);

        if (!metadataOut) continue;

        const titleMatch = metadataOut.match(/'xesam:title':\s*<'([^']*)'>/);
        const artistListMatch = metadataOut.match(
          /'xesam:artist':\s*<\[([^\]]*)\]>/
        );

        const artistNames = [];
        if (artistListMatch?.[1]) {
          for (const match of artistListMatch[1].matchAll(/'([^']+)'/g)) {
            if (match[1]) artistNames.push(match[1]);
          }
        }

        const playerName = player.replace("org.mpris.MediaPlayer2.", "");
        return {
          player: playerName,
          title: titleMatch?.[1] ?? "",
          artist: artistNames.join(", "),
        };
      }

      return null;
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
      this._stopPocketRefresh();
      this._stopMediaRefresh();
      this._stopVisualizerAnimation();
      for (const id of this._signalIds) {
        if (id) this.disconnect(id);
      }
      this._signalIds = [];
      this._pocket = null;
      this._currentMedia = null;
      this._visualizerBars = [];
      super.destroy();
    }
  }
);

export default SoundIndicator;
