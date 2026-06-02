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
const HR_TABLE_URL =
  process.env.LARK_HR_TABLE_URL ||
  "https://dacsankinhdo.sg.larksuite.com/base/MYsqbAZWwamm6NsDRUNlkRc0gEg?table=tblTzjbVaEn78wQH&view=vewIliHDMf";

const SOURCE_NAME_FIELD = "Name";
const SOURCE_RESULT_FIELD = "Result";
const SOURCE_DATE_FIELD = process.env.LARK_SOURCE_DATE_FIELD || "";
const SOURCE_WORK_DAYS_FIELD = process.env.LARK_SOURCE_WORK_DAYS_FIELD || "";
const SOURCE_LATE_COUNT_FIELD = process.env.LARK_SOURCE_LATE_COUNT_FIELD || "";
const SOURCE_OT_HOURS_FIELD = process.env.LARK_SOURCE_OT_HOURS_FIELD || "";
const HR_NAME_FIELD = process.env.LARK_HR_NAME_FIELD || "";
const DESTINATION_NAME_FIELD = "Tên NV";
const DESTINATION_WORK_DAYS_FIELD = "Ngày công TT";
const DESTINATION_LATE_COUNT_FIELD = "Số lần trễ";
const DESTINATION_OT_HOURS_FIELD = process.env.LARK_DESTINATION_OT_HOURS_FIELD || "Số giờ OT";

const SOURCE_DATE_FIELD_CANDIDATES = [
  "Date",
  "Day",
  "Time",
  "Timestamp",
  "Check Time",
  "Clock Time",
  "Attendance Time",
  "Attendance Date",
  "Record Time",
  "Ngày",
  "Ngày công",
  "Thời gian",
  "Thời gian chấm công",
  "Giờ chấm công",
];

const SOURCE_DATE_FIELD_KEYWORDS = [
  "date",
  "day",
  "time",
  "timestamp",
  "clock",
  "check",
  "attendance",
  "ngày",
  "thời gian",
  "giờ",
  "chấm công",
];

const EMPLOYEE_NAME_FIELD_CANDIDATES = [
  "Tên NV",
  "Name",
  "Tên nhân viên",
  "Họ và tên",
  "Họ tên",
  "Nhân viên",
  "Employee",
  "Employee Name",
  "Full Name",
];

const EMPLOYEE_NAME_FIELD_KEYWORDS = [
  "tên",
  "nhân viên",
  "nhân sự",
  "name",
  "employee",
];

const SOURCE_NAME_FIELD_CANDIDATES = [
  SOURCE_NAME_FIELD,
  DESTINATION_NAME_FIELD,
  "Tên nhân viên",
  "Họ và tên",
  "Họ tên",
  "Nhân viên",
  "Employee",
  "Employee Name",
  "Full Name",
];

const SOURCE_WORK_DAYS_FIELD_CANDIDATES = [
  "Ngày làm việc thực tế",
  "Ngày công TT",
  "Ngày công thực tế",
  "Số ngày công",
  "Ngày công",
  "Công thực tế",
  "Actual Work Days",
  "Work Days",
];

const SOURCE_LATE_COUNT_FIELD_CANDIDATES = [
  "Số lần trễ",
  "Lần trễ",
  "Số lần đi trễ",
  "Very late",
  "Late Count",
];

const SOURCE_OT_HOURS_FIELD_CANDIDATES = [
  "Số giờ OT",
  "Số giờ tăng ca",
  "Giờ OT",
  "Giờ tăng ca",
  "OT",
  "OT Hours",
  "Overtime",
  "Overtime Hours",
];

const SOURCE_SUMMARY_FIELD_KEYWORDS = {
  workDays: ["ngày làm việc", "ngày công", "công thực tế", "work day"],
  lateCount: ["trễ", "late"],
  otHours: ["ot", "tăng ca", "overtime"],
};

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

