const config = {
  nakama: {
    host: import.meta.env.VITE_NAKAMA_HOST || window.location.hostname,
    port: import.meta.env.VITE_NAKAMA_PORT || "7350",
    ssl: import.meta.env.VITE_NAKAMA_SSL === "true" || false,
  },
};

export default config;
