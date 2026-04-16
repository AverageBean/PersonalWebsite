# Train Detection Project

## Overview
Real-time train detection system using hardware-based sound detection coupled with Home Assistant integration for apartment environmental control and light scheduling. Detects train passage via envelope-detected sound levels and automatically increases AC Infinity fan speed for pressure compensation.

## Hardware Stack
- **Sound Detector**: SparkFun SEN-12642 analog sound level sensor
  - Output: AUDIO pin (analog envelope voltage, 0–3.3V) + GATE pin (digital threshold)
  - Sensitivity: adjustable via onboard potentiometer
- **Microcontroller**: ESP32 DevKit (replaces Arduino R3)
  - Built-in WiFi, 12-bit ADC, GPIO pin compatibility
  - Runs ESPHome firmware for seamless HA integration
- **Integration**: Home Assistant with:
  - ESPHome native API (auto-discovery, OTA updates)
  - dalinicus/homeassistant-acinfinity (AC Infinity fan control)
  - Automation rules for fan speed ramping
- **Control Application**: Air purifier fan speed control (ramped to 80% on detection, restored after passage)

## Hardware Wiring

| SEN-12642 Pin | ESP32 Pin | Notes |
|---|---|---|
| VCC | 3.3V | Power supply (SEN-12642 operates 3.3–5V) |
| GND | GND | Ground |
| AUDIO | GPIO34 | Analog envelope output; input-only ADC1 channel (safe from accidental output) |
| GATE | GPIO35 | Digital threshold output; optional fast-path trigger |

**Rationale**: GPIO34/35 are ADC1 channels; ADC2 conflicts with WiFi on ESP32. Both are input-only, preventing accidental damage.

## Firmware Architecture

### ESPHome Configuration (`firmware/train-detector.yaml`)
- **ADC Sensor**: reads AUDIO pin every 50ms, 12-bit resolution
- **Filtering Chain**:
  1. Normalize to 0–3.3V range
  2. Sliding window average (10 samples @ 50ms = 500ms window) for noise rejection
- **Detection Logic**:
  - `train_detected` binary sensor: ON when smoothed level > threshold
  - `delayed_on: 2s` → must sustain above threshold for 2 seconds (rejects brief bangs)
  - `delayed_off: 45s` → covers full train passage duration; stays ON for 45s after level drops
- **Tunable Threshold**: exposed as Home Assistant `number.train_detector_detection_threshold`
  - Range: 20–95% (configurable without reflashing)
  - Initial value: 65% (tunable from HA UI)
  - Saved between reboots via `restore_value: yes`
- **OTA Firmware Updates**: passwordless updates via HA (with encryption key)
- **Status LED**: GPIO2 for visual feedback

### Threshold Calibration Strategy
1. Deploy device and observe baseline ambient level (silence)
2. Record peak during passing train
3. Set threshold = baseline + 40% × (peak − baseline)
4. Fine-tune via HA number entity without reflashing

**Example calibration**:
- Baseline ambient: 20%
- Train peak: 85%
- Threshold = 20 + 0.4 × (85 − 20) = 20 + 26 = 46% (conservative for rejecting false positives)

## Home Assistant Integration

### 3a. ESPHome Device
Once firmware is deployed, Home Assistant auto-discovers the ESP32 and exposes:
- `sensor.train_detector_sound_level` (float, 0–100%)
- `binary_sensor.train_detector_train_detected` (on/off)
- `number.train_detector_detection_threshold` (tunable, 20–95%)

Add via HA UI: **Settings → Devices & Services → ESPHome** (auto-discovery on LAN)

### 3b. AC Infinity Integration
Install via HACS: `dalinicus/homeassistant-acinfinity`
Provides: `fan.controller_69_pro` (speed 0–10 or percentage 0–100)
Requires: AC Infinity cloud credentials in Home Assistant `configuration.yaml`

