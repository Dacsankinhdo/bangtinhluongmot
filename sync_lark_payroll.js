#!/usr/bin/env node
"use strict";

/*
 * Sync attendance data from a dynamic Lark Base source table into a fixed payroll table.
 *
 * Usage:
 *   node sync_lark_payroll.js "https://dacsankinhdo.sg.larksuite.com/base/MYsqbAZWwamm6NsDRUNlkRc0gEg?table=tblnpozKA9FKISqQ&view=vewv0KTGjJ#time-settings"
 *   node sync_lark_payroll.js --dry-run "https://..."
 *   node sync_lark_payroll.js --self-test
 *
 * Requires Node.js 18+ for the built-in fetch API.
 */

const LARK_OPENAPI_HOST = "https://open.larksuite.com";

const APP_ID = process.env.LARK_APP_ID || "cli_a975bd3a93b99eed";
const APP_SECRET = process.env.LARK_APP_SECRET || "";

const DESTINATION_APP_TOKEN = "MYsqbAZWwamm6NsDRUNlkRc0gEg";
const DESTINATION_TABLE_ID = "tblgL5ME8fR2c8mc";

const SOURCE_NAME_FIELD = "Name";
const SOURCE_RESULT_FIELD = "Result";
const DESTINATION_NAME_FIELD = "Tên NV";
const DESTINATION_WORK_DAYS_FIELD = "Ngày công TT";
const DESTINATION_LATE_COUNT_FIELD = "Số lần trễ";

const SAMPLE_SOURCE_URL =
  "https://dacsankinhdo.sg.larksuite.com/base/" +
  "MYsqbAZWwamm6NsDRUNlkRc0gEg?table=tblnpozKA9FKISqQ&view=vewv0KTGjJ#time-settings";

class LarkApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "LarkApiError";
  }
}

function parseSourceUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch (error) {
    throw new Error(`SOURCE_URL is not a valid URL: ${sourceUrl}`);
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const baseIndex = pathParts.indexOf("base");
  const appToken = baseIndex >= 0 ? pathParts[baseIndex + 1] : "";
  const tableId = parsed.searchParams.get("table") || "";

  if (!appToken) {
    throw new Error("SOURCE_URL must contain /base/{app_token}");
  }
  if (!tableId) {
    throw new Error("SOURCE_URL must contain query parameter table={table_id}");
  }

  return { appToken, tableId };
}

function runParseTest() {
  const parsed = parseSourceUrl(SAMPLE_SOURCE_URL);

  if (parsed.appToken !== "MYsqbAZWwamm6NsDRUNlkRc0gEg") {
    throw new Error(`Parse test failed for appToken: ${parsed.appToken}`);
  }
  if (parsed.tableId !== "tblnpozKA9FKISqQ") {
    throw new Error(`Parse test failed for tableId: ${parsed.tableId}`);
  }

  console.log(
    `[OK] Parse test: app_token=${parsed.appToken}, table_id=${parsed.tableId}`
  );
}

