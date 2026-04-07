const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const zlib = require("zlib");

function loadDotEnvIfPresent() {
  const dotenvPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(dotenvPath)) {
    return;
  }

  const lines = fs.readFileSync(dotenvPath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

loadDotEnvIfPresent();

const HOST = process.env.CAD_CONVERTER_HOST || "127.0.0.1";
const PORT = Number(process.env.CAD_CONVERTER_PORT || 8090);
const MAX_UPLOAD_BYTES = Number(process.env.CAD_CONVERTER_MAX_UPLOAD || 120 * 1024 * 1024);
const converterScript = path.join(__dirname, "convert-sldprt-with-freecad.py");
const stepConverterScript = path.join(__dirname, "convert-stl-to-step-with-freecad.py");
const parametricConverterScript = path.join(__dirname, "convert-stl-to-step-parametric-with-freecad.py");
const cadToStlScript = path.join(__dirname, "convert-cad-to-stl-with-freecad.py");
const moldGeneratorScript = path.join(__dirname, "generate-mold-with-freecad.py");
const CLOUDCONVERT_API_KEY = process.env.CLOUDCONVERT_API_KEY || "";
const CLOUDCONVERT_API_BASE = process.env.CLOUDCONVERT_API_BASE || "https://api.cloudconvert.com/v2";
const ONSHAPE_ACCESS_KEY = process.env.ONSHAPE_ACCESS_KEY || "";
const ONSHAPE_SECRET_KEY = process.env.ONSHAPE_SECRET_KEY || "";
const ONSHAPE_BASE_URL = process.env.ONSHAPE_BASE_URL || "https://cad.onshape.com";
const ONSHAPE_TRANSLATION_MAX_POLLS = Number(process.env.ONSHAPE_TRANSLATION_MAX_POLLS || 80);
const ONSHAPE_TRANSLATION_POLL_MS = Number(process.env.ONSHAPE_TRANSLATION_POLL_MS || 1500);

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(body);
}

function sendBinary(res, statusCode, contentType, data, fileName, extraHeaders = {}) {
  const extraKeys = Object.keys(extraHeaders).join(", ");
  res.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Expose-Headers": extraKeys,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    ...extraHeaders
  });
  res.end(data);
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function resolveCommandOnPath(commandName) {
  if (process.platform === "win32") {
    const check = spawnSync("where", [commandName], { encoding: "utf8" });
    const output = `${check.stdout || ""}\n${check.stderr || ""}`;
    const lines = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .filter(line => !line.startsWith("INFO:"))
      .filter(line => exists(line));

    return lines[0] || null;
  }

  const check = spawnSync("which", [commandName], { encoding: "utf8" });
  if (check.status !== 0) {
    return null;
  }

  const resolved = (check.stdout || "").trim();
  return resolved && exists(resolved) ? resolved : null;
}

function detectFreeCadExecutable() {
  if (process.env.FREECAD_CMD) {
    return {
      executable: process.env.FREECAD_CMD,
      args: []
    };
  }

  if (process.platform === "win32") {
    const installCandidates = [
      {
        executable: "C:/Program Files/FreeCAD 1.0/bin/python.exe",
        args: []
      },
      {
        executable: "C:/Program Files/FreeCAD 1.0/bin/FreeCADCmd.exe",
        args: []
      },
      {
        executable: "C:/Program Files/FreeCAD 0.21/bin/python.exe",
        args: []
      },
      {
        executable: "C:/Program Files/FreeCAD 0.21/bin/FreeCADCmd.exe",
        args: []
      },
      {
        executable: "C:/Program Files/FreeCAD 0.20/bin/python.exe",
        args: []
      },
      {
        executable: "C:/Program Files/FreeCAD 0.20/bin/FreeCADCmd.exe",
        args: []
      }
    ];

    for (const runtime of installCandidates) {
      if (exists(runtime.executable)) {
        return runtime;
      }
    }
  }

  const pathCandidates = ["FreeCADCmd"];
  for (const candidate of pathCandidates) {
    const resolved = resolveCommandOnPath(candidate);
    if (!resolved) {
      continue;
    }

    return {
      executable: resolved,
      args: []
    };
  }

  return {
    executable: null,
    args: []
  };
}