### 3c. Automation Rules
Two automations (see `ha-config/automations-train.yaml`):

**Automation 1 — Train Detected (ramp up)**
- Trigger: `binary_sensor.train_detected` → ON
- Actions:
  1. Save current fan percentage to helper `input_number.acinfinity_saved_speed`
  2. Set `fan.controller_69_pro` to 80% (speed 8/10)

**Automation 2 — Train Passed (restore)**
- Trigger: `binary_sensor.train_detected` → OFF
- Action: Restore fan to saved percentage (default 30% if none saved)

### 3d. Helper Entity
Create `input_number.acinfinity_saved_speed` (see `ha-config/helpers-train.yaml`):
- Stores pre-train fan percentage
- Range: 0–100%, default 30%
- Slider mode in HA UI for manual adjustment

## Website Integration

### Data Source
- Browser polls HA REST API: `/api/states/binary_sensor.train_detected`
- Fetches sound level from: `/api/states/sensor.train_detector_sound_level`
- History via: `/api/history/period/2026-04-13?filter_entity_id=sensor.train_detector_sound_level`

### Train Detection Panel (`js/app.js` + `index.html`)
- **Live Indicator**: "Train Passing" / "Clear" with visual highlight
- **Event Log**: table of recent detections (timestamp, duration, peak level)
- **24-Hour Chart**: sound level history from HA (using Chart.js or similar)

## File Locations

| File | Purpose |
|---|---|
| `firmware/train-detector.yaml` | ESPHome YAML configuration (main) |
| `firmware/secrets.yaml` | WiFi SSID, passwords, encryption key (gitignored) |
| `ha-config/automations-train.yaml` | HA automation rules (reference) |
| `ha-config/helpers-train.yaml` | HA helper definitions (reference) |
| `docs/train-detection-project.md` | This file |
| `js/app.js` | Website train detection tab UI |
| `index.html` | HTML tab for train detection panel |

## Project Goals
1. ✓ Detect train passage events from ambient sound levels via SEN-12642
2. ✓ Trigger Home Assistant automation routines upon detection
3. ✓ Control AC Infinity fan speed (80% on detection, restore post-passage)
4. ⧗ Coordinate light scheduling with detection events (planned)
5. ⧗ Display detection status and analytics on personal website (in progress)

## Current Status
- **Phase**: Hardware firmware complete, HA automation template ready, website panel in progress
- **Completed**:
  - ESPHome firmware with ADC sensing, filtering, and tunable threshold
  - HA automation YAML for fan control
  - Helper entities for state management
- **In Progress**:
  - Website train detection panel (live indicator, event log, chart)
- **Next Steps**:
  - Validate ESPHome compilation and device connectivity
  - Calibrate SEN-12642 threshold during actual train passage
  - Test HA automations manually before live deployment
  - Implement website panel with HA REST API polling
  - Add light scheduling automations (optional Phase 2)

## Integration Resources
- **ESPHome Documentation**: https://esphome.io/ (YAML syntax, sensor/binary_sensor components)
- **Home Assistant**: https://www.home-assistant.io/ (automation, developer tools, API)
- **AC Infinity Integration**: [dalinicus/homeassistant-acinfinity](https://github.com/dalinicus/homeassistant-acinfinity)
  - Supports Controller 69 Pro and other AC Infinity devices
  - Cloud API-based; requires AC Infinity account credentials
- **SEN-12642 Datasheet**: https://www.sparkfun.com/products/12642

## Technical Notes
- SEN-12642 envelope output is ratiometric; quiet room ≈ 0.2V, train ≈ 2.5V
- ESP32 ADC is 12-bit (4095 counts) with some nonlinearity; ESPHome filters mitigate
- WiFi connection priority: fast_connect (single AP) → captive portal for fallback
- OTA updates require matching WiFi SSID and HA API encryption key
- Train passage detection assumes sound signatures > 45 seconds (delayed_off duration)
