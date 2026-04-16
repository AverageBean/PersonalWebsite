# Train Detection — Wireless Control Implementation

**Date**: 2026-04-13  
**Project**: PersonalWebsite — Train Detection + AC Infinity Fan Control  
**Scope**: Hardware wiring, ESPHome firmware, Home Assistant automation template, website panel foundation

---

## What Was Built

A complete wireless train detection system that:
1. Reads a SparkFun SEN-12642 sound sensor via an ESP32 microcontroller
2. Detects train passage via envelope-following sound level thresholds
3. Sends events to Home Assistant over WiFi via ESPHome native API
4. Triggers automations to increase the AC Infinity air purifier fan speed to 80% during passage
5. Restores the fan speed after the train event completes (45-second debounce)
6. Displays detection status and analytics on the personal website

---

## Hardware Decisions Made

### Why ESP32 instead of Arduino R3?
The original plan specified an Arduino R3 (ATmega328P), which has **no built-in wireless**. Three options existed:
1. Add an ESP8266/ESP32 as a WiFi bridge (serial UART protocol, two boards, more complex)
2. Use an Arduino WiFi shield (cost, size, bulky)
3. **Replace Arduino R3 with ESP32 DevKit** (single board, built-in WiFi, same GPIO pin count, ideal for IoT)

**Decision**: Replace with ESP32 — simplifies wiring, reduces cost, future-proofs for other WiFi-based experiments, and is the industry standard for hobby IoT projects.

### Pin Selection: GPIO34 for AUDIO
The SEN-12642 outputs an analog envelope voltage (0–3.3V) proportional to sound level. The ESP32 has two ADC banks:
- **ADC1**: GPIO32–39 (available during WiFi operation)
- **ADC2**: GPIO0, 2, 4, 12–15 (conflicts with WiFi)

**Decision**: GPIO34 (ADC1 channel) — input-only pin, safe from accidental damage, no WiFi interference.

### Why ESPHome?
Home Assistant integration options:
1. **MQTT** (lightweight pub/sub; requires Mosquitto broker in HA)
2. **REST API** (HTTP POST; higher overhead, requires auth tokens)
3. **ESPHome native API** (tight HA integration, YAML-configured, OTA updates, auto-discovery)

**Decision**: ESPHome — eliminates the need for custom Arduino sketches or a separate MQTT broker. Device auto-discovers in HA, supports passwordless OTA firmware updates, and provides a clean YAML interface for configuration. No C++ coding required.

---

## Firmware Architecture & Filtering

The ESPHome firmware uses a **cascading filter chain** to reject false positives:

```
SEN-12642 (analog) 
  ↓ (0–3.3V envelope)
ESP32 ADC 
  ↓ (0–4095 count, 12-bit)
Normalize to 0–1 range 
  ↓
Sliding Window Average (10 samples, 500ms window) 
  ↓ (noise rejection)
Binary Sensor Logic 
  ↓ (if smoothed > threshold)
delayed_on: 2s 
  ↓ (must sustain for 2 seconds)
delayed_off: 45s 
  ↓ (stays ON for 45s after drop)
train_detected output
```

**Why this chain**:
- **ADC normalization**: Convert hardware counts to a human-readable 0–1 scale
- **Sliding window (10 samples @ 50ms = 500ms)**: Smooth high-frequency noise while preserving train impulses
- **Binary sensor threshold**: Compare smoothed level against a tunable setpoint (initial: 65%)
- **delayed_on (2s)**: A truck honk, door slam, or speaker peak lasts <500ms; train rumble sustains >2s
- **delayed_off (45s)**: A train typically passes for 30–90 seconds; keeping the sensor ON for 45s after the level drops ensures the automation fires for the full passage, not prematurely

**Tuning Strategy**:
1. Deploy device and observe HA sensor during silence (baseline ~20%)
2. Record peak during a train pass (example: 85%)
3. Set threshold = baseline + 40% × (peak − baseline) = 20 + 26 = 46%
4. Use the HA number entity (`number.train_detector_detection_threshold`) to fine-tune without reflashing

---

## Home Assistant Automation Flow

Two automations work in tandem:

### Automation 1: Train Detected (ON)
**Trigger**: `binary_sensor.train_detected` changes to ON

