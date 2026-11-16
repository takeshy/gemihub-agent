export function mountSiteEditor() {
  document.getElementById("site-design").hidden = false;
  document.getElementById("site-design-toggle").addEventListener("click", () => { location.href = "/page-editor"; });
}
