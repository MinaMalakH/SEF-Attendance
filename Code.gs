// ============================================================
//  ATTENDANCE SYSTEM — Google Apps Script Backend
//  Paste this entire file into your Apps Script project.
//  Deploy as Web App: Execute as "Me", Access "Anyone".
// ============================================================

// ══════════════════════════════════════════════════════════════
// ▼ CONFIGURATION & CONSTANTS
// ══════════════════════════════════════════════════════════════
const CONFIG = {
  sheets: {
    type1: "خدام",
    type2: "مخدومين",
  },
  columns: {
    NAME:       1,   // A — الاسم
    PHONE:      2,   // B — رقم الموبايل
    BDATE:      3,   // C — تاريخ الميلاد
    COLLEGE:    4,   // D — الكلية
    ISOLD:      5,   // E — وافد قديم  (✓ if existed before the system)
    FIRST_DATE: 6,   // F — أول حضور  (date of very first attendance)
    DATES_START: 7,  // G onwards — one column per session date
  },
  rows: {
    HEADER:    1,
    DATA_START: 2,
  },
  formats: {
    dateFormat:            "yyyy-MM-dd",
    headerBackground:      "#1F4E79",
    firstDateBackground:   "#FFD966",   // yellow — first-date column header
    firstDateCellBg:       "#FFF9E6",   // light yellow for data cells in col F
    attendanceBackground:  "#C6EFCE",
    newRowBackground:      "#FFF2CC",
    dateColumnBackground:  "#EBF3FB",
    dateColumnHeader:      "#4472C4",
    attendanceMark:        "✓",
  },
  columnWidths: {
    nameCol:      200,
    phoneCol:     130,
    bdateCol:     110,
    collegeCol:   140,
    isOldCol:     90,
    firstDateCol: 120,
  },
};

// ── RESPONSE HELPER ──────────────────────────────────────────
function corsResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ══════════════════════════════════════════════════════════════
// ▼ VALIDATORS & ERROR HANDLING
// ══════════════════════════════════════════════════════════════

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

function validateSheetType(type) {
  const t = parseInt(type || "1");
  if (t !== 1 && t !== 2) throw new ValidationError("Sheet type must be 1 or 2");
  return t;
}

function validateDate(dateStr) {
  if (!dateStr) throw new ValidationError("Date is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr).trim())) {
    throw new ValidationError("Date must be in yyyy-MM-dd format");
  }
  return String(dateStr).trim();
}

function validateRowIndex(rowIndex) {
  const idx = parseInt(rowIndex);
  if (isNaN(idx) || idx < CONFIG.rows.DATA_START) throw new ValidationError("Invalid row index");
  return idx;
}

function validatePhone(phone) {
  const p = String(phone || "").trim();
  if (!p) throw new ValidationError("Phone is required");
  return p;
}

function validateName(name) {
  const n = String(name || "").trim();
  if (!n) throw new ValidationError("Name is required");
  return n;
}

function validateCollege(college) {
  const c = String(college || "").trim();
  if (!c) throw new ValidationError("College is required");
  return c;
}

// ══════════════════════════════════════════════════════════════
// ▼ SHEET MANAGER CLASS
// ══════════════════════════════════════════════════════════════

class SheetManager {
  constructor(sheetType) {
    this.type  = validateSheetType(sheetType);
    this.sheet = this._getSheet();
  }

  _getSheet() {
    const ss   = SpreadsheetApp.getActiveSpreadsheet();
    const name = this.type === 1 ? CONFIG.sheets.type1 : CONFIG.sheets.type2;
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error("Sheet not found: " + name);
    return sheet;
  }

  getHeaders() {
    const lastCol = this.sheet.getLastColumn();
    if (lastCol < 1) return [];
    return this.sheet.getRange(CONFIG.rows.HEADER, 1, 1, lastCol).getValues()[0];
  }

