// ── CONFIGURATION ──────────────────────────────────────────────
const SCRIPT_URL_KEY = "attendanceScriptUrl";
const COLLEGES = [
    "طب",
    "هندسة",
    "حاسبات ومعلومات",
    "علوم",
    "صيدلة",
    "أسنان",
    "تمريض",
    "تجارة",
    "حقوق",
    "آداب",
    "تربية",
    "زراعة",
    "علاج طبيعي",
    "أخرى",
];

// ── STATE ──────────────────────────────────────────────────────
let state = {
    sessionDate: "", // 'yyyy-MM-dd'
    sessionDateAr: "", // Arabic formatted
    currentType: 1, // 1 or 2
    selectedPerson: null, // { rowIndex, name, phone, bdate, college, attendance }
    pendingUpdates: {}, // { phone, bdate, college } from missing-fields editor
    scriptUrl: "",
    searchTimer: null,
    disabledButtons: new Set(), // Track disabled buttons to prevent multiple submissions
};

// ── INIT ───────────────────────────────────────────────────────
window.onload = function () {
    // Load saved script URL
    const saved = localStorage.getItem(SCRIPT_URL_KEY);
    if (saved) {
        state.scriptUrl = saved;
        document.getElementById("scriptUrl").value = saved;
    }
    // Default today
    const today = new Date();
    document.getElementById("sessionDate").valueAsDate = today;
    buildCollegeGrid();
};

// ── UTILS ──────────────────────────────────────────────────────
// Disable a button temporarily during API call
function disableButton(buttonId) {
    const btn = document.getElementById(buttonId);
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";
        state.disabledButtons.add(buttonId);
    }
}

// Re-enable a button after API call completes
function enableButton(buttonId) {
    const btn = document.getElementById(buttonId);
    if (btn) {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
        state.disabledButtons.delete(buttonId);
    }
}

// Disable all buttons with a specific selector
function disableButtonsBySelector(selector) {
    document.querySelectorAll(selector).forEach(btn => {
        btn.disabled = true;
        btn.style.opacity = "0.6";
        btn.style.cursor = "not-allowed";
    });
}

// Re-enable all buttons with a specific selector
function enableButtonsBySelector(selector) {
    document.querySelectorAll(selector).forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = "1";
        btn.style.cursor = "pointer";
    });
}

function goTo(pageId) {
    document
        .querySelectorAll(".page")
        .forEach((p) => p.classList.remove("active"));
    document.getElementById(pageId).classList.add("active");
    window.scrollTo({ top: 0, behavior: "smooth" });
    // If navigating to the stats page, refresh stats so numbers are up-to-date
    if (pageId === "p1" && state.sessionDate) {
        loadStats(state.currentType || 1);
    }
}

function showToast(msg, isError = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.classList.add("show");
    setTimeout(() => t.classList.remove("show"), 2800);
}

