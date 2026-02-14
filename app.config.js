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

// Override sensitive fields if .env values exist
if (env.EXPO_OWNER) {
  config.owner = env.EXPO_OWNER;
}
if (env.EAS_PROJECT_ID) {
  config.extra = config.extra || {};
  config.extra.eas = config.extra.eas || {};
  config.extra.eas.projectId = env.EAS_PROJECT_ID;
}
if (env.ANDROID_PACKAGE) {
  config.android = config.android || {};
  config.android.package = env.ANDROID_PACKAGE;
}

// Inject app-runtime secrets into extra so code can read them via Constants.expoConfig.extra
config.extra = config.extra || {};
config.extra.pushServerUrl = env.PUSH_SERVER_URL || "";

module.exports = ({ config: _cfg }) => {
  return {
    ...config,
  };
};
