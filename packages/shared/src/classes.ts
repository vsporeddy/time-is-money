// Character classes — passive-only abilities. Each is tied to one fixed
// portrait (see portraits.ts for the sheet layout); assigning a class means
// assigning its portrait too.

export interface ClassDefinition {
  id: string;
  name: string;
  description: string;
  color: string; // distinguishes each class's badge/label wherever it's shown
  portraitIndex: number; // the one portrait this class always appears as
}

export const CLASS_DEFINITIONS: ClassDefinition[] = [
  { id: 'prospector', name: 'Prospector', description: "Every lot's modifiers and true value are revealed to you instantly, with no staggered reveal.", color: '#e8c25a', portraitIndex: 51 },
  { id: 'merchant', name: 'Merchant', description: "Knows the Lot Pool's full sale order in advance.", color: '#57c98a', portraitIndex: 44 },
  { id: 'spy', name: 'Spy', description: 'Sees every mystery item in the Lot Pool that stays hidden to everyone else.', color: '#9b6bd9', portraitIndex: 145 },
  { id: 'investor', name: 'Investor', description: 'Unspent time quietly earns interest at the end of every round.', color: '#2fb8c4', portraitIndex: 34 },
  { id: 'smuggler', name: 'Smuggler', description: 'Weapons you own count toward a small set bonus.', color: '#d1495c', portraitIndex: 153 },
  { id: 'appraiser', name: 'Appraiser', description: "Sees an item's hidden trait before bidding even opens.", color: '#bfe6f0', portraitIndex: 31 },
  { id: 'auctioneer', name: 'Auctioneer', description: 'Takes a small commission rebate of time back on every lot won.', color: '#f0923c', portraitIndex: 38 },
  { id: 'insurer', name: 'Insurer', description: 'Recovers part of the time spent on lots bid on and lost.', color: '#7fa8c9', portraitIndex: 13 },
  { id: 'locksmith', name: 'Locksmith', description: 'Chests you win open immediately without a key.', color: '#b8c0c9', portraitIndex: 116 },
  { id: 'hoarder', name: 'Hoarder', description: 'Earns a small flat bonus for every item owned, no matter how cheap.', color: '#9a5a42', portraitIndex: 128 },
  { id: 'gambler', name: 'Gambler', description: 'Each lot won in a row grows a time rebate on the next win. Any lot someone else wins resets the streak.', color: '#e6529c', portraitIndex: 147 },
];

// Classes are unique per room, so the class list is also the hard player cap.
export const MAX_PLAYERS_PER_ROOM = CLASS_DEFINITIONS.length;

// Classes are unique per room — picks randomly among whichever classes aren't
// already taken, or undefined if every one of them (all CLASS_DEFINITIONS.length) is in use.
export function pickAvailableClassId(takenClassIds: Iterable<string>): string | undefined {
  const taken = new Set(takenClassIds);
  const available = CLASS_DEFINITIONS.filter((c) => !taken.has(c.id));
  if (available.length === 0) return undefined;
  return available[Math.floor(Math.random() * available.length)].id;
}

export function getClassDefinition(id: string | undefined): ClassDefinition | undefined {
  return CLASS_DEFINITIONS.find((c) => c.id === id);
}