function formatDateAr(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("ar-EG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

function formatDateShortAr(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("ar-EG", {
        day: "numeric",
        month: "long",
        year: "numeric",
    });
}

function getInitials(name) {
    if (!name) return "?";
    const parts = name.trim().split(" ");
    return parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0][0];
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function setPendingUpdate(key, value) {
    state.pendingUpdates[key] = value;
}

function renderPersonFieldRow(key, label, value, type) {
    const displayValue = key === "bdate" ? formatDateShortAr(value) : escapeHtml(value);
    const icon = key === "phone" ? "phone" : key === "bdate" ? "cake" : key === "college" ? "school" : "id";
    return `
    <tr id="fieldRow_${key}">
        <td><i class="ti ti-${icon}" style="font-size:14px; margin-left:5px;"></i>${label}</td>
        <td id="fieldEditor_${key}" style="display:flex; align-items:center; justify-content:flex-end; gap:8px;">
            <span id="fieldValue_${key}">${displayValue || '<span style="color:#DDD">—</span>'}</span>
            <button type="button" class="icon-btn" onclick="editPersonField('${key}', '${type}')" style="border:none; background:none; color:var(--c-blue-600); cursor:pointer; padding:0;">
                <i class="ti ti-pencil"></i>
            </button>
        </td>
    </tr>`;
}

function editPersonField(key, type) {
    const person = state.selectedPerson || {};
    const currentValue = state.pendingUpdates[key] !== undefined ? state.pendingUpdates[key] : person[key] || "";
    const inputType = type || (key === "bdate" ? "date" : "text");
    const inputValue = inputType === "date" ? currentValue : escapeHtml(currentValue);
    const editor = document.getElementById(`fieldEditor_${key}`);
    if (!editor) return;

    editor.innerHTML = `<input type="${inputType}" id="input_${key}" value="${inputValue}"
            style="width:100%; padding:8px; border:1px solid #DDD; border-radius:6px;"
            oninput="setPendingUpdate('${key}', this.value)" />`;
    const input = document.getElementById(`input_${key}`);
    if (input) input.focus();
}

function avatarColors(name) {
    const palettes = [
        { bg: "#E6F1FB", color: "#0C447C" },
        { bg: "#E1F5EE", color: "#085041" },
        { bg: "#FAEEDA", color: "#854F0B" },
        { bg: "#FBEAF0", color: "#72243E" },
        { bg: "#EAF3DE", color: "#27500A" },
    ];
    const i = (name || "").charCodeAt(0) % palettes.length;
    return palettes[i];
}

// ── NETWORK ────────────────────────────────────────────────────
async function apiGet(params) {
    if (!state.scriptUrl) throw new Error("لم يتم إدخال رابط Web App");
    const url = state.scriptUrl + "?" + new URLSearchParams(params);
    const res = await fetch(url, { redirect: "follow" });
    return res.json();
}

async function apiPost(body) {
    if (!state.scriptUrl) throw new Error("لم يتم إدخال رابط Web App");
    const res = await fetch(state.scriptUrl, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain" }, // avoids CORS preflight
        body: JSON.stringify(body),
    });
    return res.json();
}

// ── CONFIG ─────────────────────────────────────────────────────
function saveConfig() {
    const url = document.getElementById("scriptUrl").value.trim();
    if (!url.startsWith("https://script.google.com")) {
        showToast("الرابط غير صحيح", true);
        return;
    }
    state.scriptUrl = url;
    localStorage.setItem(SCRIPT_URL_KEY, url);
    showToast("تم حفظ الإعدادات ✓");
}

// ── PAGE 0 → 1: START SESSION ──────────────────────────────────
async function startSession() {
    const d = document.getElementById("sessionDate").value;
    if (!d) {
        showToast("اختر التاريخ أولاً", true);
        return;
    }
    if (!state.scriptUrl) {
        showToast("أدخل رابط Web App أولاً", true);
        return;
    }

    // Find and disable the start button
    const startBtn = document.querySelector('[onclick="startSession()"]');
    if (startBtn) {
        startBtn.disabled = true;
        startBtn.style.opacity = "0.6";
        startBtn.style.cursor = "not-allowed";
    }

    state.sessionDate = d;
    state.sessionDateAr = formatDateAr(d);

    // Update top bar
    document.getElementById("topBarSub").textContent = formatDateShortAr(d);
    document.getElementById("topBarBadge").textContent = "جلسة نشطة";
    document.getElementById("topBarBadge").style.display = "";

    // Show loading
    goTo("p1");
    document.getElementById("statsLoader").classList.add("show");
    document.getElementById("statsArea").style.display = "none";

    // Create date columns in background (don't block UI)
    try {
        await apiPost({ action: "addDateColumn", date: d });
    } catch (e) {
        showToast("تعذّر إنشاء العمود: " + e.message, true);
    }

    // Load stats for type 1 (default view)
    loadStats(1);
}

async function loadStats(type) {
    document.getElementById("statsLoader").classList.add("show");
    document.getElementById("statsArea").style.display = "none";
    try {
        // Always fetch both types so we can show khudam, makhdoumin and total
        const [a, b] = await Promise.all([
            apiGet({ action: "getStats", type: 1, date: state.sessionDate }),
            apiGet({ action: "getStats", type: 2, date: state.sessionDate }),
        ]);

        const aOk = a && a.ok;
        const bOk = b && b.ok;

        // Date label
        document.getElementById("st_date").textContent =
            state.sessionDateAr || formatDateShortAr(state.sessionDate) || "—";

        const aToday = aOk ? Number(a.todayCount || 0) : 0;
        const bToday = bOk ? Number(b.todayCount || 0) : 0;
        const aFirstTime = aOk ? Number(a.firstTimeCount || 0) : 0;
        const bFirstTime = bOk ? Number(b.firstTimeCount || 0) : 0;

        document.getElementById("st_khudam").textContent = aOk ? aToday : "—";
        document.getElementById("st_makhdoumin").textContent = bOk
            ? bToday
            : "—";
        document.getElementById("st_total").textContent =
            aToday + bToday || 0;
        document.getElementById("st_firsttime").textContent =
            aFirstTime + bFirstTime || 0;

        // Show/hide view button based on first-time count
        const totalFirstTime = aFirstTime + bFirstTime;
        const btn = document.getElementById("viewFirstTimeBtn");
        if (totalFirstTime > 0) {
            btn.style.display = "";
        } else {
            btn.style.display = "none";
        }

        if (aOk || bOk)
            document.getElementById("statsArea").style.display = "";
    } catch (e) {
        // stats are optional
    }
    document.getElementById("statsLoader").classList.remove("show");
}

// ── PAGE 1 → 2: GO TO SEARCH ──────────────────────────────────
function goToSearch(type) {
    state.currentType = type;
    document.getElementById("p2Title").textContent =
        type === 1 ? "بحث — خدام" : "بحث — مخدوم";
    document.getElementById("searchInput").value = "";
    document.getElementById("searchResults").innerHTML = "";
    document.getElementById("noResults").style.display = "none";
    document.getElementById("searchLoader").classList.remove("show");
    goTo("p2");
}

// ── SEARCH ─────────────────────────────────────────────────────
function onSearchInput() {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(doSearch, 400); // debounce 400ms
}

async function doSearch() {
    const q = document.getElementById("searchInput").value.trim();
    const resultsEl = document.getElementById("searchResults");
    const noEl = document.getElementById("noResults");
    const loader = document.getElementById("searchLoader");

    if (q.length < 2) {
        resultsEl.innerHTML = "";
        noEl.style.display = "none";
        return;
    }

    loader.classList.add("show");
    resultsEl.innerHTML = "";
    noEl.style.display = "none";

    try {
        const data = await apiGet({
            action: "search",
            type: state.currentType,
            q,
        });
        loader.classList.remove("show");

        if (!data.ok) {
            showToast("خطأ: " + data.error, true);
            return;
        }

        if (!data.results || data.results.length === 0) {
            noEl.style.display = "block";
            return;
        }

        resultsEl.innerHTML = data.results
            .map((p) => {
                const c = avatarColors(p.name);
                const alreadyPresent =
                    p.attendance && p.attendance[state.sessionDate];
                return `<div class="result-item" onclick='selectPerson(${JSON.stringify(p)})'>
    <div class="avatar" style="background:${c.bg}; color:${c.color};">${getInitials(p.name)}</div>
    <div style="flex:1; min-width:0;">
        <div class="result-name">${p.name}</div>
        <div class="result-sub">${p.phone} · ${p.college}</div>
    </div>
    ${alreadyPresent
                        ? '<span class="badge badge-green">حاضر ✓</span>'
                        : '<span class="badge badge-gray">غائب</span>'
                    }
    </div>`;
            })
            .join("");
    } catch (e) {
        loader.classList.remove("show");
        showToast("خطأ في الاتصال: " + e.message, true);
    }
}

// ── SELECT PERSON ──────────────────────────────────────────────
function selectPerson(person) {
    state.selectedPerson = person;
    state.pendingUpdates = {};

    const c = avatarColors(person.name);
    const count = Object.keys(person.attendance || {}).length;
    const alreadyPresent =
        person.attendance && person.attendance[state.sessionDate];

    // Build detail card
    document.getElementById("personDetailCard").innerHTML = `
<div class="person-header">
    <div class="person-avatar" style="background:${c.bg}; color:${c.color};">${getInitials(person.name)}</div>
    <div>
    <div style="font-size:18px; font-weight:700; color:#1a1a1a;">${escapeHtml(person.name)}</div>
    <div style="font-size:13px; color:var(--c-gray-600); margin-top:2px;">${escapeHtml(person.college || "—")}</div>
    ${alreadyPresent ? '<span class="badge badge-green" style="margin-top:6px;">حاضر اليوم بالفعل ✓</span>' : ""}
    </div>
</div>
<table class="detail-table">
    ${renderPersonFieldRow("name", "الاسم", person.name || "", "text")}
    ${person.phone ? renderPersonFieldRow("phone", "رقم الموبايل", person.phone, "tel") : ""}
    ${person.bdate ? renderPersonFieldRow("bdate", "تاريخ الميلاد", person.bdate, "date") : ""}
    ${person.college ? renderPersonFieldRow("college", "الكلية", person.college, "text") : ""}
    <tr>
    <td><i class="ti ti-calendar-check" style="font-size:14px; margin-left:5px;"></i>أول حضور</td>
    <td>${person.firstDate ? formatDateShortAr(person.firstDate) : '<span style="color:#DDD">—</span>'}</td>
    </tr>
    <tr>
    <td><i class="ti ti-calendar-stats" style="font-size:14px; margin-left:5px;"></i>مرات الحضور</td>
    <td><span class="badge badge-blue">${count} مرة</span></td>
    </tr>
</table>`;

    // Check for missing fields
    const missing = [];
    if (!person.phone)
        missing.push({
            key: "phone",
            label: "رقم الموبايل",
            type: "tel",
            placeholder: "01XXXXXXXXX",
        });
    if (!person.bdate)
        missing.push({
            key: "bdate",
            label: "تاريخ الميلاد",
            type: "date",
            placeholder: "",
        });
    if (!person.college)
        missing.push({
            key: "college",
            label: "الكلية",
            type: "text",
            placeholder: "اسم الكلية",
        });

    const missingSec = document.getElementById("missingSection");
    const missingFlds = document.getElementById("missingFields");
    if (missing.length > 0) {
        missingSec.style.display = "";
        missingFlds.innerHTML = missing
            .map(
                (f) => `
    <div class="field" style="margin-bottom:10px;">
    <label class="field-label" style="color:var(--c-amber-600);">${f.label}</label>
    <input type="${f.type}" id="mf_${f.key}" placeholder="${f.placeholder}"
        oninput="state.pendingUpdates['${f.key}'] = this.value" />
    </div>`,
            )
            .join("");
    } else {
        missingSec.style.display = "none";
    }

    document.getElementById("confirmDateLabel").textContent =
        state.sessionDateAr;
    goTo("p3");
}

// ── CONFIRM ATTENDANCE ─────────────────────────────────────────
async function confirmAttendance() {
    const p = state.selectedPerson;
    if (!p) return;

    // Disable the confirm button to prevent double submission
    const confirmBtn = document.querySelector('[onclick="confirmAttendance()"]');
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.style.opacity = "0.6";
        confirmBtn.style.cursor = "not-allowed";
    }

    try {
        // Save any pending updates first
        if (Object.keys(state.pendingUpdates).length > 0) {
            const updateRes = await apiPost({
                action: "updatePerson",
                type: state.currentType,
                rowIndex: p.rowIndex,
                updates: state.pendingUpdates,
            });
            if (!updateRes.ok) {
                showToast("خطأ في تحديث البيانات: " + updateRes.error, true);
                if (confirmBtn) {
                    confirmBtn.disabled = false;
                    confirmBtn.style.opacity = "1";
                    confirmBtn.style.cursor = "pointer";
                }
                return;
            }
            Object.assign(p, state.pendingUpdates);
            state.selectedPerson = p;
            state.pendingUpdates = {};
        }

        // Mark attendance
        const res = await apiPost({
            action: "markAttendance",
            type: state.currentType,
            rowIndex: p.rowIndex,
            date: state.sessionDate,
        });
        if (!res.ok) {
            showToast("خطأ: " + res.error, true);
            // Re-enable button on error
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = "1";
                confirmBtn.style.cursor = "pointer";
            }
            return;
        }

        document.getElementById("successName").textContent =
            "تم تسجيل حضور " + p.name;
        document.getElementById("successSub").textContent =
            state.sessionDateAr;
        goTo("p5");
    } catch (e) {
        showToast("خطأ في الاتصال: " + e.message, true);
        // Re-enable button on error
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.style.opacity = "1";
            confirmBtn.style.cursor = "pointer";
        }
    }
}

