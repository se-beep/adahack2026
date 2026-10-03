/* Edinburgh Easy Services - frontend logic */
(function () {
  "use strict";

  var USER_KEY = "ees.user";
  var PREFS_KEY = "ees.prefs";
  var SKIP_KEY = "ees.skippedSignup";

  var APP_NAME = "Edinburgh Easy Services";
  var TEXT_SIZES = [
    { label: "Normal", px: 16 },
    { label: "Large", px: 19 },
    { label: "Extra large", px: 22 },
  ];
  var VIEW_TITLES = {
    signup: APP_NAME,
    home: APP_NAME,
    map: "Map",
    search: "Search",
    contact: "Contact",
    faq: "FAQ",
    profile: "Profile",
    detail: "Service",
  };
  var VIEWS = Object.keys(VIEW_TITLES);

  var HELPLINES = [
    { name: "NHS 24", about: "Urgent health advice when your GP is closed.", tel: "111" },
    { name: "Police (not an emergency)", about: "Report a crime or ask for help.", tel: "101" },
    { name: "Samaritans", about: "Talk to someone, any time. Free to call.", tel: "116 123" },
    { name: "Breathing Space", about: "Support if you feel low or worried.", tel: "0800 83 85 87" },
    { name: "Shelter Scotland", about: "Help with housing or losing your home.", tel: "0808 800 4444" },
    { name: "Citizens Advice Scotland", about: "Help with money, benefits and rights.", tel: "0800 028 1456" },
  ];

  var FAQS = [
    { q: "Is everything here free?",
      a: "Most services are free. If a service may cost money, we say so on its page." },
    { q: "Do I need to sign up?",
      a: "No. You can skip sign up and still use every part of the app." },
    { q: "What happens to my email or phone number?",
      a: "It is kept on this device only. You can remove it at any time from your Profile." },
    { q: "How up to date is the information?",
      a: "We collect it from public sources. Opening times can change, so please call or check the website before you go." },
    { q: "What are plain words?",
      a: "We rewrite service information in short, simple sentences. On any service page you can still see the original wording." },
    { q: "I need help right now.",
      a: "If you or someone else is in danger, call 999. For other urgent help, see the Contact page." },
  ];

  var state = {
    services: [],
    categories: [],
    filters: { q: "", category: "" },
    map: null,
    markers: {},
    user: null,
    prefs: { textSize: 0, highContrast: false },
    signupMethod: "email",
    searchFrom: "home",
    detailFrom: "search",
    pendingMapFocus: null,
  };

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ---------- Storage (fails quietly in private browsing) ---------- */
  function load(key, store) {
    try { return JSON.parse((store || localStorage).getItem(key)); } catch (e) { return null; }
  }
  function save(key, value, store) {
    try { (store || localStorage).setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
  }
  function remove(key, store) {
    try { (store || localStorage).removeItem(key); } catch (e) { /* ignore */ }
  }

  /* ---------- Accessibility: text size + high contrast ---------- */
  function applyPrefs() {
    var size = TEXT_SIZES[state.prefs.textSize];
    $("#screen").style.fontSize = size.px + "px";
    document.body.classList.toggle("hc", state.prefs.highContrast);

    var sizeBtn = $("#text-size-btn");
    sizeBtn.setAttribute("aria-label", "Text size: " + size.label + ". Tap to change.");
    $$(".size-dots i").forEach(function (dot, i) {
      dot.classList.toggle("on", i <= state.prefs.textSize);
    });
    $("#contrast-btn").setAttribute("aria-pressed", state.prefs.highContrast ? "true" : "false");

    $("#profile-text-size").textContent = size.label;
    $("#profile-contrast").textContent = state.prefs.highContrast ? "On" : "Off";
    $("#profile-contrast-btn").textContent = state.prefs.highContrast ? "Turn off" : "Turn on";

    if (state.map) state.map.invalidateSize();
  }
  function cycleTextSize() {
    state.prefs.textSize = (state.prefs.textSize + 1) % TEXT_SIZES.length;
    save(PREFS_KEY, state.prefs);
    applyPrefs();
  }
  function toggleContrast() {
    state.prefs.highContrast = !state.prefs.highContrast;
    save(PREFS_KEY, state.prefs);
    applyPrefs();
  }
  $("#text-size-btn").addEventListener("click", cycleTextSize);
  $("#contrast-btn").addEventListener("click", toggleContrast);
  $("#profile-text-btn").addEventListener("click", cycleTextSize);
  $("#profile-contrast-btn").addEventListener("click", toggleContrast);

  /* ---------- Data loading ---------- */
  var dataReady = Promise.all([
    fetch("/api/services").then(function (r) { return r.json(); }),
    fetch("/api/categories").then(function (r) { return r.json(); }),
  ]).then(function (res) {
    state.services = res[0];
    state.categories = res[1];
    renderChips();
    renderList();
  });

  /* ---------- Routing ---------- */
  function parseHash() {
    var parts = location.hash.replace(/^#\/?/, "").split("/");
    var view = VIEWS.indexOf(parts[0]) !== -1 ? parts[0] : "home";
    return { view: view, id: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function go(path) { location.hash = "#/" + path; }

  function backTarget(view) {
    if (view === "detail") return state.detailFrom;
    if (view === "search") return state.searchFrom;
    return "home";
  }

  function needsSignup() {
    return !state.user && !load(SKIP_KEY, sessionStorage);
  }

  function route() {
    var r = parseHash();
    if (needsSignup() && r.view !== "signup") { location.replace("#/signup"); return; }
    if (!needsSignup() && r.view === "signup") { location.replace("#/home"); return; }

    VIEWS.forEach(function (v) { $("#view-" + v).hidden = (v !== r.view); });
    $("#view-title").textContent = VIEW_TITLES[r.view];
    $("#back-btn").hidden = (r.view === "home" || r.view === "signup");
    $("#screen").scrollTop = 0;

    if (r.view === "map") showMap(r.id);
    else if (r.view === "detail") showDetail(r.id);
    else if (r.view === "profile") renderProfile();

    if (r.view === "search") $("#search").focus();
    else $("#view-title").focus();
  }

  $("#back-btn").addEventListener("click", function () { go(backTarget(parseHash().view)); });
  window.addEventListener("hashchange", route);

  /* ---------- Sign up ---------- */
  var SIGNUP_FIELDS = {
    email: { label: "Email address", type: "email", inputmode: "email",
             autocomplete: "email", placeholder: "name@example.com" },
    phone: { label: "Phone number", type: "tel", inputmode: "tel",
             autocomplete: "tel", placeholder: "07123 456789" },
  };

  function setSignupMethod(method) {
    state.signupMethod = method;
    var f = SIGNUP_FIELDS[method];
    var input = $("#signup-input");
    $("#signup-label").textContent = f.label;
    input.type = f.type;
    input.inputMode = f.inputmode;
    input.autocomplete = f.autocomplete;
    input.placeholder = f.placeholder;
    input.value = "";
    $("#signup-error").textContent = "";
    $$(".segment").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.method === method ? "true" : "false");
    });
  }
  $$(".segment").forEach(function (b) {
    b.addEventListener("click", function () { setSignupMethod(b.dataset.method); });
  });

  function validate(method, value) {
    if (!value) return method === "email" ? "Please enter your email address." : "Please enter your phone number.";
    if (method === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return "That email address does not look right.";
    }
    if (method === "phone") {
      var digits = value.replace(/[\s()+-]/g, "");
      if (!/^\d{10,13}$/.test(digits)) return "That phone number does not look right.";
    }
    return "";
  }

  $("#signup-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("#signup-input");
    var value = input.value.trim();
    var error = validate(state.signupMethod, value);
    $("#signup-error").textContent = error;
    input.setAttribute("aria-invalid", error ? "true" : "false");
    if (error) { input.focus(); return; }
    state.user = { method: state.signupMethod, value: value };
    save(USER_KEY, state.user);
    go("home");
  });
  $("#signup-skip").addEventListener("click", function () {
    save(SKIP_KEY, true, sessionStorage);
    go("home");
  });

  /* ---------- Search ---------- */
  function renderChips() {
    var chips = $("#category-chips");
    chips.innerHTML = "";
    [""].concat(state.categories).forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.cat = c;
      b.setAttribute("aria-pressed", state.filters.category === c ? "true" : "false");
      b.textContent = c === "" ? "All" : c;
      b.addEventListener("click", function () { setCategory(c); });
      chips.appendChild(b);
    });
  }

  function setCategory(cat) {
    state.filters.category = cat;
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
    var list = $("#service-list");
    var items = filtered();
    list.innerHTML = "";
    $("#list-empty").hidden = items.length > 0;
    $("#result-count").textContent = items.length === 1 ? "1 place" : items.length + " places";
    items.forEach(function (s) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-card";
      btn.innerHTML =
        '<span class="card-name">' + esc(s.name) + '</span>' +
        '<span class="card-meta">' +
          '<span>' + esc(s.category) + '</span>' +
          '<span class="tag">' + (s.free ? "Free" : "May cost money") + '</span>' +
        '</span>';
      btn.addEventListener("click", function () {
        state.detailFrom = "search";
        go("detail/" + encodeURIComponent(s.id));
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  $("#search").addEventListener("input", function (e) {
    state.filters.q = e.target.value;
    renderList();
  });

  /* ---------- Map ---------- */
  $("#map-search").addEventListener("click", function () {
    state.searchFrom = "map";
    go("search");
  });
  $$('.home-btn[href="#/search"]').forEach(function (a) {
    a.addEventListener("click", function () { state.searchFrom = "home"; });
  });

  function buildMap() {
    state.map = L.map("map").setView([55.9533, -3.1883], 12);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.map);

    state.services.forEach(function (s) {
      var marker = L.circleMarker([s.location.lat, s.location.lon], {
        radius: 9,
        className: "marker-dot",
      }).addTo(state.map);
      marker.bindPopup(function () { return popupFor(s); });
      state.markers[s.id] = marker;
    });
  }

  function popupFor(s) {
    var el = document.createElement("div");
    el.className = "popup";
    el.innerHTML =
      "<strong>" + esc(s.name) + "</strong>" +
      "<span>" + esc(s.category) + "</span>" +
      "<span>" + esc(s.address.street) + ", " + esc(s.address.postcode) + "</span>";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn primary";
    btn.textContent = "See details";
    btn.addEventListener("click", function () {
      state.detailFrom = "map";
      go("detail/" + encodeURIComponent(s.id));
    });
    el.appendChild(btn);
    return el;
  }

  function showMap(focusId) {
    dataReady.then(function () {
      if (!state.map) buildMap();
      // The container was hidden until now, so Leaflet must re-measure it.
      setTimeout(function () {
        state.map.invalidateSize();
        var marker = focusId && state.markers[focusId];
        if (marker) {
          state.map.setView(marker.getLatLng(), 15);
          marker.openPopup();
        }
      }, 50);
    });
  }

  /* ---------- Detail ---------- */
  function showDetail(id) {
    var el = $("#view-detail");
    el.innerHTML = '<p class="muted">Loading…</p>';
    fetch("/api/services/" + encodeURIComponent(id)).then(function (r) {
      if (!r.ok) throw new Error("not found");
      return r.json();
    }).then(renderDetail).catch(function () {
      el.innerHTML = '<p class="empty">Sorry, we could not find that service.</p>';
    });
  }

  function renderDetail(s) {
    var hours = s.hours.map(function (h) {
      var t = h.open && h.close ? (h.open + " – " + h.close) : (h.note || "Open");
      return "<li><span>" + esc(h.days) + "</span><span>" + esc(t) + "</span></li>";
    }).join("");
    var phone = s.phone
      ? '<a class="btn primary block" href="tel:' + esc(s.phone) + '">Call ' + esc(s.phone) + "</a>"
      : "";
    var website = s.website
      ? '<a class="btn block" href="' + esc(s.website) + '" target="_blank" rel="noopener">Open website</a>'
      : "";

    var el = $("#view-detail");
    el.innerHTML =
      '<article class="detail">' +
        '<div class="row">' +
          '<h2>' + esc(s.name) + '</h2>' +
          '<span class="card-meta"><span>' + esc(s.category) + '</span>' +
            '<span class="tag">' + (s.free ? "Free" : "May cost money") + '</span></span>' +
        '</div>' +
        '<div class="row"><span class="label">About</span>' +
          '<p class="plain" id="plain-desc">' + esc(s.description_plain) + '</p>' +
          '<button type="button" class="toggle-link" id="toggle-original">Show original wording</button>' +
        '</div>' +
        '<div class="row"><span class="label">Address</span>' +
          '<div class="address-box"><span>' + esc(s.address.street) + ", " + esc(s.address.postcode) + '</span>' +
            '<button type="button" class="btn" id="copy-address">Copy</button></div>' +
        '</div>' +
        (hours ? '<div class="row"><span class="label">Opening hours</span><ul class="hours-list">' + hours + '</ul></div>' : "") +
        '<div class="detail-actions">' +
          phone +
          '<button type="button" class="btn block" id="show-on-map">Show on map</button>' +
          website +
        '</div>' +
        '<p class="disclaimer">Details may change. Please check before you go.</p>' +
      '</article>';

    var showPlain = true;
    $("#toggle-original").addEventListener("click", function (e) {
      showPlain = !showPlain;
      $("#plain-desc").textContent = showPlain ? s.description_plain : s.description_original;
      e.target.textContent = showPlain ? "Show original wording" : "Show plain wording";
    });
    $("#copy-address").addEventListener("click", function () {
      var addr = s.address.street + ", " + s.address.postcode + ", Edinburgh";
      var b = $("#copy-address");
      navigator.clipboard.writeText(addr).then(function () {
        b.textContent = "Copied";
        setTimeout(function () { b.textContent = "Copy"; }, 1500);
      }).catch(function () {
        window.prompt("Copy the address:", addr);
      });
    });
    $("#show-on-map").addEventListener("click", function () {
      go("map/" + encodeURIComponent(s.id));
    });
  }

  /* ---------- Contact ---------- */
  function renderHelplines() {
    $("#helpline-list").innerHTML = HELPLINES.map(function (h) {
      return '<li class="helpline">' +
        '<div><p class="setting-name">' + esc(h.name) + '</p>' +
          '<p class="muted small">' + esc(h.about) + '</p></div>' +
        '<a class="btn" href="tel:' + esc(h.tel.replace(/\s/g, "")) + '" aria-label="Call ' +
          esc(h.name) + ' on ' + esc(h.tel) + '">' + esc(h.tel) + '</a>' +
      '</li>';
    }).join("");
  }

  /* ---------- FAQ ---------- */
  function renderFaqs() {
    $("#faq-list").innerHTML = FAQS.map(function (f) {
      return "<details><summary>" + esc(f.q) + "</summary><p>" + esc(f.a) + "</p></details>";
    }).join("");
  }

  function translateText() {
    var text = $("#translate-in").value.trim();
    var status = $("#translate-status");
    var out = $("#translate-out");
    if (!text) { status.textContent = "Please paste some text first."; return; }
    status.textContent = "Working on it… this can take a moment the first time.";
    out.hidden = true;
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    }).then(function (r) {
      if (!r.ok) throw new Error("translate failed");
      return r.json();
    }).then(function (res) {
      status.textContent = "Here it is in plain words:";
      out.textContent = res.plain;
      out.hidden = false;
    }).catch(function (err) {
      status.textContent = "Sorry, this is not working right now.";
      console.error(err);
    });
  }
  $("#translate-btn").addEventListener("click", translateText);

  /* ---------- Profile ---------- */
  function renderProfile() {
    var el = $("#profile-account");
    if (state.user) {
      el.innerHTML =
        '<h2 class="section-title">Your details</h2>' +
        '<div><p class="muted small">' + (state.user.method === "email" ? "Email" : "Phone") + '</p>' +
          '<p class="account-value">' + esc(state.user.value) + '</p></div>' +
        '<button type="button" class="btn block" id="sign-out">Remove my details</button>';
      $("#sign-out").addEventListener("click", function () {
        state.user = null;
        remove(USER_KEY);
        remove(SKIP_KEY, sessionStorage);
        setSignupMethod("email");
        go("signup");
      });
    } else {
      el.innerHTML =
        '<h2 class="section-title">Your details</h2>' +
        '<p class="muted">You have not signed up.</p>' +
        '<button type="button" class="btn primary block" id="sign-up">Sign up</button>';
      $("#sign-up").addEventListener("click", function () {
        remove(SKIP_KEY, sessionStorage);
        go("signup");
      });
    }
  }

  /* ---------- Init ---------- */
  state.user = load(USER_KEY);
  var savedPrefs = load(PREFS_KEY);
  if (savedPrefs) {
    state.prefs.textSize = Math.min(TEXT_SIZES.length - 1, Math.max(0, savedPrefs.textSize | 0));
    state.prefs.highContrast = !!savedPrefs.highContrast;
  }
  applyPrefs();
  renderHelplines();
  renderFaqs();
  route();
})();