  // Returns date-session columns (col 7 onwards)
  getDateColumns() {
    const headers  = this.getHeaders();
    const datesCols = [];
    for (let i = CONFIG.columns.DATES_START - 1; i < headers.length; i++) {
      const h = headers[i];
      if (h) {
        const dateStr = this._normalizeDateString(h);
        datesCols.push({ col: i + 1, date: dateStr });
      }
    }
    return datesCols;
  }

  findDateColumn(dateStr) {
    const normalized = this._normalizeDate(validateDate(dateStr));
    const cols = this.getDateColumns();
    for (let i = 0; i < cols.length; i++) {
      if (this._normalizeDate(cols[i].date) === normalized) return cols[i].col;
    }
    return -1;
  }

  getAllData() {
    const lastRow = this.sheet.getLastRow();
    const lastCol = this.sheet.getLastColumn();
    if (lastRow < CONFIG.rows.DATA_START || lastCol < 1) return [];
    return this.sheet
      .getRange(CONFIG.rows.DATA_START, 1, lastRow - CONFIG.rows.DATA_START + 1, lastCol)
      .getValues();
  }

  // Build a person object from a raw row
  buildPersonObject(row, rowIndex, dateColumns) {
    const attendance = {};
    dateColumns.forEach((d) => {
      const val = row[d.col - 1];
      if (val && val !== "" && val !== 0) attendance[d.date] = true;
    });

    let bdate = row[CONFIG.columns.BDATE - 1];
    if (bdate instanceof Date) {
      bdate = Utilities.formatDate(bdate, Session.getScriptTimeZone(), CONFIG.formats.dateFormat);
    } else {
      bdate = String(bdate || "").trim();
    }

    // Read firstDate from column F
    let firstDate = row[CONFIG.columns.FIRST_DATE - 1];
    if (firstDate instanceof Date) {
      firstDate = Utilities.formatDate(firstDate, Session.getScriptTimeZone(), CONFIG.formats.dateFormat);
    } else {
      firstDate = String(firstDate || "").trim();
    }

    // If col F is empty, derive from the oldest ✓ in date columns (for old entries)
    if (!firstDate && dateColumns.length > 0) {
      const sorted = dateColumns
        .filter((d) => {
          const val = row[d.col - 1];
          return val && val !== "" && val !== 0;
        })
        .map((d) => d.date)
        .sort();
      if (sorted.length > 0) firstDate = sorted[0];
    }

    return {
      rowIndex:       rowIndex,
      name:           String(row[CONFIG.columns.NAME     - 1] || "").trim(),
      phone:          String(row[CONFIG.columns.PHONE    - 1] || "").trim(),
      bdate:          bdate,
      college:        String(row[CONFIG.columns.COLLEGE  - 1] || "").trim(),
      isOld:          !!(row[CONFIG.columns.ISOLD - 1]),
      firstDate:      firstDate,
      attendance:     attendance,
      attendanceCount: Object.keys(attendance).length,
    };
  }

  setValueAndFormat(rowIndex, colIndex, value, formatting) {
    const cell = this.sheet.getRange(rowIndex, colIndex);
    cell.setValue(value);
    if (formatting) {
      if (formatting.background) cell.setBackground(formatting.background);
      if (formatting.fontColor)  cell.setFontColor(formatting.fontColor);
      if (formatting.fontWeight) cell.setFontWeight(formatting.fontWeight);
      if (formatting.alignment)  cell.setHorizontalAlignment(formatting.alignment);
    }
  }

  _normalizeDateString(dateStr) {
    if (!dateStr) return "";
    const str = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const parsed = new Date(str);
    if (!isNaN(parsed)) {
      return Utilities.formatDate(parsed, Session.getScriptTimeZone(), CONFIG.formats.dateFormat);
    }
    return str;
  }

  _normalizeDate(d) { return this._normalizeDateString(d); }
}

