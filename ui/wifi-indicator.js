"use strict";

import GObject from "gi://GObject";
import St from "gi://St";
import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import {
  makeProxy,
  openControlCenter,
  spawnAsync,
  spawnSync,
  wifiSignalIcon,
} from "../lib/utils.js";

const NM_STATE_CONNECTED_LOCAL = 50;
const SPEED_SAMPLE_INTERVAL_SECONDS = 1;
const ACTIVE_WIFI_REFRESH_INTERVAL_SECONDS = 4;

const WifiIndicator = GObject.registerClass(
  class WifiIndicator extends PanelMenu.Button {
    _init(pocket = null) {
      super._init(0.0, _("Wi-Fi"));
      this._pocket = pocket;
      this._signalIds = [];
      this._speedSampleSourceId = 0;
      this._pocketRefreshSourceId = 0;
      this._activeWifiRefreshSourceId = 0;
      this._lastCounters = null;
      this._downloadRateText = "0 B/s";
      this._uploadRateText = "0 B/s";
      this._hasThroughputSample = false;
      this._currentSsid = "";
      this._currentStrength = 0;
      this._activeIface = "";
      this._activeInfoInFlight = false;
      this._isHovering = false;
      this._icon = new St.Icon({
        icon_name: "network-wireless-offline-symbolic",
        style_class: "system-status-icon",
      });
      this.add_child(this._icon);

      this._proxy = makeProxy(
        Gio.DBus.system,
        "org.freedesktop.NetworkManager",
        "/org/freedesktop/NetworkManager",
        "org.freedesktop.NetworkManager"
      );
      if (this._proxy) {
        this._proxySignalId = this._proxy.connect("g-properties-changed", () =>
          this._updateIcon()
        );
        this._updateIcon();
      }
      if (this._pocket) {
        this._signalIds.push(
          this.connect("enter-event", () => {
            this._isHovering = true;
            this._showPocket();
            this._startPocketRefresh();
            this._refreshActiveWifiInfoAsync();
          })
        );
        this._signalIds.push(
          this.connect("leave-event", () => {
            this._isHovering = false;
            this._stopPocketRefresh();
            this._pocket.hide();
          })
        );
      }
      this._startSpeedSampling();
      this._startActiveWifiRefresh();
      this._buildMenu();
    }

    _getPocketData() {
      const wifiOn =
        this._proxy?.get_cached_property("WirelessEnabled")?.unpack() ?? false;
      const state = this._proxy?.get_cached_property("State")?.unpack() ?? 0;
      if (!wifiOn)
        return {
          value: _("Off"),
          iconName: "network-wireless-offline-symbolic",
        };
      if (state < NM_STATE_CONNECTED_LOCAL)
        return {
          value: _("Not connected"),
          iconName: "network-wireless-disconnected-symbolic",
        };

      // Deterministic fallback: populate SSID/interface once when cache is empty.
      if (!this._currentSsid) this._hydrateActiveFromNmcliSync();

      if (!this._currentSsid) this._refreshFromActiveAccessPoint();

      const ssid = this._currentSsid || _("Connected");
      const speedText = ` · ↓ ${this._downloadRateText} ↑ ${this._uploadRateText}`;
      return {
        value: `${ssid}${speedText}`,
        iconName:
          this._currentStrength > 0
            ? wifiSignalIcon(this._currentStrength, true)
            : this._icon.icon_name || "network-wireless-connected-symbolic",
      };
    }

    _hydrateActiveFromNmcliSync() {
      const out = spawnSync([
        "nmcli",
        "-t",
        "-f",
        "DEVICE,TYPE,CONNECTION",
        "device",
        "status",
      ]);
      const active = this._parseActiveWifiInterface(out);
      if (!active) return;

      this._activeIface = active.iface ?? this._activeIface;
      if (active.connection && active.connection !== "--") {
        this._currentSsid = active.connection;
      }
    }

    _showPocket() {
      if (!this._pocket) return;
      const pocketData = this._getPocketData();
      this._pocket.cancelHide();
      this._pocket.show(this, _("Wi-Fi"), pocketData.value, "#4ade80", {
        iconName: pocketData.iconName,
      });
    }

    _startPocketRefresh() {
      if (this._pocketRefreshSourceId) return;
      this._pocketRefreshSourceId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        1,
        () => {
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

    _startSpeedSampling() {
      this._sampleSpeed();
      this._speedSampleSourceId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        SPEED_SAMPLE_INTERVAL_SECONDS,
        () => {
          this._sampleSpeed();
          return GLib.SOURCE_CONTINUE;
        }
      );
    }

    _startActiveWifiRefresh() {
      this._refreshActiveWifiInfoAsync();
      this._activeWifiRefreshSourceId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        ACTIVE_WIFI_REFRESH_INTERVAL_SECONDS,
        () => {
          this._refreshActiveWifiInfoAsync();
          return GLib.SOURCE_CONTINUE;
        }
      );
    }

    _refreshActiveWifiInfoAsync() {
      if (this._activeInfoInFlight) return;

      const wifiOn =
        this._proxy?.get_cached_property("WirelessEnabled")?.unpack() ?? false;
      const state = this._proxy?.get_cached_property("State")?.unpack() ?? 0;
      if (!wifiOn || state < NM_STATE_CONNECTED_LOCAL) {
        this._currentSsid = "";
        this._currentStrength = 0;
        this._activeIface = "";
        this._lastCounters = null;
        this._setThroughput("0 B/s", "0 B/s", false);
        return;
      }

      this._activeInfoInFlight = true;
      this._runCommandAsync(
        [
          "nmcli",
          "-t",
          "-f",
          "IN-USE,SSID,SIGNAL",
          "dev",
          "wifi",
          "list",
          "--rescan",
          "no",
        ],
        (out) => {
          const active = this._parseActiveWifiList(out);
          if (active) {
            this._activeInfoInFlight = false;
            this._currentSsid = active.ssid;
            this._currentStrength = active.strength;
            this._refreshActiveIfaceAsync(() => {
              // Pocket content refresh is driven by timer while hovering.
            });
            return;
          }

          this._runCommandAsync(
            [
              "nmcli",
              "-t",
              "-f",
              "TYPE,NAME",
              "connection",
              "show",
              "--active",
            ],
            (activeOut) => {
              this._activeInfoInFlight = false;
              const fallbackSsid = this._parseActiveConnectionName(activeOut);
              if (fallbackSsid) {
                this._currentSsid = fallbackSsid;
              } else {
                this._refreshFromActiveAccessPoint();
              }
              this._refreshActiveIfaceAsync(() => {
                // Pocket content refresh is driven by timer while hovering.
              });
            }
          );
        }
      );
    }

    _refreshActiveIfaceAsync(done = null) {
      this._runCommandAsync(
        ["nmcli", "-t", "-f", "DEVICE,TYPE,CONNECTION", "device", "status"],
        (out) => {
          const active = this._parseActiveWifiInterface(out);
          this._activeIface = active?.iface ?? "";
          if (active?.connection && active.connection !== "--") {
            this._currentSsid = active.connection;
          }
          done?.();
        }
      );
    }

    _parseActiveWifiList(out) {
      if (!out) return null;

      const lines = out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const markedLine = lines.find(
        (line) =>
          line.startsWith("*:") ||
          line.startsWith("yes:") ||
          line.startsWith("true:")
      );

      if (markedLine) {
        const parts = this._parseNmcliLine(markedLine);
        const ssid = (parts[1] ?? "").trim();
        const strength = parseInt(parts[2] ?? "0", 10) || 0;
        if (ssid) return { ssid, strength };
      }

      // Fallback: if IN-USE marker is missing, pick strongest visible SSID.
      let best = null;
      for (const line of lines) {
        const parts = this._parseNmcliLine(line);
        const ssid = (parts[1] ?? "").trim();
        if (!ssid) continue;
        const strength = parseInt(parts[2] ?? "0", 10) || 0;
        if (!best || strength > best.strength) best = { ssid, strength };
      }

      return best;
    }

    _parseActiveConnectionName(out) {
      if (!out) return "";

      for (const rawLine of out.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const parts = this._parseNmcliLine(line);
        const type = (parts[0] ?? "").trim();
        const name = (parts[1] ?? "").trim();
        if ((type === "802-11-wireless" || type === "wifi") && name)
          return name;
      }

      return "";
    }

    _refreshFromActiveAccessPoint() {
      try {
        const activeApPath = this._proxy
          ?.get_cached_property("ActiveAccessPoint")
          ?.unpack();
        if (!activeApPath || activeApPath === "/") return;

        const apProxy = makeProxy(
          Gio.DBus.system,
          "org.freedesktop.NetworkManager",
          activeApPath,
          "org.freedesktop.NetworkManager.AccessPoint"
        );
        if (!apProxy) return;

        const rawSsid = apProxy.get_cached_property("Ssid")?.unpack();
        const ssid = this._decodeSsid(rawSsid);
        const strength = apProxy.get_cached_property("Strength")?.unpack() ?? 0;
        if (ssid) this._currentSsid = ssid;
        this._currentStrength = strength;
      } catch (_e) {}
    }

    _parseActiveWifiInterface(out) {
      if (!out) return null;

      let fallbackIface = "";

      for (const rawLine of out.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const parts = this._parseNmcliLine(line);
        const iface = (parts[0] ?? "").trim();
        const type = (parts[1] ?? "").trim();
        const connection = (parts[2] ?? "").trim();
        if (type !== "wifi" && type !== "802-11-wireless") continue;
        if (!iface) continue;
        if (!fallbackIface) fallbackIface = iface;
        if (connection && connection !== "--") {
          return { iface, connection };
        }
      }

      if (fallbackIface) return { iface: fallbackIface, connection: "" };
      return null;
    }

    _sampleSpeed() {
      const iface = this._activeIface || this._detectWirelessInterface();
      if (!iface) {
        this._lastCounters = null;
        this._setThroughput("0 B/s", "0 B/s", false);
        return;
      }

      const counters = this._readInterfaceCounters(iface);
      if (!counters) {
        this._lastCounters = null;
        this._setThroughput("0 B/s", "0 B/s", false);
        return;
      }

      const nowUs = GLib.get_monotonic_time();
      if (!this._lastCounters || this._lastCounters.iface !== iface) {
        this._lastCounters = {
          iface,
          rxBytes: counters.rxBytes,
          txBytes: counters.txBytes,
          tsUs: nowUs,
        };
        this._setThroughput("0 B/s", "0 B/s", false);
        return;
      }

      const elapsedSeconds = (nowUs - this._lastCounters.tsUs) / 1000000;
      if (elapsedSeconds > 0.1) {
        const rxDelta = Math.max(
          0,
          counters.rxBytes - this._lastCounters.rxBytes
        );
        const txDelta = Math.max(
          0,
          counters.txBytes - this._lastCounters.txBytes
        );
        const downRate = this._formatBytesPerSecond(rxDelta / elapsedSeconds);
        const upRate = this._formatBytesPerSecond(txDelta / elapsedSeconds);
        this._setThroughput(downRate, upRate, true);
      }

      this._lastCounters = {
        iface,
        rxBytes: counters.rxBytes,
        txBytes: counters.txBytes,
        tsUs: nowUs,
      };
    }

    _readInterfaceCounters(iface) {
      const out = this._readTextFile("/proc/net/dev");
      if (!out) return null;

      for (const rawLine of out.split("\n")) {
        const line = rawLine.trim();
        if (!line.startsWith(`${iface}:`)) continue;
        const [namePart, statsPart] = line.split(":");
        if (!namePart || !statsPart) continue;
        const fields = statsPart
          .trim()
          .split(/\s+/)
          .map((v) => parseInt(v, 10));
        if (fields.length < 16) continue;
        return {
          rxBytes: Number.isFinite(fields[0]) ? fields[0] : 0,
          txBytes: Number.isFinite(fields[8]) ? fields[8] : 0,
        };
      }

      return null;
    }

    _readTextFile(path) {
      try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok || !bytes) return "";
        return new TextDecoder("utf-8").decode(bytes);
      } catch (_e) {
        return "";
      }
    }

    _detectWirelessInterface() {
      const out = this._readTextFile("/proc/net/wireless");
      if (!out) return "";

      const lines = out.split("\n");
      for (let i = 2; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const idx = line.indexOf(":");
        if (idx <= 0) continue;
        return line.substring(0, idx).trim();
      }

      return "";
    }

    _setThroughput(downRateText, upRateText, hasSample) {
      const changed =
        this._downloadRateText !== downRateText ||
        this._uploadRateText !== upRateText ||
        this._hasThroughputSample !== hasSample;
      if (!changed) return;

      this._downloadRateText = downRateText;
      this._uploadRateText = upRateText;
      this._hasThroughputSample = hasSample;
      if (this._isHovering) this._showPocket();
    }

    _formatBytesPerSecond(bytesPerSecond) {
      if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0)
        return "0 B/s";
      const units = ["B/s", "KB/s", "MB/s", "GB/s"];
      let value = bytesPerSecond;
      let unitIndex = 0;
      while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
      }

      const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
      return `${value.toFixed(decimals)} ${units[unitIndex]}`;
    }

    _decodeSsid(rawSsid) {
      if (!rawSsid) return "";
      if (typeof rawSsid === "string") return rawSsid;

      let bytes = rawSsid;
      if (rawSsid instanceof Uint8Array) bytes = Array.from(rawSsid);
      if (!Array.isArray(bytes) || bytes.length === 0) return "";

      const filtered = bytes.filter((b) => b > 0);
      try {
        return new TextDecoder("utf-8").decode(Uint8Array.from(filtered));
      } catch (_e) {
        return String.fromCharCode(...filtered);
      }
    }

    _updateIcon() {
      const wifiOn =
        this._proxy?.get_cached_property("WirelessEnabled")?.unpack() ?? false;
      const state = this._proxy?.get_cached_property("State")?.unpack() ?? 0;

      if (!wifiOn) {
        this._currentSsid = "";
        this._currentStrength = 0;
        this._activeIface = "";
        this._lastCounters = null;
        this._setThroughput("0 B/s", "0 B/s", false);
        this._icon.icon_name = "network-wireless-offline-symbolic";
      } else if (state >= NM_STATE_CONNECTED_LOCAL) {
        const activeApPath = this._proxy
          ?.get_cached_property("ActiveAccessPoint")
          ?.unpack();
        if (activeApPath && activeApPath !== "/") {
          GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            try {
              const apProxy = makeProxy(
                Gio.DBus.system,
                "org.freedesktop.NetworkManager",
                activeApPath,
                "org.freedesktop.NetworkManager.AccessPoint"
              );
              if (apProxy) {
                const rawSsid = apProxy.get_cached_property("Ssid")?.unpack();
                const strength =
                  apProxy.get_cached_property("Strength")?.unpack() ?? 0;
                this._currentSsid =
                  this._decodeSsid(rawSsid) || _("Hidden network");
                this._currentStrength = strength;
                this._icon.icon_name = wifiSignalIcon(strength, true);
              }
            } catch (_e) {}
            return GLib.SOURCE_REMOVE;
          });
        } else {
          this._refreshActiveWifiInfoAsync();
          this._icon.icon_name = "network-wireless-connected-symbolic";
        }
      } else if (state >= 40) {
        // Keep last known SSID/iface during transient states to avoid flicker to fallback text.
        this._icon.icon_name = "network-wireless-signal-good-symbolic";
      } else {
        this._currentSsid = "";
        this._currentStrength = 0;
        this._activeIface = "";
        this._lastCounters = null;
        this._setThroughput("0 B/s", "0 B/s", false);
        this._icon.icon_name = "network-wireless-disconnected-symbolic";
      }
    }

    _runCommandAsync(argv, done) {
      try {
        const command = argv.map((part) => GLib.shell_quote(part)).join(" ");
        const proc = new Gio.Subprocess({
          argv: ["/bin/sh", "-lc", command],
          flags:
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
        });

        proc.communicate_utf8_async(null, null, (_p, res) => {
          try {
            const [, stdout] = proc.communicate_utf8_finish(res);
            done(stdout ?? "");
          } catch (_e) {
            done("");
          }
        });
      } catch (_e) {
        done("");
      }
    }

    _parseNmcliLine(line) {
      const fields = [];
      let current = "";
      let escaping = false;

      for (const ch of line) {
        if (escaping) {
          current += ch;
          escaping = false;
          continue;
        }

        if (ch === "\\") {
          escaping = true;
          continue;
        }

        if (ch === ":") {
          fields.push(current);
          current = "";
          continue;
        }

        current += ch;
      }

      fields.push(current);
      return fields;
    }

    _buildMenu() {
      const headerRow = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
      });
      headerRow.set_style("padding: 4px 12px;");
      const headerBox = new St.BoxLayout({ x_expand: true });
      headerBox.add_child(
        new St.Label({
          text: _("Wi-Fi"),
          y_align: Clutter.ActorAlign.CENTER,
          x_expand: true,
        })
      );
      const wifiLabel = headerBox.get_last_child();
      if (wifiLabel)
        wifiLabel.set_style("font-weight: bold; font-size: 1.05em;");
      const refreshBtn = new St.Button({
        style_class: "icon-button",
        child: new St.Icon({
          icon_name: "view-refresh-symbolic",
          icon_size: 14,
        }),
      });
      refreshBtn.set_style("padding: 4px;");
      refreshBtn.connect("clicked", () => {
        refreshBtn.reactive = false;
        this._scanNetworks(() => {
          refreshBtn.reactive = true;
        });
      });
      headerBox.add_child(refreshBtn);
      headerRow.add_child(headerBox);
      this.menu.addMenuItem(headerRow);
      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

      this._toggleItem = new PopupMenu.PopupSwitchMenuItem(_("Wi-Fi"), false);
      this._toggleItem.connect("toggled", (_i, s) => this._setWifi(s));
      this.menu.addMenuItem(this._toggleItem);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      this._netSection = new PopupMenu.PopupMenuSection();
      this.menu.addMenuItem(this._netSection);

      this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
      const s = new PopupMenu.PopupMenuItem(_("Network Settings…"));
      s.connect("activate", () => openControlCenter("wifi"));
      this.menu.addMenuItem(s);

      this.menu.connect("open-state-changed", (_m, open) => {
        if (open) this._refresh();
      });
    }

    _refresh() {
      const wifiOn =
        this._proxy?.get_cached_property("WirelessEnabled")?.unpack() ?? false;
      this._toggleItem.setToggleState(wifiOn);
      this._scanNetworks();
    }

    _setWifi(enabled) {
      try {
        this._proxy?.call(
          "org.freedesktop.DBus.Properties.Set",
          new GLib.Variant("(ssv)", [
            "org.freedesktop.NetworkManager",
            "WirelessEnabled",
            new GLib.Variant("b", enabled),
          ]),
          Gio.DBusCallFlags.NONE,
          -1,
          null,
          null
        );
      } catch (_e) {}
    }

    _scanNetworks(done) {
      this._netSection.removeAll();
      const ph = new PopupMenu.PopupMenuItem(_("Scanning…"), {
        reactive: false,
      });
      ph.label.style = "font-style: italic; opacity: 0.55;";
      this._netSection.addMenuItem(ph);

      this._runCommandAsync(
        [
          "nmcli",
          "-t",
          "-f",
          "SSID,SIGNAL,SECURITY,IN-USE",
          "dev",
          "wifi",
          "list",
        ],
        (asyncOut) => {
          const out =
            asyncOut ||
            spawnSync([
              "nmcli",
              "-t",
              "-f",
              "SSID,SIGNAL,SECURITY,IN-USE",
              "dev",
              "wifi",
              "list",
            ]) ||
            "";

          this._netSection.removeAll();

          if (!out) {
            this._netSection.addMenuItem(
              new PopupMenu.PopupMenuItem(_("Wi-Fi unavailable"), {
                reactive: false,
              })
            );
            done?.();
            return;
          }

          const seen = new Set();
          let count = 0;
          for (const line of out.trim().split("\n")) {
            if (!line || count >= 10) continue;
            const parts = this._parseNmcliLine(line);
            if (parts.length < 4) continue;
            const ssid = parts[0].trim();
            const signal = parseInt(parts[1], 10) || 0;
            const security = parts[2].trim();
            const inUse =
              parts[3].trim() === "*" ||
              parts[3].trim() === "yes" ||
              parts[3].trim() === "true";
            if (!ssid || seen.has(ssid)) continue;
            seen.add(ssid);
            count++;

            const item = new PopupMenu.PopupBaseMenuItem();
            item.add_child(
              new St.Icon({
                icon_name: wifiSignalIcon(signal),
                style_class: "popup-menu-icon",
              })
            );
            item.add_child(
              new St.Label({
                text: ssid,
                y_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                style: inUse ? "font-weight: bold;" : "",
              })
            );

            if (security && security !== "--")
              item.add_child(
                new St.Icon({
                  icon_name: "channel-secure-symbolic",
                  style_class: "popup-menu-icon",
                })
              );

            if (inUse)
              item.add_child(
                new St.Icon({
                  icon_name: "object-select-symbolic",
                  style_class: "popup-menu-icon",
                })
              );

            item.connect("activate", () => {
              if (!inUse) spawnAsync(["nmcli", "dev", "wifi", "connect", ssid]);
            });
            this._netSection.addMenuItem(item);
          }

          if (count === 0)
            this._netSection.addMenuItem(
              new PopupMenu.PopupMenuItem(_("No networks found"), {
                reactive: false,
              })
            );

          done?.();
        }
      );
    }

    destroy() {
      this._stopPocketRefresh();
      this._isHovering = false;
      if (this._activeWifiRefreshSourceId) {
        GLib.Source.remove(this._activeWifiRefreshSourceId);
        this._activeWifiRefreshSourceId = 0;
      }
      if (this._speedSampleSourceId) {
        GLib.Source.remove(this._speedSampleSourceId);
        this._speedSampleSourceId = 0;
      }
      for (const id of this._signalIds) {
        if (id) this.disconnect(id);
      }
      this._signalIds = [];
      if (this._proxy && this._proxySignalId) {
        this._proxy.disconnect(this._proxySignalId);
        this._proxySignalId = 0;
      }
      this._proxy = null;
      this._pocket = null;
      super.destroy();
    }
  }
);

export default WifiIndicator;
