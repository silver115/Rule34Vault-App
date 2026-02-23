// Dynamic Expo config — reads app.json as base, overrides sensitive fields from .env
// This file is NOT gitignored so the logic is public, but the .env file IS gitignored.
const fs = require("fs");
const path = require("path");

// Load .env file if it exists
const envPath = path.resolve(__dirname, ".env");
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx > 0) {
        env[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
      }
    });
}

// Load the base app.json
const appJson = require("./app.json");
const config = appJson.expo || appJson;

// Optionally override push server URL from .env (for local development)
config.extra = config.extra || {};
if (env.PUSH_SERVER_URL) {
  config.extra.pushServerUrl = env.PUSH_SERVER_URL;
}

module.exports = ({ config: _cfg }) => {
  return {
    ...config,
  };
};