// ══════════════════════════════════════════════════════════════
// ▼ ROUTER & HANDLERS
// ══════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    const action = e.parameter.action;
    const handlers = {
      search:              (p) => searchPerson(p),
      getDates:            (p) => getDates(p),
      getStats:            (p) => getStats(p),
      getFirstTimePersons: (p) => getFirstTimePersons(p),
      getTodayAttendees:   (p) => getTodayAttendees(p),
    };
    if (!handlers[action]) return corsResponse({ ok: false, error: "Unknown action: " + action });
    return corsResponse(handlers[action](e.parameter));
  } catch (err) {
    return corsResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    const body    = JSON.parse(e.postData.contents);
    const action  = body.action;
    const handlers = {
      markAttendance:   (p) => markAttendance(p),
      removeAttendance: (p) => removeAttendance(p),
      addNewcomer:      (p) => addNewcomer(p),
      addDateColumn:    (p) => addDateColumn(p),
      updatePerson:     (p) => updatePerson(p),
    };
    if (!handlers[action]) return corsResponse({ ok: false, error: "Unknown action: " + action });
    return corsResponse(handlers[action](body));
  } catch (err) {
    return corsResponse({ ok: false, error: err.message });
  }
}

// ── HANDLER: getDates ────────────────────────────────────────
function getDates(params) {
  const manager = new SheetManager(params.type || "1");
  const dates   = manager.getDateColumns();
  return { ok: true, dates: dates.map((d) => d.date) };
}

// ── HANDLER: getStats ────────────────────────────────────────
function getStats(params) {
  const manager     = new SheetManager(params.type || "1");
  const data        = manager.getAllData();
  const dateColumns = manager.getDateColumns();
  const todayDate   = validateDate(params.date);
  const dateCol     = manager.findDateColumn(todayDate);

  let todayCount    = 0;
  let firstTimeCount = 0;

  if (dateCol > 0) {
    todayCount = data.filter((row) => {
      const val = row[dateCol - 1];
      return val && val !== "" && val !== 0;
    }).length;

    // A "first timer" is someone whose stored firstDate equals today
    firstTimeCount = data.filter((row) => {
      const val = row[dateCol - 1];
      if (!val || val === "" || val === 0) return false;

      let firstDate = row[CONFIG.columns.FIRST_DATE - 1];
      if (firstDate instanceof Date) {
        firstDate = Utilities.formatDate(firstDate, Session.getScriptTimeZone(), CONFIG.formats.dateFormat);
      } else {
        firstDate = String(firstDate || "").trim();
      }
      return firstDate === todayDate;
    }).length;
  }

  return {
    ok:           true,
    totalPeople:  data.length,
    totalSessions: dateColumns.length,
    todayCount:   todayCount,
    firstTimeCount: firstTimeCount,
  };
}

// ── HANDLER: getFirstTimePersons ─────────────────────────────
function getFirstTimePersons(params) {
  const type      = validateSheetType(params.type || "1");
  const todayDate = validateDate(params.date);

  const manager     = new SheetManager(type);
  const data        = manager.getAllData();
  const dateColumns = manager.getDateColumns();
  const dateCol     = manager.findDateColumn(todayDate);

  if (dateCol < 0) return { ok: true, persons: [] };

  const persons = data
    .map((row, i) => {
      const val = row[dateCol - 1];
      if (!val || val === "" || val === 0) return null;

      let firstDate = row[CONFIG.columns.FIRST_DATE - 1];
      if (firstDate instanceof Date) {
        firstDate = Utilities.formatDate(firstDate, Session.getScriptTimeZone(), CONFIG.formats.dateFormat);
      } else {
        firstDate = String(firstDate || "").trim();
      }

      // Only include if firstDate is today
      if (firstDate !== todayDate) return null;

      return manager.buildPersonObject(row, i + CONFIG.rows.DATA_START, dateColumns);
    })
    .filter((p) => p !== null);

  return { ok: true, persons: persons };
}

