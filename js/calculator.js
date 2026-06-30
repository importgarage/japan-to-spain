// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const IVA_RATE               = 0.21;
const EPA_RATE               = 0.00;
const MFN_RATE               = 0.10;
const FLUORINATED_GAS_TAX    = 60;
const ITV_FEE                = 130;
const DGT_FEE                = 99.77;
const PLATES_COST            = 30;
const SWORN_TRANSLATION_COST = 150;
const MARINE_INSURANCE_DEFAULT = 150;
const SUPPORTED_LANGS        = ["es", "en", "zh", "ja"];

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

function t(key) {
  return key.split(".").reduce((obj, k) => obj && obj[k], LANG) || key;
}

function ti(key, vars = {}) {
  let str = t(key);
  Object.entries(vars).forEach(([k, v]) => {
    str = str.replace(new RegExp(`\\{${k}\\}`, "g"), v);
  });
  return str;
}

function applyLang() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    el.innerHTML = t(el.getAttribute("data-i18n-html"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
  document.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
  });
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.classList.toggle("lang-btn--active", btn.dataset.lang === CURRENT_LANG);
  });
  const makeFirst = document.querySelector("#make option[value='']");
  if (makeFirst) makeFirst.textContent = t("calc.placeholderMake");
  const modelFirst = document.querySelector("#model option[value='']");
  if (modelFirst) modelFirst.textContent = t("calc.placeholderModel");
  const genFirst = document.querySelector("#generation option[value='']");
  if (genFirst) genFirst.textContent = t("calc.placeholderGeneration");
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
function calculate(vehicle, purchasePrice, auctionFee, inlandTransport, shippingCost, marineInsurance, portHandling, homoCost, hasAC, useEPA, useExistingHomo, fiscalValue, manufactureYear) {
  const v          = vehicle;
  const cif        = purchasePrice + auctionFee + inlandTransport + shippingCost + marineInsurance;
  const tariffRate = useEPA ? EPA_RATE : MFN_RATE;
  const tariff     = Math.round(cif * tariffRate);
  const iva        = Math.round((cif + tariff) * IVA_RATE);
  const fluorGas   = hasAC ? FLUORINATED_GAS_TAX : 0;
  const historico  = isHistorico(v);

  let homoLabel;
  if (historico)            homoLabel = t("results.homoHistoric");
  else if (useExistingHomo) homoLabel = t("results.homoEquivalence");
  else                      homoLabel = t("results.homoIndividual");

  const age            = (manufactureYear && manufactureYear > 0)
                           ? Math.max(0, new Date().getFullYear() - manufactureYear)
                           : getAge(v);
  const deprFactor     = getDepreciation(age);
  const deprPercent    = Math.round(deprFactor * 100);
  const hasFiscalValue = fiscalValue !== null && fiscalValue > 0;
  const fiscalBase     = hasFiscalValue ? fiscalValue : purchasePrice;
  const taxableBase    = Math.round(fiscalBase * deprFactor);
  const taxBase        = Math.max(purchasePrice, taxableBase);
  const co2Estimated   = estimateCO2(v);
  const co2IsEstimate  = (v.co2 === null || v.co2 === undefined) && co2Estimated !== null;
  const matricRate     = getMatriculacionRate(co2Estimated);
  const matricTax      = matricRate === null ? null : Math.round(taxBase * matricRate);
  const matricForTotal = matricTax === null ? 0 : matricTax;

  const total    = purchasePrice + auctionFee + inlandTransport + shippingCost + marineInsurance
                 + portHandling + tariff + iva + fluorGas
                 + homoCost + ITV_FEE + matricForTotal
                 + DGT_FEE + SWORN_TRANSLATION_COST + PLATES_COST;

  const delivery = total - purchasePrice - auctionFee;

  let matricLabel;
  if (matricRate === null)   matricLabel = t("results.matricUnknown");
  else if (matricRate === 0) matricLabel = t("results.matricExempt");
  else                       matricLabel = ti("results.matricRate", { rate: (matricRate * 100).toFixed(2) });

  return {
    vehicle: v, historico, cif,
    auctionFee, inlandTransport, shippingCost, marineInsurance, portHandling,
    tariffRate, tariff, iva, fluorGas,
    homoCost, homoLabel,
    matricRate, matricTax, matricForTotal,
    co2Estimated, co2IsEstimate,
    age, deprFactor, deprPercent,
    fiscalBase, taxableBase, taxBase, hasFiscalValue,
    total:    Math.round(total),
    delivery: Math.round(delivery),
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

function formatPercent(n) {
  return Math.round(n * 100) + "%";
}

// ─────────────────────────────────────────────────────────────────────────────
//  QUOTE TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────
function buildHomoTemplate(v, purchasePrice) {
  const generation = [v.generation, v.variant].filter(Boolean).join(" / ") || "—";
  const co2        = (v.co2 !== null && v.co2 !== undefined) ? `${v.co2} g/km` : "no disponible";
  const fuel       = v.fuelType || "—";
  const power      = v.power    ? `${v.power} CV` : "—";
  const cc         = v.cc       ? `${v.cc} cc`    : "—";

  return `Asunto: Consulta homologación vehículo japonés — ${v.make} ${v.model} ${v.years[1]}

Buenos días,

Me pongo en contacto para solicitar información sobre la homologación de un vehículo importado directamente de Japón con las siguientes características:

  Marca:                 ${v.make}
  Modelo:                ${v.model}
  Generación / Variante: ${generation}
  Año de fabricación:    ${v.years[1]}
  Motor:                 ${v.engine || "—"} — ${cc}
  Combustible:           ${fuel}
  Potencia:              ${power}
  CO₂ (g/km):            ${co2}
  Volante:               Derecha (JDM)

Mi primera consulta es si existe alguna contraseña de homologación por equivalencia para este vehículo en la base de datos del Ministerio de Industria, ya que sería la vía preferida antes de iniciar cualquier otro trámite.

En caso de que no exista equivalencia, le agradecería que me facilitara un presupuesto cerrado para homologación individual, indicando plazo estimado y si el vehículo debe desplazarse físicamente a sus instalaciones o si el proceso puede gestionarse de forma remota.

Quedo a su disposición para cualquier aclaración adicional.

Un saludo,
[NOMBRE]
[TELÉFONO / EMAIL]`;
}

function buildPortTemplate(v, purchasePrice) {
  const generation = [v.generation, v.variant].filter(Boolean).join(" / ") || "—";

  return `Asunto: Consulta gastos de puerto — ${v.make} ${v.model} ${v.years[1]}

Buenos días,

Me pongo en contacto para solicitar información sobre los gastos de despacho y puerto para un vehículo importado de Japón con las siguientes características:

  Marca:                 ${v.make}
  Modelo:                ${v.model}
  Generación / Variante: ${generation}
  Año de fabricación:    ${v.years[1]}
  Valor declarado:       €${Math.round(purchasePrice).toLocaleString("es-ES")}
  Método de envío:       [RoRo / Contenedor]
  Puerto de origen:      [OSAKA / NAGOYA / YOKOHAMA]
  Puerto de destino:     [PUERTO]
  Fecha estimada de llegada: [FECHA]

Le agradecería que me facilitara un presupuesto detallado que incluya:

  1. Gastos de descarga y manipulación en puerto
  2. Despacho aduanero (DUA)
  3. Almacenaje estimado
  4. Cualquier otro coste aplicable hasta la entrega del vehículo

Quedo a su disposición para cualquier aclaración.

Un saludo,
[NOMBRE]
[TELÉFONO / EMAIL]`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  UI
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {

  // ── Language init ──────────────────────────────────────────────────────────
  const initialLang = detectLang();
  await loadLang(initialLang);
  applyLang();

  // ── Helper to read all inputs and re-calculate ─────────────────────────────
  function getCurrentInputs() {
    const idx = generationSelect.value;
    if (!idx) return null;
    const price = parseFloat(priceInput.value);
    if (isNaN(price) || price <= 0) return null;
    let v = currentVehicles[parseInt(idx)];
    const co2Override = document.getElementById("co2-override");
    if (co2Override && co2Override.value) {
      v = { ...v, co2: parseFloat(co2Override.value) };
    }
    return {
      v,
      price,
      auctionFee:      parseFloat(document.getElementById("auction-fee")?.value)      || 0,
      inlandTransport: parseFloat(document.getElementById("inland-transport")?.value)  || 0,
      shipping:        parseFloat(shippingInput.value)                                 || 1800,
      marineInsurance: parseFloat(document.getElementById("marine-insurance")?.value)  || MARINE_INSURANCE_DEFAULT,
      portHandling:    parseFloat(document.getElementById("port-handling")?.value)     || 0,
      homoCost:        parseFloat(document.getElementById("homo-cost")?.value)         || 0,
      fiscalValue:     fiscalInput ? parseFloat(fiscalInput.value) || 0 : 0,
      manufactureYear: parseInt(document.getElementById("manufacture-year")?.value)    || 0,
    };
  }

  // ── Language switcher ──────────────────────────────────────────────────────
  document.querySelectorAll(".lang-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const code = btn.dataset.lang;
      if (code === CURRENT_LANG) return;
      await loadLang(code);
      applyLang();
      if (resultsDiv && resultsDiv.style.display !== "none" && resultsDiv.innerHTML.trim()) {
        const inputs = getCurrentInputs();
        if (inputs) {
          const result = calculate(
            inputs.v, inputs.price, inputs.auctionFee, inputs.inlandTransport,
            inputs.shipping, inputs.marineInsurance, inputs.portHandling, inputs.homoCost,
            acCheck.checked, epaCheck.checked, existingCheck.checked, inputs.fiscalValue,
            inputs.manufactureYear
          );
          renderResults(result);
        }
      }
    });
  });

  const makeSelect       = document.getElementById("make");
  const modelSelect      = document.getElementById("model");
  const yearInput        = document.getElementById("manufacture-year");
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
  const yearRow          = document.getElementById("year-row");

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
  let currentModel    = null;
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
    if (yearRow) yearRow.style.display = "none";
    existingRow.style.display  = "none";
    existingCheck.checked      = false;
    currentModel               = null;
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

  // ── Model → show year input ────────────────────────────────────────────────
  modelSelect.addEventListener("change", () => {
    currentModel = modelSelect.value;
    generationSelect.innerHTML = `<option value="">${t("calc.placeholderGeneration")}</option>`;
    generationSelect.disabled  = true;
    existingRow.style.display  = "none";
    existingCheck.checked      = false;
    if (vehicleBadge) vehicleBadge.style.display = "none";
    if (!currentModel) {
      if (yearRow) yearRow.style.display = "none";
      return;
    }
    // Show year input and clear it
    if (yearRow) yearRow.style.display = "flex";
    if (yearInput) yearInput.value = "";
  });

  // ── Year input → filter generations ───────────────────────────────────────
  function populateGenerations() {
    if (!currentModel) return;
    const yearVal = parseInt(yearInput?.value);
    generationSelect.innerHTML = `<option value="">${t("calc.placeholderGeneration")}</option>`;
    generationSelect.disabled  = true;
    existingRow.style.display  = "none";
    existingCheck.checked      = false;
    if (vehicleBadge) vehicleBadge.style.display = "none";

    // Require a valid 4-digit year
    if (!yearVal || yearVal < 1900 || yearVal > new Date().getFullYear()) return;

    const matching = currentVehicles.filter(v =>
      v.model === currentModel &&
      yearVal >= v.years[0] &&
      yearVal <= v.years[1]
    );

    if (matching.length === 0) return;

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
  }

  if (yearInput) {
    yearInput.addEventListener("input", populateGenerations);
  }

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
    const inputs = getCurrentInputs();
    if (!inputs) { alert(t("calc.alertInvalidPrice")); return; }
    const result = calculate(
      inputs.v, inputs.price, inputs.auctionFee, inputs.inlandTransport,
      inputs.shipping, inputs.marineInsurance, inputs.portHandling, inputs.homoCost,
      acCheck.checked, epaCheck.checked, existingCheck.checked, inputs.fiscalValue,
      inputs.manufactureYear
    );
    renderResults(result);
    resultsDiv.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ── Vehicle badge ──────────────────────────────────────────────────────────
  function updateVehicleBadge(v) {
    if (!vehicleBadge) return;
    const hist = isHistorico(v);
    const age  = getAge(v);
    const tags = [];

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
    vehicleBadge.innerHTML =
      tags.join("")
      + variantLine
      + `<p class="vehicle-note">${v.notes}</p>`
      + `<p class="vehicle-note" style="margin-top:6px;color:var(--text-muted);font-size:.8rem">${co2Label}</p>`;
    vehicleBadge.style.display = "block";
  }

  // ── Clipboard helper ───────────────────────────────────────────────────────
  function copyToClipboard(text, btnEl) {
    const finish = () => {
      const original = btnEl.dataset.originalText || btnEl.textContent;
      btnEl.dataset.originalText = original;
      btnEl.textContent = t("results.quoteCopied");
      btnEl.disabled = true;
      setTimeout(() => {
        btnEl.textContent = original;
        btnEl.disabled = false;
      }, 2000);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(finish).catch(() => fallbackCopy(text, finish));
    } else {
      fallbackCopy(text, finish);
    }
  }

  function fallbackCopy(text, callback) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity  = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    callback();
  }

  // ── Render results ─────────────────────────────────────────────────────────
  function renderResults(r) {
    const v             = r.vehicle;
    const hist          = r.historico;
    const purchasePrice = parseFloat(priceInput.value);

    const rows = [
      // ── Japan costs ──
      { label: t("results.rowPurchase"),        value: formatEuro(purchasePrice),                                              note: t("results.rowPurchaseNote"),        cat: "neutral" },
      { label: t("results.rowAuctionFee"),       value: r.auctionFee > 0 ? formatEuro(r.auctionFee) : "—",                    note: t("results.rowAuctionFeeNote"),      cat: "neutral" },
      { label: t("results.rowInlandTransport"),  value: r.inlandTransport > 0 ? formatEuro(r.inlandTransport) : "—",          note: t("results.rowInlandTransportNote"), cat: "neutral" },
      { label: t("results.rowShipping"),         value: formatEuro(r.shippingCost),                                            note: t("results.rowShippingNote"),        cat: "neutral" },
      { label: t("results.rowInsurance"),        value: formatEuro(r.marineInsurance),                                         note: t("results.rowInsuranceNote"),       cat: "neutral" },
      { label: t("results.rowCIF"),              value: formatEuro(r.cif),                                                     note: t("results.rowCIFNote"),             cat: "neutral" },
      { label: t("results.rowPortHandling"),     value: r.portHandling > 0 ? formatEuro(r.portHandling) : "—",                note: t("results.rowPortHandlingNote"),    cat: "neutral" },
      // ── Import taxes ──
      { label: t("results.dividerImport"),       value: "",                                                                    note: "",                                  cat: "divider" },
      { label: t("results.rowTariff"),           value: formatEuro(r.tariff),                                                  note: r.tariffRate === 0 ? t("results.rowTariffEPA") : t("results.rowTariffMFN"), cat: "tax" },
      { label: t("results.rowVAT"),              value: formatEuro(r.iva),                                                     note: t("results.rowVATNote"),             cat: "tax"     },
      { label: t("results.rowFluorGas"),         value: r.fluorGas > 0 ? formatEuro(r.fluorGas) : t("results.rowFluorGasNA"), note: t("results.rowFluorGasNote"),        cat: "tax"     },
      { label: t("results.rowTranslation"),      value: formatEuro(SWORN_TRANSLATION_COST),                                    note: t("results.rowTranslationNote"),     cat: "admin"   },
      // ── Arrival / registration ──
      { label: t("results.dividerArrival"),      value: "",                                                                    note: "",                                  cat: "divider" },
      { label: t("results.rowFiscalValue"),      value: r.hasFiscalValue ? formatEuro(r.fiscalBase) : t("results.rowFiscalValueNA"), note: t("results.rowFiscalValueNote"), cat: "admin" },
      { label: t("results.rowDeprCoeff"),        value: formatPercent(r.deprFactor),                                           note: ti("results.rowDeprCoeffNote", { age: r.age }), cat: "admin" },
      { label: t("results.rowTaxableBase"),      value: formatEuro(r.taxableBase),                                             note: t("results.rowTaxableBaseNote"),     cat: "admin"   },
      { label: t("results.rowMatric"),           value: r.matricTax === null ? t("results.rowMatricNA") : formatEuro(r.matricTax), note: r.matricTax === null ? t("results.matricNoteNoData") : ti("results.matricNote", { rate: r.matricLabel, co2: `${r.co2Estimated} g/km${r.co2IsEstimate ? " (estimado)" : ""}` }), cat: "tax" },
      { label: t("results.rowHomo"),             value: r.homoCost > 0 ? formatEuro(r.homoCost) : "—",                        note: r.homoLabel,                         cat: "homo"    },
      { label: t("results.rowITV"),              value: formatEuro(ITV_FEE),                                                   note: t("results.rowITVNote"),             cat: "admin"   },
      { label: t("results.rowDGT"),              value: formatEuro(DGT_FEE),                                                   note: t("results.rowDGTNote"),             cat: "admin"   },
      { label: t("results.rowPlates"),           value: formatEuro(PLATES_COST),                                               note: t("results.rowPlatesNote"),          cat: "admin"   },
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

    const homoWarning = r.homoCost === 0 ? `
      <p style="font-size:.8rem;color:var(--tag-amber-text);margin-top:8px">${t("results.homoMissingWarning")}</p>` : "";

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
            <div class="total-label">${t("results.totalDelivery")}</div>
            <div class="total-range total-range--import">${formatEuro(r.delivery)}</div>
          </div>
          <div class="total-plus" aria-hidden="true">=</div>
          <div class="total-block">
            <div class="total-label">${t("results.totalEstimated")}</div>
            <div class="total-range">${formatEuro(r.total)}</div>
          </div>
        </div>
        ${r.matricTax === null ? `<p style="font-size:.8rem;color:var(--tag-amber-text);margin-top:8px">${t("results.matricMissingWarning")}</p>` : ""}
        ${homoWarning}
        <p class="total-disclaimer">${t("results.disclaimer")}</p>
      </div>
      <div class="quote-section">
        <h3 class="quote-section__title">${t("results.quoteTitle")}</h3>
        <p class="quote-section__desc">${t("results.quoteDesc")}</p>
        <div class="quote-section__buttons">
          <button class="btn-quote" id="btn-copy-homo" type="button">${t("results.quoteCopyHomo")}</button>
          <button class="btn-quote" id="btn-copy-port" type="button">${t("results.quoteCopyPort")}</button>
        </div>
      </div>
      <div class="warning-box">
        <strong>${t("results.warningTitle")}</strong>
        <p>${t("results.warningBody")}</p>
      </div>
    `;
    resultsDiv.style.display = "block";

    const btnHomo = document.getElementById("btn-copy-homo");
    const btnPort = document.getElementById("btn-copy-port");
    if (btnHomo) btnHomo.addEventListener("click", () => copyToClipboard(buildHomoTemplate(v, purchasePrice), btnHomo));
    if (btnPort) btnPort.addEventListener("click", () => copyToClipboard(buildPortTemplate(v, purchasePrice), btnPort));
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