// ── NEWCOMER ───────────────────────────────────────────────────
function goToNewcomer() {
    ["nc_fname", "nc_lname", "nc_phone", "nc_other_college"].forEach(
        (id) => {
            const el = document.getElementById(id);
            if (el) el.value = "";
        },
    );
    document.getElementById("nc_bdate").value = "";
    document.getElementById("nc_is_old").checked = false;
    document.getElementById("otherCollegeWrap").style.display = "none";
    // Deselect all colleges
    document
        .querySelectorAll(".college-item")
        .forEach((el) => el.classList.remove("selected"));
    document
        .querySelectorAll(".college-item input")
        .forEach((r) => (r.checked = false));

    const title = state.currentType === 1 ? "خدام" : "مخدوم";
    const newcomerType = state.currentType === 1 ? "خادم" : "مخدوم";
    document.getElementById("p4Title").textContent =
        newcomerType + " جديد — " + title;
    document.getElementById("newcomerBtn").innerHTML =
        '<i class="ti ti-user-plus"></i> تسجيل ' + newcomerType + " جديد";
    document.getElementById("noResultsHint").textContent =
        "هل هو " + newcomerType + " جديد؟";
    document.getElementById("p4Sub").textContent =
        "أدخل بيانات الشخص الجديد";
    document.getElementById("ncDateLabel").textContent =
        state.sessionDateAr;
    goTo("p4");
}