async function apiRequest(method, path, { token, params, body } = {}) {
  const url = new URL(`${LARK_OPENAPI_HOST}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers = {
    "Content-Type": "application/json; charset=utf-8",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const responseText = await response.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch (error) {
    throw new LarkApiError(
      `Invalid JSON response for ${method} ${path}: ${responseText}`
    );
  }

  if (!response.ok) {
    throw new LarkApiError(
      `HTTP ${response.status} for ${method} ${path}: ${responseText}`
    );
  }
  if (data.code !== 0) {
    throw new LarkApiError(
      `Lark API error for ${method} ${path}: ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function getTenantAccessToken() {
  if (!APP_SECRET) {
    throw new Error("Missing LARK_APP_SECRET environment variable");
  }

  const data = await apiRequest(
    "POST",
    "/open-apis/auth/v3/tenant_access_token/internal",
    {
      body: {
        app_id: APP_ID,
        app_secret: APP_SECRET,
      },
    }
  );

  if (!data.tenant_access_token) {
    throw new LarkApiError("tenant_access_token is missing from Lark response");
  }

  return data.tenant_access_token;
}

async function listRecords(appToken, tableId, token, fieldNames) {
  const records = [];
  let pageToken = "";

  while (true) {
    const params = {
      page_size: 500,
    };
    if (pageToken) {
      params.page_token = pageToken;
    }
    if (fieldNames && fieldNames.length > 0) {
      params.field_names = JSON.stringify(fieldNames);
    }

    const data = await apiRequest(
      "GET",
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(
        tableId
      )}/records`,
      {
        token,
        params,
      }
    );

    const pageData = data.data || {};
    records.push(...(pageData.items || []));

    if (!pageData.has_more) {
      return records;
    }

    pageToken = pageData.page_token || "";
    if (!pageToken) {
      throw new LarkApiError("Lark response has_more=true but page_token is empty");
    }
  }
}

async function batchUpdateRecords(appToken, tableId, token, updates) {
  for (let index = 0; index < updates.length; index += 500) {
    const chunk = updates.slice(index, index + 500);
    await apiRequest(
      "POST",
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(
        tableId
      )}/records/batch_update`,
      {
        token,
        body: {
          records: chunk,
        },
      }
    );
  }
}

function cellToText(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    return value.map(cellToText).join("").trim();
  }
  if (typeof value === "object") {
    for (const key of ["text", "name", "value"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        return cellToText(value[key]);
      }
    }
    return JSON.stringify(value);
  }
  return String(value).trim();
}

function normalizeName(name) {
  return name.split(/\s+/).filter(Boolean).join(" ").toLocaleLowerCase("vi-VN");
}

function isValidAttendanceRecord(name, result) {
  return Boolean(name) && Boolean(result);
}

function aggregateAttendance(records) {
  const summariesByKey = new Map();
  const displayNameByKey = new Map();

  for (const record of records) {
    const fields = record.fields || {};
    const name = cellToText(fields[SOURCE_NAME_FIELD]);
    const result = cellToText(fields[SOURCE_RESULT_FIELD]);

    if (!isValidAttendanceRecord(name, result)) {
      continue;
    }

    const nameKey = normalizeName(name);
    if (!displayNameByKey.has(nameKey)) {
      displayNameByKey.set(nameKey, name);
    }
    if (!summariesByKey.has(nameKey)) {
      summariesByKey.set(nameKey, {
        name: displayNameByKey.get(nameKey),
        workDays: 0,
        lateCount: 0,
      });
    }

    const summary = summariesByKey.get(nameKey);
    summary.workDays += 1;
    if (result.toLocaleLowerCase("en-US") === "very late") {
      summary.lateCount += 1;
    }
  }

  return Array.from(summariesByKey.values());
}

function buildDestinationIndex(records) {
  const index = new Map();
  const duplicates = new Set();

  for (const record of records) {
    const recordId = record.record_id;
    const fields = record.fields || {};
    const name = cellToText(fields[DESTINATION_NAME_FIELD]);

    if (!recordId || !name) {
      continue;
    }

    const nameKey = normalizeName(name);
    if (index.has(nameKey)) {
      duplicates.add(name);
      continue;
    }
    index.set(nameKey, recordId);
  }

  if (duplicates.size > 0) {
    throw new Error(
      `Destination table has duplicated employee names in field ${DESTINATION_NAME_FIELD}: ` +
        Array.from(duplicates).sort().join(", ")
    );
  }

  return index;
}

function buildUpdates(summaries, destinationIndex) {
  const updates = [];
  const missingNames = [];

  const sortedSummaries = summaries
    .slice()
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), "vi-VN"));

  for (const summary of sortedSummaries) {
    const recordId = destinationIndex.get(normalizeName(summary.name));
    if (!recordId) {
      missingNames.push(summary.name);
      continue;
    }

    updates.push({
      record_id: recordId,
      fields: {
        [DESTINATION_WORK_DAYS_FIELD]: summary.workDays,
        [DESTINATION_LATE_COUNT_FIELD]: summary.lateCount,
      },
    });
  }

  return { updates, missingNames };
}

