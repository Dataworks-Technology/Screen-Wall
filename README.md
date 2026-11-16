# Screen Wall

Puts a web page full screen on each display connected to a laptop, and lets you change what is on each one from a web page on the LAN. Built for a Windows laptop driving four HDMI outputs with multiviewers and video feeds.

It is one Electron app: Chromium renders each output in its own borderless full-screen window, and the same process serves the control page.

## Using it

1. Install Screen Wall on the laptop (see Installing on Windows); it starts by itself. Nothing appears on any screen yet.
2. On any device on the same network, open `http://<laptop address>:8080` and enter the token. The token is shown on the same page when it is opened on the laptop itself (see Settings).
3. Press **Identify screens**. Each screen shows its name for a few seconds, so you can tell which monitor on the page is which output. Use **More → Rename screen** to call them something useful ("Stage left").
4. Press **Change what's showing** under a screen, choose **Web page** or **SRT stream**, fill it in and press **Show on …**.

The control page is laid out like a monitor wall. Each screen has a live picture of what it is showing (refreshed every few seconds while the page is open), and a strip under it with its name and a tally lamp: green when showing, amber while loading, red when unplugged or retrying, grey when black or not in use.

| Control                        | What it does                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Change what's showing          | Picks a saved source, a web page or an SRT stream for the screen. `https://` is added to a web address if you leave it out.         |
| Black                          | Covers the screen with black. The button then reads **Bring back**, which puts back what was on it.                                 |
| Reload                         | Loads the page, or restarts the stream, again.                                                                                      |
| Remote                         | Remote control: see the screen, and click on its page (below).                                                                      |
| More → Rename screen           | Names the screen. The name appears on its strip and when identifying.                                                               |
| More → Stop showing            | Closes the page and lets the laptop's desktop show on that screen.                                                                  |
| Sound                          | Every screen starts silent. Switch it on for the one that should carry sound.                                                       |
| Fill the screen with the video | For a page that is a video player: puts its video into full screen, as the player's own button would, and again after every reload. |
| More → Forget this screen      | Removes an unplugged screen that still has a source saved against it.                                                               |

