type AppConfig = {
  nakama: {
    host: string;
    port: string;
    ssl: boolean;
  };
};

const config: AppConfig = {
  nakama: {
    host: window.location.hostname,
    port: "80",
    ssl: false,
  },
};

export default config;
