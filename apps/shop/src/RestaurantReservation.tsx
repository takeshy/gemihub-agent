import React from "react";
import type { ShopConfig } from "../server/domain";
import { getLocale, tr } from "../shared/i18n";
import { lateReleaseMinutes } from "../shared/seating";
import { reservePageCopy } from "../shared/restaurant-agent-copy";

/** Shared by the visible reservation page and the assistant's backing state on other pages. */
export function RestaurantReservationForm({ config }: { config: ShopConfig }) {
  const t = reservePageCopy(getLocale(), config.name);
  return <>
    <p id="reserve-embedded-note" className="muted" hidden>{t.embeddedNote}</p>
    <section id="reserve-result" className="panel notice" role="status" hidden>
      <h2 id="reserve-result-title" /><p id="reserve-result-text" />
    </section>
    <section className="panel restaurant-reservation-form" aria-labelledby="reserve-heading">
      <h2 id="reserve-heading">{t.form}</h2>
      <form id="reserve-form" noValidate>
        <div className="form-grid">
          <label className="field">{t.date}<input type="date" id="reserve-date" required /></label>
          <label className="field">{t.people}<input type="number" id="reserve-people" inputMode="numeric" step="1" required /></label>
          <label className="field">{t.course}<select id="reserve-course" /></label>
          <label className="field">{t.time}<select id="reserve-time" required /></label>
        </div>
        <label className="field">{t.note}<textarea id="reserve-note" maxLength={300} /></label>
        <div className="form-grid">
          <label className="field">{t.name}<input type="text" id="reserve-name" maxLength={100} autoComplete="name" required /></label>
          <label className="field">{t.phone}<input type="tel" id="reserve-phone" maxLength={24} autoComplete="tel" required /></label>
        </div>
        <p className="muted">{config.seating?.confirmationCall === false ? t.noCallback(lateReleaseMinutes) : t.callback}</p>
        <p id="reserve-summary" className="notice" />
        <p id="reserve-error" className="error" role="alert" hidden />
        <button type="submit" className="button primary">{t.submit}</button>
      </form>
    </section>
  </>;
}

export function RestaurantReservation({ config }: { config: ShopConfig }) {
  return <div className="restaurant-reservation-page">
    <section className="panel">
      <h2>{tr("ご予約")}</h2>
      <p>{tr("日時と人数を選び、下のフォームからご予約いただけます。空席やコースを相談しながら進めたい方は、AIもご利用いただけます。")}</p>
      <button id="assistant-toggle" className="button primary" type="button" aria-controls="assistant" aria-expanded="false" disabled>{tr("AIで予約する")}</button>
    </section>
    <RestaurantReservationForm config={config} />
  </div>;
}
