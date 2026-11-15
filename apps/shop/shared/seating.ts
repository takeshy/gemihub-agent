// Start times and starting seat settings for a restaurant, shared by the owner's screens, the server and the demo data.

const minutes = (clock: string) => Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
const clock = (total: number) => `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
/** Every half hour from the first time to the last, inclusive. */
export function halfHours(from: string, to: string) {
  const result: string[] = [];
  for (let t = minutes(from); t <= minutes(to); t += 30) result.push(clock(t));
  return result;
}
/** Without a confirmation call, a party this many minutes late gives up its seats to other guests. */
export const lateReleaseMinutes = 5;
/** Seat settings a shop starts with when it becomes a restaurant: every half hour that leaves two hours before closing. */
export function defaultSeating(hours: { start: string; end: string }) {
  const startTimes: string[] = [];
  for (let t = minutes(hours.start); t + 120 <= minutes(hours.end); t += 30) startTimes.push(clock(t));
  return {
    reservableSeats: 20, standardMinutes: 90, largePartyMinutes: 120, largePartyFrom: 7,
    startTimes: startTimes.length ? startTimes : [hours.start],
    minPartySize: 1, maxPartySize: 20, seatOnly: true, confirmationCall: true, overrides: [] as { date: string; reservableSeats: number; note?: string }[],
  };
}
