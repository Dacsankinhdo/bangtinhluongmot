#!/usr/bin/env node
"use strict";

const fs = require("fs/promises");
const http = require("http");
const path = require("path");

const { analyzePayroll, syncPayroll } = require("./sync_lark_payroll");

const HOST = process.env.HOST || "127.0.0.1";
const START_PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function publicAnalysis(analysis) {
  return {
    source: analysis.source,
    sourceRecordCount: analysis.sourceRecordCount,
    destinationRecordCount: analysis.destinationRecordCount,
    employeeCount: analysis.employeeCount,
    updateCount: analysis.updateCount,
    summaries: analysis.summaries,
    missingNames: analysis.missingNames,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new Error("Request body is too large");
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf-8");
  return raw ? JSON.parse(raw) : {};
}

async function handleApi(request, response, url) {
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "Only POST is supported" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { error: "Invalid JSON body" });
    return;
  }

  const sourceUrl = String(body.sourceUrl || "").trim();
  if (!sourceUrl) {
    sendJson(response, 400, { error: "Missing sourceUrl" });
    return;
  }

  try {
    if (url.pathname === "/api/analyze") {
      const analysis = await analyzePayroll(sourceUrl);
      sendJson(response, 200, { ok: true, analysis: publicAnalysis(analysis) });
      return;
    }

    if (url.pathname === "/api/sync") {
      const analysis = await syncPayroll(sourceUrl);
      sendJson(response, 200, { ok: true, analysis: publicAnalysis(analysis) });
      return;
    }

    sendJson(response, 404, { error: "API endpoint not found" });
  } catch (error) {
    sendJson(response, 500, {
      error: error.message || "Unexpected server error",
    });
  }
}

async function handleStatic(request, response, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const decodedPath = decodeURIComponent(requestedPath);
  const filePath = path.normalize(path.join(PUBLIC_DIR, decodedPath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const mimeType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": mimeType,
      "Cache-Control": "no-store",
    });
    response.end(content);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

function createServer() {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || HOST}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await handleStatic(request, response, url);
  });
}

function listenWithFallback(server, port, maxPort) {
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < maxPort) {
      listenWithFallback(createServer(), port + 1, maxPort);
      return;
    }
    throw error;
  });

  server.listen(port, HOST, () => {
    console.log(`Payroll UI is running at http://${HOST}:${port}`);
  });
}

listenWithFallback(createServer(), START_PORT, START_PORT + 20);