**Actions**:
1. Save the current AC Infinity fan percentage to `input_number.acinfinity_saved_speed`
2. Set `fan.controller_69_pro` to 80% (speed 8/10)
3. Log "Train detected — ramping fan to 80%"

**Purpose**: When sound levels spike, immediately increase fan airflow to compensate for air pressure fluctuations caused by the train's passing air mass.

### Automation 2: Train Passed (OFF)
**Trigger**: `binary_sensor.train_detected` changes to OFF (after 45s delayed_off)

**Actions**:
1. Restore `fan.controller_69_pro` to the saved percentage
2. Log "Train passed — restored fan speed"

**Purpose**: Return the fan to its previous quiet state after the train has completely passed.

---

## Website Integration (Foundation)

The "Train Detection" tab is already a placeholder in `index.html`. The panel will display:

### Live Indicator
- Large visual element showing "Train Passing — Increased Fan" or "Clear — Normal Airflow"
- Color-coded (red during detection, green when clear)

### Event Log
- Table of recent detection events: timestamp, duration, peak sound level
- Polled from HA REST API: `GET /api/history/period/2026-04-13?filter_entity_id=binary_sensor.train_detected`

### 24-Hour Sound Chart
- Time-series line chart of sound level over the last 24 hours
- Pulls from `sensor.train_detector_sound_level` history
- Highlights train detection windows as shaded regions

---

## Files Created

| File | Purpose |
|---|---|
| `firmware/train-detector.yaml` | ESPHome YAML — ADC, filtering, binary sensor, OTA, API encryption |
| `firmware/secrets.yaml` | WiFi SSID, OTA password, API encryption key (gitignored) |
| `ha-config/automations-train.yaml` | HA automation YAML template (copy into `automations.yaml` or create via UI) |
| `ha-config/helpers-train.yaml` | HA input_number helper for saved fan speed (reference) |
| `docs/train-detection-project.md` | Updated with full architecture, wiring, calibration, and integration guide |
| `LearningLog/2026-04-13_TrainDetectionWireless.md` | This file |

---

## Key Engineering Decisions Documented

1. **ESP32 over Arduino R3**: Simplicity, cost, industry standard
2. **ESPHome over Arduino sketches**: Zero-custom-code integration, OTA updates, YAML simplicity
3. **GPIO34 (ADC1)**: WiFi-safe, input-only protection
4. **Cascading filters**: Noise rejection + impulse detection + sustained-event debouncing
5. **45-second delayed_off**: Matches typical train passage duration
6. **2-second delayed_on**: Rejects transient spikes while catching sustained train rumble

---

## Next Steps (Verification & Testing)

1. **ESPHome Compilation**: Run `esphome compile firmware/train-detector.yaml` to validate YAML syntax
2. **Device Deployment**: Flash ESP32 with ESPHome firmware, join WiFi
3. **HA Auto-Discovery**: Device should appear in HA settings within 30 seconds
4. **Threshold Calibration**: Record baseline (silence) and peak (train) sound levels, adjust threshold via HA UI
5. **Automation Testing**: Use HA Developer Tools to manually trigger `binary_sensor.train_detected` and verify fan speed changes
6. **End-to-End**: Walk past sensor, clap loudly (simulates train), verify detection fires and fan ramps
7. **Website Panel**: Implement live indicator, event log, and 24-hour chart with HA REST API polling

---

## Lessons Learned (for Future Projects)

- **ESPHome is the right abstraction for ESP32+HA**: No custom C++ sketches, no MQTT learning curve, YAML is readable
- **Cascading filters matter**: A single threshold is fragile; combining multiple debounce strategies (delayed_on, delayed_off, sliding window) creates robust detection
- **Auto-discovery is powerful**: Devices advertise themselves; no manual IP or entity registration needed
- **Tunable parameters via HA reduce reflashing**: Exposing threshold as a number entity lets users fine-tune without touching firmware
- **ADC channel selection is critical on ESP32**: ADC2 WiFi conflicts are non-obvious; documenting GPIO34/35 prevents wasted debugging time

---

## References

- **ESPHome**: https://esphome.io/
- **Home Assistant**: https://www.home-assistant.io/
- **AC Infinity Integration**: https://github.com/dalinicus/homeassistant-acinfinity
- **SEN-12642**: https://www.sparkfun.com/products/12642