function runFreeCadConversion(freeCadRuntime, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const commandArgs = [...(freeCadRuntime.args || []), converterScript, inputPath, outputPath];
    const processHandle = spawn(freeCadRuntime.executable, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    processHandle.stdout.on("data", chunk => stdoutChunks.push(chunk));
    processHandle.stderr.on("data", chunk => stderrChunks.push(chunk));

    processHandle.on("error", error => reject(error));

    processHandle.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr || stdout || `FreeCAD exited with code ${code}.`;
      reject(new Error(message));
    });
  });
}

async function downloadToFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) {
    const details = await readResponseTextSafe(response);
    throw new Error(`Download failed (${response.status}): ${details || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(arrayBuffer));
}

async function cloudConvertRequest(endpointPath, options = {}) {
  if (!CLOUDCONVERT_API_KEY) {
    throw new Error("CloudConvert fallback is not configured. Set CLOUDCONVERT_API_KEY.");
  }

  const response = await fetch(`${CLOUDCONVERT_API_BASE}${endpointPath}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CLOUDCONVERT_API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const responseText = await readResponseTextSafe(response);
  const responseJson = parseJsonSafely(responseText);

  if (!response.ok) {
    const detail = responseJson && responseJson.message
      ? responseJson.message
      : responseText || response.statusText;
    throw new Error(`CloudConvert request failed (${response.status}): ${detail}`);
  }

  return responseJson;
}

function getCloudConvertExportUrl(jobData) {
  const tasks = jobData && Array.isArray(jobData.tasks) ? jobData.tasks : [];
  const exportTask = tasks.find(task => task && task.operation === "export/url" && task.status === "finished");
  const files = exportTask && exportTask.result && Array.isArray(exportTask.result.files)
    ? exportTask.result.files
    : [];
  const firstFile = files[0] || null;

  return firstFile && firstFile.url ? firstFile.url : "";
}

async function runCloudConvertConversion(inputPath, outputPath) {
  if (!CLOUDCONVERT_API_KEY) {
    throw new Error("CloudConvert fallback is not configured. Set CLOUDCONVERT_API_KEY.");
  }

  const inputBuffer = fs.readFileSync(inputPath);
  const payload = {
    tasks: {
      "import-base64": {
        operation: "import/base64",
        file: inputBuffer.toString("base64"),
        filename: path.basename(inputPath)
      },
      "convert-to-stl": {
        operation: "convert",
        input: "import-base64",
        output_format: "stl"
      },
      "export-url": {
        operation: "export/url",
        input: "convert-to-stl"
      }
    }
  };

  const createResult = await cloudConvertRequest("/jobs", {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const job = createResult && createResult.data ? createResult.data : null;
  const jobId = job && job.id ? job.id : "";

  if (!jobId) {
    throw new Error("CloudConvert did not return a job id.");
  }

  const waitResult = await cloudConvertRequest(`/jobs/${encodeURIComponent(jobId)}/wait`, {
    method: "GET"
  });

  const waitJob = waitResult && waitResult.data ? waitResult.data : null;
  const downloadUrl = getCloudConvertExportUrl(waitJob);

  if (!downloadUrl) {
    throw new Error("CloudConvert did not return an export URL.");
  }

  await downloadToFile(downloadUrl, outputPath);
}

function runFreeCadStlToStepConversion(freeCadRuntime, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const commandArgs = [...(freeCadRuntime.args || []), stepConverterScript, inputPath, outputPath];
    const processHandle = spawn(freeCadRuntime.executable, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    processHandle.stdout.on("data", chunk => stdoutChunks.push(chunk));
    processHandle.stderr.on("data", chunk => stderrChunks.push(chunk));

    processHandle.on("error", error => reject(error));

    processHandle.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr || stdout || `FreeCAD exited with code ${code}.`;
      reject(new Error(message));
    });
  });
}

async function runConversionWithFallback(inputPath, outputPath) {
  const errors = [];
  const freeCadRuntime = detectFreeCadExecutable();

  if (freeCadRuntime.executable) {
    try {
      await runFreeCadConversion(freeCadRuntime, inputPath, outputPath);
      return "freecad";
    } catch (error) {
      errors.push(`FreeCAD failed: ${error.message}`);
    }
  } else {
    errors.push("FreeCAD runtime is unavailable.");
  }

  if (CLOUDCONVERT_API_KEY) {
    try {
      await runCloudConvertConversion(inputPath, outputPath);
      return "cloudconvert";
    } catch (error) {
      errors.push(`CloudConvert failed: ${error.message}`);
    }
  } else {
    errors.push("CloudConvert fallback is disabled. Set CLOUDCONVERT_API_KEY.");
  }

  throw new Error(errors.join(" "));
}