// ── HANDLER: getTodayAttendees ────────────────────────────────
function getTodayAttendees(params) {
  const type      = validateSheetType(params.type || "1");
  const todayDate = validateDate(params.date);

  const manager     = new SheetManager(type);
  const data        = manager.getAllData();
  const dateColumns = manager.getDateColumns();
  const dateCol     = manager.findDateColumn(todayDate);

  if (dateCol < 0) return { ok: true, persons: [] };

  const persons = data
    .map((row, i) => {
      const val = row[dateCol - 1];
      if (!val || val === "" || val === 0) return null;
      const person = manager.buildPersonObject(row, i + CONFIG.rows.DATA_START, dateColumns);
      person.attendedToday = true;
      return person;
    })
    .filter((p) => p !== null);

  return { ok: true, persons: persons };
}

// ── HANDLER: search ──────────────────────────────────────────
function searchPerson(params) {
  const type  = validateSheetType(params.type || "1");
  const query = String(params.q || "").trim().toLowerCase();

  if (query.length < 2) return { ok: true, results: [] };

  const manager     = new SheetManager(type);
  const data        = manager.getAllData();
  const dateColumns = manager.getDateColumns();

  const results = data
    .map((row, i) => manager.buildPersonObject(row, i + CONFIG.rows.DATA_START, dateColumns))
    .filter((person) =>
      person.name.toLowerCase().includes(query) ||
      person.phone.includes(query) ||
      person.college.toLowerCase().includes(query)
    );

  return { ok: true, results: results };
}

// ── HANDLER: markAttendance ──────────────────────────────────
function markAttendance(body) {
  const type     = validateSheetType(body.type || "1");
  const rowIndex = validateRowIndex(body.rowIndex);
  const date     = validateDate(body.date);
  const mark     = body.mark || CONFIG.formats.attendanceMark;

  const manager = new SheetManager(type);
  const dateCol = manager.findDateColumn(date);
  if (dateCol < 0) throw new ValidationError("Date column not found. Run addDateColumn first.");

  manager.setValueAndFormat(rowIndex, dateCol, mark, {
    background: CONFIG.formats.attendanceBackground,
    fontColor:  "#276221",
    fontWeight: "bold",
    alignment:  "center",
  });

  return { ok: true, rowIndex: rowIndex, dateCol: dateCol, mark: mark };
}

// ── HANDLER: removeAttendance ────────────────────────────────
function removeAttendance(body) {
  const type     = validateSheetType(body.type || "1");
  const rowIndex = validateRowIndex(body.rowIndex);
  const date     = validateDate(body.date);

  const manager = new SheetManager(type);
  const dateCol = manager.findDateColumn(date);
  if (dateCol < 0) throw new ValidationError("Date column not found. Run addDateColumn first.");

  manager.sheet.getRange(rowIndex, dateCol).clearContent();
  manager.sheet.getRange(rowIndex, dateCol)
    .setBackground(CONFIG.formats.dateColumnBackground)
    .setHorizontalAlignment("center");

  return { ok: true, rowIndex: rowIndex, dateCol: dateCol };
}

// ── HANDLER: addDateColumn ───────────────────────────────────
function addDateColumn(body) {
  const date    = validateDate(body.date);
  const results = {};

  [1, 2].forEach((type) => {
    try {
      const manager  = new SheetManager(type);
      const existing = manager.findDateColumn(date);

      if (existing > 0) {
        results["sheet" + type] = { alreadyExists: true, col: existing };
        return;
      }

      const lastCol = manager.sheet.getLastColumn();
      const newCol  = lastCol < CONFIG.columns.DATES_START - 1
        ? CONFIG.columns.DATES_START
        : lastCol + 1;

      manager.sheet.getRange(CONFIG.rows.HEADER, newCol).setValue(date);
      manager.sheet.getRange(CONFIG.rows.HEADER, newCol)
        .setBackground(CONFIG.formats.dateColumnHeader)
        .setFontColor("#FFFFFF")
        .setFontWeight("bold")
        .setHorizontalAlignment("center");

      if (manager.sheet.getLastRow() >= CONFIG.rows.DATA_START) {
        manager.sheet
          .getRange(CONFIG.rows.DATA_START, newCol, manager.sheet.getLastRow() - CONFIG.rows.DATA_START + 1, 1)
          .setHorizontalAlignment("center")
          .setBackground(CONFIG.formats.dateColumnBackground);
      }

      results["sheet" + type] = { created: true, col: newCol };
    } catch (e) {
      results["sheet" + type] = { error: e.message };
    }
  });

  return { ok: true, results: results };
}

