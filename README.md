<p align="center"><img src="assets/icons/favicon-128.png" width="96" alt="" /></p>

<h1 align="center">The Tube Desktop</h1>

<p align="center">A dedicated Windows desktop app for YouTube — like YTMDesktop, but for regular YouTube.</p>

---

The Tube Desktop (TTD) keeps the real desktop YouTube experience — your account, Premium, and protected content such as Movies, 4K and HDR — and adds the control the website doesn't give you: a plugin system that can reshape what YouTube shows, a fail-safe so a broken plugin never breaks the page, and (coming) a queue that survives navigation, a real picture-in-picture window, sponsor/ad skipping and more.

> **Status:** early development. Milestone 1 (foundation: plugin system, data-rewrite layer, settings window, Hide Shorts plugin) is on the `v1-foundation` branch. Expect rough edges.

## Features

- **Signed-in desktop YouTube** in its own window, with your session kept between launches.
- **Protected content:** built on [castLabs Electron](https://github.com/castlabs/electron-releases) (Widevine), so Movies, 4K and HDR play.
- **Plugins** that rewrite YouTube's data before the page renders it — about 1 ms per response.
- **Hide Shorts** plugin (on by default).
- **Fail-safe:** a plugin that fails three times turns itself off for that page; YouTube carries on unmodified.
- **Settings window** (`Ctrl+,`) with per-plugin switches and options.
- **Lighter than the Edge YouTube app:** same CPU, ~40% less RAM in testing (7 processes vs 28).

Planned: app-owned queue with return-from-detour, picture-in-picture window, SponsorBlock, ad skip, pinned quality, hide watched, channel blocklist, Return YouTube Dislike, themes, tray and global hotkeys.

## Building from source

Requirements: Windows 10/11, Node.js 24+, Python 3 (for DRM signing).

```bash
npm install
npm start
```

`npm install` also runs castLabs' installer (npm 11 otherwise skips it). Run the tests with `npm test`.

### DRM signing (needed for Movies and some protected content)

castLabs Electron ships with a development-only Widevine signature. For full protected-content playback, sign your build with your **own** free castLabs EVS account:

```bash
python -m pip install --upgrade castlabs-evs
python -m castlabs_evs.account signup
npm run sign
```

## License

[PolyForm Noncommercial 1.0.0](LICENSE.md). You may use, study and modify this software for **non-commercial** purposes. Commercial use — including selling it or building it into a commercial product — is not permitted without the author's written permission.

The icons are part of this project and are covered by the same license. castLabs Electron and other dependencies are distributed under their own licenses.

## Disclaimer

The Tube Desktop is an independent project. It is not affiliated with, endorsed by, or sponsored by YouTube or Google. YouTube is a trademark of Google LLC.
