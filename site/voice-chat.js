import { runVisibleChatTurn } from "./voice-turn.js";

export class GuideVoice {
  constructor({ engine, shopFrame, shops = [], config, ownShop, launcherHost, fetch: fetchImpl = (...args) => globalThis.fetch(...args) }) {
    Object.assign(this, { engine, shopFrame, shops, ownShop, fetch: fetchImpl });
    this.state = "off"; this.generation = 0; this.playing = new Set(); this.pending = new Map(); this.playAt = 0;
    if (!config?.voice) return;
    this.english = document.documentElement.lang === "en";
    const node = (tag, text) => { const element = document.createElement(tag); if (text) element.textContent = text; return element; };
    this.launcher = node("button", this.words("🎙 音声で話す", "🎙 Talk to AI"));
    this.launcher.id = "voice-open"; this.launcher.className = "finder-voice-launcher"; this.launcher.type = "button";
    this.launcher.setAttribute("aria-haspopup", "dialog"); this.launcher.setAttribute("aria-controls", "finder-voice"); this.launcher.setAttribute("aria-expanded", "false");
    const panel = node("dialog"); this.dialog = panel; panel.id = "finder-voice"; panel.className = "finder-voice";
    panel.setAttribute("aria-labelledby", "voice-heading");
    const heading = node("h2", this.words("音声で話す", "Talk to AI")); heading.id = "voice-heading";
    const close = node("button", "×"); close.id = "voice-close"; close.className = "finder-voice-close"; close.type = "button"; close.autofocus = true;
    close.setAttribute("aria-label", this.words("閉じる", "Close"));
    const header = node("div"); header.className = "finder-voice-heading"; header.append(heading, close);
    const mode = node("p", this.words("音声モード", "Voice mode")); mode.className = "finder-voice-mode";
    const label = node("label", this.words("話し相手", "Talk to")); label.htmlFor = "voice-target";
    this.select = node("select"); this.select.id = "voice-target";
    for (const shop of ownShop ? [ownShop] : [{ id: "", name: this.words("地域の案内", "Local guide") }, ...shops.filter(shop => !!shop.networkUrl)]) {
      const option = node("option", shop.name); option.value = shop.id; this.select.append(option);
    }
    label.append(this.select);
    this.select.disabled = !!ownShop;
    this.button = node("button", this.words("🎙 音声で話す", "🎙 Talk to AI")); this.button.id = "voice-start"; this.button.type = "button";
    this.status = node("p", this.words("音声は運営のGeminiを使います。", "Voice uses the site's Gemini.")); this.status.id = "voice-status"; this.status.setAttribute("role", "status");
    this.heard = node("p"); this.heard.id = "voice-heard";
    this.spoken = node("p"); this.spoken.id = "voice-spoken";
    this.spoken.setAttribute("aria-live", "polite");
    const row = node("div"); row.className = "finder-voice-controls"; row.append(label, this.button);
    panel.append(header, mode, row, this.status, this.heard, this.spoken); (launcherHost || document.body).append(this.launcher); document.body.append(panel);
    this.launcher.addEventListener("click", () => this.open());
    close.addEventListener("click", () => panel.close());
    panel.addEventListener("close", () => { if (panel.open || this.reviewing) return; this.launcher.setAttribute("aria-expanded", "false"); this.stop(); this.launcher.focus({ preventScroll: true }); });
    panel.addEventListener("click", event => {
      if (event.target !== panel) return;
      const box = panel.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) panel.close();
    });
    this.select.addEventListener("change", () => {
      this.cancelQuestions(); this.silence();
      if (this.select.value) shopFrame.open(this.select.value); else shopFrame.close();
      this.updateTarget();
    });
    shopFrame.onChange = () => { for (const [id, controller] of this.pending) if (controller.shop && controller.shop !== shopFrame.shop) this.cancelQuestion(id, controller); this.silence(); this.heard.textContent = this.spoken.textContent = ""; this.updateTarget(); };
    shopFrame.onVoiceReview = open => this.review(open);
    shopFrame.onVoiceOpen = () => this.open();
    this.button.addEventListener("click", () => this.state === "off" ? void this.start() : this.stop());
    document.getElementById("ns-newchat")?.addEventListener("click", () => this.stop());
    document.getElementById("ai-settings-open")?.addEventListener("click", () => this.stop());
    window.addEventListener("pagehide", () => this.stop());
    this.updateTarget();
  }
  words(ja, en) { return this.english ? en : ja; }
  open() {
    if (!this.dialog.open) this.dialog.showModal();
    this.launcher.setAttribute("aria-expanded", "true");
    if (this.state === "off") void this.start();
  }
  review(open) {
    if (open && this.dialog?.open) {
      this.reviewing = true; this.dialog.close(); this.launcher.setAttribute("aria-expanded", "false");
      this.launcher.textContent = this.words("🎙 音声会話中・戻る", "🎙 Voice active · Return");
    } else if (!open && this.reviewing) {
      this.reviewing = false;
      this.launcher.textContent = this.words("🎙 音声で話す", "🎙 Talk to AI");
      if (this.state !== "off") { if (!this.dialog.open) this.dialog.showModal(); this.launcher.setAttribute("aria-expanded", "true"); }
    }
  }
  updateTarget() { if (this.select) this.select.value = this.shopFrame.shop?.id || ""; }
  silence() { for (const source of this.playing) { try { source.stop(); } catch { /* Already ended. */ } } this.playing.clear(); this.playAt = 0; }
  cancelQuestion(id, controller) {
    controller.abort(); this.pending.delete(id);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: "result", id, answer: "The conversation target changed. Do not repeat the previous request.", target: "guide" }));
  }
  cancelQuestions() { for (const [id, controller] of this.pending) this.cancelQuestion(id, controller); }
  stop(message) {
    this.generation++; clearTimeout(this.connectionTimer); this.state = "off";
    this.reviewing = false;
    if (this.launcher) this.launcher.textContent = this.words("🎙 音声で話す", "🎙 Talk to AI");
    const ws = this.ws; this.ws = null; ws?.close(); this.cancelQuestions(); this.silence();
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    void this.input?.close().catch(() => {}); this.input = null;
    void this.output?.close().catch(() => {}); this.output = null;
    if (this.button) { this.button.textContent = this.words("🎙 音声で話す", "🎙 Talk to AI"); this.button.setAttribute("aria-pressed", "false"); }
    if (this.status) this.status.textContent = message || this.words("音声を終了しました。", "Voice ended.");
  }
  async start() {
    const generation = ++this.generation;
    this.state = "connecting"; this.button.textContent = this.words("■ 接続をやめる", "■ Cancel connection"); this.button.setAttribute("aria-pressed", "true");
    this.status.textContent = this.words("音声AIにつないでいます…", "Connecting voice AI…"); this.heard.textContent = this.spoken.textContent = "";
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error();
      this.output = new AudioContext({ sampleRate: 24000 }); await this.output.resume();
      if (generation !== this.generation) return;
      const response = await this.fetch("/api/ai/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(); const session = await response.json();
      if (generation !== this.generation) return;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const context = new AudioContext({ sampleRate: 16000 }); this.input = context;
      await context.audioWorklet.addModule(new URL("./voice-audio.js", import.meta.url));
      if (generation !== this.generation) return;
      const node = new AudioWorkletNode(context, "microphone");
      context.createMediaStreamSource(stream).connect(node); node.connect(context.destination);
      const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/ai/live`); this.ws = ws;
      this.connectionTimer = setTimeout(() => { if (generation === this.generation) this.stop(this.words("音声に接続できませんでした。もう一度お試しください。", "Voice could not connect. Please try again.")); }, 20000);
      ws.onopen = () => { if (this.ws === ws) ws.send(JSON.stringify({ type: "start", token: session.token, language: document.documentElement.lang || "ja", ...(this.ownShop ? { scope: "shop" } : {}) })); };
      node.port.onmessage = event => {
        if (this.state !== "on" || this.ws !== ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 128000) return;
        const samples = event.data, bytes = new Uint8Array(samples.length * 2), pcm = new DataView(bytes.buffer);
        samples.forEach((sample, i) => pcm.setInt16(i * 2, Math.max(-1, Math.min(1, sample)) * (sample < 0 ? 32768 : 32767), true));
        ws.send(JSON.stringify({ type: "audio", data: btoa(String.fromCharCode(...bytes)) }));
      };
      ws.onmessage = event => { if (this.ws === ws) { try { this.message(JSON.parse(event.data), ws); } catch { this.stop(this.words("音声の応答を確認できませんでした。", "The voice response could not be read.")); } } };
      ws.onerror = () => { if (this.ws === ws) this.stop(this.words("音声接続が中断しました。文字でも相談できます。", "Voice disconnected. You can use text chat.")); };
      ws.onclose = event => { if (this.ws === ws) this.stop(event.code === 1000 ? this.words("音声会話を終了しました。", "Voice conversation ended.") : this.words("音声に接続できませんでした。文字でも相談できます。", "Voice could not connect. You can use text chat.")); };
    } catch { if (generation === this.generation) this.stop(this.words("マイクや音声AIに接続できませんでした。マイクの許可と接続状態を確認してください。", "Could not connect the microphone or voice AI. Check microphone permission and connection.")); }
  }
  message(message, ws) {
    if (message.type === "ready") { clearTimeout(this.connectionTimer); this.state = "on"; this.button.textContent = this.words("■ 音声を終了", "■ End voice"); this.status.textContent = this.words("お話しください。AIが声で答えます。", "Speak now. The AI will answer aloud."); }
    if (message.type === "heard") this.heard.textContent = (this.heard.textContent + message.text).slice(-4000);
    if (message.type === "spoken") this.spoken.textContent = (this.spoken.textContent + message.text).slice(-4000);
    if (message.type === "turn") { this.heard.textContent = ""; }
    if (message.type === "interrupted") { this.silence(); this.spoken.textContent = ""; }
    if (message.type === "cancel") { this.pending.get(message.id)?.abort(); this.pending.delete(message.id); }
    if (message.type === "consult") {
      if (this.pending.has(message.id)) return;
      const controller = new AbortController();
      // Return to the guide before registering this question; changing the target cancels earlier questions.
      if (!this.ownShop && message.guide && this.shopFrame.shop) this.shopFrame.close();
      this.pending.set(message.id, controller);
      this.status.textContent = this.words("調べています。確認画面が出たら内容を確認してください。", "Checking. Review any confirmation shown on screen.");
      const target = this.shopFrame.shop;
      controller.shop = target;
      const operation = target ? this.shopFrame.askVoice(message.question, controller.signal) : runVisibleChatTurn(document, message.question, controller.signal);
      void operation.then(answer => {
        // Opening a shop as the guide's answer changes the target, but its selection reply is still useful.
        if (this.ws === ws && !controller.signal.aborted) ws.send(JSON.stringify({ type: "result", id: message.id, answer, target: this.shopFrame.shop?.name || this.words("地域の案内", "Local guide") }));
      }).catch(() => { if (this.ws === ws && !controller.signal.aborted) ws.send(JSON.stringify({ type: "result", id: message.id, answer: this.words("回答を確認できませんでした。画面を確認してください。", "The answer could not be confirmed. Please check the screen."), target: target?.name || "guide" })); }).finally(() => { this.pending.delete(message.id); if (this.ws === ws) this.status.textContent = this.words("お話しください。AIが声で答えます。", "Speak now. The AI will answer aloud."); });
    }
    if (message.type === "audio" && this.output) {
      const bytes = Uint8Array.from(atob(message.data), c => c.charCodeAt(0)), pcm = new DataView(bytes.buffer);
      const rate = Number(message.mimeType?.match(/rate=(\d+)/)?.[1] || 24000);
      if (bytes.length % 2 || rate < 8000 || rate > 48000 || this.playAt - this.output.currentTime > 30) return;
      const buffer = this.output.createBuffer(1, bytes.length / 2, rate), channel = buffer.getChannelData(0);
      for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
      const source = this.output.createBufferSource(); source.buffer = buffer; source.connect(this.output.destination);
      const at = Math.max(this.output.currentTime, this.playAt); source.start(at); this.playAt = at + buffer.duration;
      this.playing.add(source); source.onended = () => this.playing.delete(source);
    }
  }
}