// ── HANDLER: addNewcomer ─────────────────────────────────────
function addNewcomer(body) {
  const type    = validateSheetType(body.type || "1");
  const name    = validateName(body.name);
  const phone   = validatePhone(body.phone);
  const college = validateCollege(body.college);
  const bdate   = String(body.bdate || "").trim();
  const date    = validateDate(body.date);
  const isOld   = body.isOld === true;

  const manager = new SheetManager(type);
  const data    = manager.getAllData();

  // Check for duplicate phone
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][CONFIG.columns.PHONE - 1]).trim() === phone) {
      return {
        ok:          false,
        error:       "رقم الموبايل موجود بالفعل",
        duplicate:   true,
        existingRow: i + CONFIG.rows.DATA_START,
      };
    }
  }

  const newRow = manager.sheet.getLastRow() + 1;

  // Write core data
  manager.sheet.getRange(newRow, CONFIG.columns.NAME   ).setValue(name);
  manager.sheet.getRange(newRow, CONFIG.columns.PHONE  ).setValue(phone);
  manager.sheet.getRange(newRow, CONFIG.columns.BDATE  ).setValue(bdate);
  manager.sheet.getRange(newRow, CONFIG.columns.COLLEGE).setValue(college);

  // Mark as old if needed
  if (isOld) {
    manager.sheet.getRange(newRow, CONFIG.columns.ISOLD).setValue(CONFIG.formats.attendanceMark);
  }

  // ★ Write firstDate (column F) — ONLY for new registrations (not for old people)
  // Old people's firstDate should be left empty and manually backfilled later
  if (!isOld) {
    manager.setValueAndFormat(newRow, CONFIG.columns.FIRST_DATE, date, {
      background: CONFIG.formats.attendanceBackground,
      fontColor:  "#276221",
      fontWeight: "bold",
      alignment:  "center",
    });
  }

  // Style core info columns
  manager.sheet.getRange(newRow, 1, 1, CONFIG.columns.FIRST_DATE)
    .setBackground(CONFIG.formats.newRowBackground)
    .setBorder(true, true, true, true, false, false, "#CCCCCC", SpreadsheetApp.BorderStyle.SOLID_MEDIUM);

  // Mark attendance for today's date column
  const dateCol = manager.findDateColumn(date);
  if (dateCol > 0) {
    manager.setValueAndFormat(newRow, dateCol, CONFIG.formats.attendanceMark, {
      background: CONFIG.formats.attendanceBackground,
      fontColor:  "#276221",
      fontWeight: "bold",
      alignment:  "center",
    });
  }

  return { ok: true, rowIndex: newRow, name: name, isOld: isOld };
}

// ── HANDLER: updatePerson ────────────────────────────────────
function updatePerson(body) {
  const type     = validateSheetType(body.type || "1");
  const rowIndex = validateRowIndex(body.rowIndex);
  const updates  = body.updates || {};

  const manager = new SheetManager(type);

  if (updates.phone   !== undefined) manager.sheet.getRange(rowIndex, CONFIG.columns.PHONE  ).setValue(updates.phone);
  if (updates.bdate   !== undefined) manager.sheet.getRange(rowIndex, CONFIG.columns.BDATE  ).setValue(updates.bdate);
  if (updates.college !== undefined) manager.sheet.getRange(rowIndex, CONFIG.columns.COLLEGE).setValue(updates.college);

  return { ok: true, rowIndex: rowIndex, updated: Object.keys(updates) };
}

