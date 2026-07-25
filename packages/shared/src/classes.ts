// Character classes — passive-only abilities, randomly assigned per player for
// now. Eventually tied to portrait ranges (see portraits.ts); until then any
// class can land on any portrait.

export interface ClassDefinition {
  id: string;
  name: string;
  description: string;
}

export const CLASS_DEFINITIONS: ClassDefinition[] = [
  { id: 'prospector', name: 'Prospector', description: "Every lot's modifiers and true value are revealed to you instantly, with no staggered reveal." },
  { id: 'merchant', name: 'Merchant', description: "Knows the Lot Pool's full sale order in advance." },
  { id: 'spy', name: 'Spy', description: 'Sees every mystery item in the Lot Pool that stays hidden to everyone else.' },
  { id: 'investor', name: 'Investor', description: 'Unspent time quietly earns interest at the end of every round.' },
  { id: 'antiquarian', name: 'Antiquarian', description: 'Trinkets you own count toward a small set bonus.' },
  { id: 'smuggler', name: 'Smuggler', description: 'Weapons you own count toward a small set bonus.' },
  { id: 'appraiser', name: 'Appraiser', description: "Sees an item's hidden trait before bidding even opens." },
  { id: 'fence', name: 'Fence', description: 'Cursed items you win are never discounted for being cursed.' },
  { id: 'auctioneer', name: 'Auctioneer', description: 'Takes a small commission rebate of time back on every lot won.' },
  { id: 'insurer', name: 'Insurer', description: 'Recovers part of the time spent on lots bid on and lost.' },
  { id: 'locksmith', name: 'Locksmith', description: 'Chests you win open immediately — no matching key required.' },
  { id: 'hoarder', name: 'Hoarder', description: 'Owning duplicates of the same item is penalized less harshly.' },
  { id: 'gambler', name: 'Gambler', description: 'Each lot won in a row grows a time rebate on the next win — any lot someone else wins resets the streak.' },
];

export function randomClassId(): string {
  return CLASS_DEFINITIONS[Math.floor(Math.random() * CLASS_DEFINITIONS.length)].id;
}

export function getClassDefinition(id: string | undefined): ClassDefinition | undefined {
  return CLASS_DEFINITIONS.find((c) => c.id === id);
}
