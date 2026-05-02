"use strict";

import BatteryIndicator from "./battery-indicator.js";
import BluetoothIndicator from "./bluetooth-indicator.js";
import NotificationIndicator from "./notification-indicator.js";
import SoundIndicator from "./sound-indicator.js";
import WifiIndicator from "./wifi-indicator.js";

export function createIndicator(id, settings, pocket) {
  switch (id) {
    case "wifi":
      return new WifiIndicator(pocket);
    case "bluetooth":
      return new BluetoothIndicator(pocket);
    case "sound":
      return new SoundIndicator(pocket);
    case "battery":
      return new BatteryIndicator(settings, pocket);
    case "notification":
      return new NotificationIndicator();
    default:
      return null;
  }
}
