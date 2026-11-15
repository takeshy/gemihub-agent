import { z } from "zod";
import { tr } from "../shared/i18n.ts";
import { dateIn, regionOf, zonedDate } from "../shared/region.ts";
import { closedOn, hoursForDate, type Booking, type ShopConfig } from "./domain.ts";

// Restaurant reservations draw on one pool of seats per day. Tables are not assigned: the shop adjusts
// the number of seats it sets aside, and a party takes as many seats as it has people.

type SeatConfig = Pick<ShopConfig, "seating" | "menus" | "hours" | "rules" | "region" | "reservationsEnabled">;
type SeatBooking = Pick<Booking, "status" | "start" | "end" | "partySize">;
export type SeatProblem = "not_restaurant" | "date" | "window" | "closed" | "party_size" | "seat_only" | "course" | "course_people" | "time" | "full";
export type SeatSlot = { start: string; end: string; reservable: number; booked: number; remaining: number; fits: boolean };

/** Seats set aside for reservations on a date: that date's override, or the shop's normal number. */
export function seatsFor(config: Pick<ShopConfig, "seating">, date: string) {
  return config.seating?.overrides.find(day => day.date === date)?.reservableSeats ?? config.seating?.reservableSeats ?? 0;
}
/** A course a reservation may name: shown, and marked as a course. */
export const reservableCourse = (config: Pick<ShopConfig, "menus">, courseId: string) =>
  config.menus.find(menu => menu.id === courseId && menu.active && menu.kind === "course" && !menu.optionFor);
