export const generateUsername = () => {
  const adjectives = [
    "Ghost",
    "Phantom",
    "Iron",
    "Steel",
    "Black",
    "Crimson",
    "Viper",
    "Rogue",
    "Shadow",
    "Silent",
    "Savage",
    "Delta",
    "Echo",
    "Nova",
    "Alpha",
    "Omega",
    "Titan",
    "Storm",
    "Blaze",
    "Reaper",
  ];
  const nouns = [
    "Strike",
    "Operator",
    "Unit",
    "Squad",
    "Brigade",
    "Division",
    "Sniper",
    "Assault",
    "Recon",
    "Command",
    "Force",
    "Legion",
    "Sentinel",
    "Vanguard",
    "Ranger",
    "Hunter",
    "Guardian",
    "Phalanx",
    "Outrider",
    "Warden",
  ];

  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 100);

  return `${adj}_${noun}_${number}`.toUpperCase();
};
