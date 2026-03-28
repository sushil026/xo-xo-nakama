const ADJECTIVES = [
  "Ghost",
  "Nova",
  "Void",
  "Arc",
  "Zero",
  "Flux",
  "Storm",
  "Neon",
  "Dark",
  "Pale",
  "Wild",
  "Calm",
  "Deep",
  "Bright",
  "Haze",
];
const NOUNS = [
  "Pilot",
  "Blade",
  "Echo",
  "Node",
  "Comet",
  "Prism",
  "Pulse",
  "Cipher",
  "Vector",
  "Drift",
  "Trace",
  "Orbit",
  "Spark",
  "Phase",
  "Byte",
];

export function randomSuggestions(count = 4): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  const maxTries = count * 20;
  let tries = 0;
  while (out.length < count && tries < maxTries) {
    tries++;
    const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const suffix = Math.floor(10 + Math.random() * 90);
    const name = `${a}_${n}_${suffix}`.toUpperCase();
    if (!used.has(name)) {
      used.add(name);
      out.push(name);
    }
  }
  return out;
}

export const generateUsername = () => {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const number = Math.floor(Math.random() * 100);

  return `${a}_${n}_${number}`.toUpperCase();
};