function parseIncomingFilename(reqUrl) {
  const url = new URL(reqUrl, `http://${HOST}:${PORT}`);
  const raw = url.searchParams.get("filename") || "model.sldprt";
  const normalized = path.basename(raw).replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  return normalized || "model.sldprt";
}

function sanitizeOutputFileName(fileName, fallbackStem = "onshape-export") {
  const raw = String(fileName || "").trim();
  const normalized = raw.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  if (!normalized) {
    return `${fallbackStem}.stl`;
  }

  return normalized.toLowerCase().endsWith(".stl") ? normalized : `${normalized}.stl`;
}

function parseJsonSafely(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

async function readResponseTextSafe(response) {
  try {
    return await response.text();
  } catch (_) {
    return "";
  }
}

function getOnshapeAuthHeader() {
  if (!ONSHAPE_ACCESS_KEY || !ONSHAPE_SECRET_KEY) {
    throw new Error("Onshape credentials are missing. Set ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY.");
  }

  return `Basic ${Buffer.from(`${ONSHAPE_ACCESS_KEY}:${ONSHAPE_SECRET_KEY}`).toString("base64")}`;
}

async function onshapeJsonRequest(method, apiPath, body = undefined) {
  const url = new URL(apiPath, ONSHAPE_BASE_URL);
  const headers = {
    Authorization: getOnshapeAuthHeader(),
    Accept: "application/json;charset=UTF-8; qs=0.09"
  };

  const options = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json;charset=UTF-8; qs=0.09";
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const responseText = await readResponseTextSafe(response);
  const json = parseJsonSafely(responseText);

  if (!response.ok) {
    const detail = json && json.message ? json.message : responseText || response.statusText;
    throw new Error(`Onshape API ${response.status}: ${detail}`);
  }

  if (!responseText) {
    return {};
  }

  return json || {};
}

async function onshapeBinaryRequest(apiPath) {
  const url = new URL(apiPath, ONSHAPE_BASE_URL);
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: getOnshapeAuthHeader(),
      Accept: "application/octet-stream"
    }
  });

  if (!response.ok) {
    const detail = await readResponseTextSafe(response);
    throw new Error(`Onshape binary download failed (${response.status}): ${detail || response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function startOnshapePartStudioStlTranslation({
  documentId,
  workspaceId,
  elementId,
  partId
}) {
  const payload = {
    formatName: "STL",
    storeInDocument: false
  };
  if (partId) {
    payload.partId = partId;
  }

  return onshapeJsonRequest(
    "POST",
    `/api/v11/partstudios/d/${documentId}/w/${workspaceId}/e/${elementId}/translations`,
    payload
  );
}

async function pollOnshapeTranslation(translationId) {
  for (let attempt = 1; attempt <= ONSHAPE_TRANSLATION_MAX_POLLS; attempt += 1) {
    const status = await onshapeJsonRequest("GET", `/api/v6/translations/${translationId}`);
    const requestState = status.requestState || status.state || "UNKNOWN";

    if (requestState === "DONE") {
      return status;
    }

    if (requestState === "FAILED" || requestState === "CANCELED") {
      const reason = status.failureReason || status.failureMessage || "No failure reason was returned.";
      throw new Error(`Translation ${requestState}: ${reason}`);
    }

    await new Promise(resolve => setTimeout(resolve, ONSHAPE_TRANSLATION_POLL_MS));
  }

  throw new Error(
    `Translation did not complete after ${ONSHAPE_TRANSLATION_MAX_POLLS} polls (~${Math.round((ONSHAPE_TRANSLATION_MAX_POLLS * ONSHAPE_TRANSLATION_POLL_MS) / 1000)}s).`
  );
}

async function downloadOnshapeTranslationResult(translationStatus) {
  const documentId = translationStatus.resultDocumentId || translationStatus.documentId;
  if (!documentId) {
    throw new Error("Onshape translation did not provide a result document ID.");
  }

  const externalIds = Array.isArray(translationStatus.resultExternalDataIds)
    ? translationStatus.resultExternalDataIds
    : [];
  if (externalIds.length > 0) {
    return onshapeBinaryRequest(`/api/v6/documents/d/${documentId}/externaldata/${externalIds[0]}`);
  }

  const elementIds = Array.isArray(translationStatus.resultElementIds)
    ? translationStatus.resultElementIds
    : [];
  if (elementIds.length > 0) {
    const workspaceId = translationStatus.resultWorkspaceId || translationStatus.workspaceId;
    if (!workspaceId) {
      throw new Error("Onshape translation returned resultElementIds without workspaceId.");
    }

    return onshapeBinaryRequest(`/api/v6/blobelements/d/${documentId}/w/${workspaceId}/e/${elementIds[0]}`);
  }

  throw new Error("Onshape translation completed but returned no downloadable output reference.");
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", chunk => {
      total += chunk.length;
      if (total > MAX_UPLOAD_BYTES) {
        reject(new Error(`Upload exceeds limit of ${MAX_UPLOAD_BYTES} bytes.`));
        req.destroy();
        return;
      }

      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", error => reject(error));
  });
}

async function handleConversion(req, res) {
  const incomingName = parseIncomingFilename(req.url);
  if (!incomingName.toLowerCase().endsWith(".sldprt")) {
    sendJson(res, 400, { error: "Only .sldprt uploads are accepted by this endpoint." });
    return;
  }

  let tempDir = "";
  try {
    const body = await readRequestBody(req);
    if (!body.length) {
      sendJson(res, 400, { error: "Upload body is empty." });
      return;
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sldprt-convert-"));
    const inputPath = path.join(tempDir, incomingName);
    const outputName = `${path.basename(incomingName, path.extname(incomingName))}.stl`;
    const outputPath = path.join(tempDir, outputName);

    fs.writeFileSync(inputPath, body);
    const method = await runConversionWithFallback(inputPath, outputPath);

    if (!exists(outputPath)) {
      throw new Error("The converter did not produce an STL output file.");
    }

    const outputBuffer = fs.readFileSync(outputPath);
    sendBinary(res, 200, "model/stl", outputBuffer, outputName, {
      "X-Converter-Method": method
    });
  } catch (error) {
    sendJson(res, 500, {
      error: `SLDPRT conversion failed: ${error.message}`
    });
  } finally {
    if (tempDir && exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

function runFreeCadParametricConversion(freeCadRuntime, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const commandArgs = [...(freeCadRuntime.args || []), parametricConverterScript, inputPath, outputPath];
    const processHandle = spawn(freeCadRuntime.executable, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    processHandle.stdout.on("data", chunk => stdoutChunks.push(chunk));
    processHandle.stderr.on("data", chunk => stderrChunks.push(chunk));

    processHandle.on("error", error => reject(error));

    processHandle.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr || stdout || `FreeCAD exited with code ${code}.`;
      reject(new Error(message));
    });
  });
}

async function handleStlToStepParametricConversion(req, res) {
  const incomingName = parseIncomingFilename(req.url);
  if (!incomingName.toLowerCase().endsWith(".stl")) {
    sendJson(res, 400, { error: "Only .stl uploads are accepted by this endpoint." });
    return;
  }

  const freeCadRuntime = detectFreeCadExecutable();
  if (!freeCadRuntime.executable) {
    sendJson(res, 503, {
      error: "FreeCAD is not available on this server. Install FreeCAD to enable STL→STEP conversion."
    });
    return;
  }

  let tempDir = "";
  try {
    const body = await readRequestBody(req);
    if (!body.length) {
      sendJson(res, 400, { error: "Upload body is empty." });
      return;
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stl-parametric-"));
    const inputPath = path.join(tempDir, incomingName);
    const outputName = `${path.basename(incomingName, path.extname(incomingName))}.step`;
    const outputPath = path.join(tempDir, outputName);

    fs.writeFileSync(inputPath, body);
    console.log(`[parametric] starting conversion: ${incomingName}`);
    let result;
    try {
      result = await runFreeCadParametricConversion(freeCadRuntime, inputPath, outputPath);
    } catch (convErr) {
      console.error("[parametric] FreeCAD process failed:\n" + convErr.message);
      throw convErr;
    }
    console.log("[parametric stdout]\n" + result.stdout);
    if (result.stderr) console.error("[parametric stderr]\n" + result.stderr);

    if (!exists(outputPath)) {
      throw new Error("The converter did not produce a STEP output file.");
    }

    const outputBuffer = fs.readFileSync(outputPath);
    const usedAnalytical = result.stdout.includes("using analytical solid");

    const coverageMatch = result.stdout.match(/coverage=(\d+\.?\d*)%/);
    const cylMatch      = result.stdout.match(/\((\d+) cyl,/);
    const planeMatch    = result.stdout.match(/(\d+) plane,?\s/);
    const torusMatch    = result.stdout.match(/(\d+) torus/);

    const totalMatch  = result.stdout.match(/loaded (\d+) triangles/);
    const horizMatch  = result.stdout.match(/(\d+) horiz \(cyl\)/);
    const vertMatch   = result.stdout.match(/(\d+) vert \(plane\)/);
    const filletMatch = result.stdout.match(/(\d+) fillet\/other/);

    function pct(count, total) {
      return (total > 0) ? ((count / total) * 100).toFixed(1) : "";
    }
    const total  = totalMatch  ? Number(totalMatch[1])  : 0;
    const horiz  = horizMatch  ? Number(horizMatch[1])  : 0;
    const vert   = vertMatch   ? Number(vertMatch[1])   : 0;
    const fillet = filletMatch ? Number(filletMatch[1]) : 0;

    sendBinary(res, 200, "model/step", outputBuffer, outputName, {
      "X-Converter-Method":    "freecad-parametric",
      "X-Analytical-Surfaces": usedAnalytical ? "true" : "false",
      "X-Coverage":            coverageMatch ? coverageMatch[1] : "",
      "X-Detected-Cylinders":  cylMatch      ? cylMatch[1]      : "",
      "X-Detected-Planes":     planeMatch    ? planeMatch[1]    : "",
      "X-Detected-Tori":       torusMatch    ? torusMatch[1]    : "",
      "X-Pct-Cyl":             pct(horiz,  total),
      "X-Pct-Plane":           pct(vert,   total),
      "X-Pct-Fillet":          pct(fillet, total)
    });
  } catch (error) {
    sendJson(res, 500, {
      error: `STL to STEP (parametric) conversion failed: ${error.message}`
    });
  } finally {
    if (tempDir && exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

// ── Minimal PKZip builder (no npm dependency) ──────────────────────────────

function buildMinimalZip(entries) {
  // entries: Array<{ name: string, data: Buffer }>
  const localHeaders = [];
  const centralHeaders = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const compressed = zlib.deflateRawSync(entry.data, { level: 6 });
    const crc = crc32(entry.data);

    // Local file header (30 + name + compressed data)
    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);   // signature
    local.writeUInt16LE(20, 4);           // version needed
    local.writeUInt16LE(0, 6);            // flags
    local.writeUInt16LE(8, 8);            // compression: deflate
    local.writeUInt16LE(0, 10);           // mod time
    local.writeUInt16LE(0, 12);           // mod date
    local.writeUInt32LE(crc, 14);         // crc-32
    local.writeUInt32LE(compressed.length, 18);  // compressed size
    local.writeUInt32LE(entry.data.length, 22);  // uncompressed size
    local.writeUInt16LE(nameBytes.length, 26);   // filename length
    local.writeUInt16LE(0, 28);           // extra field length
    nameBytes.copy(local, 30);
    localHeaders.push(Buffer.concat([local, compressed]));

    // Central directory header
    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(8, 10);         // compression: deflate
    central.writeUInt16LE(0, 12);         // mod time
    central.writeUInt16LE(0, 14);         // mod date
    central.writeUInt32LE(crc, 16);       // crc-32
    central.writeUInt32LE(compressed.length, 20);  // compressed size
    central.writeUInt32LE(entry.data.length, 24);  // uncompressed size
    central.writeUInt16LE(nameBytes.length, 28);   // filename length
    central.writeUInt16LE(0, 30);         // extra field length
    central.writeUInt16LE(0, 32);         // file comment length
    central.writeUInt16LE(0, 34);         // disk number
    central.writeUInt16LE(0, 36);         // internal attrs
    central.writeUInt32LE(0, 38);         // external attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    nameBytes.copy(central, 46);
    centralHeaders.push(central);

    offset += 30 + nameBytes.length + compressed.length;
  }

  const centralDirBuf = Buffer.concat(centralHeaders);
  const centralDirOffset = offset;

  // End of central directory (22 bytes)
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);              // signature
  eocd.writeUInt16LE(0, 4);                       // disk number
  eocd.writeUInt16LE(0, 6);                       // disk with central dir
  eocd.writeUInt16LE(entries.length, 8);           // entries on this disk
  eocd.writeUInt16LE(entries.length, 10);           // total entries
  eocd.writeUInt32LE(centralDirBuf.length, 12);    // central dir size
  eocd.writeUInt32LE(centralDirOffset, 16);        // central dir offset
  eocd.writeUInt16LE(0, 20);                       // comment length

  return Buffer.concat([...localHeaders, centralDirBuf, eocd]);
}

function crc32(buf) {
  // Standard CRC-32 (ISO 3309)
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ── Mold generation ─────────────────────────────────────────────────────────

function runFreeCadMoldGeneration(freeCadRuntime, inputPath, outputDir, paramsPath) {
  return new Promise((resolve, reject) => {
    const commandArgs = [...(freeCadRuntime.args || []), moldGeneratorScript, inputPath, outputDir, paramsPath];
    const processHandle = spawn(freeCadRuntime.executable, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    processHandle.stdout.on("data", chunk => stdoutChunks.push(chunk));
    processHandle.stderr.on("data", chunk => stderrChunks.push(chunk));

    processHandle.on("error", error => reject(error));

    processHandle.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr || stdout || `FreeCAD exited with code ${code}.`;
      reject(new Error(message));
    });
  });
}

function runFreeCadCadToStl(freeCadRuntime, inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const commandArgs = [...(freeCadRuntime.args || []), cadToStlScript, inputPath, outputPath];
    const processHandle = spawn(freeCadRuntime.executable, commandArgs, {
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks = [];
    const stderrChunks = [];

    processHandle.stdout.on("data", chunk => stdoutChunks.push(chunk));
    processHandle.stderr.on("data", chunk => stderrChunks.push(chunk));

    processHandle.on("error", error => reject(error));

    processHandle.on("close", code => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const message = stderr || stdout || `FreeCAD exited with code ${code}.`;
      reject(new Error(message));
    });
  });
}

const CAD_EXTENSIONS = new Set([".step", ".stp", ".iges", ".igs", ".brep", ".brp"]);

async function handleCadToStlConversion(req, res) {
  const incomingName = parseIncomingFilename(req.url);
  const ext = path.extname(incomingName).toLowerCase();
  if (!CAD_EXTENSIONS.has(ext)) {
    sendJson(res, 400, {
      error: `Unsupported file extension: ${ext}. Accepted: ${[...CAD_EXTENSIONS].join(", ")}`
    });
    return;
  }

  const freeCadRuntime = detectFreeCadExecutable();
  if (!freeCadRuntime.executable) {
    sendJson(res, 500, { error: "FreeCAD is not installed or not found." });
    return;
  }

  let tempDir = "";
  try {
    const body = await readRequestBody(req);
    if (!body.length) {
      sendJson(res, 400, { error: "Upload body is empty." });
      return;
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cad-to-stl-"));
    const inputPath = path.join(tempDir, incomingName);
    const outputName = `${path.basename(incomingName, ext)}.stl`;
    const outputPath = path.join(tempDir, outputName);

    fs.writeFileSync(inputPath, body);
    const result = await runFreeCadCadToStl(freeCadRuntime, inputPath, outputPath);

    if (!exists(outputPath)) {
      throw new Error("FreeCAD did not produce an STL output file.");
    }

    const outputBuffer = fs.readFileSync(outputPath);
    sendBinary(res, 200, "model/stl", outputBuffer, outputName, {
      "X-Converter-Method": "freecad-cad-to-stl"
    });
  } catch (error) {
    sendJson(res, 500, {
      error: `CAD to STL conversion failed: ${error.message}`
    });
  } finally {
    if (tempDir && exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function handleStlToMoldGeneration(req, res) {
  const incomingName = parseIncomingFilename(req.url);
  if (!incomingName.toLowerCase().endsWith(".stl")) {
    sendJson(res, 400, { error: "Only .stl uploads are accepted by this endpoint." });
    return;
  }

  const freeCadRuntime = detectFreeCadExecutable();
  if (!freeCadRuntime.executable) {
    sendJson(res, 503, {
      error: "FreeCAD is not available on this server. Install FreeCAD to enable mold generation."
    });
    return;
  }

  // Parse mold parameters from query string
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const wallThickness = Number(urlObj.searchParams.get("wallThickness") || 10);
  const clearance = Number(urlObj.searchParams.get("clearance") || 0);
  const splitHeight = Number(urlObj.searchParams.get("splitHeight"));
  const pinDiameter = Number(urlObj.searchParams.get("pinDiameter") || 5);
  const pinInset = Number(urlObj.searchParams.get("pinInset") || 8);
  const pinTolerance = Number(urlObj.searchParams.get("pinTolerance") || 0.4);
  const sprueDiameter = Number(urlObj.searchParams.get("sprueDiameter") || 6);
  const sprueEnabled = urlObj.searchParams.get("sprueEnabled") !== "false";

  if (isNaN(splitHeight)) {
    sendJson(res, 400, { error: "splitHeight query parameter is required." });
    return;
  }
  if (wallThickness <= 0 || pinDiameter <= 0 || sprueDiameter <= 0) {
    sendJson(res, 400, { error: "wallThickness, pinDiameter, and sprueDiameter must be positive." });
    return;
  }

  let tempDir = "";
  try {
    const body = await readRequestBody(req);
    if (!body.length) {
      sendJson(res, 400, { error: "Upload body is empty." });
      return;
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stl-mold-"));
    const inputPath = path.join(tempDir, incomingName);
    fs.writeFileSync(inputPath, body);

    // Write params JSON
    const paramsObj = { wallThickness, clearance, splitHeight, pinDiameter, pinInset, pinTolerance, sprueDiameter, sprueEnabled };
    const paramsPath = path.join(tempDir, "params.json");
    fs.writeFileSync(paramsPath, JSON.stringify(paramsObj));

    console.log(`[mold] starting generation: ${incomingName} (wall=${wallThickness}, split=${splitHeight})`);
    let result;
    try {
      result = await runFreeCadMoldGeneration(freeCadRuntime, inputPath, tempDir, paramsPath);
    } catch (convErr) {
      console.error("[mold] FreeCAD process failed:\n" + convErr.message);
      throw convErr;
    }

    console.log("[mold stdout]\n" + result.stdout);
    if (result.stderr) console.error("[mold stderr]\n" + result.stderr);

    // Parse output JSON from stdout: {"top": "path", "bottom": "path"}
    let outputPaths;
    try {
      outputPaths = JSON.parse(result.stdout);
    } catch (e) {
      throw new Error("Could not parse output paths from FreeCAD script.");
    }

    if (!exists(outputPaths.top) || !exists(outputPaths.bottom)) {
      throw new Error("FreeCAD did not produce both mold STL files.");
    }

    const topBuf = fs.readFileSync(outputPaths.top);
    const bottomBuf = fs.readFileSync(outputPaths.bottom);
    const stem = path.basename(incomingName, path.extname(incomingName));

    const zipBuffer = buildMinimalZip([
      { name: `${stem}-mold-top.stl`, data: topBuf },
      { name: `${stem}-mold-bottom.stl`, data: bottomBuf }
    ]);

    sendBinary(res, 200, "application/zip", zipBuffer, `${stem}-mold.zip`, {
      "X-Converter-Method": "freecad-mold"
    });
  } catch (error) {
    sendJson(res, 500, {
      error: `Mold generation failed: ${error.message}`
    });
  } finally {
    if (tempDir && exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function handleStlToStepConversion(req, res) {
  const incomingName = parseIncomingFilename(req.url);
  if (!incomingName.toLowerCase().endsWith(".stl")) {
    sendJson(res, 400, { error: "Only .stl uploads are accepted by this endpoint." });
    return;
  }

  const freeCadRuntime = detectFreeCadExecutable();
  if (!freeCadRuntime.executable) {
    sendJson(res, 503, {
      error: "FreeCAD is not available on this server. Install FreeCAD to enable STL→STEP conversion."
    });
    return;
  }

  let tempDir = "";
  try {
    const body = await readRequestBody(req);
    if (!body.length) {
      sendJson(res, 400, { error: "Upload body is empty." });
      return;
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stl-to-step-"));
    const inputPath = path.join(tempDir, incomingName);
    const outputName = `${path.basename(incomingName, path.extname(incomingName))}.step`;
    const outputPath = path.join(tempDir, outputName);

    fs.writeFileSync(inputPath, body);
    await runFreeCadStlToStepConversion(freeCadRuntime, inputPath, outputPath);

    if (!exists(outputPath)) {
      throw new Error("The converter did not produce a STEP output file.");
    }

    const outputBuffer = fs.readFileSync(outputPath);
    sendBinary(res, 200, "model/step", outputBuffer, outputName, {
      "X-Converter-Method": "freecad"
    });
  } catch (error) {
    sendJson(res, 500, {
      error: `STL to STEP conversion failed: ${error.message}`
    });
  } finally {
    if (tempDir && exists(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

async function handleOnshapePartStudioExport(req, res) {
  try {
    const bodyBuffer = await readRequestBody(req);
    const payloadText = bodyBuffer.toString("utf8");
    const payload = parseJsonSafely(payloadText);

    if (!payload || typeof payload !== "object") {
      sendJson(res, 400, { error: "Request body must be valid JSON." });
      return;
    }

    const documentId = String(payload.documentId || "").trim();
    const workspaceId = String(payload.workspaceId || "").trim();
    const elementId = String(payload.elementId || "").trim();
    const partId = payload.partId ? String(payload.partId).trim() : "";
    const fileName = sanitizeOutputFileName(payload.fileName, "onshape-export");

    if (!documentId || !workspaceId || !elementId) {
      sendJson(res, 400, {
        error: "documentId, workspaceId, and elementId are required."
      });
      return;
    }

    const start = await startOnshapePartStudioStlTranslation({
      documentId,
      workspaceId,
      elementId,
      partId: partId || undefined
    });

    const translationId = start.id;
    if (!translationId) {
      throw new Error("Onshape did not return a translation ID.");
    }

    const completedStatus = await pollOnshapeTranslation(translationId);
    const stlBuffer = await downloadOnshapeTranslationResult(completedStatus);

    sendBinary(res, 200, "model/stl", stlBuffer, fileName, {
      "X-Converter-Method": "onshape",
      "X-Onshape-Translation-Id": translationId
    });
  } catch (error) {
    sendJson(res, 500, {
      error: `Onshape export failed: ${error.message}`
    });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    const freeCadRuntime = detectFreeCadExecutable();
    sendJson(res, 200, {
      ok: true,
      freecadConfigured: Boolean(freeCadRuntime.executable),
      freecadExecutable: freeCadRuntime.executable,
      cloudConvertConfigured: Boolean(CLOUDCONVERT_API_KEY),
      onshapeConfigured: Boolean(ONSHAPE_ACCESS_KEY && ONSHAPE_SECRET_KEY),
      onshapeBaseUrl: ONSHAPE_BASE_URL
    });
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/convert/sldprt-to-stl")) {
    await handleConversion(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/convert/cad-to-stl")) {
    await handleCadToStlConversion(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/convert/stl-to-step-parametric")) {
    await handleStlToStepParametricConversion(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/convert/stl-to-step")) {
    await handleStlToStepConversion(req, res);
    return;
  }

  if (req.method === "POST" && req.url.startsWith("/api/convert/stl-to-mold")) {
    await handleStlToMoldGeneration(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/convert/onshape/partstudio-to-stl") {
    await handleOnshapePartStudioExport(req, res);
    return;
  }

  sendJson(res, 404, { error: "Not found." });
});

server.listen(PORT, HOST, () => {
  console.log(`[converter] listening on http://${HOST}:${PORT}`);
  console.log("[converter] endpoint: POST /api/convert/sldprt-to-stl?filename=<name>.sldprt");
  console.log("[converter] endpoint: POST /api/convert/cad-to-stl?filename=<name>.step|.iges|.brep");
  console.log("[converter] endpoint: POST /api/convert/stl-to-step?filename=<name>.stl");
  console.log("[converter] endpoint: POST /api/convert/stl-to-step-parametric?filename=<name>.stl");
  console.log("[converter] endpoint: POST /api/convert/stl-to-mold?filename=<name>.stl&wallThickness=10&splitHeight=25&...");
  console.log("[converter] endpoint: POST /api/convert/onshape/partstudio-to-stl");
  console.log("[converter] health: GET /api/health");
  console.log(`[converter] cloudconvert fallback: ${CLOUDCONVERT_API_KEY ? "enabled" : "disabled"}`);
  console.log(`[converter] onshape export: ${(ONSHAPE_ACCESS_KEY && ONSHAPE_SECRET_KEY) ? "enabled" : "disabled"}`);
});
