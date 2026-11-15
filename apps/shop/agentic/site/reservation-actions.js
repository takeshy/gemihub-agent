// Registers the reservation page's operations with the agent runtime.
// agent-manifest.json loads this module through "actions.module". Only the names in
// "actions.agentTools" become model tools, called website_<name>.
// The operations and their rules live in reserve-page.js and on the server; this module
// only wraps them. It imports the page script by the URL the page loads it from, so both
// share one page object.
import { App } from "./reserve-page.js";

class ReservationActions {
  static registerActions(actions) {
    actions.register(ReservationActions.pageStateAction());
    actions.register(ReservationActions.requestAction());
    actions.register(ReservationActions.fillFormAction());
    actions.register(ReservationActions.placeAction());
  }

  static page() {
    if (!App.page) {
      throw new Error("The reservation page has not loaded.");
    }
    return App.page;
  }

  static pageStateAction() {
    return {
      name: "get_reservation_page_state",
      description: "Read this page: the restaurant's name, today's date (as YYYY-MM-DD and with its weekday), the first and last date that can be reserved, the party sizes accepted, whether seats-only reservations are accepted, the courses that can be reserved with their ids, the cancellation rule, what the reservation form shows now (date, time, party size, course, length of stay, total, the start times for that date with seats left), its version, and the latest reservation made on this page. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ReservationActions.page().getState(),
    };
  }

  static requestAction() {
    return {
      name: "get_reservation_request",
      description: "Read the conditions another site passed to this page when the visitor came from it: date, time, partySize, course (none = seats only, wanted = a course, any = either), courseId, budgetPerPerson and avoid (foods to avoid). Returns null when the visitor came without conditions. It never contains names or contact details. Changes nothing.",
      effect: "read",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ request: ReservationActions.page().getRequest() }),
    };
  }

  static fillFormAction() {
    const courseIds = ReservationActions.page().courseIds();
    const properties = {
      date: { type: "string", format: "date", description: "The date as YYYY-MM-DD, from the visitor, between firstDate and lastDate of website_get_reservation_page_state." },
      time: { type: "string", maxLength: 5, description: "The start time as HH:MM, one of the start times the page offers. Leave out to choose the date first." },
      partySize: { type: "integer", minimum: 1, maximum: 200, description: "How many guests, from the visitor." },
      dietaryNote: { type: "string", maxLength: 300, description: "Foods to avoid or other notes for the kitchen, in the visitor's words. Leave out to keep the note in the form." },
    };
    if (courseIds.length) {
      properties.courseId = { type: "string", enum: courseIds, description: "The course id from website_get_reservation_page_state or mcp_find_menu_items. Leave out for seats only." };
    }
    return {
      name: "fill_reservation_form",
      description: "Put a date, party size, optional start time, optional course and optional dietary note in the reservation form on this page, where the visitor sees and can change them. Returns the updated form (with the length of stay, whether it is seats only, the total, and the start times with seats left) and the new version, or ok false with a reason when the restaurant cannot seat it. Does not make a reservation.",
      effect: "write",
      inputSchema: { type: "object", additionalProperties: false, required: ["date", "partySize"], properties: properties },
      execute: (args) => ReservationActions.page().fillForm(args),
    };
  }

  static placeAction() {
    const courseIds = ReservationActions.page().courseIds();
    const properties = {
      date: { type: "string", format: "date", description: "The date in the form, as YYYY-MM-DD." },
      time: { type: "string", maxLength: 5, description: "The start time in the form, as HH:MM." },
      partySize: { type: "integer", minimum: 1, maximum: 200, description: "The party size in the form." },
      name: { type: "string", minLength: 1, maxLength: 120, description: "The name for the reservation, as the visitor gave it." },
      phone: { type: "string", minLength: 6, maxLength: 24, description: "The visitor's phone number, as they gave it. The restaurant reaches them at this number; no email is taken." },
      dietaryNote: { type: "string", maxLength: 300, description: "Foods to avoid or other notes for the kitchen. Leave out to use the note in the form." },
      expectedVersion: { type: "integer", minimum: 0, description: "The latest version in this turn: from website_get_reservation_page_state, or from website_fill_reservation_form if it ran after that read." },
      expectedTotal: { type: "number", minimum: 0, description: "form.total from the same result as expectedVersion: the amount the visitor saw. 0 for seats only." },
    };
    if (courseIds.length) {
      properties.courseId = { type: "string", enum: courseIds, description: "The course in the form. Leave out for seats only." };
    }
    return {
      name: "place_reservation",
      description: "Make the reservation that the form on this page shows, for the named guest. The browser asks the visitor to confirm first, showing the date, time, length of stay, party size, course or seats only, total and cancellation rule. The site refuses a stale expectedVersion, a changed total, a time that is no longer free, and a missing phone number. Returns the receipt with the reservation id. Takes no payment.",
      effect: "irreversible",
      inputSchema: { type: "object", additionalProperties: false, required: ["date", "time", "partySize", "name", "phone", "expectedVersion", "expectedTotal"], properties: properties },
      execute: (args) => ReservationActions.page().placeReservation(args),
    };
  }
}

// The runtime calls the module's registerActions export.
export const registerActions = ReservationActions.registerActions;