function buildCollegeGrid() {
    const grid = document.getElementById("collegeGrid");
    grid.innerHTML = COLLEGES.map(
        (c) => `
<label class="college-item" onclick="selectCollege(this, '${c}')">
    <input type="radio" name="college" value="${c}" />
    ${c}
</label>`,
    ).join("");
}

function selectCollege(el, val) {
    document
        .querySelectorAll(".college-item")
        .forEach((x) => x.classList.remove("selected"));
    el.classList.add("selected");
    el.querySelector("input").checked = true;
    document.getElementById("otherCollegeWrap").style.display =
        val === "أخرى" ? "" : "none";
    if (val !== "أخرى")
        document.getElementById("nc_other_college").value = "";
}

async function submitNewcomer() {
    const fname = document.getElementById("nc_fname").value.trim();
    const lname = document.getElementById("nc_lname").value.trim();
    const phone = document.getElementById("nc_phone").value.trim();
    const bdate = document.getElementById("nc_bdate").value;
    const isOld = document.getElementById("nc_is_old").checked;
    const checked = document.querySelector(".college-item.selected input");
    let college = checked ? checked.value : "";
    if (college === "أخرى")
        college = document.getElementById("nc_other_college").value.trim();

    // Validate
    const errors = [];
    if (!fname || !lname) errors.push("الاسم مطلوب");
    if (!phone || phone.length < 10) errors.push("رقم الموبايل غير صحيح");
    if (!bdate) errors.push("تاريخ الميلاد مطلوب");
    if (!college) errors.push("اختر الكلية");
    if (errors.length) {
        showToast(errors[0], true);
        return;
    }

    const name = fname + " " + lname;

    // Disable the submit button to prevent double submission
    const submitBtn = document.querySelector('[onclick="submitNewcomer()"]');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = "0.6";
        submitBtn.style.cursor = "not-allowed";
    }

    try {
        const res = await apiPost({
            action: "addNewcomer",
            type: state.currentType,
            name,
            phone,
            bdate,
            college,
            date: state.sessionDate,
            isOld: isOld,
        });

        if (!res.ok) {
            if (res.duplicate) {
                showToast("رقم الموبايل موجود بالفعل في الشيت!", true);
            } else {
                showToast("خطأ: " + res.error, true);
            }
            // Re-enable button on error
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.style.opacity = "1";
                submitBtn.style.cursor = "pointer";
            }
            return;
        }

        let successMsg = "عضو جديد + حضور " + state.sessionDateAr;
        if (isOld) {
            successMsg += " (وافد قديم)";
        }

        document.getElementById("successName").textContent =
            "تمت إضافة " + name;
        document.getElementById("successSub").textContent = successMsg;
        goTo("p5");
    } catch (e) {
        showToast("خطأ في الاتصال: " + e.message, true);
        // Re-enable button on error
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.style.opacity = "1";
            submitBtn.style.cursor = "pointer";
        }
    }
}