**Saved** (the first choice under Change what's showing) lists everything that has been shown, newest first. Press one to put it on the screen. Type to narrow the list by name or any part of the address. **Rename** gives a source a name of your own ("MPRO multiviewer"), shown in place of its address; a name can also be given when adding a web page or stream. **Edit** opens a saved source in its form, to change, say, a stream's latency. **Remove** takes one off the list and **Clear all** empties it; what is on a screen is not affected. This replaces the History window and its **Use on** buttons of earlier versions.

**Remote** opens a picture of that screen, updated about once a second. Moving over the picture and clicking does the same on the page, which is how you press a page's own full-screen or play button from another device. It passes on the mouse only, not the keyboard.

On the laptop itself the mouse works on the pages directly. The pointer is hidden while it is still, and comes back for three seconds whenever the mouse moves.

**Sound** is the one switch for a screen's sound. Off, the screen is silent whatever the page does. On, the app also unmutes the page's own player within ten seconds, and again after every reload, so nobody has to click the player's mute button. Sound comes out of whichever output Windows has set as its default, not necessarily the monitor the page is on. Next to the switch the screen says whether it is making sound at that moment: `playing` with nothing to hear means the sound is going to a different output, so change the default output in Windows sound settings; `the page is silent` means the page or its feed has no sound to give.

A screen showing a live video feed says how fast that video is arriving (`Video arriving at 6.2 Mbit/s`), measured over the last ten seconds. For a page this counts WebRTC video and sound only, not the rest of the page. The top of the page gives the download rate of the whole laptop, including anything else running on it.

Every screen has the same controls in the same places, so they line up across the wall; those that do not apply at the moment are greyed out. A problem (unplugged, retrying) is written across the screen's picture.

**Settings** (top right) holds the things you rarely touch:

- **Address:** the addresses other devices can open the page at. You can make it answer on one of them instead of all; doing so moves your browser to it. If the chosen address later disappears from the laptop (cable unplugged, new address from the router), the page answers on every address again until it comes back, so it cannot be set out of reach.
- **Access token:** shows the token, and lets you change it to one of your own or a new random one. Every other device is then asked for the new token.
- **Updates** and **Fault log** (see below).

To reach the app on the laptop itself, start it a second time: it offers to open the control page or quit.

### SRT streams

Choose **SRT stream** under **Change what's showing** and fill in:

- **How it connects:** _Connect to the sender_ (caller) when the sender is waiting at an address you know; _Wait for the sender to connect_ (listener) when the sender is set to send to the laptop. In listener mode Windows Firewall asks once to let `screen-wall-player.exe` receive connections; allow it on private networks.
- **Sender address** and **Port**, or just the port to listen on.
- **Latency** in milliseconds, 200 unless you know better. More rides out a poor network but delays the picture; SRT uses the higher of this and the sender's setting.
- **Passphrase** if the stream is encrypted: 10 to 79 characters, exactly as on the sender. It is never shown on the control page or written to the log.
- **Stream ID** under More options, only if the sender asks for one.

Pasting a whole `srt://` address into Sender address fills in every field. An address copied from VLC works too: its latency is in milliseconds, FFmpeg's in microseconds, and the form tells them apart.

The app plays the stream with mpv, a video player that comes with the installer, full screen on that display. **Sound** and **Remote** (the picture only; clicks do nothing) work as for a page.

- A stream that drops, freezes for 30 seconds, or shows no picture for a minute is started again: after 2s, 4s, 8s, 16s, then every 30s. Each time is written to the log, with any passphrase hidden.
- The player is mpv, licensed under the GPL; see `player/README.txt` for its source.

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

A feed whose connection reports that it has failed (the usual result of the laptop's network dropping for a few seconds) is reloaded within ten seconds, logged as `feed connection failed`. When a live video stops for any other reason, two `video stalled … WebRTC:` lines are written twenty seconds apart, then `video froze`, and the page is reloaded. Compare the numbers in the two `stalled` lines:

| Between the two lines                                             | What it means                                                                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packetsReceived` did not rise                                    | Nothing was arriving: the sender, the network, or the page not reconnecting (see `connection`, `ice`). |
| `packetsReceived` rose, `framesDecoded` did not                   | Video was arriving but not being decoded. `decoder` and `hardwareDecoder` say which decoder was used.  |
| `keyFramesRequested` rose, `keyFramesDecoded` did not             | The decoder lost its place and asked the sender to start afresh, and the sender never did.             |
| `framesDecoded` kept rising, or there is no `stalled` line at all | Frames were decoded but never reached the display: graphics, or the display adaptor's driver.          |

Each `stalled` line also gives `connection` and `ice` (a feed whose network path broke reads `disconnected`, then `failed`) and `route` (whether the video came straight from the sender or through a relay, over UDP or TCP). Around the same time, look for `internet stopped answering` and `network addresses changed`: the app checks every five seconds and writes both down, so a freeze that lines up with either is the laptop's network, not the feed.

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

The page is plain HTTP, so the token can be read by anyone able to capture traffic on the network; it keeps out the casually curious, not a determined attacker. Only `http`, `https` and `srt` addresses are accepted.

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

| File         | What it holds                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `main.js`    | Start-up: single instance, the local dialog, page lock-down.                                   |
| `config.js`  | Settings (`config.json`) and the fault log.                                                    |
| `screens.js` | The windows on the displays, their recovery, and matching displays.                            |
| `server.js`  | The control page and its API. It only reaches windows through `screens.js`.                    |
| `preload.js` | Runs in each page shown: keeps track of its WebRTC connections for the log.                    |
| `updater.js` | Finds newer releases on GitHub and installs one when asked.                                    |
| `player.js`  | Plays SRT streams with mpv, full screen over a screen's window, and restarts them.             |
| `fonts/`     | Nunito Sans and Outfit, the Dataworks typefaces, for the control page (SIL Open Font License). |
| `lib.js`     | Pure logic (URL checks, display matching, retry timing), covered by tests.                     |
| `ui.html`    | The control page.                                                                              |
| `release.js` | Chooses the next version for the release workflow.                                             |

The installer is built with Electron's fuses set so the app cannot be run as plain Node or with debugging flags. Dependabot raises a pull request when Electron has an update; merge those promptly, since the app shows other people's web pages.

## Other platforms

The code has no Windows-specific parts.

- **macOS**: expected to work as is, not yet tried; build with `npm run dist` on a Mac. Turn off "Displays have separate Spaces" if a full-screen window shows a menu bar.
- **Linux**: expected to work under a plain X11 desktop, not yet tried there. Wayland does not let an app choose which display a window opens on. Under Hyprland with XWayland (`--ozone-platform=x11`) and fractional scaling, the window opened on the wrong display. Start at login needs a desktop autostart entry, which the app does not create.

## Limits

- Feeds protected by DRM (Widevine) will not play; stock Electron does not include it.
- Remote passes on the mouse only, so a page cannot be typed into from another device. Cookies are kept between runs, so a login done on the laptop with mouse and keyboard would persist, but that has not been tried. Prefer URLs that need no login.
- A URL that is a file or raw stream (`.m3u8`, a download) rather than a web page shows "not a web page" and stays black.
- Tested on Linux only so far. Placement across four HDMI outputs on Windows, mixed scaling between displays and the firewall prompt have not been run on the real laptop.

## Licence

[MIT](LICENSE). The Dataworks name and logo are trademarks of Dataworks and are not covered by that licence; replace them if you distribute your own version.
