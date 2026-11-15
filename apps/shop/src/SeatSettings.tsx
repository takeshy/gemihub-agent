import { tr } from "../shared/i18n";
import React, { useState } from "react";
import type { ShopConfig } from "../server/domain";
import { dateIn, regionOf } from "../shared/region";
import { DateInput } from "./DateInput";
import { defaultSeating, halfHours, lateReleaseMinutes } from "../shared/seating";

type Seating = NonNullable<ShopConfig["seating"]>;
const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
export function SeatSettings({ config, onChange }: { config: ShopConfig; onChange: (seating: Seating) => void }) {
  const seating = config.seating || defaultSeating(config.hours);
  const [times, setTimes] = useState(() => [...seating.startTimes].sort().join(", "));
  const put = <K extends keyof Seating>(key: K, value: Seating[K]) => onChange({ ...seating, [key]: value });
  const number = (key: "reservableSeats" | "standardMinutes" | "largePartyMinutes" | "largePartyFrom" | "minPartySize" | "maxPartySize", label: string, min: number, max: number, step = 1) =>
    <label className="field"><span>{label}</span><input type="number" min={min} max={max} step={step} value={seating[key]} onChange={event => put(key, +event.target.value)} /></label>;
  const parsed = times.split(/[\s,、]+/).filter(Boolean);
  const invalid = parsed.filter(time => !clock.test(time));
  return <div className="seat-settings">
    <h3>{tr("席の設定")}</h3>
    <p className="muted">{tr("予約用に確保する席数を登録します。予約は席数の合計で管理し、テーブルの割り当てはしません。状況に合わせていつでも増減できます。")}</p>
    <div className="form-grid">
      {number("reservableSeats", tr("予約用の席数（通常の日）"), 0, 500)}
      {number("minPartySize", tr("予約できる人数（下限）"), 1, 200)}
      {number("maxPartySize", tr("予約できる人数（上限）"), 1, 200)}
      {number("standardMinutes", tr("通常予約の利用時間（分）"), 30, 360, 15)}
      {number("largePartyMinutes", tr("宴会の利用時間（分）"), 30, 360, 15)}
      {number("largePartyFrom", tr("この人数以上を宴会として扱う"), 2, 200)}
    </div>
    <label className="field"><span>{tr("受付開始時刻（カンマ区切り・例 17:00, 17:30）")}</span>
      <input value={times} aria-invalid={!!invalid.length} onChange={event => {
        setTimes(event.target.value);
        const next = [...new Set(event.target.value.split(/[\s,、]+/).filter(time => clock.test(time)))].sort();
        if (next.length) put("startTimes", next);
      }} /></label>
    {!!invalid.length && <p className="alert" role="alert">{tr("時刻は HH:MM の形で入力してください：{0}", invalid.join(", "))}</p>}
    <div className="actions"><button type="button" onClick={() => { const next = halfHours(seating.startTimes.slice().sort()[0], seating.startTimes.slice().sort().at(-1)!); setTimes(next.join(", ")); put("startTimes", next); }}>{tr("最初から最後まで30分刻みにする")}</button></div>
    <label className="check-field"><input type="checkbox" checked={seating.seatOnly} onChange={event => put("seatOnly", event.target.checked)} /><span>{tr("席のみの予約（コースなし）を受け付ける")}</span></label>
    <label className="check-field"><input type="checkbox" checked={seating.confirmationCall !== false} onChange={event => put("confirmationCall", event.target.checked)} /><span>{tr("予約が入ったら、お客様へ折り返しの確認電話をする")}</span></label>
    <p className="small muted">{seating.confirmationCall !== false ? tr("予約ページに「お店から確認のお電話を差し上げます」と表示します。") : tr("折り返しの電話はしません。予約ページに「ご予約時刻から{0}分を過ぎてもご来店がない場合は、他のお客様をご案内します」と表示します。", lateReleaseMinutes)}</p>
    <SeatOverrides config={{ ...config, seating }} onChange={overrides => put("overrides", overrides)} />
  </div>;
}

export function SeatOverrides({ config, onChange }: { config: ShopConfig; onChange: (overrides: Seating["overrides"]) => void }) {
  const seating = config.seating!;
  const today = dateIn(new Date(), regionOf(config).timeZone);
  const [date, setDate] = useState(today);
  const overrides = [...seating.overrides].sort((a, b) => a.date.localeCompare(b.date));
  const set = (target: string, reservableSeats: number, note?: string) => {
    const seats = Math.max(0, Math.min(500, Math.round(reservableSeats)));
    const existing = seating.overrides.find(day => day.date === target);
    onChange(existing ? seating.overrides.map(day => day.date === target ? { ...day, reservableSeats: seats, ...(note !== undefined ? { note: note || undefined } : {}) } : day)
      : [...seating.overrides, { date: target, reservableSeats: seats, ...(note ? { note } : {}) }]);
  };
  const seatsOn = (target: string) => seating.overrides.find(day => day.date === target)?.reservableSeats ?? seating.reservableSeats;
  return <fieldset className="seat-overrides">
    <legend>{tr("日ごとの席数")}</legend>
    <p className="small muted">{tr("貸切や団体の予定に合わせて、その日だけ席数を変えられます。すでに入っている予約は取り消されません。")}</p>
    <div className="actions">
      <span>{tr("今日（{0}）：{1}席", today, seatsOn(today))}</span>
      <button type="button" onClick={() => set(today, seatsOn(today) + 4)}>{tr("今日だけ +4席")}</button>
      <button type="button" disabled={seatsOn(today) < 4} onClick={() => set(today, seatsOn(today) - 4)}>{tr("今日だけ −4席")}</button>
    </div>
    <div className="edit-row">
      <label className="field"><span>{tr("日付を追加")}</span><DateInput aria-label={tr("日付を追加")} value={date} min={today} onValueChange={setDate} /></label>
      <button type="button" disabled={!date || seating.overrides.some(day => day.date === date) || seating.overrides.length >= 400} onClick={() => set(date, seating.reservableSeats)}>{tr("この日の席数を変える")}</button>
    </div>
    {!overrides.length && <p className="small muted">{tr("席数を変えた日はありません。")}</p>}
    {overrides.map(day => <div className="edit-row" key={day.date}>
      <label className="field"><span>{tr("{0} の席数", day.date)}</span><input type="number" min={0} max={500} value={day.reservableSeats} onChange={event => set(day.date, +event.target.value)} /></label>
      <label className="field"><span>{tr("メモ（任意）")}</span><input value={day.note || ""} maxLength={100} onChange={event => set(day.date, day.reservableSeats, event.target.value)} /></label>
      <button type="button" onClick={() => onChange(seating.overrides.filter(other => other.date !== day.date))}>{tr("通常の席数に戻す")}</button>
    </div>)}
  </fieldset>;
}
