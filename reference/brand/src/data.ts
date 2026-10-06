// Skyline's own accounts and bookings. The Provider never stores these; its
// agent reads and changes them only through the Brand API with a delegation
// token for the signed-in user.

export type Flight = {
  flight: string;
  from: string;
  to: string;
  date: string;
  departs: string;
  arrives: string;
};

export type Alternative = Flight & { seatsLeft: number; changeFee: number };

export type Trip = Flight & {
  confirmation: string;
  seat: string;
  status: "on_time" | "delayed";
  delayMinutes: number;
  scheduledDeparts: string;
  alternatives: Alternative[];
};

export type User = { id: string; name: string; email: string; password: string };

export const USERS: User[] = [
  { id: "sky-4471", name: "Alex Rivera", email: "alex.rivera@example.com", password: "skyline" },
];

export const SCOPE_LABELS: Record<string, string> = {
  "flights:upcoming:read": "View upcoming flights",
  "flights:history:read": "View past flights",
  "flights:rebook": "Rebook flights",
};

function initialTrips(): Record<string, { upcoming: Trip[]; past: Trip[] }> {
  return {
    "sky-4471": {
      upcoming: [
        {
          confirmation: "K7PQ2M",
          flight: "SK 482",
          from: "SFO",
          to: "O'Hare",
          date: "Friday",
          departs: "2:40 PM",
          arrives: "8:50 PM",
          scheduledDeparts: "10:05 AM",
          seat: "22A",
          status: "delayed",
          delayMinutes: 270,
          alternatives: [
            {
              flight: "SK 318",
              from: "SFO",
              to: "O'Hare",
              date: "Friday",
              departs: "11:15 AM",
              arrives: "5:20 PM",
              seatsLeft: 4,
              changeFee: 0,
            },
          ],
        },
      ],
      past: [
        {
          confirmation: "R2LW8D",
          flight: "SK 211",
          from: "O'Hare",
          to: "SFO",
          date: "Aug 14",
          departs: "7:30 AM",
          arrives: "10:05 AM",
          scheduledDeparts: "7:30 AM",
          seat: "9C",
          status: "on_time",
          delayMinutes: 0,
          alternatives: [],
        },
        {
          confirmation: "M4TB6Q",
          flight: "SK 905",
          from: "SFO",
          to: "Seattle",
          date: "Jun 3",
          departs: "6:10 PM",
          arrives: "8:20 PM",
          scheduledDeparts: "6:10 PM",
          seat: "14F",
          status: "on_time",
          delayMinutes: 0,
          alternatives: [],
        },
      ],
    },
  };
}

let trips = initialTrips();

export function resetTrips(): void {
  trips = initialTrips();
}

export function findUser(email: string, password: string): User | undefined {
  return USERS.find(
    (user) => user.email.toLowerCase() === email.trim().toLowerCase() && user.password === password,
  );
}

export function upcomingTrips(userId: string): Trip[] {
  return trips[userId]?.upcoming ?? [];
}

export function pastTrips(userId: string): Trip[] {
  return trips[userId]?.past ?? [];
}

export function rebook(userId: string, confirmation: string, flight: string): Trip | undefined {
  const trip = upcomingTrips(userId).find((candidate) => candidate.confirmation === confirmation);
  const target = trip?.alternatives.find((alternative) => alternative.flight === flight);
  if (!trip || !target) return undefined;
  const previous: Alternative = {
    flight: trip.flight,
    from: trip.from,
    to: trip.to,
    date: trip.date,
    departs: trip.departs,
    arrives: trip.arrives,
    seatsLeft: 12,
    changeFee: 0,
  };
  Object.assign(trip, {
    ...target,
    scheduledDeparts: target.departs,
    seat: "14C",
    status: "on_time",
    delayMinutes: 0,
    alternatives: [previous],
  });
  return trip;
}
