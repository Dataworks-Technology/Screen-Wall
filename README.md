# Screen Wall

Puts a web page full screen on each display connected to a laptop, and lets you change what is on each one from a web page on the LAN. Built for a Windows laptop driving four HDMI outputs with multiviewers and video feeds.

It is one Electron app: Chromium renders each output in its own borderless full-screen window, and the same process serves the control page.

## Using it

1. Install Screen Wall on the laptop (see Installing on Windows); it starts by itself. Nothing appears on any screen yet.
2. On any device on the same network, open `http://<laptop address>:8080` and enter the token. The token is shown on the same page when it is opened on the laptop itself (see Settings).
3. Press **Identify screens**. Each screen shows its name for a few seconds, so you can tell which card is which output. Use **Rename** to call them something useful ("Stage left").
4. Type or paste an address under **Web page to show** and press **Show**.

Each card says what its screen is doing (Showing, Loading, Retrying, Black, Not in use, Unplugged) and what is on it now.

| Control      | What it does                                                             |
| ------------ | ------------------------------------------------------------------------ |
| Show         | Shows the web page full screen. `https://` is added if you leave it out. |
| Reload page  | Loads the page again.                                                    |
| Black screen | Keeps the screen covered, showing black.                                 |
| Stop showing | Closes the page and lets the laptop's desktop show on that screen.       |
| Play sound   | Every screen starts silent. Tick it on the one that should carry sound.  |
| Rename       | Names the screen. The name appears on the card and when identifying.     |
| Forget       | Removes an unplugged screen that still has a page saved against it.      |

**Remote control** (on a card that is showing a page) opens a picture of that screen, updated about once a second. Moving over the picture and clicking does the same on the page, which is how you press a page's own full-screen or play button from another device. It passes on the mouse only, not the keyboard.

On the laptop itself the mouse works on the pages directly. The pointer is hidden while it is still, and comes back for three seconds whenever the mouse moves.

**Play sound** is the one switch for a screen's sound. Unticked, the screen is silent whatever the page does. Ticked, the app also unmutes the page's own player within ten seconds, and again after every reload, so nobody has to click the player's mute button. Sound comes out of whichever output Windows has set as its default, not necessarily the monitor the page is on.

A card showing a live video feed says how fast that video is arriving (`video arriving at 6.2 Mbit/s`), measured over the last ten seconds. This counts WebRTC video and sound only, not the rest of the page. The line under the title at the top gives the download rate of the whole laptop, including anything else running on it.

Buttons only appear when they apply: a screen that is not in use offers just **Show** and **Black screen**.

**Settings** (top right) holds the things you rarely touch:

- **Address:** the addresses other devices can open the page at. You can make it answer on one of them instead of all; doing so moves your browser to it. If the chosen address later disappears from the laptop (cable unplugged, new address from the router), the page answers on every address again until it comes back, so it cannot be set out of reach.
- **Access token:** shows the token, and lets you change it to one of your own or a new random one. Every other device is then asked for the new token.

**History** (top right) lists every web page that has been shown. Each has a **Use on** button per screen, which puts that page on the screen straight away. Addresses are shortened to fit; click one to see it in full. **Name** gives a page a name of your own ("MPRO multiviewer"), which is then shown in place of its address. Remove one, or clear them all; pages currently on a screen are not affected.

The same history appears under a card's **Web page to show** box when you click in it, and narrows as you type. Typing matches a page's name and any part of its address, so `multiviewer mpro` finds the multiviewer page for that division. Pick one, then press **Show**.

To reach the app on the laptop itself, start it a second time: it offers to open the control page or quit.

## What keeps it running

