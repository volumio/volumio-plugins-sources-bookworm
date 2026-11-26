"use strict";

// Plugin name used in log messages (same idea as PLUGIN_NAME in ir_activity_led).
// Shared by index.js and the lib modules so every log line has the same prefix.
const PLUGIN_NAME = "Argon ONE Power & Fan";
const LOG_PREFIX = `[${PLUGIN_NAME}] `;

module.exports = {
  PLUGIN_NAME: PLUGIN_NAME,
  LOG_PREFIX: LOG_PREFIX,
};