async function listFields(appToken, tableId, token) {
  const fields = [];
  let pageToken = "";

  while (true) {
    const params = {
      page_size: 100,
    };
    if (pageToken) {
      params.page_token = pageToken;
    }

    const data = await apiRequest(
      "GET",
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(
        tableId
      )}/fields`,
      {
        token,
        params,
      }
    );

    const pageData = data.data || {};
    fields.push(...(pageData.items || []));

    if (!pageData.has_more) {
      return fields;
    }

    pageToken = pageData.page_token || "";
    if (!pageToken) {
      throw new LarkApiError("Lark fields response has_more=true but page_token is empty");
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

async function batchCreateRecords(appToken, tableId, token, records) {
  for (let index = 0; index < records.length; index += 500) {
    const chunk = records.slice(index, index + 500);
    await apiRequest(
      "POST",
      `/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(
        tableId
      )}/records/batch_create`,
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

function formatDateKey(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function parseDateKey(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  if (typeof value === "number") {
    const timestamp = value > 100000000000 ? value : value * 1000;
    const date = new Date(timestamp);
    return Number.isNaN(date.getTime()) ? "" : formatDateKey(date);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const key = parseDateKey(item);
      if (key) {
        return key;
      }
    }
    return "";
  }

  if (typeof value === "object") {
    for (const key of ["timestamp", "time", "date", "value", "text"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const dateKey = parseDateKey(value[key]);
        if (dateKey) {
          return dateKey;
        }
      }
    }
    return "";
  }

  const text = String(value).trim();
  const ymd = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  const dmy = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : formatDateKey(parsed);
}

function findFieldValue(fields, fieldName) {
  if (!fieldName) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(fields, fieldName)) {
    return fields[fieldName];
  }

  const normalized = fieldName.toLocaleLowerCase("vi-VN");
  const matchedKey = Object.keys(fields).find(
    (key) => key.toLocaleLowerCase("vi-VN") === normalized
  );
  return matchedKey ? fields[matchedKey] : undefined;
}

function findCandidateField(fields, configuredField, candidates, keywords = []) {
  if (configuredField) {
    const configuredValue = findFieldValue(fields, configuredField);
    if (configuredValue !== undefined) {
      return { fieldName: configuredField, value: configuredValue };
    }
  }

  for (const fieldName of candidates) {
    const value = findFieldValue(fields, fieldName);
    if (value !== undefined) {
      return { fieldName, value };
    }
  }

  const matchedKey = Object.keys(fields).find((fieldName) => {
    const normalized = fieldName.toLocaleLowerCase("vi-VN");
    return keywords.some((keyword) => normalized.includes(keyword));
  });

  return matchedKey ? { fieldName: matchedKey, value: fields[matchedKey] } : null;
}

function findSourceName(fields) {
  const candidate = findCandidateField(fields, "", SOURCE_NAME_FIELD_CANDIDATES, [
    "tên",
    "nhân viên",
    "name",
    "employee",
  ]);
  return candidate ? cellToText(candidate.value) : "";
}

function parseNumberValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseNumberValue(item);
      if (parsed !== null) {
        return parsed;
      }
    }
    return null;
  }

  if (typeof value === "object") {
    for (const key of ["number", "value", "text", "name"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const parsed = parseNumberValue(value[key]);
        if (parsed !== null) {
          return parsed;
        }
      }
    }
    return null;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const normalized = text
    .replace(/\s/g, "")
    .replace(/,/g, ".")
    .replace(/[^\d.-]/g, "");
  if (!normalized || normalized === "-" || normalized === ".") {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function findNumericSummaryValue(fields, configuredField, candidates, keywords) {
  const candidate = findCandidateField(fields, configuredField, candidates, keywords);
  if (!candidate) {
    return { found: false, value: 0, fieldName: "" };
  }

  const parsed = parseNumberValue(candidate.value);
  return {
    found: parsed !== null,
    value: parsed === null ? 0 : parsed,
    fieldName: candidate.fieldName,
  };
}

function findSourceSummaryValues(fields) {
  return {
    workDays: findNumericSummaryValue(
      fields,
      SOURCE_WORK_DAYS_FIELD,
      SOURCE_WORK_DAYS_FIELD_CANDIDATES,
      SOURCE_SUMMARY_FIELD_KEYWORDS.workDays
    ),
    lateCount: findNumericSummaryValue(
      fields,
      SOURCE_LATE_COUNT_FIELD,
      SOURCE_LATE_COUNT_FIELD_CANDIDATES,
      SOURCE_SUMMARY_FIELD_KEYWORDS.lateCount
    ),
    otHours: findNumericSummaryValue(
      fields,
      SOURCE_OT_HOURS_FIELD,
      SOURCE_OT_HOURS_FIELD_CANDIDATES,
      SOURCE_SUMMARY_FIELD_KEYWORDS.otHours
    ),
  };
}

function getFieldName(field) {
  if (!field || typeof field !== "object") {
    return "";
  }
  return String(field.field_name || field.name || "").trim();
}

function collectFieldNames(records, fields = []) {
  const names = new Set();

  for (const field of fields) {
    const fieldName = getFieldName(field);
    if (fieldName) {
      names.add(fieldName);
    }
  }

  for (const record of records) {
    for (const fieldName of Object.keys(record.fields || {})) {
      names.add(fieldName);
    }
  }

  return Array.from(names);
}

function resolveEmployeeNameField(records, fields = [], preferredField = "") {
  const fieldNames = collectFieldNames(records, fields);
  const lowerNameMap = new Map(
    fieldNames.map((fieldName) => [fieldName.toLocaleLowerCase("vi-VN"), fieldName])
  );

  if (preferredField) {
    const exact = lowerNameMap.get(preferredField.toLocaleLowerCase("vi-VN"));
    if (exact) {
      return exact;
    }
    throw new Error(`Cannot find employee name field: ${preferredField}`);
  }

  for (const candidate of EMPLOYEE_NAME_FIELD_CANDIDATES) {
    const exact = lowerNameMap.get(candidate.toLocaleLowerCase("vi-VN"));
    if (exact) {
      return exact;
    }
  }

  const fuzzy = fieldNames.find((fieldName) => {
    const normalized = fieldName.toLocaleLowerCase("vi-VN");
    return EMPLOYEE_NAME_FIELD_KEYWORDS.some((keyword) => normalized.includes(keyword));
  });

  if (fuzzy) {
    return fuzzy;
  }

  throw new Error(
    "Cannot detect employee name field in HR table. Set LARK_HR_NAME_FIELD to the exact field name."
  );
}

function findAttendanceDayKey(fields) {
  if (SOURCE_DATE_FIELD) {
    const configuredKey = parseDateKey(findFieldValue(fields, SOURCE_DATE_FIELD));
    if (configuredKey) {
      return configuredKey;
    }
  }

  for (const fieldName of SOURCE_DATE_FIELD_CANDIDATES) {
    const candidateKey = parseDateKey(findFieldValue(fields, fieldName));
    if (candidateKey) {
      return candidateKey;
    }
  }

  const fuzzyEntries = Object.entries(fields).filter(([fieldName]) => {
    const normalized = fieldName.toLocaleLowerCase("vi-VN");
    return SOURCE_DATE_FIELD_KEYWORDS.some((keyword) => normalized.includes(keyword));
  });

  for (const [, value] of fuzzyEntries) {
    const candidateKey = parseDateKey(value);
    if (candidateKey) {
      return candidateKey;
    }
  }

  return "";
}

function isValidAttendanceRecord(name, result) {
  return Boolean(name) && Boolean(result);
}

function aggregateAttendance(records) {
  const summariesByKey = new Map();
  const displayNameByKey = new Map();

  for (const record of records) {
    const fields = record.fields || {};
    const name = findSourceName(fields);
    const result = cellToText(findFieldValue(fields, SOURCE_RESULT_FIELD));
    const summaryValues = findSourceSummaryValues(fields);
    const hasDirectSummaryCounts =
      summaryValues.workDays.found || summaryValues.lateCount.found;

    if (!name) {
      continue;
    }
    if (!hasDirectSummaryCounts && !isValidAttendanceRecord(name, result)) {
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
        otHours: 0,
        workDayKeys: new Set(),
      });
    }

    const summary = summariesByKey.get(nameKey);
    if (hasDirectSummaryCounts) {
      if (summaryValues.workDays.found) {
        summary.workDays += summaryValues.workDays.value;
      }
      if (summaryValues.lateCount.found) {
        summary.lateCount += summaryValues.lateCount.value;
      }
      if (summaryValues.otHours.found) {
        summary.otHours += summaryValues.otHours.value;
      }
      continue;
    }

    const dayKey = findAttendanceDayKey(fields);
    const workDayKey = dayKey || `record:${record.record_id || summary.workDayKeys.size}`;
    if (!summary.workDayKeys.has(workDayKey)) {
      summary.workDayKeys.add(workDayKey);
      summary.workDays += 1;
    }
    if (result.toLocaleLowerCase("en-US") === "very late") {
      summary.lateCount += 1;
    }
    if (summaryValues.otHours.found) {
      summary.otHours += summaryValues.otHours.value;
    }
  }

  return Array.from(summariesByKey.values()).map((summary) => ({
    name: summary.name,
    workDays: summary.workDays,
    lateCount: summary.lateCount,
    otHours: summary.otHours,
  }));
}

function buildDestinationIndex(records) {
  return buildNameIndex(records, DESTINATION_NAME_FIELD, {
    duplicateLabel: `Destination table has duplicated employee names in field ${DESTINATION_NAME_FIELD}`,
  });
}

function buildNameIndex(records, nameField, { duplicateLabel } = {}) {
  const index = new Map();
  const duplicates = new Set();

  for (const record of records) {
    const recordId = record.record_id;
    const fields = record.fields || {};
    const name = cellToText(findFieldValue(fields, nameField));

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
      `${duplicateLabel || `Table has duplicated names in field ${nameField}`}: ` +
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
        [DESTINATION_OT_HOURS_FIELD]: summary.otHours || 0,
      },
    });
  }

  return { updates, missingNames };
}

function getHrTable() {
  return parseSourceUrl(HR_TABLE_URL);
}

function findMissingEmployeeNames(summaries, employeeIndex) {
  return summaries
    .filter((summary) => !employeeIndex.has(normalizeName(summary.name)))
    .map((summary) => summary.name)
    .sort((a, b) => normalizeName(a).localeCompare(normalizeName(b), "vi-VN"));
}

async function analyzeEmployeeRegistry(token, summaries) {
  const table = getHrTable();
  const fields = await listFields(table.appToken, table.tableId, token);
  const nameField = resolveEmployeeNameField([], fields, HR_NAME_FIELD);
  const records = await listRecords(table.appToken, table.tableId, token, [nameField]);
  const index = buildNameIndex(records, nameField, {
    duplicateLabel: `HR table has duplicated employee names in field ${nameField}`,
  });

  return {
    table,
    nameField,
    recordCount: records.length,
    missingNames: findMissingEmployeeNames(summaries, index),
  };
}

async function addMissingHrEmployees(sourceUrl) {
  const analysis = await analyzePayroll(sourceUrl);
  const namesToCreate = analysis.hr.missingNames;

  if (namesToCreate.length > 0) {
    const records = namesToCreate.map((name) => ({
      fields: {
        [analysis.hr.nameField]: name,
      },
    }));

    await batchCreateRecords(
      analysis.hr.table.appToken,
      analysis.hr.table.tableId,
      analysis.token,
      records
    );
  }

  analysis.createdEmployeeNames = namesToCreate;
  if (namesToCreate.length > 0) {
    analysis.hr.recordCount += namesToCreate.length;
    analysis.hr.missingNames = [];
    analysis.summaries = analysis.summaries.map((summary) => ({
      ...summary,
      hrMatched: true,
    }));
  }
  return analysis;
}

async function analyzePayroll(sourceUrl) {
  const source = parseSourceUrl(sourceUrl);
  const token = await getTenantAccessToken();

  const sourceRecords = await listRecords(source.appToken, source.tableId, token);
  const summaries = aggregateAttendance(sourceRecords);
  const destinationRecords = await listRecords(
    DESTINATION_APP_TOKEN,
    DESTINATION_TABLE_ID,
    token,
    [
      DESTINATION_NAME_FIELD,
      DESTINATION_WORK_DAYS_FIELD,
      DESTINATION_LATE_COUNT_FIELD,
      DESTINATION_OT_HOURS_FIELD,
    ]
  );

  const destinationIndex = buildDestinationIndex(destinationRecords);
  const { updates, missingNames } = buildUpdates(summaries, destinationIndex);
  const hr = await analyzeEmployeeRegistry(token, summaries);
  const previewRows = summaries
    .slice()
    .sort((a, b) => normalizeName(a.name).localeCompare(normalizeName(b.name), "vi-VN"))
    .map((summary) => ({
      name: summary.name,
      workDays: summary.workDays,
      lateCount: summary.lateCount,
      otHours: summary.otHours || 0,
      matched: destinationIndex.has(normalizeName(summary.name)),
      hrMatched: !hr.missingNames.some(
        (missingName) => normalizeName(missingName) === normalizeName(summary.name)
      ),
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
    hr,
    createdEmployeeNames: [],
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
  if (analysis.hr.missingNames.length > 0) {
    console.log(
      "[WARN] These names were not found in the HR table:",
      analysis.hr.missingNames.join(", ")
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
  addMissingHrEmployees,
  analyzePayroll,
  analyzeEmployeeRegistry,
  batchCreateRecords,
  batchUpdateRecords,
  buildDestinationIndex,
  buildNameIndex,
  buildUpdates,
  cellToText,
  DESTINATION_APP_TOKEN,
  DESTINATION_TABLE_ID,
  DESTINATION_LATE_COUNT_FIELD,
  DESTINATION_NAME_FIELD,
  DESTINATION_OT_HOURS_FIELD,
  DESTINATION_WORK_DAYS_FIELD,
  findAttendanceDayKey,
  findSourceSummaryValues,
  getHrTable,
  getTenantAccessToken,
  listRecords,
  listFields,
  parseSourceUrl,
  parseDateKey,
  parseNumberValue,
  resolveEmployeeNameField,
  runParseTest,
  syncPayroll,
};
