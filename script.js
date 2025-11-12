/* Get references to DOM elements */
// Replace eager element lookups with lazy variables so we can initialize after DOM is ready.
let categoryFilter;
let productsContainer;
let chatForm;
let chatWindow;

// Keep track of selected products using a Set for fast add/remove checks
const selectedProductIds = new Set();

// Cache all products after loading so we can show details when clicked
let allProductsCache = null;

// NEW: live search input element (initialized in init)
let searchInput;

// Inject minimal CSS for modal and highlighted state so no stylesheet edits are required.
(function injectPopupStyles() {
  const css = `
    .product-card.highlighted { box-shadow: 0 0 0 3px rgba(255,200,0,0.95); transform: translateY(-6px); transition: transform 0.12s, box-shadow 0.12s; z-index: 20; position: relative; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:1000; }
    .modal { background:#fff; border-radius:8px; padding:16px; max-width:420px; width:90%; box-shadow:0 10px 30px rgba(0,0,0,0.2); }
    .modal img { max-width:100%; height:auto; display:block; margin-bottom:12px; border-radius:6px; }
    .modal .meta { margin-bottom:12px; color:#333; }
    .modal .close { background:#111;color:#fff;border:none;padding:8px 12px;border-radius:6px;cursor:pointer; }
    /* Make product cards visibly clickable */
    .product-card { cursor: pointer; }
  `;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);
})();

/* Load product data from JSON file */
async function loadProducts() {
  if (allProductsCache) return allProductsCache;
  const response = await fetch("products.json");
  const data = await response.json();
  allProductsCache = data.products;
  return allProductsCache;
}

/* Create HTML for displaying product cards */
function displayProducts(products) {
  // Render each card and include a data attribute for the product id.
  // If a product is selected, add the 'selected' class so it shows visually.
  productsContainer.innerHTML = products
    .map((product) => {
      const pid = product.id ?? product.name;
      const selectedClass = selectedProductIds.has(pid) ? "selected" : "";
      const ariaPressed = selectedProductIds.has(pid) ? "true" : "false";
      // Add an accessible info button and an initially hidden description block inside the card.
      // The description now includes a close button and a wrapper so the expanded state can overlay the whole card.
      return `
    <div class="product-card ${selectedClass}" data-product-id="${pid}" role="button" tabindex="0" aria-pressed="${ariaPressed}">
      <img src="${product.image}" alt="${product.name}">
      <div class="product-info">
        <h3>${product.name}</h3>
        <p>${product.brand}</p>
        <button class="info-btn" aria-expanded="false" aria-controls="desc-${pid}" title="Show details">Details</button>
        <div id="desc-${pid}" class="product-desc" aria-hidden="true" tabindex="-1">
          <button class="desc-close" aria-label="Hide details">✕</button>
          <div class="desc-content">
            ${
              product.description
                ? `${product.description}`
                : "<em>No description available.</em>"
            }
          </div>
        </div>
      </div>
    </div>
  `;
    })
    .join("");
}

/* Remove any existing highlight from cards */
function clearHighlights() {
  const prev = productsContainer.querySelector(".product-card.highlighted");
  if (prev) prev.classList.remove("highlighted");
}

// --- New helper to close any existing modal reliably ---
function closeExistingModal() {
  const existing = document.getElementById("product-modal-overlay");
  if (!existing) return;
  // If the overlay stored a close function, call it so attached listeners are removed cleanly.
  if (typeof existing._close === "function") {
    try {
      existing._close();
    } catch (e) {
      existing.remove();
    }
  } else {
    existing.remove();
  }
}

