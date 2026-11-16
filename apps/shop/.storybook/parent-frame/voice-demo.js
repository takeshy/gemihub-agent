// Voice stories exercise the real guide UI and document search, with sample audio transport only.
// No real microphone, WebSocket or Google API is used inside this story frame.
export function installVoiceDemo() {
  class DemoAudio {
    constructor() { this.currentTime = 0; this.destination = {}; this.audioWorklet = { addModule: async () => {} }; }
    async resume() {}
    async close() {}
    createMediaStreamSource() { return { connect() {} }; }
    createBuffer(_channels, length, rate) { return { duration: length / rate, getChannelData: () => new Float32Array(length) }; }
    createBufferSource() { return { connect() {}, start() { setTimeout(() => this.onended?.(), 0); }, stop() {} }; }
  }
  window.AudioContext = DemoAudio;
  window.AudioWorkletNode = class { constructor() { this.port = {}; } connect() {} };
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } });
  const RealSocket = window.WebSocket;
  window.WebSocket = class {
    static OPEN = 1;
    constructor(url) {
      if (!String(url).endsWith("/api/ai/live")) return new RealSocket(url);
      this.readyState = 0; this.bufferedAmount = 0;
      setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 20);
    }
    receive(data) { if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(data) }); }
    send(raw) {
      const input = JSON.parse(raw);
      if (input.type === "start") {
        this.receive({ type: "ready" });
        setTimeout(() => {
          const question = document.getElementById("voice-target")?.value ? "営業時間を教えて" : "中央図書館の開館時間を教えて";
          this.receive({ type: "heard", text: question });
          this.receive({ type: "consult", id: "voice-story", question, guide: false });
        }, 100);
      }
      if (input.type === "result") {
        this.receive({ type: "spoken", text: input.answer });
        this.receive({ type: "turn" });
      }
    }
    close() { this.readyState = 3; setTimeout(() => this.onclose?.({ code: 1000 }), 0); }
  };
}
