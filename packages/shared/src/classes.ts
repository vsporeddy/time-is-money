// Character classes — passive-only abilities, randomly assigned per player for
// now. Eventually tied to portrait ranges (see portraits.ts); until then any
// class can land on any portrait.

export interface ClassDefinition {
  id: string;
  name: string;
  description: string;
  color: string; // distinguishes each class's badge/label wherever it's shown
}

export const CLASS_DEFINITIONS: ClassDefinition[] = [
  { id: 'prospector', name: 'Prospector', description: "Every lot's modifiers and true value are revealed to you instantly, with no staggered reveal.", color: '#e8c25a' },
  { id: 'merchant', name: 'Merchant', description: "Knows the Lot Pool's full sale order in advance.", color: '#57c98a' },
  { id: 'spy', name: 'Spy', description: 'Sees every mystery item in the Lot Pool that stays hidden to everyone else.', color: '#9b6bd9' },
  { id: 'investor', name: 'Investor', description: 'Unspent time quietly earns interest at the end of every round.', color: '#2fb8c4' },
  { id: 'jeweller', name: 'Jeweller', description: 'Trinkets you own count toward a small set bonus.', color: '#c98a3f' },
  { id: 'smuggler', name: 'Smuggler', description: 'Weapons you own count toward a small set bonus.', color: '#d1495c' },
  { id: 'appraiser', name: 'Appraiser', description: "Sees an item's hidden trait before bidding even opens.", color: '#bfe6f0' },
  { id: 'fence', name: 'Fence', description: 'Cursed items you win are never discounted for being cursed.', color: '#b5b54a' },
  { id: 'auctioneer', name: 'Auctioneer', description: 'Takes a small commission rebate of time back on every lot won.', color: '#f0923c' },
  { id: 'insurer', name: 'Insurer', description: 'Recovers part of the time spent on lots bid on and lost.', color: '#7fa8c9' },
  { id: 'locksmith', name: 'Locksmith', description: 'Chests you win open immediately without a key.', color: '#b8c0c9' },
  { id: 'hoarder', name: 'Hoarder', description: 'Earns a small flat bonus for every item owned, no matter how cheap.', color: '#9a5a42' },
  { id: 'gambler', name: 'Gambler', description: 'Each lot won in a row grows a time rebate on the next win. Any lot someone else wins resets the streak.', color: '#e6529c' },
];

export function randomClassId(): string {
  return CLASS_DEFINITIONS[Math.floor(Math.random() * CLASS_DEFINITIONS.length)].id;
}

export function getClassDefinition(id: string | undefined): ClassDefinition | undefined {
  return CLASS_DEFINITIONS.find((c) => c.id === id);
}