// Create and show modal popup for a product. Keeps only one modal at a time.
function showProductModal(product, card) {
  clearHighlights();
  // Add highlight to the clicked card
  card.classList.add("highlighted");

  // If modal already exists, remove it so we recreate with updated content.
  const existing = document.getElementById("product-modal-overlay");
  if (existing) existing.remove();

  // Build overlay and modal elements
  const overlay = document.createElement("div");
  overlay.id = "product-modal-overlay";
  overlay.className = "modal-overlay";
  overlay.tabIndex = -1;

  // Ensure overlay/modal inherit the page direction for RTL support
  const pageDir =
    document.documentElement.getAttribute("dir") ||
    document.body.getAttribute("dir") ||
    "ltr";
  overlay.dir = pageDir;

  const modal = document.createElement("div");
  modal.className = "modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    ${product.image ? `<img src="${product.image}" alt="${product.name}">` : ""}
    <div class="meta">
      <h3>${product.name}</h3>
      <div>${product.brand || ""}</div>
      ${product.description ? `<p>${product.description}</p>` : ""}
    </div>
    <div style="text-align:right;">
      <button class="close" aria-label="Close popup">Close</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Focus management
  const closeBtn = modal.querySelector(".close");
  closeBtn.focus();

  // Close handlers: button, overlay click (outside modal), Escape key
  function closeModal() {
    overlay.remove();
    card.classList.remove("highlighted");
    document.removeEventListener("keydown", escHandler);
  }
  // store a reference so external code can close the modal cleanly
  overlay._close = closeModal;

  closeBtn.addEventListener("click", closeModal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal();
  });
  function escHandler(e) {
    if (e.key === "Escape") closeModal();
  }
  document.addEventListener("keydown", escHandler);
}

// --- New helper: return array of selected product data (minimal fields) ---
function getSelectedProductsData() {
  const products = allProductsCache || [];
  const selected = [];
  for (const id of selectedProductIds) {
    const p = products.find((it) => String(it.id ?? it.name) === String(id));
    if (!p) continue;
    selected.push({
      id: p.id ?? null,
      name: p.name,
      brand: p.brand,
      category: p.category,
      description: p.description || "",
    });
  }
  return selected;
}

// --- New: persistence helpers and selected-list rendering ---
function saveSelectedToStorage() {
  try {
    localStorage.setItem(
      "selectedProductIds",
      JSON.stringify(Array.from(selectedProductIds))
    );
  } catch (e) {
    console.warn("saveSelectedToStorage failed", e);
  }
}

function loadSelectedFromStorage() {
  try {
    const raw = localStorage.getItem("selectedProductIds");
    if (!raw) return;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const id of arr) selectedProductIds.add(String(id));
    }
  } catch (e) {
    console.warn("loadSelectedFromStorage failed", e);
  }
}

// small helper to escape user-visible text
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSelectedProductsList() {
  if (!selectedProductsList) return;
  selectedProductsList.innerHTML = "";

  if (!selectedProductIds.size) {
    selectedProductsList.innerHTML = `<div class="placeholder-message">No selected products.</div>`;
    const cb = document.getElementById("clearSelections");
    if (cb) cb.style.display = "none";
    return;
  }

  const frag = document.createDocumentFragment();
  const products = allProductsCache || [];

  for (const id of selectedProductIds) {
    const p = products.find((x) => String(x.id ?? x.name) === String(id));
    const name = p ? p.name : id;
    const item = document.createElement("div");
    item.className = "selected-item";
    item.dataset.id = id;
    item.innerHTML = `
      <div class="sel-name">${escapeHtml(name)}</div>
      <button class="remove-item" data-id="${escapeHtml(id)}">Remove</button>
    `;
    frag.appendChild(item);
  }

  selectedProductsList.appendChild(frag);

  // ensure a Clear All button exists
  let clearBtn = document.getElementById("clearSelections");
  if (!clearBtn) {
    clearBtn = document.createElement("button");
    clearBtn.id = "clearSelections";
    clearBtn.textContent = "Clear all";
    clearBtn.className = "remove-item clear-all";
    // place after the list
    if (selectedProductsList.parentNode) {
      selectedProductsList.parentNode.insertBefore(
        clearBtn,
        selectedProductsList.nextSibling
      );
    } else {
      document.body.appendChild(clearBtn);
    }
    clearBtn.addEventListener("click", () => {
      selectedProductIds.clear();
      saveSelectedToStorage();
      renderSelectedProductsList();
      // update any visible cards
      const cards = document.querySelectorAll(".product-card.selected");
      cards.forEach((c) => {
        c.classList.remove("selected");
        c.setAttribute("aria-pressed", "false");
      });
    });
  }
  clearBtn.style.display = "inline-block";
}

