// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const IVA_RATE            = 0.21;
const EPA_RATE            = 0.00;
const MFN_RATE            = 0.10;
const FLUORINATED_GAS_TAX = 60;
const ITV_FEE_LOW         = 100;
const ITV_FEE_HIGH        = 100;
const DGT_FEE             = 99.77;
const TRANSLATION_COST    = 150;
const SUPPORTED_LANGS     = ["es", "en", "zh", "ja"];

// ─────────────────────────────────────────────────────────────────────────────
//  I18N
// ─────────────────────────────────────────────────────────────────────────────
let LANG = {};
let CURRENT_LANG = "es";

function detectLang() {
  const saved = localStorage.getItem("lang");
  if (saved && SUPPORTED_LANGS.includes(saved)) return saved;
  const browser = (navigator.language || navigator.userLanguage || "es")
    .toLowerCase().split("-")[0];
  return SUPPORTED_LANGS.includes(browser) ? browser : "es";
}

async function loadLang(code) {
  const res = await fetch(`lang/${code}.json`);
  if (!res.ok) throw new Error(`Could not load lang/${code}.json`);
  LANG = await res.json();
  CURRENT_LANG = code;
  localStorage.setItem("lang", code);
  document.documentElement.setAttribute("lang", code);
}

// Resolve a dot-notation key, e.g. t("calc.calcButton")
function t(key) {
  return key.split(".").reduce((obj, k) => obj && obj[k], LANG) || key;
}

// Resolve with {placeholder} interpolation
function ti(key, vars = {}) {
  let str = t(key);
  Object.entries(vars).forEach(([k, v]) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  });
  return str;
}

