const ADJECTIVES = [
  'grumpy', 'caffeinated', 'sneaky', 'wobbly', 'cosmic', 'turbo', 'sleepy',
  'spicy', 'quantum', 'fuzzy', 'rogue', 'salty', 'mellow', 'jumpy',
  'glowing', 'frosty', 'silky', 'chunky', 'zesty', 'nifty', 'plucky',
  'dizzy', 'breezy', 'snappy', 'velvet', 'rusty', 'giddy', 'quirky',
  'stealthy', 'bouncy',
];

const NOUNS = [
  'badger', 'walrus', 'penguin', 'falcon', 'otter', 'yeti', 'gremlin',
  'wizard', 'ninja', 'robot', 'dragon', 'panda', 'koala', 'sloth',
  'raccoon', 'hamster', 'narwhal', 'octopus', 'phoenix', 'goblin',
  'unicorn', 'taco', 'pretzel', 'waffle', 'comet', 'nebula', 'volcano',
  'glacier', 'tornado', 'cactus',
];

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

export function generateSnapshotName(): string {
  return `${pick(ADJECTIVES)}-${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}
