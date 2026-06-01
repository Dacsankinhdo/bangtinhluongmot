"use strict";

function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") {
    if (Buffer.isBuffer(request.body)) {
      return JSON.parse(request.body.toString("utf-8"));
    }
    return request.body;
  }
  if (typeof request.body === "string") {
    return request.body ? JSON.parse(request.body) : {};
  }

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

function publicAnalysis(analysis) {
  return {
    source: analysis.source,
    sourceRecordCount: analysis.sourceRecordCount,
    destinationRecordCount: analysis.destinationRecordCount,
    employeeCount: analysis.employeeCount,
    updateCount: analysis.updateCount,
    summaries: analysis.summaries,
    missingNames: analysis.missingNames,
    hr: analysis.hr,
    createdEmployeeNames: analysis.createdEmployeeNames || [],
  };
}

async function handlePayrollRequest(request, response, action) {
  if (request.method !== "POST") {
    sendJson(response, 405, { ok: false, error: "Only POST is supported" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(request);
  } catch (error) {
    sendJson(response, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const sourceUrl = String(body.sourceUrl || "").trim();
  if (!sourceUrl) {
    sendJson(response, 400, { ok: false, error: "Missing sourceUrl" });
    return;
  }

  try {
    const analysis = await action(sourceUrl);
    sendJson(response, 200, { ok: true, analysis: publicAnalysis(analysis) });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error.message || "Unexpected server error",
    });
  }
}

module.exports = {
  handlePayrollRequest,
  publicAnalysis,
  readJsonBody,
  sendJson,
};
