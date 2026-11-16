// Agent connectivity and reservation support are independent capabilities.
export function reservationPageUrl(shop) {
  if (shop?.reservationEnabled === false) return "";
  return shop?.reservationUrl || (shop?.reservationEnabled === undefined ? shop?.pageUrl : "") || "";
}

export const canReserve = shop => !!reservationPageUrl(shop);
export const hasAgent = shop => !!shop?.networkUrl;
// A reservation URL alone does not provide availability or a supported embedded page.
export const canCheckReservations = shop => hasAgent(shop) && canReserve(shop);

export function shopPageUrl(shop) {
  const url = new URL(shop.pageUrl);
  if (canReserve(shop) && url.href === reservationPageUrl(shop)) url.pathname = url.pathname.replace(/\/reserve\/?$/, "/");
  return url.href;
}
