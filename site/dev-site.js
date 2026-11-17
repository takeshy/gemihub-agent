// Keep the environment notice outside the editable page design.
if (typeof location !== "undefined" && location.hostname === "dev.gemihub.net") {
  document.title = `【デモ】${document.title}`;
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow";
  document.head.append(robots);

  const notice = document.createElement("aside");
  notice.className = "demo-notice";
  notice.setAttribute("aria-label", "デモサイトのご案内");
  const label = document.createElement("strong");
  label.textContent = "デモサイト";
  const description = document.createElement("span");
  description.textContent = "街の案内AIの動作を体験するためのサイトです。";
  notice.append(label, description);
  document.body.prepend(notice);

  const badge = document.createElement("strong");
  badge.className = "demo-badge";
  badge.textContent = "デモ";
  document.getElementById("shop-view-header")?.append(badge);
}
