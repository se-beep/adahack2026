/* LifeLine - frontend logic */
(function () {
  "use strict";

  var USER_KEY = "ees.user";
  var PREFS_KEY = "ees.prefs";
  var SKIP_KEY = "ees.skippedSignup";

  var APP_NAME = "LifeLine";
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
    captions: "Live captions",
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
    mapCategory: "",
    captionsFrom: "contact",
    here: null,          // { lat, lon, accuracy } once the browser reports a position
    locStatus: "idle",   // idle | pending | ok | denied | unavailable
    locWatch: null,
    hereMarker: null,
    hereAccuracy: null,
    mapCentered: false,
  };

  // Pin colours per service type. Unlisted types take the next fallback colour.
  var CATEGORY_COLORS = {
    "Food bank": "#c6ff5e",
    "Warm space": "#ffb347",
    "Public toilet": "#5ee6e6",
    "Period": "#ff5ec8",
    "NHS": "#a78bfa",
  };
  var FALLBACK_COLORS = ["#ffd84a", "#19b5c9", "#ffffff"];

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

  /* ---------- Location ---------- */
  var MILES_PER_KM = 0.621371;
  var MOVE_THRESHOLD_KM = 0.025; // ignore GPS jitter when deciding to re-sort

  function hasLocation(s) {
    return !!(s.location && (s.location.lat || s.location.lon));
  }

  function distanceKm(a, b) {
    var toRad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * toRad;
    var dLon = (b.lon - a.lon) * toRad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * 6371 * Math.asin(Math.sqrt(h));
  }

  function distanceTo(s) {
    return state.here && hasLocation(s) ? distanceKm(state.here, s.location) : null;
  }

  function formatDistance(km) {
    var mi = km * MILES_PER_KM;
    if (mi < 0.1) return "Under 0.1 miles away";
    return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " miles away";
  }

  function startLocating() {
    if (state.locWatch !== null || state.locStatus === "denied") return;
    if (!("geolocation" in navigator)) { setLocStatus("unavailable"); return; }
    setLocStatus("pending");
    state.locWatch = navigator.geolocation.watchPosition(onPosition, onPositionError,
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
  }

  function onPosition(pos) {
    var next = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
    var moved = !state.here || distanceKm(state.here, next) > MOVE_THRESHOLD_KM;
    state.here = next;
    setLocStatus("ok");
    updateHereMarker();
    if (moved) renderList();
  }

  function onPositionError(err) {
    // Once we have a fix, a later timeout just means the position is stale; keep it.
    if (state.here && err.code !== err.PERMISSION_DENIED) return;
    navigator.geolocation.clearWatch(state.locWatch);
    state.locWatch = null;
    setLocStatus(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
  }

  function setLocStatus(status) {
    state.locStatus = status;
    var mapMessages = {
      pending: "Finding your location…",
      denied: "Location is off. Allow location for this site in your browser settings.",
      unavailable: "We could not find your location.",
    };
    $("#map-status").textContent = mapMessages[status] || "";
    renderLocationNote();
  }

  function renderLocationNote() {
    var note = $("#location-note");
    var s = state.locStatus;
    note.hidden = (s === "idle" || s === "ok");
    if (s === "pending") {
      note.textContent = "Finding your location to show the nearest places…";
    } else if (s === "denied") {
      note.textContent = "Location is off, so places are not sorted by distance.";
    } else if (s === "unavailable") {
      note.innerHTML = "We could not find your location, so places are not sorted by distance. " +
        '<button type="button" class="toggle-link" id="retry-location">Try again</button>';
      $("#retry-location").addEventListener("click", startLocating);
    }
  }

  /* ---------- Read aloud ---------- */
  var synth = window.speechSynthesis || null;
  var readingBtn = null;

  // Wrap each sentence in a span so it can be highlighted while spoken.
  // Line breaks are kept, since plain-words text puts one idea on each line.
  function sentencesHtml(text) {
    return String(text || "").split(/\n+/).map(function (line) {
      var parts = line.match(/[^.!?]+[.!?]*/g) || [];
      return parts.map(function (part) { return part.trim(); }).filter(Boolean).map(function (part) {
        return '<span class="say">' + esc(part) + "</span>";
      }).join(" ");
    }).filter(Boolean).join("\n");
  }

  function listenButtonHtml() {
    if (!synth) return "";
    return '<button type="button" class="listen-btn" aria-pressed="false">' +
      '<svg class="icon"><use href="#i-speaker"/></svg><span class="listen-label">Listen</span></button>';
  }

  // Hook up a Listen button to read every .say element inside root, in order.
  function bindListen(btn, root) {
    if (!btn) return;
    btn.addEventListener("click", function () {
      readAloud(Array.prototype.slice.call(root.querySelectorAll(".say")), btn);
    });
  }

  function setListening(btn, on) {
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.querySelector(".listen-label").textContent = on ? "Stop" : "Listen";
  }

  function pickVoice() {
    var voices = synth.getVoices();
    return voices.filter(function (v) { return v.lang === "en-GB" && v.localService; })[0] ||
      voices.filter(function (v) { return v.lang === "en-GB"; })[0] || null;
  }

  function stopReading() {
    if (!synth) return;
    synth.cancel();
    $$(".say.speaking").forEach(function (el) { el.classList.remove("speaking"); });
    if (readingBtn) setListening(readingBtn, false);
    readingBtn = null;
  }

  function readAloud(els, btn) {
    var toggledOff = (readingBtn === btn);
    stopReading();
    if (toggledOff || !els.length) return;
    readingBtn = btn;
    setListening(btn, true);
    var voice = pickVoice();
    // One utterance per sentence: boundary events are unreliable across browsers.
    els.forEach(function (el, i) {
      var u = new SpeechSynthesisUtterance(el.dataset.say || el.textContent);
      u.lang = "en-GB";
      u.rate = 0.9;
      if (voice) u.voice = voice;
      u.onstart = function () {
        el.classList.add("speaking");
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      };
      u.onend = function () {
        el.classList.remove("speaking");
        if (i === els.length - 1 && readingBtn === btn) {
          setListening(btn, false);
          readingBtn = null;
        }
      };
      synth.speak(u);
    });
  }

  /* ---------- Data loading ---------- */
  var dataReady = Promise.all([
    fetch("/api/services").then(function (r) { return r.json(); }),
    fetch("/api/categories").then(function (r) { return r.json(); }),
  ]).then(function (res) {
    state.services = res[0];
    state.categories = res[1];
    renderChips();
    renderMapFilter();
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
    if (view === "captions") return state.captionsFrom;
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
    $("#screen").dataset.view = r.view;
    $("#view-title").textContent = VIEW_TITLES[r.view];
    $("#back-btn").hidden = (r.view === "home" || r.view === "signup");
    $("#screen").scrollTop = 0;
    stopReading();
    if (r.view !== "captions") stopCaptions();

    if (r.view === "map" || r.view === "search") startLocating();
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

  // Nearest first when we know where the user is; places without coordinates go last.
  function sortByDistance(items, km) {
    if (!state.here) return items;
    return items.sort(function (a, b) {
      var da = km[a.id], db = km[b.id];
      if (da === null) return db === null ? 0 : 1;
      if (db === null) return -1;
      return da - db;
    });
  }

  function renderList() {
    var list = $("#service-list");
    var km = {};
    var items = filtered();
    items.forEach(function (s) { km[s.id] = distanceTo(s); });
    sortByDistance(items, km);

    list.innerHTML = "";
    $("#list-empty").hidden = items.length > 0;
    $("#result-count").textContent = (items.length === 1 ? "1 place" : items.length + " places") +
      (state.here && items.length > 1 ? ", nearest first" : "");
    items.forEach(function (s) {
      var li = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "service-card";
      btn.innerHTML =
        '<span class="card-name">' + esc(s.name) + '</span>' +
        '<span class="card-meta">' +
          (km[s.id] !== null ? '<span class="card-distance">' + formatDistance(km[s.id]) + '</span>' : "") +
          categoryLabelHtml(s.category) +
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
    // Standard OpenStreetMap tiles, recoloured to a night map in CSS (.night-tiles).
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      className: "night-tiles",
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.map);

    state.services.forEach(function (s) {
      if (!hasLocation(s)) return;
      var marker = L.marker([s.location.lat, s.location.lon], {
        icon: starIcon(colorFor(s.category)),
        title: s.name,
      });
      marker.bindPopup(function () { return popupFor(s); });
      state.markers[s.id] = marker;
    });
    applyMapFilter();

    var LocateControl = L.Control.extend({
      options: { position: "topright" },
      onAdd: function () {
        var btn = L.DomUtil.create("button", "map-locate");
        btn.type = "button";
        btn.setAttribute("aria-label", "Show my location");
        btn.innerHTML = '<svg class="icon"><use href="#i-locate"/></svg>';
        L.DomEvent.disableClickPropagation(btn);
        L.DomEvent.on(btn, "click", function () {
          if (state.here) state.map.setView([state.here.lat, state.here.lon], 15);
          else startLocating();
        });
        return btn;
      },
    });
    new LocateControl().addTo(state.map);
  }

  function updateHereMarker() {
    if (!state.map || !state.here) return;
    var ll = [state.here.lat, state.here.lon];
    if (!state.hereMarker) {
      state.hereAccuracy = L.circle(ll, {
        radius: state.here.accuracy,
        className: "here-accuracy",
        interactive: false,
      }).addTo(state.map);
      state.hereMarker = L.marker(ll, {
        icon: L.divIcon({
          className: "here-pin",
          html: '<svg viewBox="0 0 100 130"><use href="#pin"/></svg>',
          iconSize: [30, 39],
          iconAnchor: [15, 38],
          popupAnchor: [0, -34],
        }),
        title: "You are here",
        zIndexOffset: 1000,
      }).bindPopup("You are here").addTo(state.map);
    } else {
      state.hereAccuracy.setLatLng(ll).setRadius(state.here.accuracy);
      state.hereMarker.setLatLng(ll);
    }
    // Centre on the user the first time only, so we never yank the map away mid-pan.
    if (!state.mapCentered) {
      state.mapCentered = true;
      state.map.setView(ll, 14);
    }
  }

  function popupFor(s) {
    var km = distanceTo(s);
    var el = document.createElement("div");
    el.className = "popup";
    el.innerHTML =
      "<strong>" + esc(s.name) + "</strong>" +
      (km !== null ? "<span>" + formatDistance(km) + "</span>" : "") +
      categoryLabelHtml(s.category) +
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

  function colorFor(cat) {
    if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
    var others = state.categories.filter(function (c) { return !CATEGORY_COLORS[c]; });
    var i = Math.max(0, others.indexOf(cat));
    return FALLBACK_COLORS[i % FALLBACK_COLORS.length];
  }

  function categoryLabelHtml(cat) {
    return '<span class="cat"><svg class="cat-star" viewBox="0 0 100 100" aria-hidden="true" style="stroke:' +
      colorFor(cat) + '"><use href="#doodle-star"/></svg>' + esc(cat) + "</span>";
  }

  // Map pins are scribbled stars in the service type's colour, with a dark halo for contrast.
  var starIcons = {};
  function starIcon(color) {
    if (!starIcons[color]) {
      starIcons[color] = L.divIcon({
        className: "star-marker",
        html: '<svg viewBox="0 0 100 100">' +
          '<use href="#doodle-star" style="stroke:#07043f;stroke-width:18;fill:none"/>' +
          '<use href="#doodle-star" style="stroke:' + color + ';stroke-width:9;fill:' + color +
          ';fill-opacity:0.22"/></svg>',
        iconSize: [30, 30],
        iconAnchor: [15, 15],
        popupAnchor: [0, -12],
      });
    }
    return starIcons[color];
  }

  // Map filter: the user picks one type of service, or All.
  function renderMapFilter() {
    var bar = $("#map-filter");
    bar.innerHTML = "";
    [""].concat(state.categories).forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.dataset.cat = c;
      b.setAttribute("aria-pressed", state.mapCategory === c ? "true" : "false");
      b.innerHTML = c === "" ? "All" : categoryLabelHtml(c);
      b.addEventListener("click", function () { setMapCategory(c); });
      bar.appendChild(b);
    });
  }

  function setMapCategory(cat) {
    state.mapCategory = cat;
    $$("#map-filter .chip").forEach(function (b) {
      b.setAttribute("aria-pressed", b.dataset.cat === cat ? "true" : "false");
    });
    applyMapFilter();
  }

  // Shows or hides pins only; the map keeps the user's current zoom and position.
  function applyMapFilter() {
    if (!state.map) return;
    var shown = 0;
    state.services.forEach(function (s) {
      var marker = state.markers[s.id];
      if (!marker) return;
      var visible = !state.mapCategory || s.category === state.mapCategory;
      if (visible) {
        shown++;
        if (!state.map.hasLayer(marker)) marker.addTo(state.map);
      } else if (state.map.hasLayer(marker)) {
        state.map.removeLayer(marker);
      }
    });
    $("#map-count").textContent = shown === 1 ? "1 place shown" : shown + " places shown";
  }

  function showMap(focusId) {
    dataReady.then(function () {
      if (!state.map) buildMap();
      // The container was hidden until now, so Leaflet must re-measure it.
      setTimeout(function () {
        state.map.invalidateSize();
        var marker = focusId && state.markers[focusId];
        if (marker && !state.map.hasLayer(marker)) setMapCategory("");
        if (marker) {
          state.mapCentered = true;
          state.map.setView(marker.getLatLng(), 15);
          marker.openPopup();
        }
        updateHereMarker();
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
    var km = distanceTo(s);
    var hours = s.hours.map(function (h) {
      var t = h.open && h.close ? (h.open + " – " + h.close) : (h.note || "Open");
      return '<li class="say" data-say="' + esc(h.days + ": " + t.replace("\u2013", "to")) + '">' +
        "<span>" + esc(h.days) + "</span><span>" + esc(t) + "</span></li>";
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
          '<h2 class="say">' + esc(s.name) + '</h2>' +
          '<span class="card-meta">' +
            (km !== null ? '<span class="card-distance">' + formatDistance(km) + '</span>' : "") +
            '<span>' + esc(s.category) + '</span>' +
            '<span class="tag">' + (s.free ? "Free" : "May cost money") + '</span></span>' +
          listenButtonHtml() +
        '</div>' +
        '<div class="row"><span class="label">About</span>' +
          '<p class="plain" id="plain-desc">' + sentencesHtml(s.description_plain) + '</p>' +
          '<button type="button" class="toggle-link" id="toggle-original">Show original wording</button>' +
        '</div>' +
        '<div class="row"><span class="label">Address</span>' +
          '<div class="address-box"><span class="say" data-say="' +
            esc("Address: " + s.address.street + ", " + s.address.postcode) + '">' +
            esc(s.address.street) + ", " + esc(s.address.postcode) + '</span>' +
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

    bindListen(el.querySelector(".listen-btn"), el);

    var showPlain = true;
    $("#toggle-original").addEventListener("click", function (e) {
      showPlain = !showPlain;
      stopReading();
      $("#plain-desc").innerHTML = sentencesHtml(showPlain ? s.description_plain : s.description_original);
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
      return '<details><summary><span class="say">' + esc(f.q) + "</span></summary>" +
        '<div class="faq-answer"><p>' + sentencesHtml(f.a) + "</p>" + listenButtonHtml() + "</div></details>";
    }).join("");
    $$("#faq-list details").forEach(function (d) { bindListen(d.querySelector(".listen-btn"), d); });
  }

  function translateText() {
    var text = $("#translate-in").value.trim();
    var status = $("#translate-status");
    var out = $("#translate-out");
    if (!text) { status.textContent = "Please paste some text first."; return; }
    var btn = $("#translate-btn");
    btn.disabled = true;
    status.textContent = "Working on it… this can take a moment the first time.";
    out.hidden = true;
    $("#translate-listen").hidden = true;
    stopReading();
    fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    }).then(function (r) {
      if (!r.ok) throw new Error("translate failed");
      return r.json();
    }).then(function (res) {
      status.textContent = "Here it is in plain words:";
      out.innerHTML = sentencesHtml(res.plain);
      out.hidden = false;
      var listen = $("#translate-listen");
      listen.innerHTML = listenButtonHtml();
      listen.hidden = !synth;
      bindListen(listen.querySelector(".listen-btn"), out);
    }).catch(function (err) {
      status.textContent = "Sorry, this is not working right now.";
      console.error(err);
    }).then(function () {
      btn.disabled = false;
    });
  }
  $("#translate-btn").addEventListener("click", translateText);

  /* ---------- Live captions ---------- */
  var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var captions = { rec: null, on: false, lines: [], interim: "" };

  function renderCaptions() {
    var out = $("#captions-out");
    if (!captions.lines.length && !captions.interim) {
      out.innerHTML = '<p class="captions-placeholder">Captions will show here.</p>';
      return;
    }
    out.innerHTML = captions.lines.map(function (line) { return "<p>" + esc(line) + "</p>"; }).join("") +
      (captions.interim ? '<p class="interim">' + esc(captions.interim) + "</p>" : "");
    out.scrollTop = out.scrollHeight;
  }

  function setCaptionsOn(on, message) {
    captions.on = on;
    var btn = $("#captions-toggle");
    btn.textContent = on ? "Stop captions" : "Start captions";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    $("#captions-status").textContent = message || (on ? "Listening\u2026" : "");
  }

  function createRecognizer() {
    var rec = new Recognition();
    rec.lang = "en-GB";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = function (e) {
      var interim = "";
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var text = e.results[i][0].transcript.trim();
        if (!text) continue;
        if (e.results[i].isFinal) captions.lines.push(text.charAt(0).toUpperCase() + text.slice(1));
        else interim += text + " ";
      }
      captions.interim = interim.trim();
      renderCaptions();
    };
    rec.onerror = function (e) {
      var messages = {
        "not-allowed": "The microphone is blocked. Allow it for this site in your browser settings.",
        "service-not-allowed": "The microphone is blocked. Allow it for this site in your browser settings.",
        "audio-capture": "No microphone was found.",
        "network": "Live captions need an internet connection.",
      };
      if (messages[e.error]) setCaptionsOn(false, messages[e.error]);
      // "no-speech" and "aborted" are routine; onend restarts listening.
    };
    rec.onend = function () {
      // Browsers stop listening after a pause, so restart until the user stops.
      if (!captions.on) return;
      try { rec.start(); } catch (err) { setCaptionsOn(false); }
    };
    return rec;
  }

  function startCaptions() {
    if (!Recognition) {
      $("#captions-status").textContent = "Live captions do not work in this browser. Try Chrome or Safari.";
      return;
    }
    stopReading();
    if (!captions.rec) captions.rec = createRecognizer();
    setCaptionsOn(true);
    try { captions.rec.start(); } catch (err) { /* already listening */ }
  }

  function stopCaptions() {
    if (!captions.on) return;
    setCaptionsOn(false);
    captions.rec.stop();
    if (captions.interim) captions.lines.push(captions.interim);
    captions.interim = "";
    renderCaptions();
  }

  $("#captions-toggle").addEventListener("click", function () {
    if (captions.on) stopCaptions(); else startCaptions();
  });
  $("#captions-clear").addEventListener("click", function () {
    captions.lines = [];
    captions.interim = "";
    renderCaptions();
  });
  $$('a[href="#/captions"]').forEach(function (a) {
    a.addEventListener("click", function () { state.captionsFrom = a.dataset.from; });
  });

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
  renderCaptions();
  route();
})();
