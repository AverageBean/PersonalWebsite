/**
 * Development startup script.
 * Starts the converter server and webpack dev server together so
 * `npm start` requires no separate terminal.
 */
const { fork, spawn } = require("child_process");
const http = require("http");
const path = require("path");

const CONVERTER_PORT = Number(process.env.CAD_CONVERTER_PORT || 8090);
const CONVERTER_HOST = process.env.CAD_CONVERTER_HOST || "127.0.0.1";

function isConverterAlreadyRunning() {
  return new Promise(resolve => {
    const req = http.get(
      `http://${CONVERTER_HOST}:${CONVERTER_PORT}/api/health`,
      { timeout: 1000 },
      res => { res.destroy(); resolve(true); }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  // If a converter is already listening on the port (e.g. a previous session
  // that wasn't fully shut down), reuse it rather than trying to fork a new one.
  const alreadyUp = await isConverterAlreadyRunning();
  let converter = null;

  if (alreadyUp) {
    console.log(`[start-dev] converter already running on port ${CONVERTER_PORT} — reusing.`);
  } else {
    converter = fork(
      path.join(__dirname, "tools", "converter-server.js"),
      [],
      { stdio: "inherit" }
    );

    converter.on("error", err =>
      console.error("[start-dev] converter spawn error:", err.message)
    );

    converter.on("exit", (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(
          `[start-dev] converter exited with code ${code}. ` +
          "STEP export will not work. " +
          `Check that port ${CONVERTER_PORT} is free and restart with npm start.`
        );
      }
    });
  }

  const webpack = spawn(
    "webpack",
    ["serve", "--hot", "--config", "webpack.config.dev.js"],
    { stdio: "inherit", shell: true }
  );

  webpack.on("error", err => console.error("[start-dev] webpack error:", err.message));

  webpack.on("close", code => {
    if (converter) converter.kill();
    process.exit(code || 0);
  });

  function stopAll() {
    if (converter) converter.kill();
    webpack.kill();
  }

  process.on("SIGINT", stopAll);
  process.on("SIGTERM", stopAll);
}

main();