- A page that fails to load, returns a server error, crashes or freezes is reloaded automatically: after 2s, 4s, 8s, 16s, then every 30s for as long as it takes.
- What each screen shows is saved, and comes back after a restart or a reboot. The installed app registers itself to start at login.
- Unplugging a display keeps its settings; plugging it back restores the page. Displays are recognised by id, then position, then monitor name, because ids can change when an adaptor is replugged.
- The laptop's displays are stopped from sleeping while it runs.
- A window closed by accident (Alt+F4) is put back within a second.
- A live video feed (WebRTC) that stops showing new pictures for 30 seconds has its page reloaded, even though the page itself is still responding. Each time is written to the log.
- The pages sit above the Windows taskbar, but Windows can still lift the taskbar in front when it is used. Set the taskbar to hide automatically on the laptop.
- Pop-ups, permission prompts (camera, location, notifications) and "leave this page?" dialogs are refused. A page's own full-screen button is allowed.

Faults are written to `screen-wall.log` in the settings folder.

## When a feed freezes

The downloaded log starts with a reading of the laptop taken at that moment: whether graphics acceleration is on, each display's resolution, the frames per second each page is managing, and how hard each of the app's processes is working. Download it while the wall is being slow.

The log says which kind of freeze it was. Download it from **Settings → Fault log** on the control page, from any device; on the laptop it is `screen-wall.log` in the settings folder.

When a live video stops, two `video stalled … WebRTC:` lines are written twenty seconds apart, then `video froze`, and the page is reloaded. Compare the numbers in the two `stalled` lines:

| Between the two lines                                             | What it means                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packetsReceived` did not rise                                    | Nothing was arriving: the sender, the network, or the page not reconnecting (see `connection`, `ice`). |
| `packetsReceived` rose, `framesDecoded` did not                   | Video was arriving but not being decoded. `decoder` and `hardwareDecoder` say which decoder was used.  |
| `keyFramesRequested` rose, `keyFramesDecoded` did not             | The decoder lost its place and asked the sender to start afresh, and the sender never did.             |
| `framesDecoded` kept rising, or there is no `stalled` line at all | Frames were decoded but never reached the display: graphics, or the display adaptor's driver.          |

`GPU process gone` in the log means the graphics driver fell over. `"trackMuted"` in the `video froze` line is not a reliable sign either way.

To test the decoder or graphics, quit Screen Wall and start it by hand with a switch, to see whether the freeze goes away: `--disable-accelerated-video-decode` (decodes video in software), then `--disable-direct-composition-video-overlays` (stops full-screen video taking a short cut to the display).

## Settings

Settings live in `config.json` in the app's data folder (`%APPDATA%\Screen Wall` on Windows). Stop the app before editing it.

| Key          | Default   | Meaning                                                                           |
| ------------ | --------- | --------------------------------------------------------------------------------- |
| `port`       | `8080`    | Port for the control page.                                                        |
| `host`       | `0.0.0.0` | The address the control page answers on; `0.0.0.0` means all. Set from Settings.  |
| `token`      | generated | What the control page asks for, once per browser. Change it to anything you like. |
| `openAccess` | `false`   | `true` turns the token check off. Only for a network you fully trust.             |

Other devices need a token the first time they open the control page; they remember it afterwards. One is generated the first time the app starts.

To look it up, open the control page in a browser on the laptop itself (`http://localhost:8080`). The laptop is never asked for the token, and the page shows it under **Settings**, where it can also be changed. Starting Screen Wall a second time on the laptop also shows it, with a button that opens the page.

The page is plain HTTP, so the token can be read by anyone able to capture traffic on the network; it keeps out the casually curious, not a determined attacker. Only `http` and `https` URLs are accepted.

## Installing on Windows

