import { insertAppointment, insertCustomer, resetDemoData } from "./db.js";
import type { CommunicationChannel, Customer } from "./types.js";

const firstNames = [
  "Sarah",
  "Mike",
  "Aisha",
  "Daniel",
  "Priya",
  "Jordan",
  "Emily",
  "Marcus",
  "Olivia",
  "Noah",
  "Grace",
  "Liam",
  "Sophia",
  "Ethan",
  "Maya",
  "Lucas",
  "Nora",
  "Caleb",
  "Isabella",
  "Owen"
];

const lastNames = [
  "Johnson",
  "Brown",
  "Patel",
  "Lee",
  "Garcia",
  "Smith",
  "Kim",
  "Davis",
  "Wilson",
  "Chen",
  "Martinez",
  "Taylor",
  "Singh",
  "Nguyen",
  "Moore",
  "Clark",
  "Walker",
  "Hall",
  "Young",
  "Allen"
];

const serviceProfiles = [
  { businessType: "Facial boutique", serviceType: "Hydrating Facial", cycle: 45, price: 14500 },
  { businessType: "Salon", serviceType: "Color Refresh", cycle: 60, price: 18500 },
  { businessType: "Dental clinic", serviceType: "Dental Cleaning", cycle: 180, price: 21000 },
  { businessType: "Massage clinic", serviceType: "Therapeutic Massage", cycle: 30, price: 12000 },
  { businessType: "Physiotherapy clinic", serviceType: "Mobility Follow-up", cycle: 21, price: 9500 },
  { businessType: "Cleaning service", serviceType: "Deep Clean", cycle: 30, price: 24000 },
  { businessType: "Home services", serviceType: "Seasonal Maintenance", cycle: 90, price: 32000 },
  { businessType: "Facial boutique", serviceType: "Acne Treatment", cycle: 35, price: 13500 },
  { businessType: "Salon", serviceType: "Haircut", cycle: 45, price: 8500 },
  { businessType: "Massage clinic", serviceType: "Sports Recovery Session", cycle: 28, price: 13000 }
];

const staffMembers = ["Alex", "Brooke", "Casey", "Devon", "Harper", "Morgan"];
const channels: CommunicationChannel[] = ["sms", "email", "phone"];

function daysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function jitter(index: number, range: number): number {
  return ((index * 37 + 17) % (range * 2 + 1)) - range;
}

export function seedDemoData(): void {
  resetDemoData();

  for (let index = 0; index < 100; index += 1) {
    const profile = serviceProfiles[index % serviceProfiles.length];
    const firstName = firstNames[index % firstNames.length];
    const lastName = lastNames[(index * 7 + Math.floor(index / firstNames.length) * 3) % lastNames.length];
    const appointmentCount = 2 + ((index * 5) % 8);
    const averageTicketCents = profile.price + jitter(index, 2500);
    const totalSpendCents = averageTicketCents * appointmentCount;
    const lastVisitOffset =
      index % 5 === 0
        ? profile.cycle + 55 + (index % 40)
        : index % 3 === 0
          ? profile.cycle + 18 + (index % 24)
          : Math.max(8, profile.cycle - 12 + (index % 35));

    const customer: Customer = {
      id: `cus_${String(index + 1).padStart(3, "0")}`,
      fullName: `${firstName} ${lastName}`,
      email: `${firstName}.${lastName}.${index + 1}@example.com`.toLowerCase(),
      phone: `+1-555-${String(1100 + index).padStart(4, "0")}`,
      businessType: profile.businessType,
      preferredChannel: channels[index % channels.length],
      vip: index % 9 === 0 || totalSpendCents > 120000,
      typicalReturnDays: profile.cycle,
      totalSpendCents,
      averageTicketCents,
      marketingConsent: index % 11 !== 0,
      notes: index % 9 === 0 ? "VIP customer; prefers proactive scheduling." : "Imported from booking system demo export.",
      createdAt: daysAgo(420 - index)
    };

    insertCustomer(customer);

    for (let visit = 0; visit < appointmentCount; visit += 1) {
      const daysBeforeLast = (appointmentCount - visit - 1) * profile.cycle + Math.max(0, jitter(index + visit, 5));
      insertAppointment({
        id: `apt_${String(index + 1).padStart(3, "0")}_${visit + 1}`,
        customerId: customer.id,
        serviceType: profile.serviceType,
        serviceDate: daysAgo(lastVisitOffset + daysBeforeLast),
        revenueCents: averageTicketCents + jitter(index + visit, 1800),
        staffMember: staffMembers[(index + visit) % staffMembers.length],
        status: "completed"
      });
    }
  }
}
