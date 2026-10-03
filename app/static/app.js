/* Edinburgh Easy Services - frontend logic */
(function () {
  "use strict";

  var state = {
    services: [],
    categories: [],
    filters: { q: "", category: "" },
    map: null,
    markers: {},
    lastView: "home",
    fontScale: 1.0,
    highContrast: false,
  };

  var CATEGORY_ICONS = {
    "Warm space": "\u{1F525}",
    "Food bank": "\u{1F96B}",
    "Free WiFi": "\u{1F4F6}",
    "Public toilet": "\u{1F6BB}",
    "Advice": "\u{1F4AC}",
    "Free museum": "\u{1F3DB}\uFE0F",
    "Water refill": "\u{1F4A7}",
    "Health & wellbeing": "\u{2764}\uFE0F",
    "nhs": "\u2695\uFE0F",
    "Period": "\u{1FA78}",
  };
  function iconFor(cat) { return CATEGORY_ICONS[cat] || "\u{1F4CD}"; }

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  /* ---------- Accessibility: font size + high contrast ---------- */
  function applyFontScale() {
    var screen = $(".screen");
    screen.style.fontSize = (16 * state.fontScale) + "px";
  }
  function setFont(delta) {
    state.fontScale = Math.min(1.5, Math.max(0.8, state.fontScale + delta));
    applyFontScale();
  }
  function setContrast(on) {
    state.highContrast = on;
    document.body.classList.toggle("hc", on);
    ["#contrast-toggle", "#app-contrast"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  document.getElementById("font-dec").addEventListener("click", function () { setFont(-0.1); });
  document.getElementById("font-inc").addEventListener("click", function () { setFont(0.1); });
  document.getElementById("app-font-dec").addEventListener("click", function () { setFont(-0.1); });
  document.getElementById("app-font-inc").addEventListener("click", function () { setFont(0.1); });
  document.getElementById("contrast-toggle").addEventListener("click", function () { setContrast(!state.highContrast); });
  document.getElementById("app-contrast").addEventListener("click", function () { setContrast(!state.highContrast); });

  /* ---------- Data loading ---------- */
  function loadData() {
    return Promise.all([
      fetch("/api/services").then(function (r) { return r.json(); }),
      fetch("/api/categories").then(function (r) { return r.json(); }),
    ]).then(function (res) {
      state.services = res[0];
      state.categories = res[1];
    });
  }

  /* ---------- View switching ---------- */
  function showView(name) {
    ["home", "map", "translate", "detail"].forEach(function (v) {
      var el = document.getElementById("view-" + v);
      if (el) el.hidden = (v !== name);
    });
    $$(".tab").forEach(function (t) {
      var on = (t.dataset.view === name);
      t.setAttribute("aria-current", on ? "true" : "false");
    });
    if (name === "map" && state.map) {
      // ensure correct size when map becomes visible
      setTimeout(function () { state.map.invalidateSize(); }, 50);
    }
  }

  /* ---------- Home list ---------- */
  function renderCategories() {
    var sel = document.getElementById("category");
    state.categories.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      sel.appendChild(opt);
    });
  }

  function renderChips() {
    var chips = document.getElementById("category-chips");
    chips.innerHTML = "";
    var cats = [""].concat(state.categories);
    cats.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.cat = c;
      b.setAttribute("aria-pressed", state.filters.category === c ? "true" : "false");
      b.textContent = c === "" ? "All" : iconFor(c) + " " + c;
      b.addEventListener("click", function () { setCategory(c); });
      chips.appendChild(b);
    });
  }

  function setCategory(cat) {
    state.filters.category = cat;
    document.getElementById("category").value = cat;
    $$(".chip").forEach(function (ch) {
      ch.setAttribute("aria-pressed", ch.dataset.cat === cat ? "true" : "false");
    });
    renderList();
  }

  function filtered() {
    var q = state.filters.q.toLowerCase();
    return state.services.filter(function (s) {
      if (state.filters.category && s.category !== state.filters.category) return false;
      if (!q) return true;
      var hay = (s.name + " " + s.category + " " + s.description_plain + " " +
        s.address.street + " " + s.address.postcode).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderList() {
    var list = document.getElementById("service-list");
    var empty = document.getElementById("list-empty");
    var items = filtered();
    list.innerHTML = "";
    empty.hidden = items.length > 0;
    items.forEach(function (s) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-card";
      btn.innerHTML =
        '<span class="icon" aria-hidden="true">' + iconFor(s.category) + '</span>' +
        '<span class="card-text">' +
          '<span class="card-name">' + esc(s.name) + '</span>' +
          '<span class="card-cat">' + esc(s.category) + '</span>' +
          '<span class="badge">' + (s.free ? "Free" : "May cost money") + '</span>' +
        '</span>';
      btn.addEventListener("click", function () { openDetail(s.id); });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  document.getElementById("search").addEventListener("input", function (e) {
    state.filters.q = e.target.value;
    renderList();
  });
  document.getElementById("category").addEventListener("change", function (e) {
    setCategory(e.target.value);
  });

  /* ---------- Detail ---------- */
  function openDetail(id) {
    state.lastView = "home";
    fetch("/api/services/" + id).then(function (r) { return r.json(); }).then(function (s) {
      renderDetail(s);
      showView("detail");
      $("#view-detail").focus && $("#view-detail").focus();
    });
  }

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderDetail(s) {
    var hours = s.hours.map(function (h) {
      var t = h.open && h.close ? (h.open + " \u2013 " + h.close) : (h.note || "Open");
      return "<li><strong>" + esc(h.days) + ":</strong> " + esc(t) + "</li>";
    }).join("");
    var website = s.website
      ? '<a class="btn" href="' + esc(s.website) + '" target="_blank" rel="noopener">Open website</a>'
      : "";
    var phone = s.phone ? '<a class="btn" href="tel:' + esc(s.phone) + '">Call ' + esc(s.phone) + "</a>" : "";

    var el = document.getElementById("view-detail");
    el.innerHTML =
      '<div class="detail" tabindex="-1">' +
        '<h2>' + esc(s.name) + '</h2>' +
        '<p class="card-cat">' + iconFor(s.category) + " " + esc(s.category) +
          ' <span class="badge">' + (s.free ? "Free" : "May cost money") + '</span></p>' +
        '<div class="row"><span class="label">About this service</span>' +
          '<p id="plain-desc">' + esc(s.description_plain) + '</p>' +
          '<button type="button" class="toggle-link" id="toggle-original">Show original wording</button>' +
        '</div>' +
        '<div class="row"><span class="label">Address</span>' +
          '<div class="address-box"><span id="address-text">' + esc(s.address.street) +
            ", " + esc(s.address.postcode) + '</span>' +
            '<button type="button" class="btn copy-btn" id="copy-address">Copy</button></div>' +
        '</div>' +
        '<div class="row"><span class="label">Opening hours</span>' +
          '<ul class="hours-list">' + hours + '</ul></div>' +
        '<div class="detail-actions">' +
          '<button type="button" class="btn" id="show-on-map">Show on map</button>' +
          phone + website +
          '<button type="button" class="btn back-btn" id="back-to-list">Back to list</button>' +
        '</div>' +
      '</div>';

    var showPlain = true;
    document.getElementById("toggle-original").addEventListener("click", function (e) {
      showPlain = !showPlain;
      document.getElementById("plain-desc").textContent =
        showPlain ? s.description_plain : s.description_original;
      e.target.textContent = showPlain ? "Show original wording" : "Show plain wording";
    });
    document.getElementById("copy-address").addEventListener("click", function () {
      var addr = s.address.street + ", " + s.address.postcode + ", Edinburgh";
      navigator.clipboard.writeText(addr).then(function () {
        var b = document.getElementById("copy-address");
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = "Copy"; }, 1500);
      }).catch(function () {
        window.prompt("Copy the address:", addr);
      });
    });
    document.getElementById("show-on-map").addEventListener("click", function () {
      showOnMap(s.id);
    });
    document.getElementById("back-to-list").addEventListener("click", function () {
      showView(state.lastView);
    });
  }

  function showOnMap(id) {
    showView("map");
    if (state.map && state.markers[id]) {
      state.map.setView(state.markers[id].getLatLng(), 15);
      state.markers[id].openPopup();
    }
  }

  /* ---------- Map ---------- */
  function buildMap() {
    state.map = L.map("map").setView([55.9533, -3.1883], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.map);

    var legend = document.getElementById("map-legend");
    var cats = {};
    state.services.forEach(function (s) { cats[s.category] = true; });
    legend.innerHTML = Object.keys(cats).map(function (c) {
      return "<li>" + iconFor(c) + " " + esc(c) + "</li>";
    }).join("");

    state.services.forEach(function (s) {
      var marker = L.marker([s.location.lat, s.location.lon]).addTo(state.map);
      marker.bindPopup("<strong>" + esc(s.name) + "</strong><br>" +
        esc(s.category) + "<br>" + esc(s.address.street) + ", " + esc(s.address.postcode));
      marker.on("click", function () { openDetail(s.id); });
      state.markers[s.id] = marker;
    });
  }

  /* ---------- Translate ---------- */
  function translateText() {
    var input = document.getElementById("translate-in");
    var status = document.getElementById("translate-status");
    var out = document.getElementById("translate-out");
    var text = input.value.trim();
    if (!text) { status.textContent = "Please enter some text first."; return; }
    status.textContent = "Translating\u2026 this may take a moment on first use.";
    out.hidden = true;
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    }).then(function (r) {
      if (!r.ok) throw new Error("translate failed");
      return r.json();
    }).then(function (res) {
      status.textContent = "Done.";
      out.textContent = res.plain;
      out.hidden = false;
    }).catch(function (err) {
      status.textContent = "Sorry, translation is unavailable right now.";
      console.error(err);
    });
  }
  document.getElementById("translate-btn").addEventListener("click", translateText);

  /* ---------- Tabs ---------- */
  $$(".tab").forEach(function (t) {
    t.addEventListener("click", function () {
      var v = t.dataset.view;
      if (v === "home") renderList();
      showView(v);
    });
  });

  /* ---------- Init ---------- */
  loadData().then(function () {
    renderCategories();
    renderChips();
    renderList();
    buildMap();
    applyFontScale();
  });
})();
