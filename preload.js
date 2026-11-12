// Runs in every page shown on a screen, before the page's own scripts.
// It keeps a list of the page's WebRTC connections, so that when a live video
// freezes screens.js can ask each one what it was receiving and decoding.
// The page is otherwise untouched and gets no access to anything of ours.
const { contextBridge } = require("electron");

contextBridge.executeInMainWorld({
  func: () => {
    const Native = window.RTCPeerConnection;
    if (!Native) return;
    const peers = (window.__screenWallPeers = []);
    // A Proxy rather than a subclass: the page still gets the browser's own
    // class in every respect, we only note each connection as it is made.
    window.RTCPeerConnection = new Proxy(Native, {
      construct(target, args, newTarget) {
        const pc = Reflect.construct(target, args, newTarget);
        peers.push(pc);
        return pc;
      },
    });
    window.webkitRTCPeerConnection = window.RTCPeerConnection;
  },
});