// Handle remove clicks inside the selected-products list (delegated)
function wireSelectedListHandlers() {
  if (!selectedProductsList) return;
  selectedProductsList.addEventListener("click", (e) => {
    const btn = e.target.closest(".remove-item");
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;
    // Remove from set, persist, update UI and cards
    selectedProductIds.delete(String(id));
    saveSelectedToStorage();
    renderSelectedProductsList();
    const card = document.querySelector(
      `.product-card[data-product-id="${CSS.escape(id)}"]`
    );
    if (card) {
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    }
  });
}

// NEW: simple local routine builder used when no API key is available
function buildLocalRoutine(products) {
  // Beginner-friendly ordering of typical skincare steps
  const order = [
    "cleanser",
    "exfoliant",
    "toner",
    "essence",
    "serum",
    "eye",
    "moisturizer",
    "oil",
    "sunscreen",
  ];
  // Group products by normalized category
  const buckets = {};
  for (const p of products) {
    const cat = String(p.category || "other")
      .trim()
      .toLowerCase();
    if (!buckets[cat]) buckets[cat] = [];
    buckets[cat].push(p);
  }

  // Build ordered steps
  const steps = [];
  for (const cat of order) {
    const list = buckets[cat];
    if (!list || !list.length) continue;
    for (const prod of list) {
      steps.push({
        cat,
        name: prod.name,
        reason: `Use ${prod.name} (${prod.brand || "brand"}) as a ${cat}.`,
      });
    }
    // remove handled category
    delete buckets[cat];
  }

  // Append any remaining categories (in no particular order)
  for (const cat of Object.keys(buckets)) {
    for (const prod of buckets[cat]) {
      steps.push({
        cat,
        name: prod.name,
        reason: `Use ${prod.name} (${
          prod.brand || "brand"
        }) in the ${cat} step.`,
      });
    }
  }

  // Format plain-text routine
  if (!steps.length) return "No products selected to build a routine.";
  const lines = ["Recommended routine based on selected products:", ""];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.name} — ${s.reason}`);
  });
  lines.push(
    "",
    "Short precautions: Patch test new products and avoid mixing strong actives."
  );
  return lines.join("\n");
}

// --- New helper: generate routine using OpenAI chat completions ---
async function generateRoutine() {
  // safely check presence of API key from window to avoid ReferenceError
  const hasKey = typeof window !== "undefined" && !!window.OPENAI_API_KEY;
  console.debug("generateRoutine() called", {
    selectedCount: selectedProductIds.size,
    selectedIds: Array.from(selectedProductIds),
    hasCache: !!allProductsCache,
    apiKeyPresent: hasKey,
  });

  if (!chatWindow) {
    console.error("generateRoutine: chatWindow not found");
    return;
  }
  const selected = getSelectedProductsData();
  if (!selected.length) {
    chatWindow.innerHTML =
      "<div>Please select at least one product before generating a routine.</div>";
    return;
  }

  // Look for an API key exposed by secrets.js (window.OPENAI_API_KEY)
  const apiKey = (typeof window !== "undefined" && window.OPENAI_API_KEY) || "";
  if (!apiKey) {
    // Local fallback: build and display a simple routine derived from the selected products
    console.warn(
      "generateRoutine: window.OPENAI_API_KEY not found, using local routine generator. To enable remote AI, expose your key like: window.OPENAI_API_KEY = 'sk-...' in secrets.js"
    );
    const localText = buildLocalRoutine(selected);
    chatWindow.innerHTML = `<div style="white-space:pre-wrap">${localText}</div>`;
    return;
  }

  // Show loading state
  chatWindow.innerHTML = "<div>Generating routine…</div>";

  // Build messages: system + user. Include the selected products JSON in the user message.
  const systemMsg =
    "You are a helpful skincare and product routine assistant. Given a list of selected products, generate a clear, step-by-step routine (order of use, brief reasoning) and any short precautions. Keep the response concise and user-friendly.";
  const userPayload = { products: selected };
  const userMsg = `Here are the selected products (JSON). Create a personalized routine using only these products.\n\n${JSON.stringify(
    userPayload,
    null,
    2
  )}\n\nReturn the routine as plain text suitable for showing to the user.`;

  try {
    const res = await fetch("https://spring-shape-150c.adebiyav.workers.dev/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: userMsg },
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error(
        "generateRoutine: API returned non-OK",
        res.status,
        res.statusText,
        text
      );
      chatWindow.innerHTML = `<div>API error: ${res.status} ${res.statusText}<pre style="white-space:pre-wrap">${text}</pre></div>`;
      return;
    }

    const data = await res.json();
    console.debug("generateRoutine: API response", data);
    const aiText =
      data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? null;
    if (!aiText) {
      chatWindow.innerHTML = "<div>No response from the API.</div>";
      return;
    }
    chatWindow.innerHTML = `<div style="white-space:pre-wrap">${aiText}</div>`;
  } catch (err) {
    console.error("generateRoutine: request failed", err);
    chatWindow.innerHTML = `<div>Request failed: ${err.message}</div>`;
  }
}

// --- New: initialize DOM-dependent things after DOMContentLoaded ---
function init() {
  // get DOM elements now that the document is ready
  categoryFilter = document.getElementById("categoryFilter");
  productsContainer = document.getElementById("productsContainer");
  chatForm = document.getElementById("chatForm");
  chatWindow = document.getElementById("chatWindow");
  // get selected-products list & generate button
  selectedProductsList = document.getElementById("selectedProductsList");
  let generateRoutineBtn = document.getElementById("generateRoutine");

  // Load persisted selection before rendering products so selected classes are applied
  loadSelectedFromStorage();

  // NEW: try to find an existing search input; if not found, create one.
  searchInput = document.getElementById("searchInput");
  if (!searchInput) {
    // Create a simple search field for beginners (no external libs)
    searchInput = document.createElement("input");
    searchInput.id = "searchInput";
    searchInput.type = "search";
    searchInput.placeholder = "Search products by name, brand, or keyword...";
    searchInput.setAttribute("aria-label", "Search products");

    // Ensure the new input follows the page text direction (RTL support)
    // Use document.documentElement.dir (html[dir]) or fallback to body.dir
    searchInput.dir =
      document.documentElement.getAttribute("dir") ||
      document.body.getAttribute("dir") ||
      "ltr";

    // Insert it near the category filter if possible, otherwise before the products container.
    if (categoryFilter && categoryFilter.parentNode) {
      categoryFilter.parentNode.insertBefore(
        searchInput,
        categoryFilter.nextSibling
      );
    } else if (productsContainer && productsContainer.parentNode) {
      productsContainer.parentNode.insertBefore(searchInput, productsContainer);
    } else {
      // fallback: append to body
      document.body.insertBefore(searchInput, document.body.firstChild);
    }
  }

  // Show initial placeholder until user selects a category
  if (productsContainer) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        Select a category to view products
      </div>
    `;
  }

  // NEW helper: apply both category + search filters and render results
  async function applyFilters() {
    // Close open modal and clear highlights when filters change
    closeExistingModal();
    clearHighlights();

    const products = await loadProducts();
    let filtered = products.slice(); // copy

    // If a category is selected, filter by it
    let selectedCategory = categoryFilter
      ? String(categoryFilter.value || "")
      : "";
    // If the selected value looks like a leftover templating placeholder (e.g. "#sym:categoryFilter")
    // try to normalize it: prefer the option's visible text when available, otherwise strip known prefixes.
    if (selectedCategory && /^#|:/.test(selectedCategory)) {
      const selOpt =
        categoryFilter &&
        categoryFilter.selectedOptions &&
        categoryFilter.selectedOptions[0];
      if (selOpt && selOpt.textContent.trim()) {
        console.warn(
          "Normalizing category from templated value to option text:",
          selectedCategory,
          "→",
          selOpt.textContent.trim()
        );
        selectedCategory = selOpt.textContent.trim();
      } else {
        // fallback: strip common templating prefix like "#sym:" or "#var:"
        const stripped = selectedCategory.replace(/^#\w+:/, "").trim();
        console.warn(
          "Stripping templating prefix from category value:",
          selectedCategory,
          "→",
          stripped
        );
        selectedCategory = stripped;
      }
    }

    // Debug: list available product categories (helps find mismatches)
    try {
      const available = Array.from(
        new Set(
          products.map((p) => String(p.category || "").trim()).filter(Boolean)
        )
      );
      console.debug(
        "applyFilters() - selectedCategory:",
        selectedCategory,
        "available product categories:",
        available
      );
    } catch (e) {
      console.debug(
        "applyFilters() - could not compute available categories",
        e
      );
    }

    if (selectedCategory) {
      filtered = filtered.filter((p) => {
        // normalize both sides to compare reliably
        const pc = String(p.category || "")
          .trim()
          .toLowerCase();
        return pc === selectedCategory.trim().toLowerCase();
      });
    }

    // If there's a search term, filter by name/brand/description/category
    const q = searchInput
      ? String(searchInput.value || "")
          .trim()
          .toLowerCase()
      : "";
    if (q) {
      filtered = filtered.filter((p) => {
        const fields = [
          p.name || "",
          p.brand || "",
          p.description || "",
          p.category || "",
        ]
          .join(" ")
          .toLowerCase();
        return fields.includes(q);
      });
    }

    // Guard: ensure we have a productsContainer to render into
    if (!productsContainer) {
      console.error(
        "applyFilters(): productsContainer not found in DOM. Cannot render products."
      );
      return;
    }

    // If no category selected and no query, show placeholder instead of all products
    if (!selectedCategory && !q) {
      productsContainer.innerHTML = `
        <div class="placeholder-message">
          Select a category to view products
        </div>
      `;
      return;
    }

    // If no results, show a friendly message
    if (!filtered.length) {
      productsContainer.innerHTML = `
        <div class="placeholder-message">
          No products match your search.
        </div>
      `;
      // Extra debug output so you can inspect why nothing matched
      console.debug(
        "applyFilters() - filtered result is empty. selectedCategory:",
        selectedCategory,
        "query:",
        q,
        "product count:",
        products.length
      );
      return;
    }

    // Render matching products
    displayProducts(filtered);
  }

  // Attach the category change handler (safe because categoryFilter now exists)
  if (categoryFilter) {
    categoryFilter.addEventListener("change", async (e) => {
      // Use the shared filter function so category + search combine
      await applyFilters();
    });
  }

  // Attach the search input handler for live filtering
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      // No need to await here; we can kick off the filter asynchronously
      applyFilters();
    });
  }

  // Chat form submission handler
  if (chatForm) {
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (chatWindow)
        chatWindow.innerHTML = "Connect to the OpenAI API for a response!";
    });
  }

  // Document-level click handler (delegation), safe to attach now
  document.addEventListener("click", async (event) => {
    // If the user clicked the inline description close button, collapse the overlay.
    const descClose = event.target.closest(".desc-close");
    if (descClose) {
      event.stopPropagation();
      const card = descClose.closest(".product-card");
      if (!card) return;
      const infoBtn = card.querySelector(".info-btn");
      if (!infoBtn) return;
      const descId = infoBtn.getAttribute("aria-controls");
      const descEl = card.querySelector(`#${CSS.escape(descId)}`);
      if (descEl) {
        infoBtn.setAttribute("aria-expanded", "false");
        descEl.setAttribute("aria-hidden", "true");
        descEl.classList.remove("expanded");
      }
      return;
    }

    // If the user clicked the info button, toggle inline description and stop propagation.
    const infoBtn = event.target.closest(".info-btn");
    if (infoBtn) {
      // prevent the card click handler from toggling selection / opening modal
      event.stopPropagation();
      const card = infoBtn.closest(".product-card");
      if (!card) return;

      const descId = infoBtn.getAttribute("aria-controls");
      const descEl = card.querySelector(`#${CSS.escape(descId)}`);
      const expanded = infoBtn.getAttribute("aria-expanded") === "true";

      if (descEl) {
        if (expanded) {
          infoBtn.setAttribute("aria-expanded", "false");
          descEl.setAttribute("aria-hidden", "true");
          descEl.classList.remove("expanded");
        } else {
          infoBtn.setAttribute("aria-expanded", "true");
          descEl.setAttribute("aria-hidden", "false");
          descEl.classList.add("expanded");
        }
      }
      return;
    }

    const card = event.target.closest(".product-card");
    if (!card) return;
    if (!productsContainer || !productsContainer.contains(card)) return;

    const pid = card.dataset.productId;
    if (!pid) return;

    if (selectedProductIds.has(pid)) {
      selectedProductIds.delete(pid);
      card.classList.remove("selected");
      card.setAttribute("aria-pressed", "false");
    } else {
      selectedProductIds.add(pid);
      card.classList.add("selected");
      card.setAttribute("aria-pressed", "true");
    }

    // persist and update the selected list UI
    saveSelectedToStorage();
    renderSelectedProductsList();

    const products = await loadProducts();
    const product = products.find((p) => (p.id ?? p.name) === pid);
    if (product) {
      // Open the modal for the selected product
      showProductModal(product, card);
    }
  });

  // Robust wiring for the Generate Routine control
  (function wireGenerateRoutine() {
    // Try primary element first
    if (!generateRoutineBtn) {
      // Fallback: find by id substring or data-action attribute
      generateRoutineBtn = document.querySelector(
        "[id*='generateRoutine'], [data-action='generateRoutine']"
      );
    }

    if (generateRoutineBtn) {
      generateRoutineBtn.addEventListener("click", (e) => {
        e.preventDefault();
        generateRoutine();
      });
      return;
    }

    // Final fallback: delegated listener to catch templated links/buttons like href="#sym:generateRoutine"
    document.addEventListener("click", (e) => {
      const el = e.target.closest("a, button");
      if (!el) return;
      const href = el.getAttribute("href") || "";
      const id = el.id || "";
      const dataAction = el.dataset ? el.dataset.action : "";
      const matches =
        id.includes("generateRoutine") ||
        dataAction === "generateRoutine" ||
        href.includes("generateRoutine");
      if (matches) {
        e.preventDefault();
        generateRoutine();
      }
    });
  })();

  // Wire handlers for selected-products list remove / clear
  wireSelectedListHandlers();

  // --- Initial load: show all products (if any) in the default category ---
  (async function () {
    const products = await loadProducts();
    let filtered = products.slice(); // copy

    // If a category is selected by default, filter by it
    const defaultCategory = categoryFilter ? categoryFilter.value : "";
    if (defaultCategory) {
      filtered = filtered.filter((p) => p.category === defaultCategory);
    }

    displayProducts(filtered);

    // After products are rendered, update the saved selection UI (names require product cache)
    renderSelectedProductsList();
  })();
}

// Wait for DOM ready
document.addEventListener("DOMContentLoaded", (event) => {
  init();
});
