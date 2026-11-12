// Start-up. The work is in:
//   config.js   settings and the fault log
//   screens.js  the windows on the displays and their recovery
//   server.js   the control page and its API
//   lib.js      pure logic, unit tested
const { app, session, powerSaveBlocker, dialog, shell } = require("electron");
const { cfg, log, load, controlUrls, localUrl } = require("./config");
const screens = require("./screens");
const server = require("./server");

// Video feeds must start without anyone clicking on them.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
// Windows otherwise pauses rendering in windows it believes are covered.
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");

// The graphics process dying is one way every video on the wall can stop at once.
app.on("child-process-gone", (_e, details) =>
  log(`${details.type} process gone: ${details.reason}`),
);
process.on("uncaughtException", (e) => log("uncaught:", e.stack || e.message));
process.on("unhandledRejection", (e) =>
  log("unhandled rejection:", (e && e.stack) || e),
);

// Opens the control page on the laptop already signed in; the page reads the token from the #fragment.
function openLocalControlPage() {
  const fragment = cfg.openAccess ? "" : `#token=${cfg.token}`;
  shell.openExternal(`${localUrl()}/${fragment}`);
}

// The pages shown are other people's websites: give them nothing they could ask for
// (camera, location, notifications…), except their own full-screen button.
function lockDownPages() {
  const ses = session.defaultSession;
  const allowed = (permission) => permission === "fullscreen";
  ses.setPermissionRequestHandler((_wc, permission, done) =>
    done(allowed(permission)),
  );
  ses.setPermissionCheckHandler((_wc, permission) => allowed(permission));
  ses.setDevicePermissionHandler(() => false); // USB, serial, HID
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // There is no visible app window, so launching it a second time is how you reach it locally.
  app.on("second-instance", async () => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      message: "Screen Wall is running",
      detail: `Control page: ${controlUrls().join("\n")}\nToken: ${cfg.openAccess ? "not required" : cfg.token}`,
      buttons: ["Open control page", "Quit Screen Wall", "Cancel"],
      cancelId: 2,
    });
    if (response === 0) openLocalControlPage();
    if (response === 1) app.quit();
  });
  app.on("window-all-closed", () => {}); // keep running with no windows open

  app.on("web-contents-created", (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: "deny" })); // no pop-ups
    wc.on("will-prevent-unload", (e) => e.preventDefault()); // no "leave this page?" prompts
  });

  app.whenReady().then(() => {
    const firstRun = load();
    log(
      `Screen Wall ${app.getVersion()} starting, Electron ${process.versions.electron}`,
    );
    log("graphics:", JSON.stringify(app.getGPUFeatureStatus()));
    lockDownPages();
    powerSaveBlocker.start("prevent-display-sleep");
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: true });

    screens.start();
    server.start();
    if (firstRun && app.isPackaged) openLocalControlPage();
  });
}