// ── NEXT PERSON ────────────────────────────────────────────────
function nextPerson() {
    goToSearch(state.currentType);
}

// ── VIEW FIRST-TIME PERSONS ────────────────────────────────────
async function viewFirstTimePersons() {
    goTo("p6");
    document.getElementById("firstTimeLoader").classList.add("show");
    document.getElementById("firstTimeList").style.display = "none";
    document.getElementById("firstTimeEmpty").style.display = "none";

    try {
        // Fetch from both types
        const [a, b] = await Promise.all([
            apiGet({
                action: "getFirstTimePersons",
                type: 1,
                date: state.sessionDate,
            }),
            apiGet({
                action: "getFirstTimePersons",
                type: 2,
                date: state.sessionDate,
            }),
        ]);

        const aPersons = a && a.ok ? a.persons || [] : [];
        const bPersons = b && b.ok ? b.persons || [] : [];
        const allPersons = [...aPersons, ...bPersons];

        document.getElementById("firstTimeLoader").classList.remove("show");

        if (allPersons.length === 0) {
            document.getElementById("firstTimeEmpty").style.display = "block";
            return;
        }

        const html = allPersons
            .map((p) => {
                const c = avatarColors(p.name);
                return `
<div class="card" style="margin-bottom: 12px;">
    <div class="person-header">
    <div class="person-avatar" style="background:${c.bg}; color:${c.color};">${getInitials(p.name)}</div>
    <div>
        <div style="font-size:16px; font-weight:700; color:#1a1a1a;">${p.name}</div>
        <div style="font-size:13px; color:var(--c-gray-600); margin-top:2px;">${p.college}</div>
    </div>
    </div>
    <table class="detail-table">
    <tr>
        <td><i class="ti ti-phone" style="font-size:14px; margin-left:5px;"></i>الموبايل</td>
        <td>${p.phone || '<span style="color:#DDD">—</span>'}</td>
    </tr>
    <tr>
        <td><i class="ti ti-cake" style="font-size:14px; margin-left:5px;"></i>الميلاد</td>
        <td>${p.bdate ? formatDateShortAr(p.bdate) : '<span style="color:#DDD">—</span>'}</td>
    </tr>
    <tr>
        <td><i class="ti ti-school" style="font-size:14px; margin-left:5px;"></i>الكلية</td>
        <td>${p.college || '<span style="color:#DDD">—</span>'}</td>
    </tr>
    <tr>
        <td><i class="ti ti-calendar-check" style="font-size:14px; margin-left:5px;"></i>أول حضور</td>
        <td><span class="badge badge-amber">${p.firstDate ? formatDateShortAr(p.firstDate) : '—'}</span></td>
    </tr>
    </table>
</div>`;
            })
            .join("");

        document.getElementById("firstTimeList").innerHTML = html;
        document.getElementById("firstTimeList").style.display = "block";
    } catch (e) {
        document.getElementById("firstTimeLoader").classList.remove("show");
        document.getElementById("firstTimeEmpty").style.display = "block";
        showToast("خطأ في التحميل: " + e.message, true);
    }
}

