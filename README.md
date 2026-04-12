# Separate Quick Toggles

A GNOME Shell extension that replaces the default combined Quick Settings panel with individual, customizable status indicators on the panel.

## Features

- **Separate Indicators**: Replaces the default wifi/sound/battery button with individual icons for Wi-Fi, Bluetooth, Sound, and Battery
- **Dynamic WiFi Icon**: Wi-Fi indicator shows real-time signal strength (offline, disconnected, weak, ok, good, excellent)
- **Customizable Order**: Drag and drop to reorder panel indicators
- **Show/Hide Toggles**: Enable or disable individual indicators as needed
- **Compact Mode**: Option to use iOS-style compact mode with a single ☰ icon
- **Battery Percentage**: Optional display of battery percentage next to the icon
- **Single Quick Settings Icon**: The default GNOME Quick Settings button is replaced with a single compact gear icon

## Installation

1. Clone or download this extension to your GNOME extensions directory:
   ```bash
   ~/.local/share/gnome-shell/extensions/separate-quick-toggles@extension/
   ```

2. Compile the schema:
   ```bash
   glib-compile-schemas ~/.local/share/gnome-shell/extensions/separate-quick-toggles@extension/schemas/
   ```

3. Enable the extension:
   ```bash
   gnome-extensions enable separate-quick-toggles@extension
   ```

4. Restart GNOME Shell or log out and back in:
   - Press `Alt`+`F2`, type `r`, and press Enter (on X11)
   - Or log out and back in (on Wayland)

## Configuration

Open GNOME Settings and navigate to **Extensions** → **Separate Quick Toggles** to configure:

- **Panel Indicators**: Reorder and toggle visibility of individual status indicators
- **Compact Mode**: Enable iOS-style compact mode (single icon for all indicators)
- **Battery**: Show or hide battery percentage label

## Indicators

### Wi-Fi
- Shows connection status
- Dynamic icon reflects current signal strength
- Click to open Wi-Fi menu with available networks
- Refresh button to scan for networks

### Bluetooth
- Shows Bluetooth on/off status
- Lists paired devices
- Toggle Bluetooth on/off

### Sound
- Volume slider for audio control
- Mute/unmute toggle
- Visual volume indicator

### Battery
- Displays current battery percentage and charging status
- Optional percentage label on panel
- Time remaining estimate (charging or discharging)

### Notifications
- Shows notification indicator
- Lists recent notifications

## Quick Settings Customization

The default GNOME Quick Settings button in the top-right corner is now replaced with a single compact gear icon (emblem-system-symbolic) that:
- Maintains the same functionality
- Takes up minimal panel space
- Matches the size of the individual indicators

## Files

- `extension.js` - Main extension logic
- `prefs.js` - Preferences/settings UI
- `stylesheet.css` - Visual styling
- `metadata.json` - Extension metadata
- `schemas/org.gnome.shell.extensions.separate-quick-toggles.gschema.xml` - GSettings schema

## License

This extension is provided as-is for personal use.

## Troubleshooting

If indicators don't appear after installation:
1. Make sure the schema is compiled: `glib-compile-schemas ~/.local/share/gnome-shell/extensions/separate-quick-toggles@extension/schemas/`
2. Restart GNOME Shell (`Alt`+`F2`, `r`, `Enter`)
3. Check if the extension is enabled in GNOME Settings

If the WiFi icon isn't updating:
- Make sure NetworkManager is installed and running
- The dynamic icon updates based on the active access point signal strength

## Notes

- Requires GNOME Shell 40 or later
- Compatible with both X11 and Wayland
- The extension automatically restores the default Quick Settings appearance when disabled