async function analyzePayroll(sourceUrl) {
  const source = parseSourceUrl(sourceUrl);
  const token = await getTenantAccessToken();

  const sourceRecords = await listRecords(source.appToken, source.tableId, token, [
    SOURCE_NAME_FIELD,
    SOURCE_RESULT_FIELD,
  ]);
  const summaries = aggregateAttendance(sourceRecords);
  const destinationRecords = await listRecords(
    DESTINATION_APP_TOKEN,
    DESTINATION_TABLE_ID,
    token,
    [
      DESTINATION_NAME_FIELD,
      DESTINATION_WORK_DAYS_FIELD,
      DESTINATION_LATE_COUNT_FIELD,
    ]
  );

  const destinationIndex = buildDestinationIndex(destinationRecords);
  const { updates, missingNames } = buildUpdates(summaries, destinationIndex);
  const previewRows = summaries
    .slice()
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), "vi-VN"))
    .map((summary) => ({
      name: summary.name,
      workDays: summary.workDays,
      lateCount: summary.lateCount,
      matched: destinationIndex.has(normalizeName(summary.name)),
    }));

  return {
    token,
    source,
    sourceRecordCount: sourceRecords.length,
    destinationRecordCount: destinationRecords.length,
    employeeCount: summaries.length,
    updateCount: updates.length,
    summaries: previewRows,
    missingNames,
    updates,
  };
}

async function syncPayroll(sourceUrl, { dryRun = false } = {}) {
  const source = parseSourceUrl(sourceUrl);
  console.log(`Source app_token=${source.appToken}, table_id=${source.tableId}`);
  console.log("Fetching tenant_access_token and reading tables...");

  const analysis = await analyzePayroll(sourceUrl);

  console.log(
    `Read ${analysis.sourceRecordCount} source records, summarized ${analysis.employeeCount} employees.`
  );
  console.log(`Prepared ${analysis.updateCount} destination updates.`);
  if (analysis.missingNames.length > 0) {
    console.log(
      "[WARN] These names were not found in the payroll table:",
      analysis.missingNames.join(", ")
    );
  }

  if (dryRun) {
    console.log("[DRY RUN] No records were updated.");
    console.log(JSON.stringify(analysis.updates, null, 2));
    return analysis;
  }

  if (analysis.updates.length === 0) {
    console.log("No matching destination records to update.");
    return analysis;
  }

  await batchUpdateRecords(
    DESTINATION_APP_TOKEN,
    DESTINATION_TABLE_ID,
    analysis.token,
    analysis.updates
  );
  console.log(`Updated ${analysis.updates.length} payroll records.`);
  return analysis;
}

function parseArgs(argv) {
  const args = {
    sourceUrl: process.env.SOURCE_URL || "",
    dryRun: false,
    selfTest: false,
  };

  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else if (!args.sourceUrl) {
      args.sourceUrl = arg;
    } else {
      throw new Error(`Unknown or duplicated argument: ${arg}`);
    }
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  runParseTest();

  if (args.selfTest) {
    return;
  }

  if (!args.sourceUrl) {
    console.error("Missing SOURCE_URL. Pass it as an argument or set SOURCE_URL env var.");
    process.exitCode = 2;
    return;
  }

  await syncPayroll(args.sourceUrl, { dryRun: args.dryRun });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message || String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  analyzePayroll,
  batchUpdateRecords,
  buildDestinationIndex,
  buildUpdates,
  cellToText,
  DESTINATION_APP_TOKEN,
  DESTINATION_TABLE_ID,
  DESTINATION_LATE_COUNT_FIELD,
  DESTINATION_NAME_FIELD,
  DESTINATION_WORK_DAYS_FIELD,
  getTenantAccessToken,
  listRecords,
  parseSourceUrl,
  runParseTest,
  syncPayroll,
};