export const isLargeParty = (config: Pick<ShopConfig, "seating">, partySize: number) => !!config.seating && partySize >= config.seating.largePartyFrom;
/** How long the seats are held: the course's own time, else the large-party or standard time by party size. */
export function durationFor(config: Pick<ShopConfig, "seating" | "menus">, partySize: number, courseId?: string) {
  const course = courseId ? reservableCourse(config, courseId) : undefined;
  if (course?.courseMinutes) return course.courseMinutes;
  const seating = config.seating;
  if (!seating) return 0;
  return partySize >= seating.largePartyFrom ? seating.largePartyMinutes : seating.standardMinutes;
}
const problemText = (problem: SeatProblem, config: SeatConfig, courseId?: string) => {
  const course = courseId ? reservableCourse(config, courseId) : undefined;
  return ({
    not_restaurant: tr("このお店は席の予約を受け付けていません"),
    date: tr("日付を確認してください"),
    window: tr("この日は予約を受け付けていません"),
    closed: tr("この日は休業日です"),
    party_size: tr("予約できる人数は{0}〜{1}名です", config.seating?.minPartySize, config.seating?.maxPartySize),
    seat_only: tr("このお店はコースの予約のみ受け付けています"),
    course: tr("このコースは予約できません"),
    course_people: tr("{0}は{1}〜{2}名で予約できます", course?.name, course?.minPeople ?? 1, course?.maxPeople ?? config.seating?.maxPartySize),
    time: tr("この時刻は予約できません"),
    full: tr("この時間は満席です"),
  })[problem];
};
/** Why no time on this date can be offered to this party, before looking at who else has reserved. */
export function seatingProblem(config: SeatConfig, date: string, partySize: number, courseId?: string, now = new Date()): SeatProblem | undefined {
  const seating = config.seating;
  if (!seating || config.reservationsEnabled === false) return "not_restaurant";
  if (!z.iso.date().safeParse(date).success) return "date";
  if (!Number.isInteger(partySize) || partySize < seating.minPartySize || partySize > seating.maxPartySize) return "party_size";
  if (courseId) {
    const course = reservableCourse(config, courseId);
    if (!course) return "course";
    if (partySize < (course.minPeople ?? 1) || partySize > (course.maxPeople ?? Infinity)) return "course_people";
  } else if (!seating.seatOnly) return "seat_only";
  const today = dateIn(now, regionOf(config).timeZone);
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + config.rules.advanceDays * 86400000).toISOString().slice(0, 10);
  if (date < today || date > last || (!config.rules.sameDay && date === today)) return "window";
  if (closedOn(config, date)) return "closed";
  return undefined;
}
/** Seats taken at the busiest moment of [from, to): each active reservation holds its party size for its own duration. */
function busiest(bookings: readonly SeatBooking[], from: number, to: number) {
  const overlapping = bookings.filter(b => b.status === "active" && b.partySize && Date.parse(b.start) < to && Date.parse(b.end) > from);
  const moments = [from, ...overlapping.map(b => Date.parse(b.start)).filter(start => start > from)];
  return Math.max(0, ...moments.map(moment => overlapping.reduce((total, b) => Date.parse(b.start) <= moment && Date.parse(b.end) > moment ? total + b.partySize! : total, 0)));
}
/** Every start time the shop accepts on the date that has not passed and ends by closing, with the seats left. */
export function seatAvailability(config: SeatConfig, bookings: readonly SeatBooking[], date: string, partySize: number, courseId?: string, now = new Date()): SeatSlot[] {
  if (seatingProblem(config, date, partySize, courseId, now)) return [];
  const timeZone = regionOf(config).timeZone;
  const duration = durationFor(config, partySize, courseId);
  const hours = hoursForDate(config, date);
  const opening = zonedDate(date, hours.start, timeZone).getTime();
  const closing = zonedDate(date, hours.end, timeZone).getTime();
  const reservable = seatsFor(config, date);
  const result: SeatSlot[] = [];
  for (const time of [...config.seating!.startTimes].sort()) {
    const start = zonedDate(date, time, timeZone).getTime();
    const end = start + duration * 60000;
    if (!Number.isFinite(start) || start < opening || end > closing || start < now.getTime() + config.rules.leadMinutes * 60000) continue;
    const booked = busiest(bookings, start, end);
    // Seats cut below what is already reserved leave nothing to offer; the existing reservations stay.
    const remaining = Math.max(0, reservable - booked);
    result.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), reservable, booked, remaining, fits: remaining >= partySize });
  }
  return result;
}
/** Whether this party can be seated at this start time; `start` is an ISO instant from `seatAvailability`. */
export function canSeat(config: SeatConfig, bookings: readonly SeatBooking[], date: string, start: string, partySize: number, courseId?: string, now = new Date()):
  { ok: true; durationMinutes: number; end: string } | { ok: false; problem: SeatProblem; reason: string } {
  const refuse = (problem: SeatProblem) => ({ ok: false as const, problem, reason: problemText(problem, config, courseId) });
  const problem = seatingProblem(config, date, partySize, courseId, now);
  if (problem) return refuse(problem);
  const slot = seatAvailability(config, bookings, date, partySize, courseId, now).find(slot => slot.start === start);
  if (!slot) return refuse("time");
  if (!slot.fits) return refuse("full");
  return { ok: true, durationMinutes: durationFor(config, partySize, courseId), end: slot.end };
}
export const seatProblemText = problemText;
/** Seats reserved beyond the number set aside, at the busiest moment of the date (0 when within it). */
export function seatOverflow(config: SeatConfig, bookings: readonly SeatBooking[], date: string) {
  const timeZone = regionOf(config).timeZone;
  const from = zonedDate(date, "00:00", timeZone).getTime();
  return Math.max(0, busiest(bookings, from, from + 86400000) - seatsFor(config, date));
}
/** The owner's table for a date: every start time, whether or not it can still be reserved. */
export function seatBoard(config: SeatConfig, bookings: readonly SeatBooking[], date: string) {
  if (!config.seating || !z.iso.date().safeParse(date).success) return [];
  const timeZone = regionOf(config).timeZone;
  const reservable = seatsFor(config, date);
  return [...config.seating.startTimes].sort().map(time => {
    const start = zonedDate(date, time, timeZone).getTime();
    // Seats occupied at the start time itself; parties arriving later show on their own rows.
    const booked = busiest(bookings, start, start + 60000);
    return { time, reservable, booked, remaining: Math.max(0, reservable - booked), overflow: Math.max(0, booked - reservable) };
  });
}
