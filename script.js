// script.js (finance page logic + helpers)
// This file expects finance.html DOM structure. If not on finance page, it will early return.

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- helpers ---------- */
  function parseNumber(v) {
    if (v === null || v === undefined) return NaN;
    if (typeof v === "number") return v;
    let s = String(v).trim();
    if (s === "" || s === "-") return NaN;

    let negative = false;

    // 處理括號表示的負數 (123) -> -123
    if (/^\(.*\)$/.test(s)) {
      negative = true;
      s = s.replace(/^\(|\)$/g, "");
    }

    // 處理負號
    if (s.startsWith('-')) {
      negative = !negative;
      s = s.substring(1);
    }

    // 移除千分位逗號和空格
    s = s.replace(/,/g, "").replace(/\s+/g, "");

    // 處理百分比 (移除%)
    if (s.endsWith('%')) {
      s = s.replace(/%$/, "");
      const n = parseFloat(s);
      if (isNaN(n)) return NaN;
      return negative ? -(n / 100) : (n / 100);
    }

    // 處理單位 (萬、千、百萬等)
    let multiplier = 1;
    if (s.includes('萬') || s.includes('万')) {
      s = s.replace(/萬|万/g, '');
      multiplier = 10000;
    } else if (s.includes('千')) {
      s = s.replace(/千/g, '');
      multiplier = 1000;
    } else if (s.includes('百萬') || s.includes('百万')) {
      s = s.replace(/百萬|百万/g, '');
      multiplier = 1000000;
    } else if (s.includes('億') || s.includes('亿')) {
      s = s.replace(/億|亿/g, '');
      multiplier = 100000000;
    }

    // 移除其他非數字字符（保留小數點、科學記號）
    s = s.replace(/[^0-9.\-eE]/g, "");

    const n = parseFloat(s);
    if (isNaN(n)) return NaN;

    const result = n * multiplier;
    return negative ? -result : result;
  }

  // 主欄位關鍵字
  const KEYWORDS = {
    revenue: ["營業收入", "營收", "Revenue", "Total Revenue", "營業收入合計", "營業收入淨額"],
    cogs: ["營業成本", "成本", "Cost of sales", "Cost of goods sold", "COGS", "營業成本合計"],
    operatingIncome: ["營業利益", "營益", "Operating Income", "營業利益（損失）", "營業利益(損失)"],
    preTax: ["稅前淨利", "稅前損益", "PreTaxIncome", "Pre-tax profit", "稅前淨利（淨損）"],
    netIncome: ["本期淨利", "本期淨損", "淨利", "Net Income", "Net profit", "繼續營業單位本期淨利"]
  };

  const OUTPUT_LABELS = {
    revenue: "營業收入",
    cogs: "營業成本",
    operatingIncome: "營業利益（損失）",
    preTax: "稅前淨利（淨損）",
    netIncome: "本期淨利（淨損）"
  };

  /* ---------- DOM elements (finance.html) ---------- */
  const radioManual = document.getElementById("radioManual");
  const radioUpload = document.getElementById("radioUpload");
  const uploadArea = document.getElementById("uploadArea");
  const manualArea = document.getElementById("manualArea");
  const parseExcelBtn = document.getElementById("parseExcelBtn");
  const excelFileInput = document.getElementById("excelFile");

  const newFieldName = document.getElementById("newFieldName");
  const newFieldValue = document.getElementById("newFieldValue");
  const newFieldNote = document.getElementById("newFieldNote");
  const addCustomFieldBtn = document.getElementById("addCustomField");
  const customFieldsList = document.getElementById("customFieldsList");

  const computeBtn = document.getElementById("computeBtn");
  const resetBtn = document.getElementById("resetBtn");
  const financeWarning = document.getElementById("financeWarning");

  const resultsSection = document.getElementById("resultsSection");
  const itemsTable = document.getElementById("itemsTable");
  const metricsTable = document.getElementById("metricsTable");
  const downloadBtn = document.getElementById("downloadXlsx");

  // 如果不是 finance.html（找不到關鍵元素），檢查是否為 stock.html
  if (!parseExcelBtn || !computeBtn) {
    handleStockPage();
    return;
  }

  function showWarning(msg) {
    if (!financeWarning) return;
    financeWarning.textContent = msg || "";
    financeWarning.style.display = msg ? "block" : "none";
  }

  // toggle upload / manual UI
  function updateModeUI() {
    const val = document.querySelector('input[name="inputType"]:checked')?.value;
    if (val === "manual") {
      if (manualArea) manualArea.classList.remove("hidden");
      if (uploadArea) uploadArea.style.display = "none";
    } else {
      if (manualArea) manualArea.classList.add("hidden");
      if (uploadArea) uploadArea.style.display = "block";
    }
  }
  if (radioManual) radioManual.addEventListener("change", updateModeUI);
  if (radioUpload) radioUpload.addEventListener("change", updateModeUI);
  updateModeUI();

  /* ---------- state ---------- */
  // parsedSums: latest sums parsed from uploaded file (before manual edits)
  let parsedSums = { revenue:0, cogs:0, operatingIncome:0, preTax:0, netIncome:0, extras:{} };
  // customFields: {id, name, value, note}
  let customFields = [];

  /* ---------- custom fields UI ---------- */
  function renderCustomFieldsUI() {
    if (!customFieldsList) return;
    customFieldsList.innerHTML = "";
    if (customFields.length === 0) {
      customFieldsList.innerHTML = `<div class="muted small">目前沒有自定義欄位</div>`;
      return;
    }
    customFields.forEach(f => {
      const div = document.createElement("div");
      div.className = "field-box";
      div.style.display = "flex";
      div.style.justifyContent = "space-between";
      div.style.alignItems = "center";
      div.style.gap = "8px";
      div.innerHTML = `
        <div style="flex:1;">
          <strong>${escapeHtml(f.name)}</strong>
          <div class="muted small">金額: ${f.value.toLocaleString()}</div>
          ${f.note ? `<div class="muted small" style="font-style:italic;">備註: ${escapeHtml(f.note)}</div>` : ''}
        </div>
        <div style="white-space:nowrap;">
          <button class="edit-cf secondary" data-id="${f.id}">編輯</button>
          <button class="del-cf secondary" data-id="${f.id}">刪除</button>
        </div>
      `;
      customFieldsList.appendChild(div);
    });

    customFieldsList.querySelectorAll(".del-cf").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        customFields = customFields.filter(x => x.id !== id);
        renderCustomFieldsUI();
      });
    });
    customFieldsList.querySelectorAll(".edit-cf").forEach(btn => {
      btn.addEventListener("click", (e) => {
        const id = e.currentTarget.getAttribute("data-id");
        const f = customFields.find(x => x.id === id);
        if (!f) return;
        const newName = prompt("修改欄位名稱", f.name);
        if (newName === null) return;
        const newValStr = prompt("修改金額（數字）", String(f.value));
        if (newValStr === null) return;
        const newNoteStr = prompt("修改備註", f.note || "");
        if (newNoteStr === null) return;
        const newVal = parseNumber(newValStr);
        f.name = (newName || "").trim();
        f.value = isNaN(newVal) ? 0 : newVal;
        f.note = (newNoteStr || "").trim();
        renderCustomFieldsUI();
      });
    });
  }

  if (addCustomFieldBtn) {
    addCustomFieldBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showWarning("");
      const nm = (newFieldName.value || "").trim();
      const val = parseNumber(newFieldValue.value);
      const note = (newFieldNote ? newFieldNote.value || "" : "").trim();
      if (!nm) {
        showWarning("請輸入自定義欄位名稱。");
        return;
      }
      const v = isNaN(val) ? 0 : val;
      const id = "cf_" + Date.now() + Math.floor(Math.random()*1000);
      customFields.push({ id, name: nm, value: v, note: note });
      newFieldName.value = ""; newFieldValue.value = "";
      if (newFieldNote) newFieldNote.value = "";
      renderCustomFieldsUI();
    });
  }

  // escape HTML helper
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  /* ---------- Excel parsing logic ---------- */
  parseExcelBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    showWarning("");
    if (resultsSection) resultsSection.classList.add("hidden");
    if (itemsTable) itemsTable.innerHTML = "";
    if (metricsTable) metricsTable.innerHTML = "";
    customFields = [];
    renderCustomFieldsUI();

    const finput = excelFileInput;
    if (!finput || !finput.files || finput.files.length === 0) {
      showWarning("請先選擇 Excel 檔案。");
      return;
    }
    const file = finput.files[0];
    try {
      parsedSums = await analyzeExcelFile(file);
      // populate manual input boxes so user can adjust afterwards
      const mr = document.getElementById("manualRevenue");
      const mc = document.getElementById("manualCogs");
      const mo = document.getElementById("manualOpIncome");
      const mp = document.getElementById("manualPreTax");
      const mn = document.getElementById("manualNetIncome");

      if (mr) mr.value = parsedSums.revenue || 0;
      if (mc) mc.value = parsedSums.cogs || 0;
      if (mo) mo.value = parsedSums.operatingIncome || 0;
      if (mp) mp.value = parsedSums.preTax || 0;
      if (mn) mn.value = parsedSums.netIncome || 0;

      // convert extras to customFields list so user sees non-matched items
      if (parsedSums.extras) {
        Object.keys(parsedSums.extras).forEach(k => {
          customFields.push({ id: "ext_"+Math.random().toString(36).slice(2,9), name: k, value: parsedSums.extras[k], note: "" });
        });
        renderCustomFieldsUI();
      }

      showWarning("已解析 Excel（已填入主要欄位），可修改或新增自定義欄位，最後點「計算指標並顯示結果」。");
    } catch (err) {
      console.error(err);
      showWarning("解析 Excel 發生錯誤，請檢查檔案格式。");
    }
  });

  // analyzeExcelFile: wide-table header matching + long-table (account + value) fallback
  function analyzeExcelFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = function(evt) {
        try {
          const data = new Uint8Array(evt.target.result);
          const wb = XLSX.read(data, { type: "array" });
          const sheet = wb.Sheets[wb.SheetNames[0]];
          // rows as objects (header-based)
          const rowsObj = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          // rows as arrays (for very simple tables)
          const rowsArr = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });

          const sums = { revenue:0, cogs:0, operatingIncome:0, preTax:0, netIncome:0, extras:{} };

          if (!rowsObj || rowsObj.length === 0) {
            console.log("No data found in Excel file");
            resolve(sums);
            return;
          }

          const headers = Object.keys(rowsObj[0]).map(h => (h||"").toString().trim());
          console.log("Found headers:", headers);
          console.log("First few rows:", rowsObj.slice(0, 3));

          // 1) header-based column matching (wide tables)
          const headerMatched = {}; // hdr -> mainKey
          headers.forEach(hdr => {
            const headerText = hdr.toLowerCase().trim();
            for (const key of Object.keys(KEYWORDS)) {
              for (const kw of KEYWORDS[key]) {
                const kwLower = kw.toLowerCase().trim();
                if (headerText.includes(kwLower) || hdr.indexOf(kw) !== -1) {
                  headerMatched[hdr] = key;
                  console.log(`Header matched: "${hdr}" -> ${key} (keyword: ${kw})`);
                  break;
                }
              }
              if (headerMatched[hdr]) break;
            }
          });
          console.log("Header matches:", headerMatched);
          // sum columns matched by header
          Object.keys(headerMatched).forEach(hdr => {
            const key = headerMatched[hdr];
            let columnSum = 0;
            rowsObj.forEach(r => {
              const v = parseNumber(r[hdr]);
              if (!isNaN(v)) {
                columnSum += v;
                console.log(`Adding ${v} to ${key} from column "${hdr}"`);
              }
            });
            sums[key] = (sums[key] || 0) + columnSum;
            console.log(`Column "${hdr}" (${key}) total: ${columnSum}`);
          });

          // 2) long table: find account col and value col
          const accountCol = headers.find(h => /原始|會計|項目|名稱|name|account|label/i.test(h)) || headers[0];
          const valueCol = headers.find(h => /數|amount|value|金額|數值|數目/i.test(h)) || headers[1] || headers[0];

          const valueColMatchedByHeader = Object.keys(headerMatched).includes(valueCol);

          if (!valueColMatchedByHeader) {
            rowsObj.forEach(r => {
              const accountText = String(r[accountCol] || "").trim();
              const accountLower = accountText.toLowerCase();
              const val = parseNumber(r[valueCol]);
              if (isNaN(val)) return;
              let matched = false;
              for (const key of Object.keys(KEYWORDS)) {
                for (const kw of KEYWORDS[key]) {
                  const kwLower = kw.toLowerCase().trim();
                  if (accountLower.includes(kwLower) || accountText.indexOf(kw) !== -1) {
                    sums[key] = (sums[key] || 0) + val;
                    matched = true;
                    break;
                  }
                }
                if (matched) break;
              }
              if (!matched && accountText) {
                sums.extras[accountText] = (sums.extras[accountText] || 0) + val;
              }
            });
          }

          // 3) fallback: if still no revenue, find max positive numeric in sheet
          if (!sums.revenue || sums.revenue === 0) {
            const cand = [];
            rowsObj.forEach(r => {
              Object.keys(r).forEach(h => {
                const v = parseNumber(r[h]);
                if (!isNaN(v)) cand.push(v);
              });
            });
            if (cand.length) {
              const maxv = Math.max(...cand);
              if (maxv > 0) sums.revenue = maxv;
            }
          }

          console.log("Final sums:", sums);
          resolve(sums);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = function(err) { reject(err); };
      reader.readAsArrayBuffer(file);
    });
  }

  /* ---------- compute and render ---------- */
  computeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    showWarning("");
    if (resultsSection) resultsSection.classList.add("hidden");
    if (itemsTable) itemsTable.innerHTML = ""; 
    if (metricsTable) metricsTable.innerHTML = "";

    // start from parsedSums but allow manual overrides
    let rev = parsedSums.revenue || 0;
    let cogs = parsedSums.cogs || 0;
    let op = parsedSums.operatingIncome || 0;
    let pre = parsedSums.preTax || 0;
    let net = parsedSums.netIncome || 0;

    // read manual inputs if present and not empty (manual overrides)
    const mr = document.getElementById("manualRevenue");
    const mc = document.getElementById("manualCogs");
    const mo = document.getElementById("manualOpIncome");
    const mp = document.getElementById("manualPreTax");
    const mn = document.getElementById("manualNetIncome");

    if (mr && mr.value !== "") rev = isNaN(parseNumber(mr.value)) ? rev : parseNumber(mr.value);
    if (mc && mc.value !== "") cogs = isNaN(parseNumber(mc.value)) ? cogs : parseNumber(mc.value);
    if (mo && mo.value !== "") op = isNaN(parseNumber(mo.value)) ? op : parseNumber(mo.value);
    if (mp && mp.value !== "") pre = isNaN(parseNumber(mp.value)) ? pre : parseNumber(mp.value);
    if (mn && mn.value !== "") net = isNaN(parseNumber(mn.value)) ? net : parseNumber(mn.value);

    // merge custom fields into main if name contains keywords
    customFields.forEach(cf => {
      const name = cf.name || "";
      const nameLower = name.toLowerCase().trim();
      const val = isNaN(parseNumber(cf.value)) ? 0 : parseNumber(cf.value);
      let merged = false;
      for (const key of Object.keys(KEYWORDS)) {
        for (const kw of KEYWORDS[key]) {
          const kwLower = kw.toLowerCase().trim();
          if (nameLower.includes(kwLower) || name.indexOf(kw) !== -1) {
            // merge into corresponding main var
            if (key === "revenue") rev += val;
            else if (key === "cogs") cogs += val;
            else if (key === "operatingIncome") op += val;
            else if (key === "preTax") pre += val;
            else if (key === "netIncome") net += val;
            merged = true; break;
          }
        }
        if (merged) break;
      }
    });

    // prepare final map for display (only five main fields)
    const finalMap = {};
    finalMap[OUTPUT_LABELS.revenue] = rev || 0;
    finalMap[OUTPUT_LABELS.cogs] = cogs || 0;
    finalMap[OUTPUT_LABELS.operatingIncome] = op || 0;
    finalMap[OUTPUT_LABELS.preTax] = pre || 0;
    finalMap[OUTPUT_LABELS.netIncome] = net || 0;

    // render items table (five rows)
    if (itemsTable) {
      itemsTable.innerHTML = "";
      Object.keys(finalMap).forEach(k => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${(isNaN(finalMap[k]) ? "-" : finalMap[k].toLocaleString())}</td>`;
        itemsTable.appendChild(tr);
      });
    }

    // compute metrics
    const revenue = finalMap[OUTPUT_LABELS.revenue] || 0;
    const cogsVal = finalMap[OUTPUT_LABELS.cogs] || 0;
    const opVal = finalMap[OUTPUT_LABELS.operatingIncome] || 0;
    const preVal = finalMap[OUTPUT_LABELS.preTax] || 0;
    const netVal = finalMap[OUTPUT_LABELS.netIncome] || 0;

    const metrics = {};
    if (!isNaN(revenue) && revenue !== 0) {
      metrics["毛利率"] = ((revenue - cogsVal) / revenue) * 100;
      metrics["營業利益率"] = (opVal / revenue) * 100;
      metrics["稅前淨利率"] = (preVal / revenue) * 100;
      metrics["淨利率"] = (netVal / revenue) * 100;
    }

    // render metrics
    if (metricsTable) metricsTable.innerHTML = "";
    if (!metrics || Object.keys(metrics).length === 0) {
      if (metricsTable) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>無法計算（營業收入為 0 或無效）</td><td>-</td>`;
        metricsTable.appendChild(tr);
      }
      showWarning("無法計算比率：找不到有效的營業收入作為分母。");
    } else {
      Object.keys(metrics).forEach(k => {
        if (metricsTable) {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${escapeHtml(k)}</td><td>${metrics[k].toFixed(2)} %</td>`;
          metricsTable.appendChild(tr);
        }
      });
      showWarning("");
    }

    if (resultsSection) resultsSection.classList.remove("hidden");
  });

  // reset
  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.preventDefault();
      parsedSums = { revenue:0, cogs:0, operatingIncome:0, preTax:0, netIncome:0, extras:{} };
      customFields = [];
      if (excelFileInput) excelFileInput.value = "";
      ["manualRevenue","manualCogs","manualOpIncome","manualPreTax","manualNetIncome"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      renderCustomFieldsUI();
      if (itemsTable) itemsTable.innerHTML = "";
      if (metricsTable) metricsTable.innerHTML = "";
      if (resultsSection) resultsSection.classList.add("hidden");
      showWarning("");
    });
  }

  // download Excel of final shown table
  if (downloadBtn) {
    downloadBtn.addEventListener("click", (e) => {
      e.preventDefault();
      // read current items table rows
      const rows = [];
      const trs = itemsTable ? itemsTable.querySelectorAll("tr") : [];
      if (!trs || trs.length === 0) {
        showWarning("目前沒有分析結果可下載。");
        return;
      }
      rows.push(["項目","金額"]);
      trs.forEach(tr => {
        const tds = tr.querySelectorAll("td");
        const k = tds[0]?.textContent || "";
        const v = parseNumber(tds[1]?.textContent) || "";
        rows.push([k, v]);
      });
      rows.push([]);
      rows.push(["指標","數值"]);
      const mtrs = metricsTable ? metricsTable.querySelectorAll("tr") : [];
      mtrs.forEach(tr => {
        const tds = tr.querySelectorAll("td");
        const k = tds[0]?.textContent || "";
        const v = tds[1]?.textContent || "";
        rows.push([k, v]);
      });

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "分析結果");
      XLSX.writeFile(wb, "財務分析結果.xlsx");
    });
  }

});

/* ---------- Stock Page Logic ---------- */
function handleStockPage() {
  const modeStock = document.getElementById("modeStock");
  const modeUndervalued = document.getElementById("modeUndervalued");
  const stockMode = document.getElementById("stockMode");
  const scanMode = document.getElementById("scanMode");
  const searchBtn = document.getElementById("searchBtn");
  const scanBtn = document.getElementById("scanBtn");
  const stockSearch = document.getElementById("stockSearch");
  const hotStocks = document.querySelectorAll(".hot");

  // 如果找不到 stock page 元素，直接返回
  if (!modeStock || !modeUndervalued) {
    return;
  }

  // 模式切換功能
  function switchMode(activeMode) {
    // 更新按鈕狀態
    if (activeMode === "stock") {
      modeStock.classList.add("active");
      modeUndervalued.classList.remove("active");
      if (stockMode) stockMode.classList.remove("hidden");
      if (scanMode) scanMode.classList.add("hidden");
    } else {
      modeStock.classList.remove("active");
      modeUndervalued.classList.add("active");
      if (stockMode) stockMode.classList.add("hidden");
      if (scanMode) scanMode.classList.remove("hidden");
    }
  }

  // 綁定模式切換事件
  modeStock.addEventListener("click", () => switchMode("stock"));
  modeUndervalued.addEventListener("click", () => switchMode("scan"));

  // 個股搜尋功能
  if (searchBtn && stockSearch) {
    searchBtn.addEventListener("click", (e) => {
      e.preventDefault();
      const query = stockSearch.value.trim();
      if (!query) {
        alert("請輸入股票代碼或名稱");
        return;
      }
      // 這裡可以加入實際的搜尋邏輯
      alert(`正在分析股票：${query}\n\n此功能將整合財報、股價、新聞等資訊進行分析。`);
    });
  }

  // 熱門股票點擊功能
  hotStocks.forEach(stock => {
    stock.addEventListener("click", (e) => {
      const code = e.target.getAttribute("data-code");
      const name = e.target.textContent;
      if (stockSearch) {
        stockSearch.value = code;
      }
      alert(`已選擇：${name}\n\n點擊「開始搜尋」進行分析。`);
    });
  });

  // AI 掃描功能
  if (scanBtn) {
    scanBtn.addEventListener("click", (e) => {
      e.preventDefault();

      // 收集篩選條件
      const capMin = document.getElementById("capMin")?.value || "";
      const capMax = document.getElementById("capMax")?.value || "";
      const industry = document.getElementById("industry")?.value || "";
      const peMin = document.getElementById("peMin")?.value || "";
      const peMax = document.getElementById("peMax")?.value || "";

      let conditions = [];
      if (capMin || capMax) {
        conditions.push(`市值：${capMin || "不限"} ~ ${capMax || "不限"}`);
      }
      if (industry && industry !== "不限制") {
        conditions.push(`產業：${industry}`);
      }
      if (peMin || peMax) {
        conditions.push(`本益比：${peMin || "不限"} ~ ${peMax || "不限"}`);
      }

      const conditionText = conditions.length > 0 ?
        `\n\n篩選條件：\n${conditions.join("\n")}` :
        "\n\n未設定篩選條件，將掃描全市場。";

      alert(`🔍 AI 正在掃描台股市場...${conditionText}\n\n此功能將分析財務指標、技術面、基本面等多維度資訊，找出被低估的潛力股票。`);
    });
  }

  // 初始化為個股模式
  switchMode("stock");
}