// Walk the DOM and apply all data-i18n* attributes
function applyLang() {
  // Plain text
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  // Inner HTML (for strings containing <strong>, <br/> etc.)
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    const key = el.getAttribute("data-i18n-html");
    el.innerHTML = t(key);
  });
  // Placeholders
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.setAttribute("placeholder", t(key));
  });
  // aria-label
  document.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    const key = el.getAttribute("data-i18n-aria-label");
    el.setAttribute("aria-label", t(key));
  });
  // Update active state on lang switcher buttons
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("lang-btn--active", btn.dataset.lang === CURRENT_LANG);
  });
  // Repopulate dynamic select placeholders
  const makeFirst = document.querySelector("#make option[value='']");
  if (makeFirst) makeFirst.textContent = t("calc.placeholderMake");
  const modelFirst = document.querySelector("#model option[value='']");
  if (modelFirst) modelFirst.textContent = t("calc.placeholderModel");
  const genFirst = document.querySelector("#generation option[value='']");
  if (genFirst) genFirst.textContent = t("calc.placeholderGeneration");
  // Update theme button aria-label
  const theme = document.documentElement.getAttribute("data-theme");
  const themeToggle = document.getElementById("theme-toggle");
  if (themeToggle) {
    themeToggle.setAttribute("aria-label", t(theme === "dark" ? "nav.ariaThemeLight" : "nav.ariaThemeDark"));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  TAX HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function getMatriculacionRate(co2) {
  if (co2 === null || co2 === undefined) return null;
  if (co2 < 120) return 0.00;
  if (co2 < 160) return 0.0475;
  if (co2 < 200) return 0.0975;
  return 0.1475;
}

function estimateCO2(vehicle) {
  if (vehicle.co2 !== null && vehicle.co2 !== undefined) return vehicle.co2;
  if (!vehicle.consumption || vehicle.consumption <= 0) return null;
  const fuel = (vehicle.fuelType || "").toLowerCase();
  let factor;
  if (fuel.includes("diesel"))                                   factor = 26.40;
  else if (fuel.includes("lpg"))                                 factor = 16.30;
  else if (fuel.includes("petrol") || fuel.includes("gasoline")) factor = 23.92;
  else if (fuel.includes("hybrid"))                              factor = 23.92;
  else return null;
  return Math.round(vehicle.consumption * factor);
}

function isHistorico(vehicle) {
  return (new Date().getFullYear() - vehicle.years[1]) >= 30;
}

function getAge(vehicle) {
  return new Date().getFullYear() - vehicle.years[1];
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEPRECIATION TABLE
// ─────────────────────────────────────────────────────────────────────────────
const DEPRECIATION = {
  0: 1.00, 1: 0.84, 2: 0.67, 3: 0.56, 4: 0.47, 5: 0.39,
  6: 0.34, 7: 0.28, 8: 0.24, 9: 0.19, 10: 0.17, 11: 0.13
};

function getDepreciation(ageYears) {
  if (ageYears <= 0)  return 1.00;
  if (ageYears >= 12) return 0.10;
  return DEPRECIATION[ageYears] ?? 0.10;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DATA FETCHING
// ─────────────────────────────────────────────────────────────────────────────
const DB_CACHE = {};

async function fetchBrand(make) {
  if (DB_CACHE[make]) return DB_CACHE[make];
  const res = await fetch(`db/${make.toLowerCase()}.json`);
  if (!res.ok) throw new Error(`No DB found for ${make}`);
  const data = await res.json();
  DB_CACHE[make] = data;
  return data;
}

async function fetchFiscalValue(make, model) {
  try {
    const params = new URLSearchParams({ make, model });
    const res    = await fetch(`https://fiscalvalue.spamshohen.workers.dev/fiscal?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.fiscalValue || null;
  } catch(e) {
    console.warn("Fiscal value worker unavailable:", e);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  CALCULATOR CORE
// ─────────────────────────────────────────────────────────────────────────────
function calculate(vehicle, purchasePrice, shippingCost, hasAC, useEPA, useExistingHomo, fiscalValue) {
  const v         = vehicle;
  const insurance = Math.round(purchasePrice * 0.005);
  const cif       = purchasePrice + shippingCost + insurance;
  const tariffRate = useEPA ? EPA_RATE : MFN_RATE;
  const tariff     = Math.round(cif * tariffRate);
  const iva        = Math.round((cif + tariff) * IVA_RATE);
  const fluorGas   = hasAC ? FLUORINATED_GAS_TAX : 0;
  const historico  = isHistorico(v);

  let homoLow, homoHigh, homoLabel;
  if (historico) {
    homoLow   = 150;  homoHigh = 400;
    homoLabel = t("results.homoHistoric");
  } else if (useExistingHomo) {
    homoLow   = 300;  homoHigh = 600;
    homoLabel = t("results.homoEquivalence");
  } else {
    homoLow   = 1500; homoHigh = 2000;
    homoLabel = t("results.homoIndividual");
  }

  const age            = getAge(v);
  const deprFactor     = getDepreciation(age);
  const hasFiscalValue = fiscalValue !== null && fiscalValue > 0;
  const fiscalBase     = hasFiscalValue ? fiscalValue * deprFactor : purchasePrice * deprFactor;
  const taxBase        = Math.max(purchasePrice, fiscalBase);
  const co2Estimated   = estimateCO2(v);
  const co2IsEstimate  = (v.co2 === null || v.co2 === undefined) && co2Estimated !== null;
  const matricRate     = getMatriculacionRate(co2Estimated);
  const matricTax      = matricRate === null ? null : Math.round(taxBase * matricRate);
  const matricForTotal = matricTax === null ? 0 : matricTax;
  const adaptationsLow  = 100;
  const adaptationsHigh = 500;

  const totalLow  = purchasePrice + shippingCost + tariff + iva + fluorGas
                  + homoLow  + ITV_FEE_LOW  + matricForTotal + DGT_FEE + TRANSLATION_COST + adaptationsLow;
  const totalHigh = purchasePrice + shippingCost + tariff + iva + fluorGas
                  + homoHigh + ITV_FEE_HIGH + matricForTotal + DGT_FEE + TRANSLATION_COST + adaptationsHigh;

  let matricLabel;
  if (matricRate === null)    matricLabel = t("results.matricUnknown");
  else if (matricRate === 0)  matricLabel = t("results.matricExempt");
  else                        matricLabel = ti("results.matricRate", { rate: (matricRate * 100).toFixed(2) });

  return {
    vehicle: v, historico, cif, insurance,
    tariffRate, tariff, iva, fluorGas,
    homoLow, homoHigh, homoLabel,
    matricRate, matricTax, matricForTotal,
    co2Estimated, co2IsEstimate,
    age, deprFactor, fiscalBase, taxBase, hasFiscalValue,
    adaptationsLow, adaptationsHigh,
    totalLow:        Math.round(totalLow),
    totalHigh:       Math.round(totalHigh),
    importCostsLow:  Math.round(totalLow  - purchasePrice),
    importCostsHigh: Math.round(totalHigh - purchasePrice),
    co2Band:         co2BandLabel(co2Estimated),
    matricLabel
  };
}

function co2BandLabel(co2) {
  if (co2 === null || co2 === undefined) return t("badge.co2Missing");
  if (co2 < 120) return "0 – 120 g/km (0%)";
  if (co2 < 160) return "120 – 160 g/km (4.75%)";
  if (co2 < 200) return "160 – 200 g/km (9.75%)";
  return "200+ g/km (14.75%)";
}

function formatEuro(n) {
  return "€" + Math.round(n).toLocaleString("es-ES");
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {

  // ── Language init ──────────────────────────────────────────────────────────
  const initialLang = detectLang();
  await loadLang(initialLang);
  applyLang();

  // ── Language switcher ──────────────────────────────────────────────────────
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.lang;
      if (code === CURRENT_LANG) return;
      await loadLang(code);
      applyLang();
      // Re-render results if visible, so they update immediately
      if (resultsDiv && resultsDiv.style.display !== "none" && resultsDiv.innerHTML.trim()) {
        const idx = generationSelect.value;
        if (idx) {
          const price = parseFloat(priceInput.value);
          if (!isNaN(price) && price > 0) {
            let v = currentVehicles[parseInt(idx)];
            const co2Override = document.getElementById("co2-override");
            if (co2Override && co2Override.value) {
              v = { ...v, co2: parseFloat(co2Override.value) };
            }
            const result = calculate(
              v, price,
              parseFloat(shippingInput.value) || 1800,
              acCheck.checked, epaCheck.checked, existingCheck.checked,
              parseFloat(fiscalInput.value) || 0
            );
            renderResults(result);
          }
        }
      }
    });
  });

  const makeSelect       = document.getElementById("make");
  const modelSelect      = document.getElementById("model");
  const generationSelect = document.getElementById("generation");
  const priceInput       = document.getElementById("purchase-price");
  const shippingInput    = document.getElementById("shipping-cost");
  const fiscalInput      = document.getElementById("fiscal-value");
  const acCheck          = document.getElementById("has-ac");
  const epaCheck         = document.getElementById("use-epa");
  const existingCheck    = document.getElementById("use-existing");
  const calcBtn          = document.getElementById("calc-btn");
  const resultsDiv       = document.getElementById("results");
  const existingRow      = document.getElementById("existing-homo-row");
  const vehicleBadge     = document.getElementById("vehicle-badge");

  // ── Theme ──────────────────────────────────────────────────────────────────
  const themeToggle = document.getElementById("theme-toggle");
  const savedTheme  = localStorage.getItem("theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeIcon(savedTheme);

  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next    = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateThemeIcon(next);
  });

  function updateThemeIcon(theme) {
    themeToggle.textContent = theme === "dark" ? "☀" : "☾";
    themeToggle.setAttribute("aria-label", t(theme === "dark" ? "nav.ariaThemeLight" : "nav.ariaThemeDark"));
  }

  // ── Vehicle data ───────────────────────────────────────────────────────────
  let currentVehicles = [];
  const MAKES = ["Acura","Aspark","Daihatsu","Datsun","Honda","Infiniti","Isuzu","Lexus","Mazda","Mitsubishi","Nissan","Subaru","Suzuki","Toyota"];
  MAKES.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m; opt.textContent = m;
    makeSelect.appendChild(opt);
  });

  // ── Make → Models ──────────────────────────────────────────────────────────
  makeSelect.addEventListener("change", async () => {
    const selectedMake = makeSelect.value;
    modelSelect.innerHTML      = `<option value="">${t("calc.placeholderModel")}</option>`;
    generationSelect.innerHTML = `<option value="">${t("calc.placeholderGeneration")}</option>`;
    modelSelect.disabled       = true;
    generationSelect.disabled  = true;
    existingRow.style.display  = "none";
    existingCheck.checked      = false;
    if (vehicleBadge) vehicleBadge.style.display = "none";
    if (!selectedMake) return;
    try {
      currentVehicles = await fetchBrand(selectedMake);
      const models = [...new Set(currentVehicles.map(v => v.model))].sort();
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m; opt.textContent = m;
        modelSelect.appendChild(opt);
      });
      modelSelect.disabled = false;
    } catch(e) {
      modelSelect.innerHTML = `<option value="">${t("calc.errorLoadingModels")}</option>`;
      console.error(e);
    }
  });

  // ── Model → Generations ────────────────────────────────────────────────────
  modelSelect.addEventListener("change", () => {
    const selectedModel = modelSelect.value;
    generationSelect.innerHTML = `<option value="">${t("calc.placeholderGeneration")}</option>`;
    generationSelect.disabled  = true;
    existingRow.style.display  = "none";
    existingCheck.checked      = false;
    if (vehicleBadge) vehicleBadge.style.display = "none";
    if (!selectedModel) return;
    const matching = currentVehicles.filter(v => v.model === selectedModel);
    matching.forEach(v => {
      const opt       = document.createElement("option");
      opt.value       = currentVehicles.indexOf(v);
      const genLabel  = v.generation || "";
      const varLabel  = v.variant    || "";
      const yearLabel = `${v.years[0]}–${v.years[1]}`;
      if (genLabel && varLabel)    opt.textContent = `${genLabel} · ${varLabel} (${yearLabel})`;
      else if (genLabel)           opt.textContent = `${genLabel} (${yearLabel})`;
      else if (varLabel)           opt.textContent = `${varLabel} (${yearLabel})`;
      else                         opt.textContent = yearLabel;
      generationSelect.appendChild(opt);
    });
    generationSelect.disabled = false;
    if (matching.length === 1) {
      generationSelect.selectedIndex = 1;
      generationSelect.dispatchEvent(new Event("change"));
    }
  });

  // ── Generation → Badge + Fiscal Value ─────────────────────────────────────
  generationSelect.addEventListener("change", () => {
    const idx = generationSelect.value;
    if (!idx) {
      existingRow.style.display = "none";
      if (vehicleBadge) vehicleBadge.style.display = "none";
      return;
    }
    const v    = currentVehicles[parseInt(idx)];
    const hist = isHistorico(v);
    existingRow.style.display = hist ? "none" : "flex";
    existingCheck.checked     = false;

    if (fiscalInput) {
      fiscalInput.disabled = false;
      if (v.fiscalValue) {
        fiscalInput.value       = v.fiscalValue;
        fiscalInput.placeholder = t("fiscalValue.loadedFromBOE");
      } else {
        fiscalInput.value       = "";
        fiscalInput.placeholder = t("fiscalValue.fetchingBOE");
        fetchFiscalValue(v.make, v.model).then(val => {
          if (val) {
            fiscalInput.value       = val;
            fiscalInput.placeholder = t("fiscalValue.fetchedFromBOE");
          } else {
            fiscalInput.placeholder = t("fiscalValue.notFound");
          }
        });
      }
    }

    updateVehicleBadge(v);

    const co2Row      = document.getElementById("co2-row");
    const co2Override = document.getElementById("co2-override");
    if (co2Row) {
      const co2Est = estimateCO2(v);
      co2Row.style.display = co2Est === null ? "flex" : "none";
      if (co2Override) co2Override.value = "";
    }
  });

  // ── Calculate button ───────────────────────────────────────────────────────
  calcBtn.addEventListener("click", () => {
    const idx = generationSelect.value;
    if (!idx) { alert(t("calc.alertSelectGen")); return; }
    const price = parseFloat(priceInput.value);
    if (isNaN(price) || price <= 0) { alert(t("calc.alertInvalidPrice")); return; }
    let v             = currentVehicles[parseInt(idx)];
    const fiscalValue = fiscalInput ? parseFloat(fiscalInput.value) || 0 : 0;
    const shipping    = parseFloat(shippingInput.value) || 1800;
    const co2Override = document.getElementById("co2-override");
    if (co2Override && co2Override.value) {
      v = { ...v, co2: parseFloat(co2Override.value) };
    }
    const result = calculate(
      v, price, shipping,
      acCheck.checked, epaCheck.checked, existingCheck.checked, fiscalValue
    );
    renderResults(result);
    resultsDiv.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ── Vehicle badge ──────────────────────────────────────────────────────────
  function updateVehicleBadge(v) {
    if (!vehicleBadge) return;
    const hist    = isHistorico(v);
    const age     = getAge(v);
    const tags    = [];

    if (hist) {
      tags.push(`<span class="tag tag--green">${t("badge.historic")}</span>`);
    } else {
      tags.push(`<span class="tag tag--blue">${t("badge.homoRequired")}</span>`);
      const yearsLeft = 30 - age;
      if (yearsLeft <= 5) {
        const key = yearsLeft === 1 ? "badge.historicIn" : "badge.historicInPlural";
        tags.push(`<span class="tag tag--amber">${ti(key, { n: yearsLeft })}</span>`);
      }
    }
    if (!hist) {
      tags.push(`<span class="tag tag--amber">${t("badge.existingCode")}</span>`);
    }

    const co2Est = estimateCO2(v);
    let co2Label;
    if (v.co2 !== null && v.co2 !== undefined) {
      co2Label = ti("badge.co2Official", { value: v.co2 });
    } else if (co2Est !== null) {
      co2Label = ti("badge.co2Estimated", { value: co2Est });
    } else {
      co2Label = t("badge.co2Missing");
    }

    const variantLine = v.variant ? `<p class="vehicle-note"><strong>${v.variant}</strong></p>` : "";
    vehicleBadge.innerHTML     = tags.join("")
      + variantLine
      + `<p class="vehicle-note">${v.notes}</p>`
      + `<p class="vehicle-note" style="margin-top:6px;color:var(--text-muted);font-size:.8rem">${co2Label}</p>`;
    vehicleBadge.style.display = "block";
  }

  // ── Render results ─────────────────────────────────────────────────────────
  function renderResults(r) {
    const v             = r.vehicle;
    const hist          = r.historico;
    const purchasePrice = parseFloat(priceInput.value);
    const shipping      = parseFloat(shippingInput.value) || 1800;

    let matricNote;
    if (r.matricTax === null) {
      matricNote = t("results.matricNoteNoData");
    } else {
      const co2Str  = `${r.co2Estimated} g/km${r.co2IsEstimate ? " (" + t("results.co2WarningTitle").replace("⚠ ", "").toLowerCase() + " — 10–30%)" : ""}`;
      const source  = r.hasFiscalValue ? t("results.matricSourceBOE") : t("results.matricSourcePurchase");
      matricNote    = ti("results.matricNote", {
        rate:  r.matricLabel,
        co2:   co2Str,
        base:  formatEuro(r.taxBase),
        source,
        depr:  Math.round(r.deprFactor * 100)
      });
    }

    const rows = [
      { label: t("results.rowPurchase"),    value: formatEuro(purchasePrice),                                             note: t("results.rowPurchaseNote"),    cat: "neutral" },
      { label: t("results.rowShipping"),    value: formatEuro(shipping),                                                  note: t("results.rowShippingNote"),    cat: "neutral" },
      { label: t("results.rowInsurance"),   value: formatEuro(r.insurance),                                               note: t("results.rowInsuranceNote"),   cat: "neutral" },
      { label: t("results.divider"),        value: "",                                                                    note: "",                               cat: "divider" },
      { label: t("results.rowTariff"),      value: formatEuro(r.tariff),                                                  note: r.tariffRate === 0 ? t("results.rowTariffEPA") : t("results.rowTariffMFN"), cat: "tax" },
      { label: t("results.rowVAT"),         value: formatEuro(r.iva),                                                     note: t("results.rowVATNote"),         cat: "tax"     },
      { label: t("results.rowFluorGas"),    value: r.fluorGas > 0 ? formatEuro(r.fluorGas) : t("results.rowFluorGasNA"), note: t("results.rowFluorGasNote"),    cat: "tax"     },
      { label: t("results.rowTranslation"), value: formatEuro(TRANSLATION_COST),                                          note: t("results.rowTranslationNote"), cat: "admin"   },
      { label: t("results.rowHomo"),        value: `${formatEuro(r.homoLow)} – ${formatEuro(r.homoHigh)}`,               note: r.homoLabel,                      cat: "homo"    },
      { label: t("results.rowITV"),         value: formatEuro(ITV_FEE_LOW),                                               note: t("results.rowITVNote"),         cat: "admin"   },
      { label: t("results.rowMatric"),      value: r.matricTax === null ? t("results.rowMatricNA") : formatEuro(r.matricTax), note: matricNote,                  cat: "tax"     },
      { label: t("results.rowDGT"),         value: formatEuro(DGT_FEE),                                                  note: t("results.rowDGTNote"),         cat: "admin"   },
      { label: t("results.rowAdaptations"), value: `${formatEuro(r.adaptationsLow)} – ${formatEuro(r.adaptationsHigh)}`, note: t("results.rowAdaptationsNote"), cat: "misc"    },
    ];

    const rowsHTML = rows.map(row => {
      if (row.cat === "divider") {
        return `<tr class="cost-row--divider"><td colspan="3">${row.label}</td></tr>`;
      }
      return `
        <tr class="cost-row--${row.cat}">
          <td class="cost-label">${row.label}</td>
          <td class="cost-value">${row.value}</td>
          <td class="cost-note">${row.note}</td>
        </tr>`;
    }).join("");

    const co2Warning = r.co2IsEstimate ? `
      <div class="warning-box" style="margin-top:0;margin-bottom:16px;border-color:rgba(201,168,76,.4);background:var(--gold-light)">
        <strong>${t("results.co2WarningTitle")}</strong>
        <p>${ti("results.co2WarningBody", { consumption: v.consumption })}</p>
      </div>` : "";

    resultsDiv.innerHTML = `
      <div class="results-header">
        <h2 class="results-title">${v.make} ${v.model}</h2>
        ${v.generation ? `<p class="results-generation">${v.generation}${v.variant ? " · " + v.variant : ""}</p>` : ""}
        <div class="results-badges">
          ${hist ? `<span class="tag tag--green">${t("results.tagHistoric")}</span>` : `<span class="tag tag--blue">${t("results.tagIndividual")}</span>`}
          ${(!hist && existingCheck.checked) ? `<span class="tag tag--amber">${t("results.tagExisting")}</span>` : ""}
        </div>
        <p class="results-note">${v.notes}</p>
      </div>
      ${co2Warning}
      <div class="cost-table-wrap">
        <table class="cost-table">
          <thead>
            <tr>
              <th>${t("results.tableHeadConcept")}</th>
              <th>${t("results.tableHeadCost")}</th>
              <th>${t("results.tableHeadDetail")}</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
        </table>
      </div>
      <div class="total-box">
        <div class="total-split">
          <div class="total-block">
            <div class="total-label">${t("results.totalPurchase")}</div>
            <div class="total-range total-range--neutral">${formatEuro(purchasePrice)}</div>
          </div>
          <div class="total-plus" aria-hidden="true">+</div>
          <div class="total-block">
            <div class="total-label">${t("results.totalImport")}</div>
            <div class="total-range total-range--import">${formatEuro(r.importCostsLow)} – ${formatEuro(r.importCostsHigh)}</div>
          </div>
          <div class="total-plus" aria-hidden="true">=</div>
          <div class="total-block">
            <div class="total-label">${t("results.totalEstimated")}</div>
            <div class="total-range">${formatEuro(r.totalLow)} – ${formatEuro(r.totalHigh)}</div>
          </div>
        </div>
        ${r.matricTax === null ? `<p style="font-size:.8rem;color:var(--tag-amber-text);margin-top:8px">${t("results.matricMissingWarning")}</p>` : ""}
        <p class="total-disclaimer">${t("results.disclaimer")}</p>
      </div>
      <div class="warning-box">
        <strong>${t("results.warningTitle")}</strong>
        <p>${t("results.warningBody")}</p>
      </div>
    `;
    resultsDiv.style.display = "block";
  }

  // ── Mobile nav ─────────────────────────────────────────────────────────────
  const navToggle = document.getElementById("nav-toggle");
  const navLinks  = document.getElementById("nav-links");
  if (navToggle && navLinks) {
    navToggle.addEventListener("click", () => {
      navLinks.classList.toggle("open");
    });
  }
});