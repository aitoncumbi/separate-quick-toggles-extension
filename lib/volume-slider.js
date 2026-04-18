"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";

import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

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
      const knobR = 7;
      const trackY = h / 2;
      const trackH = 4;
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
      const tw = this._track.width;
      const knobR = 7;
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

export default VolumeSliderItem;
