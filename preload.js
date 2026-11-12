// Runs in every page shown on a screen, before the page's own scripts.
// It notes each WebRTC connection the page makes and, every two seconds,
// asks it what it has received and decoded, keeping the latest answer. When a
// live video freezes, screens.js reads those answers to see where it stopped.
// The page is otherwise untouched and gets no access to anything of ours.
const { contextBridge } = require("electron");

contextBridge.executeInMainWorld({
  func: () => {
    const Native = window.RTCPeerConnection;
    if (!Native) return;
    // One record per connection: when it was last asked, when it last answered, and the answer.
    const peers = (window.__screenWallPeers = []);
    // A Proxy rather than a subclass: the page still gets the browser's own
    // class in every respect, we only note each connection as it is made.
    window.RTCPeerConnection = new Proxy(Native, {
      construct(target, args, newTarget) {
        const pc = Reflect.construct(target, args, newTarget);
        peers.push({ pc, asked: 0, answered: 0, reading: null });
        return pc;
      },
    });
    window.webkitRTCPeerConnection = window.RTCPeerConnection;

    const read = (stats) => {
      const reading = { bytes: 0, video: [] };
      for (const s of stats.values()) {
        // The route the video is taking: straight to the sender or through a relay, over UDP or TCP.
        if (s.type === "transport" && s.selectedCandidatePairId) {
          const pair = stats.get(s.selectedCandidatePairId) || {};
          const local = stats.get(pair.localCandidateId) || {};
          const remote = stats.get(pair.remoteCandidateId) || {};
          reading.route = {
            protocol: local.protocol,
            local: local.candidateType,
            remote: remote.candidateType,
            relayedOver: local.relayProtocol,
            roundTripMs: Math.round((pair.currentRoundTripTime || 0) * 1000),
          };
        }
        if (s.type !== "inbound-rtp") continue;
        reading.bytes += s.bytesReceived || 0;
        if (s.kind === "video")
          reading.video.push({
            packetsReceived: s.packetsReceived,
            packetsLost: s.packetsLost,
            framesReceived: s.framesReceived,
            framesDecoded: s.framesDecoded,
            framesDropped: s.framesDropped,
            keyFramesDecoded: s.keyFramesDecoded,
            keyFramesRequested: s.pliCount,
            freezes: s.freezeCount,
            decoder: s.decoderImplementation,
            hardwareDecoder: s.powerEfficientDecoder,
          });
      }
      return reading;
    };
    setInterval(() => {
      const now = Date.now();
      for (const peer of peers) {
        if (peer.pc.connectionState === "closed") continue;
        // One question at a time; if a connection has stopped answering, try again every ten seconds.
        if (peer.asked > peer.answered && now - peer.asked < 10000) continue;
        peer.asked = now;
        Native.prototype.getStats.call(peer.pc).then(
          (stats) => {
            peer.answered = Date.now();
            peer.reading = read(stats);
          },
          () => {},
        );
      }
    }, 2000);
  },
});
