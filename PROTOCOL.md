# DaVinci IQ3 Bluetooth protocol (reverse engineered)

Status: worked out from DaVinci's own code on 2026-11-02. Reading is confirmed on a real IQ3; **writes are not yet confirmed.**
Mark each item ✅ once it's seen working on the device.

## Confirmed on a real IQ3 (2026-11-02, Pixel 9 + Chrome)

- ✅ Connects with plain Web Bluetooth, no pairing. Picker name: `DAVINCI IQ3`. (Early timeouts went away after the official web app had connected once; cause unknown.)
- ✅ Service and characteristic list matches the table below, plus `06000000` and `07000000` (read, notify) whose meaning is unknown.
- ✅ Device Information: maker `Realtek BT`, model `DAVINCI IQ3`, firmware `v1.2.2.0`, software `v_3.2.1.1`. The GAP name reads `BLE_OTA`.
- ✅ Current state is **18 bytes**, for example `03 dc 50 3f 45 64 00 00 24 2c 00 00 02 31 00 00 18 00`: smart path (3), 207.00 °C current, 177.27 °C target, path index 0, battery level 2 (40%), flags 0x31 (vibration, stealth, bit 0 unknown). Bytes 5 (0x64) and 14–17 are unknown.
- ✅ Smart paths decode as documented. The metadata word is the path index, a point's time byte is a fraction of the duration (/255), and temperatures are whole °C. The stock paths are 177→188, 188→199, 199→210 and 210→221 °C, 8 minutes each.

## Where this came from

1. **The official web app**, `https://webapp.davincivaporizer.com`. DaVinci's new "DaVinci Connect"
   app (`com.synergyinnovation.davinciconnect`) is only a Web Bluetooth browser that loads this site.
   The site serves its source map (`/static/js/main.9050946b.js.map`), so its original unminified
   source can be read: `helpers/device.js`, `services/WebBluetoothService.js`,
   `services/NativeBluetoothBridge.js`. It covers IQ2, IQ3, IQC and IQS through one protocol.
2. **The older native app**, `com.synergyinnovation.davincivaporizerapp` v3.3.0, decompiled with jadx:
   `com/synergyinnovation/davincibluetooth/PangCVaporizerDevice.java`. It names every control command,
   including some the web app never sends.

## Connection

- **No pairing, bonding, PIN or encryption handshake.** The app connects and reads and writes right away.
- Scan filter (advertised service): `edfec62e-9900-b00b-1e50-005041934743`
- Main GATT service ("Pang C"): `edfec62e-9900-b00b-1e50-0050414e4743`
  (the tail `50 41 4e 47 43` is ASCII `PANGC`)
- The official app reads current state every 5 s and session data every 10 s, and also uses notifications.
- A BLE peripheral like this usually accepts **one central at a time**, so close the official app first.

## Characteristics (all `XXXXXXXX-0000-0000-0000-0050414e4743`)

| UUID prefix | Name | Ops | Size |
|---|---|---|---|
| `01000000` | Control point | write | 2–3 bytes |
| `02000000` | Current state | read, notify | 14+ bytes |
| `05000000` | Session data | read, notify, write | 20 bytes |
| `06000000`, `07000000` | unknown | read, notify | ? |
| `09000000` | Smart paths | read, write | 104 bytes |
| `0d000000` | Statistics | read | 20 bytes |
| `19890902` | Firmware update | write | **never touch** |

Standard services are also present: Device Information `180a` (manufacturer `2a29`, model `2a24`,
serial `2a25`, firmware `2a26`, software `2a28`, system id `2a23`) and Generic Access `1800`
(device name `2a00`).

## Control point commands: `[command, value]`

| Bytes | Meaning | Source |
|---|---|---|
| `30 xx` | Switch state (values below) | both |
| `10 mm` / `11 mm` | Key down / key up. Mask `02` = **+**, `04` = **−**, `01` = app key | both |
| `50 nn` | Vibrate once, pattern `nn` (1 short, 2 long, 3 double, 4 triple, 5 quad, 6 double long, 7 very long) | native |
| `60 04` / `60 ff` | Stealth (dim display) on / off | both |
| `90 01` / `90 00` | Vibration alerts on / off | both |
| `f0 01` / `f0 00` | Display °C / °F | both |
| `80 nn` | Start smart path `nn` | both |
| `70 00` | Store settings to flash | native |
| `40 00 tt` | Set target temp. **The native code is buggy** (`(i<<8)&255` is always 0), so the real format is unknown | native, unused |
| `20 00` | **FACTORY RESET. Do not send.** | native |

### Values for `30 xx` (switch state)

From the native app's `CTRL_DATA_*` constants:
`01` off · `02` turning on · `03` turning off · `04` boost ("blast") · `05` precision temp ·
`06` smart path show temp · `07` smart path mode · `08` smart path select · `09` exit boost ·
`0a` cooldown · `0b`/`0c` smart path variants · `0d` show battery level · `0e` toggle temp.

What the web app actually sends:
- Power on: `30 02`
- Power off: `30 01`, wait 500 ms, `30 00`, wait 800 ms, `10 00`
- Temperature up or down: if the state isn't 6, send `30 05` and wait up to 3 s for state 5 or 6.
  Then send `10 mm`, wait 100 ms, `11 mm`, with mm = `02` for up or `04` for down.
- Start a dose session: `30 02`, `30 07`, then write 20 bytes to session data.
- Stop a session: `30 01`

## Current state (`02000000`), little-endian

| Byte | Field |
|---|---|
| 0 | State: 0 off, 1 charge, 2 on, 3 smart path, 4 selected smart path, 5 temp show smart path, 6 precision temp, 7 boost, 8 standby |
| 1–2 | Current temp, uint16, **hundredths of °C** (so ÷100) |
| 3–4 | Target temp, uint16, hundredths of °C |
| 5–6 | unknown |
| 7 | Smart path index |
| 8–11 | Timer, uint32 (probably seconds) |
| 12 | Battery level 0–5, each step is 20% |
| 13 | Flags: `02` °C display · `04` target reached · `08` charging · `10` vibration on · `20` stealth on |

## Statistics (`0d000000`)

bytes 0–3 total heating time in seconds (uint32) · 4–5 accumulated session time · 6 session count ·
7–8 precision-temp sum · 9 precision-temp count · 10–17 use count for smart paths 1–4 (uint16 each) ·
18–19 lifetime puff count.

## Smart paths (`09000000`)

4 paths × 26 bytes = 104. Each path: int16 metadata, int16 duration in seconds, 10 × (uint8 time,
uint8 temp) points, uint8 point count, 1 spare byte.

## Session data (`05000000`), 20 bytes

0 session type · 1 THC % (integer part) · 2 CBD % (integer part) · 3 oven size index · 4–5 puff sample ·
6 last puff duration (÷10, then +1) · 7–8 last puff THC (÷10) · 9–10 last puff CBD · 11–12 total THC ·
13–14 total CBD · 15 session flag (1 = start) · 16 puff count · 17 THC fraction · 18 CBD fraction ·
19 reserved.
