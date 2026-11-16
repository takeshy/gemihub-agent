let channel;
window.addEventListener("message", event => {
  if (event.source !== parent || event.origin !== location.origin) return;
  const input = event.data;
  const send = data => parent.postMessage({ ...data, channel, shop: "voice-demo" }, location.origin);
  if (input?.type === "gemihub:voice-connect" && input.shop === "voice-demo") { channel = input.channel; send({ type: "gemihub:voice-ready" }); }
  if (input?.type === "gemihub:voice-question" && input.channel === channel) {
    document.getElementById("question").textContent = input.question;
    const answer = "サンプル店の営業時間は午前10時から午後6時です。Storybookの固定の回答例です。";
    document.getElementById("answer").textContent = answer;
    send({ type: "gemihub:voice-answer", id: input.id, answer });
  }
});
parent.postMessage({ type: "gemihub:reserve-ready", shop: "voice-demo", version: 1 }, location.origin);
