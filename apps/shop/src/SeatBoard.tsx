import { tr } from "../shared/i18n";
import React from "react";
import type { Booking, ShopConfig } from "../server/domain";
import { seatBoard, seatOverflow, seatsFor } from "../server/seats";

/** A date's seats by start time: set aside, reserved and left, with a warning when more are reserved than set aside. */
export function SeatBoard({ config, bookings, date }: { config: ShopConfig; bookings: Booking[]; date: string }) {
  const rows = seatBoard(config, bookings, date);
  if (!rows.length) return null;
  const overflow = seatOverflow(config, bookings, date);
  const note = config.seating?.overrides.find(day => day.date === date)?.note;
  return <section className="seat-board" aria-label={tr("席の状況")}>
    <h3>{tr("{0} の席：予約用 {1}席", date, seatsFor(config, date))}{note ? ` (${note})` : ""}</h3>
    {overflow > 0 && <p className="alert" role="alert">{tr("予約が確保席数を上回っています（超過 {0}席）。席数を増やすか、お客様にご連絡ください。", overflow)}</p>}
    <div className="seat-board-scroll"><table>
      <thead><tr><th scope="col">{tr("開始時刻")}</th>{rows.map(row => <th scope="col" key={row.time}>{row.time}</th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">{tr("予約済み")}</th>{rows.map(row => <td key={row.time} className={row.overflow ? "over" : ""}>{row.booked}</td>)}</tr>
        <tr><th scope="row">{tr("残り")}</th>{rows.map(row => <td key={row.time} className={row.remaining ? "" : "full"}>{row.remaining}</td>)}</tr>
      </tbody>
    </table></div>
  </section>;
}
