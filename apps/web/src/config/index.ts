// const isSecure = window.location.protocol === "https:";

// const config = {
//   nakama: {
//     host: window.location.hostname,
//     port: isSecure ? "443" : "80",
//     ssl: isSecure,
//   },
// };

const config = {
  nakama: {
    host: window.location.hostname,
    port: "7350",
    ssl: false,
  },
};

export default config;