Download `Screen-Wall-Setup-<version>.exe` from the [latest release](https://github.com/Dataworks-Technology/Screen-Wall/releases/latest) and run it. It installs for the current user without needing administrator rights, adds a Start menu entry and an uninstaller, and starts the app. To upgrade, run a newer installer over the top; settings are kept.

### Updating

Once a version is installed, later ones are installed from the control page: **Settings → Updates** looks for a newer release each time Settings is opened, and **Install version …** downloads it, checks it against the checksum GitHub published, installs it and restarts the app. Every screen goes dark for about a minute, so not during a show. Nothing is ever installed on its own.

Only releases are offered (see Releasing), not the builds attached to pull requests. Installing by hand also still works: run a newer installer over the top, with no need to uninstall first.

On the laptop, once:

- Allow the app through Windows Firewall when asked on first start (private networks).
- Set Windows display mode to **Extend**, not Duplicate, and arrange the four outputs.
- Set the laptop to log in automatically and never sleep on mains power, so it recovers from a power cut by itself.
- The installer is not code signed, so SmartScreen will ask you to confirm before it runs.

## Releasing

The **Screen Wall** workflow tests and builds the Windows installer on every pull request and on `main`. To publish a version, open **Actions > Screen Wall > Run workflow** on `main` and choose a release type:

| Type                      | Next version                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `auto`                    | Chosen from the commits since the last release: a breaking change is major, a `feat` is minor, anything else is a patch. |
| `patch`, `minor`, `major` | That bump, whatever the commits say.                                                                                     |

The first release is 1.0.0. The workflow then creates the tag `v<version>` and a GitHub Release holding `Screen-Wall-Setup-<version>.exe`, its SHA-256 and the list of changes. The tag is only created once the build has passed. The version is not committed back to `package.json`; the tag is the record, and the control page shows the running version next to the host name.

## Running from source

```sh
npm install
npm start        # run it
npm test         # unit tests
npm run dist     # build the installer for the platform you are on
```

The Windows installer can only be built on Windows, or on a machine with Wine.

`SCREEN_WALL_DATA=/some/folder npm start` uses a different settings folder. `SCREEN_WALL_WINDOWED=1 npm start` opens small ordinary windows instead of taking over displays, for development.

## Code

| File         | What it holds                                                               |
| ------------ | --------------------------------------------------------------------------- |
| `main.js`    | Start-up: single instance, the local dialog, page lock-down.                |
| `config.js`  | Settings (`config.json`) and the fault log.                                 |
| `screens.js` | The windows on the displays, their recovery, and matching displays.         |
| `server.js`  | The control page and its API. It only reaches windows through `screens.js`. |
| `preload.js` | Runs in each page shown: keeps track of its WebRTC connections for the log. |
| `updater.js` | Finds newer releases on GitHub and installs one when asked.                 |
| `lib.js`     | Pure logic (URL checks, display matching, retry timing), covered by tests.  |
| `ui.html`    | The control page.                                                           |
| `release.js` | Chooses the next version for the release workflow.                          |

The installer is built with Electron's fuses set so the app cannot be run as plain Node or with debugging flags. Dependabot raises a pull request when Electron has an update; merge those promptly, since the app shows other people's web pages.

## Other platforms

The code has no Windows-specific parts.

- **macOS**: expected to work as is, not yet tried; build with `npm run dist` on a Mac. Turn off "Displays have separate Spaces" if a full-screen window shows a menu bar.
- **Linux**: expected to work under a plain X11 desktop, not yet tried there. Wayland does not let an app choose which display a window opens on. Under Hyprland with XWayland (`--ozone-platform=x11`) and fractional scaling, the window opened on the wrong display. Start at login needs a desktop autostart entry, which the app does not create.

## Limits

- Feeds protected by DRM (Widevine) will not play; stock Electron does not include it.
- There is no remote way to click or type into a page, and the pointer is hidden over pages. Cookies are kept between runs, so a login done on the laptop with mouse and keyboard would persist, but that has not been tried. Prefer URLs that need no login.
- A URL that is a file or raw stream (`.m3u8`, a download) rather than a web page shows "not a web page" and stays black.
- Tested on Linux only so far. Placement across four HDMI outputs on Windows, mixed scaling between displays and the firewall prompt have not been run on the real laptop.

## Licence

[MIT](LICENSE). The Dataworks name and logo are trademarks of Dataworks and are not covered by that licence; replace them if you distribute your own version.
