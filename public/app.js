"use strict";

const sampleUrl =
  "https://dacsankinhdo.sg.larksuite.com/base/MYsqbAZWwamm6NsDRUNlkRc0gEg?table=tblnpozKA9FKISqQ&view=vewv0KTGjJ";

const elements = {
  sourceUrl: document.querySelector("#sourceUrl"),
  analyzeButton: document.querySelector("#analyzeButton"),
  syncButton: document.querySelector("#syncButton"),
  statusText: document.querySelector("#statusText"),
  sourceRecordCount: document.querySelector("#sourceRecordCount"),
  employeeCount: document.querySelector("#employeeCount"),
  updateCount: document.querySelector("#updateCount"),
  missingCount: document.querySelector("#missingCount"),
  parsedSource: document.querySelector("#parsedSource"),
  summaryBody: document.querySelector("#summaryBody"),
  missingList: document.querySelector("#missingList"),
};

let lastAnalyzedUrl = "";

elements.sourceUrl.value = localStorage.getItem("lastSourceUrl") || sampleUrl;

function setStatus(message, type = "") {
  elements.statusText.textContent = message;
  elements.statusText.className = `status-text ${type}`.trim();
}

function setBusy(isBusy) {
  elements.analyzeButton.disabled = isBusy;
  elements.syncButton.disabled = isBusy || !lastAnalyzedUrl;
}

function metric(element, value) {
  element.textContent = new Intl.NumberFormat("vi-VN").format(value || 0);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function postJson(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }

  return payload;
}

function renderAnalysis(analysis) {
  metric(elements.sourceRecordCount, analysis.sourceRecordCount);
  metric(elements.employeeCount, analysis.employeeCount);
  metric(elements.updateCount, analysis.updateCount);
  metric(elements.missingCount, analysis.missingNames.length);

  elements.parsedSource.textContent = `${analysis.source.appToken} / ${analysis.source.tableId}`;

  if (analysis.summaries.length === 0) {
    elements.summaryBody.innerHTML =
      '<tr><td colspan="4" class="empty-state">Không có dữ liệu phù hợp.</td></tr>';
  } else {
    elements.summaryBody.innerHTML = analysis.summaries
      .map((row) => {
        const badge = row.matched
          ? '<span class="badge ok">Khớp</span>'
          : '<span class="badge warn">Thiếu</span>';

        return `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.workDays)}</td>
            <td>${escapeHtml(row.lateCount)}</td>
            <td>${badge}</td>
          </tr>
        `;
      })
      .join("");
  }

  if (analysis.missingNames.length === 0) {
    elements.missingList.innerHTML = "<li>Tất cả tên đã khớp.</li>";
  } else {
    elements.missingList.innerHTML = analysis.missingNames
      .map((name) => `<li>${escapeHtml(name)}</li>`)
      .join("");
  }
}

function getSourceUrl() {
  return elements.sourceUrl.value.trim();
}

async function analyze() {
  const sourceUrl = getSourceUrl();
  if (!sourceUrl) {
    setStatus("Vui lòng dán URL bảng nguồn.", "error");
    return;
  }

  lastAnalyzedUrl = "";
  setBusy(true);
  setStatus("Đang đọc Lark Base và tổng hợp dữ liệu...");

  try {
    const payload = await postJson("/api/analyze", { sourceUrl });
    renderAnalysis(payload.analysis);
    lastAnalyzedUrl = sourceUrl;
    localStorage.setItem("lastSourceUrl", sourceUrl);
    setStatus(
      `Đã phân tích ${payload.analysis.employeeCount} nhân viên, sẵn sàng cập nhật ${payload.analysis.updateCount} dòng.`,
      "success"
    );
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

async function sync() {
  const sourceUrl = getSourceUrl();
  if (!lastAnalyzedUrl || sourceUrl !== lastAnalyzedUrl) {
    setStatus("URL đã thay đổi, hãy phân tích lại trước khi cập nhật.", "error");
    return;
  }

  const confirmed = window.confirm(
    "Cập nhật Ngày công TT và Số lần trễ vào bảng lương đích?"
  );
  if (!confirmed) {
    return;
  }

  setBusy(true);
  setStatus("Đang cập nhật bảng lương...");

  try {
    const payload = await postJson("/api/sync", { sourceUrl });
    renderAnalysis(payload.analysis);
    setStatus(`Đã cập nhật ${payload.analysis.updateCount} dòng vào bảng lương.`, "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

elements.analyzeButton.addEventListener("click", analyze);
elements.syncButton.addEventListener("click", sync);
elements.sourceUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    analyze();
  }
});
elements.sourceUrl.addEventListener("input", () => {
  if (elements.sourceUrl.value.trim() !== lastAnalyzedUrl) {
    elements.syncButton.disabled = true;
  }
});