// ── VIEW TODAY ATTENDEES ────────────────────────────────────────
async function viewTodayAttendees() {
    goTo("p7");
    document.getElementById("attendeeLoader").classList.add("show");
    document.getElementById("attendeeList").style.display = "none";
    document.getElementById("attendeeEmpty").style.display = "none";

    try {
        // Fetch from both types
        const [a, b] = await Promise.all([
            apiGet({
                action: "getTodayAttendees",
                type: 1,
                date: state.sessionDate,
            }),
            apiGet({
                action: "getTodayAttendees",
                type: 2,
                date: state.sessionDate,
            }),
        ]);

        const aPersons = a && a.ok ? a.persons || [] : [];
        const bPersons = b && b.ok ? b.persons || [] : [];
        const allPersons = [...aPersons, ...bPersons];

        document.getElementById("attendeeLoader").classList.remove("show");

        if (allPersons.length === 0) {
            document.getElementById("attendeeEmpty").style.display = "block";
            return;
        }

        const html = allPersons
            .map((p, idx) => {
                const c = avatarColors(p.name);
                return `
<div class="card" style="margin-bottom: 12px;">
    <div class="person-header">
    <div class="person-avatar" style="background:${c.bg}; color:${c.color};">${getInitials(p.name)}</div>
    <div style="flex:1;">
        <div style="font-size:16px; font-weight:700; color:#1a1a1a;">${p.name}</div>
        <div style="font-size:13px; color:var(--c-gray-600); margin-top:2px;">${p.college}</div>
    </div>
    <input
        type="checkbox"
        checked
        class="attendee-check"
        data-type="${a.persons && a.persons.includes(p) ? 1 : 2}"
        data-row="${p.rowIndex}"
        data-name="${p.name}"
        onchange="toggleAttendance(this)"
        style="width: 20px; height: 20px; cursor: pointer;"
    />
    </div>
    <table class="detail-table">
    <tr>
        <td><i class="ti ti-phone" style="font-size:14px; margin-left:5px;"></i>الموبايل</td>
        <td>${p.phone || '<span style="color:#DDD">—</span>'}</td>
    </tr>
    <tr>
        <td><i class="ti ti-cake" style="font-size:14px; margin-left:5px;"></i>الميلاد</td>
        <td>${p.bdate ? formatDateShortAr(p.bdate) : '<span style="color:#DDD">—</span>'}</td>
    </tr>
    <tr>
        <td><i class="ti ti-school" style="font-size:14px; margin-left:5px;"></i>الكلية</td>
        <td>${p.college || '<span style="color:#DDD">—</span>'}</td>
    </tr>
    <tr>
        <td><i class="ti ti-calendar-check" style="font-size:14px; margin-left:5px;"></i>أول حضور</td>
        <td>${p.firstDate ? formatDateShortAr(p.firstDate) : '<span style="color:#DDD">—</span>'}</td>
    </tr>
    </table>
</div>`;
            })
            .join("");

        document.getElementById("attendeeList").innerHTML = html;
        document.getElementById("attendeeList").style.display = "block";
    } catch (e) {
        document.getElementById("attendeeLoader").classList.remove("show");
        document.getElementById("attendeeEmpty").style.display = "block";
        showToast("خطأ في التحميل: " + e.message, true);
    }
}

// ── TOGGLE ATTENDANCE ───────────────────────────────────────────
async function toggleAttendance(checkbox) {
    const personType = parseInt(checkbox.dataset.type);
    const rowIndex = parseInt(checkbox.dataset.row);
    const personName = checkbox.dataset.name;
    const isChecked = checkbox.checked;

    // Disable checkbox during operation
    checkbox.disabled = true;

    try {
        if (isChecked) {
            // Mark attendance
            await apiPost({
                action: "markAttendance",
                type: personType,
                rowIndex: rowIndex,
                date: state.sessionDate,
            });
            showToast("✓ تم تسجيل حضور " + personName);
        } else {
            // Remove attendance (set cell to empty)
            await apiPost({
                action: "removeAttendance",
                type: personType,
                rowIndex: rowIndex,
                date: state.sessionDate,
            });
            showToast("✗ تم حذف حضور " + personName);
        }
    } catch (e) {
        // Revert checkbox on error
        checkbox.checked = !isChecked;
        showToast("خطأ: " + e.message, true);
    } finally {
        // Always re-enable checkbox
        checkbox.disabled = false;
    }
}