// ══════════════════════════════════════════════════════════════
// ▼ UTILITY & SETUP
// ══════════════════════════════════════════════════════════════

/**
 * setupSheets()
 * Run ONCE manually from the Apps Script editor to initialise both sheets.
 * Do NOT run if you already have data — it will reset the headers but not delete rows.
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const headers = [
    "الاسم",          // A
    "رقم الموبايل",   // B
    "تاريخ الميلاد",  // C
    "الكلية",         // D
    "وافد قديم",      // E
    "أول حضور",       // F  ← NEW
  ];

  [CONFIG.sheets.type1, CONFIG.sheets.type2].forEach((sheetName) => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) sheet = ss.insertSheet(sheetName);

    // Write fixed headers (A–F)
    headers.forEach((header, i) => {
      sheet.getRange(CONFIG.rows.HEADER, i + 1).setValue(header);
    });

    // Style A–E with dark blue
    sheet.getRange(CONFIG.rows.HEADER, 1, 1, 5)
      .setBackground(CONFIG.formats.headerBackground)
      .setFontColor("#FFFFFF")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setFontSize(11);

    // Style F (أول حضور) with yellow
    sheet.getRange(CONFIG.rows.HEADER, CONFIG.columns.FIRST_DATE)
      .setBackground(CONFIG.formats.firstDateBackground)
      .setFontColor("#7F5C00")
      .setFontWeight("bold")
      .setHorizontalAlignment("center")
      .setFontSize(11);

    // Column widths
    sheet.setColumnWidth(CONFIG.columns.NAME,       CONFIG.columnWidths.nameCol);
    sheet.setColumnWidth(CONFIG.columns.PHONE,      CONFIG.columnWidths.phoneCol);
    sheet.setColumnWidth(CONFIG.columns.BDATE,      CONFIG.columnWidths.bdateCol);
    sheet.setColumnWidth(CONFIG.columns.COLLEGE,    CONFIG.columnWidths.collegeCol);
    sheet.setColumnWidth(CONFIG.columns.ISOLD,      CONFIG.columnWidths.isOldCol);
    sheet.setColumnWidth(CONFIG.columns.FIRST_DATE, CONFIG.columnWidths.firstDateCol);

    // Freeze header row + first 6 columns
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(6);

    // RTL
    sheet.setRightToLeft(true);
  });

  Logger.log("✅ Setup complete! Both sheets are ready with the أول حضور column.");
}

/**
 * backfillFirstDates()
 * One-time utility — run manually AFTER migrating from the old system.
 * For every row where column F (أول حضور) is empty, it finds the earliest
 * ✓ mark across all date columns and writes that date into col F.
 * Safe to re-run — it only touches rows where col F is currently blank.
 */
function backfillFirstDates() {
  [1, 2].forEach((type) => {
    const manager     = new SheetManager(type);
    const data        = manager.getAllData();
    const dateColumns = manager.getDateColumns();

    data.forEach((row, i) => {
      const rowIndex = i + CONFIG.rows.DATA_START;

      // Skip if col F already has a value
      let existing = row[CONFIG.columns.FIRST_DATE - 1];
      if (existing instanceof Date) existing = Utilities.formatDate(existing, Session.getScriptTimeZone(), CONFIG.formats.dateFormat);
      else existing = String(existing || "").trim();
      if (existing) return;

      // Find the earliest attended date in the date columns
      const attended = dateColumns
        .filter((d) => {
          const val = row[d.col - 1];
          return val && val !== "" && val !== 0;
        })
        .map((d) => d.date)
        .sort();

      if (attended.length === 0) return;

      const earliest = attended[0];
      manager.setValueAndFormat(rowIndex, CONFIG.columns.FIRST_DATE, earliest, {
        background: CONFIG.formats.firstDateCellBg,
        fontColor:  "#7f5c00",
        fontWeight: "bold",
        alignment:  "center",
      });
    });
  });

  Logger.log("✅ backfillFirstDates complete!");
}