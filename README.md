# IQ3 Remote

An unofficial phone app for the DaVinci IQ3 vaporizer. Install it from Chrome on Android and control your IQ3 over Bluetooth.

- **Live temperature** on a 3D IQ3. Its dot display shows the same reading as the real one, and the stage warms up as the oven does.
- **Power from the temperature bars.** Pull up and hold for 3 seconds to turn it on. Slide to the bottom, keep pulling, and hold to turn it off.
- **Set the temperature** by sliding the bars.
- **Draws are animated.** Vapor rises from the mouthpiece while you inhale, timed from the temperature dip a draw causes.
- **Charging.** Plug the IQ3 in and it turns around to show the cable in its port, lit green, with the battery level up top.
- **Smart paths and wraps** from the bottom bar. **Settings** has °F or °C, vibration and a dim display.
- **Wraps:** the four official colors (Onyx, Sapphire, Gunmetal, Amethyst) plus custom finishes.
- **Remembers your IQ3** and reconnects when it comes back in range.

Not affiliated with or endorsed by DaVinci. Use at your own risk.

## Install

1. Open **https://bigapejit.github.io/iq3-remote/** in Chrome on Android.
2. Tap **Install** at the top. If you don't see it, open Chrome's menu and choose **Install app**.
3. On the IQ3, turn Bluetooth on: press up and down together 5 times, until the button flashes blue.
4. Close the official DaVinci app. The IQ3 only talks to one app at a time.
5. In IQ3 Remote, pull up on the bars and hold.

The app needs Web Bluetooth. That means Chrome or Edge on Android, ChromeOS, Windows or macOS; iPhone browsers don't support it.

To try it without a vaporizer, add `?demo` to the address. Add `&charging` to see it plugged in, or `&hot` to start it heating.

## How it works

The app talks to the IQ3 over Web Bluetooth, with no pairing required. [PROTOCOL.md](PROTOCOL.md) documents the service, characteristics, commands and data layouts, and marks what has been confirmed on a real device.

The app never writes to the firmware-update characteristic, and it refuses to send the factory-reset command.

## Develop

There's no build step. Everything the app serves is in `web/`.

| File | What it does |
|---|---|
| `web/index.html` | The app shell and styles |
| `web/js/iq3.js` | Bluetooth client: connect, reconnect, state, commands, draw detection |
| `web/js/stage.js` | The 3D IQ3 (three.js) |
| `web/js/thermo.js` | The temperature and power strip |
| `web/js/wraps.js` | Finishes and generated wrap textures |
| `web/js/demo.js` | A simulated IQ3 for `?demo` |
| `web/lab.html` | A raw protocol test page |
| `web/sw.js` | Offline support |

Web Bluetooth only runs over HTTPS. To test on a phone, run `node serve.mjs`: it serves `web/` and opens a Cloudflare quick tunnel, so `cloudflared` must be installed. `node serve.mjs --local` serves on localhost only.

Every push to `main` deploys `web/` to GitHub Pages.
