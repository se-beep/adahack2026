/* LifeLine - frontend logic */
(function () {
  "use strict";

  var USER_KEY = "ees.user";
  var PREFS_KEY = "ees.prefs";
  var SKIP_KEY = "ees.skippedSignup";
  var GP_KEY = "ees.gp";
  var HOME_KEY = "ees.homePostcode";
  var YS_KEY = "ees.youngscot";

  var APP_NAME = "LifeLine";
  // The four universities in Edinburgh. Keep in step with STUDENT_DOMAINS in app/auth.py.
  var STUDENT_DOMAINS = ["ed.ac.uk", "live.napier.ac.uk", "hw.ac.uk", "qmu.ac.uk"];
  var TEXT_SIZES = [
    { label: "Normal", px: 16 },
    { label: "Large", px: 19 },
    { label: "Extra large", px: 22 },
  ];
  var VIEW_TITLES = {
    signup: "Welcome",
    home: APP_NAME,
    map: "Map",
    search: "Search",
    contact: "Contact",
    faq: "FAQ",
    profile: "Profile",
    nhs: "NHS and GP",
    injury: "Injury help",
    youngscot: "Young Scot",
    captions: "Live captions",
    detail: "Service",
  };
  var VIEWS = Object.keys(VIEW_TITLES);
  var YEAR_LABELS = { "1": "1st year", "2": "2nd year", "3": "3rd year", "4": "4th year",
                      "5+": "5th year or above", pg: "Postgraduate" };

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
    { q: "What happens to my email?",
      a: "We keep it with your account so you can log in. We only use it to send your sign up code." },
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
    onboard: { step: "welcome", student: false, year: null, email: "", from: "account" },
    searchFrom: "home",
    detailFrom: "search",
    mapCategory: "",
    captionsFrom: "contact",
    gp: null,            // id of the GP practice the user picked as theirs
    home: null,          // { postcode, lat, lon } from the postcode the user typed
    injury: null,
    here: null,          // { lat, lon, accuracy } once the browser reports a position
    locStatus: "idle",   // idle | pending | ok | denied | unavailable
    locWatch: null,
    hereMarker: null,
    hereAccuracy: null,
    mapCentered: false,
  };

  // Pin colours per service type. Unlisted types take the next fallback colour.
  var CATEGORY_COLORS = {
    "Food bank": "#2b8a3e",
    "Warm space": "#f08c00",
    "Public toilet": "#1971c2",
    "Period": "#c2255c",
    "NHS": "#7048e8",
    "Pharmacy": "#15aabf",
  };
  var FALLBACK_COLORS = ["#5c940d", "#862e9c", "#495057", "#a61e4d"];

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
    if (moved) { renderList(); renderNearby(); }
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
    renderNearby();
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
    renderNearby();
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
    if (view === "injury") return "nhs";
    return "home";
  }

  function isStudent() { return !!(state.user && state.user.student); }

  function needsSignup() {
    return !state.user && !load(SKIP_KEY, sessionStorage);
  }

  function route() {
    var r = parseHash();
    if (needsSignup() && r.view !== "signup") { location.replace("#/signup"); return; }
    if (!needsSignup() && r.view === "signup") { location.replace("#/home"); return; }

    VIEWS.forEach(function (v) { $("#view-" + v).hidden = (v !== r.view); });
    $("#view-title").textContent = VIEW_TITLES[r.view];
    $("#home-youngscot").hidden = !isStudent();
    if (r.view === "youngscot" && !isStudent()) { location.replace("#/home"); return; }
    if (r.view === "signup") showStep(state.onboard.step);
    else $("#back-btn").hidden = (r.view === "home");
    $("#screen").scrollTop = 0;
    stopReading();
    if (r.view !== "captions") stopCaptions();

    if (["map", "search", "nhs", "injury", "youngscot"].indexOf(r.view) !== -1) startLocating();
    if (r.view === "nhs" || r.view === "injury" || r.view === "youngscot") renderNearby();
    if (r.view === "map") showMap(r.id);
    else if (r.view === "detail") showDetail(r.id);
    else if (r.view === "profile") renderProfile();

    focusView(r.view);
  }

  function focusView(view) {
    if (view === "search") $("#search").focus();
    else if (view === "signup") stepEl(state.onboard.step).querySelector(".display").focus();
    else $("#view-title").focus();
  }

  $("#back-btn").addEventListener("click", function () {
    var view = parseHash().view;
    if (view === "signup") showStep(prevStep(), true);
    else go(backTarget(view));
  });
  window.addEventListener("hashchange", route);

  /* ---------- Welcome + sign up ---------- */
  function api(path, body) {
    return fetch("/api/auth/" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok) return data;
        throw new Error(typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.");
      });
    }, function () {
      throw new Error("We could not reach LifeLine. Check your connection and try again.");
    });
  }

  function stepEl(step) { return $('.ob-step[data-step="' + step + '"]'); }

  function prevStep() {
    var ob = state.onboard;
    if (ob.step === "year") return "student";
    if (ob.step === "account") return ob.student ? "year" : "student";
    if (ob.step === "verify") return ob.from;
    return "welcome";
  }

  function showStep(step, focus) {
    var ob = state.onboard;
    ob.step = step;
    $$(".ob-step").forEach(function (el) { el.hidden = (el.dataset.step !== step); });
    $("#back-btn").hidden = (step === "welcome");
    $("#screen").scrollTop = 0;

    if (step === "account") {
      $("#account-email-label").textContent = ob.student ? "Student email" : "Email address";
      $("#account-email").placeholder = ob.student ? "s1234567@ed.ac.uk" : "name@example.com";
      $("#account-email-hint").textContent = ob.student
        ? "Use your university email: " + STUDENT_DOMAINS.join(", ").replace(/, ([^,]*)$/, " or $1") : "";
    }
    if (step === "verify") $("#verify-email").textContent = ob.email;
    if (focus) stepEl(step).querySelector(".display").focus();
  }

  $$("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () { showStep(b.dataset.go, true); });
  });
  $$("[data-student]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.onboard.student = (b.dataset.student === "yes");
      showStep(state.onboard.student ? "year" : "account", true);
    });
  });
  $$("[data-year]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.onboard.year = b.dataset.year;
      showStep("account", true);
    });
  });

  // Runs one request for a form: locks its button, shows any error under the fields.
  function submitForm(form, errorEl, request, done) {
    var btn = form.querySelector('[type="submit"]');
    errorEl.textContent = "";
    btn.disabled = true;
    request().then(done, function (err) { errorEl.textContent = err.message; })
      .then(function () { btn.disabled = false; });
  }

  function awaitCode(email, from, res) {
    state.onboard.email = email;
    state.onboard.from = from;
    $("#verify-code").value = "";
    $("#verify-error").textContent = "";
    showDevCode(res);
    showStep("verify", true);
  }

  // dev_code only comes back when the server has no email service set up.
  function showDevCode(res) {
    var note = $("#verify-dev");
    note.hidden = !res.dev_code;
    note.innerHTML = res.dev_code
      ? "Email is not set up on this server yet, so no email was sent. Your code is <strong>" + esc(res.dev_code) + "</strong>"
      : "";
  }

  function signedIn(res) {
    state.user = { method: "email", value: res.user.email, student: res.user.is_student,
                   year: res.user.year, token: res.token };
    save(USER_KEY, state.user);
    // The account's GP wins; a GP picked before signing in is added to the account.
    if (res.user.gp_id) setMyGp(res.user.gp_id, true);
    else if (state.gp) setMyGp(state.gp);
    state.onboard.step = "welcome";
    go("home");
  }

  function checkEmail(email, student) {
    if (!email) return "Please enter your email address.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "That email address does not look right.";
    if (student && STUDENT_DOMAINS.indexOf(email.split("@")[1].toLowerCase()) === -1) {
      return "Please use your university email, like name@ed.ac.uk";
    }
    return "";
  }

  $("#account-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var ob = state.onboard;
    var email = $("#account-email").value.trim();
    var password = $("#account-password").value;
    var error = checkEmail(email, ob.student) ||
      (password.length < 8 ? "Use at least 8 characters for your password." : "");
    $("#account-error").textContent = error;
    if (error) { (checkEmail(email, ob.student) ? $("#account-email") : $("#account-password")).focus(); return; }

    submitForm(e.target, $("#account-error"), function () {
      return api("signup", { email: email, password: password, is_student: ob.student,
                             year: ob.student ? ob.year : null });
    }, function (res) {
      $("#account-password").value = "";
      awaitCode(email, "account", res);
    });
  });

  $("#verify-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#verify-code").value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      $("#verify-error").textContent = "Type the 6 numbers from your email.";
      $("#verify-code").focus();
      return;
    }
    submitForm(e.target, $("#verify-error"), function () {
      return api("verify", { email: state.onboard.email, code: code });
    }, signedIn);
  });

  $("#verify-resend").addEventListener("click", function () {
    var error = $("#verify-error");
    api("resend", { email: state.onboard.email }).then(function (res) {
      showDevCode(res);
      error.textContent = "We sent a new code.";
    }, function (err) { error.textContent = err.message; });
  });

  $("#login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("#login-email").value.trim();
    var password = $("#login-password").value;
    var error = checkEmail(email, false) || (password ? "" : "Please enter your password.");
    $("#login-error").textContent = error;
    if (error) return;

    submitForm(e.target, $("#login-error"), function () {
      return api("login", { email: email, password: password });
    }, function (res) {
      $("#login-password").value = "";
      // An account that never finished sign up is sent a fresh code instead.
      if (res.status === "verify") awaitCode(email, "login", res);
      else signedIn(res);
    });
  });

  $("#signup-skip").addEventListener("click", function () {
    save(SKIP_KEY, true, sessionStorage);
    go("home");
  });

  /* ---------- Start screen ---------- */
  // Shown on every load. The app underneath is inert until the logo is tapped.
  $("#screen").inert = true;
  var SPLASH_LEAVE_MS = 1450; // stars spin out, then the sky fades (see .splash.leaving)
  $("#splash-start").addEventListener("click", function () {
    var splash = $("#splash");
    var calm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("#splash-start").disabled = true;
    $("#screen").inert = false;
    splash.classList.add("leaving");
    setTimeout(function () {
      splash.hidden = true;
      focusView(parseHash().view);
    }, calm ? 0 : SPLASH_LEAVE_MS);
  });

  /* ---------- Nearby places (GPs, pharmacies, minor injuries units) ---------- */
  var NEARBY = {
    gp:       { list: "#gp-list", tag: "gp", count: 5 },
    pharmacy: { list: "#pharmacy-list", tag: "pharmacy", count: 3 },
    library:  { list: "#library-list", tag: "library", count: 3 },
    miu:      { list: "#miu-list", tag: "miu", count: 5 },
  };

  // A GP has to cover your home address, so a typed postcode comes first there.
  // Everything else is about where you are right now.
  function originFor(kind) {
    return kind === "gp" ? (state.home || state.here) : (state.here || state.home);
  }

  function placeHtml(s, km, kind) {
    var mine = (s.id === state.gp);
    return '<li class="place' + (mine ? " is-mine" : "") + '">' +
      '<span class="card-name">' + esc(s.name) + '</span>' +
      (km !== null ? '<span class="card-distance">' + formatDistance(km) + '</span>' : "") +
      '<span class="muted">' + esc(s.address.street) + ", " + esc(s.address.postcode) + '</span>' +
      '<div class="btn-row">' +
        (s.phone ? '<a class="btn" href="tel:' + esc(s.phone.replace(/\s/g, "")) + '">Call ' + esc(s.phone) + '</a>' : "") +
        '<button type="button" class="btn" data-detail="' + esc(s.id) + '">More details</button>' +
        (kind === "gp" && !mine ? '<button type="button" class="btn primary" data-my-gp="' + esc(s.id) + '">This is my GP</button>' : "") +
      '</div></li>';
  }

  function renderNearbyList(kind) {
    var cfg = NEARBY[kind];
    var origin = originFor(kind === "miu" ? "pharmacy" : kind);
    var items = state.services.filter(function (s) { return (s.tags || []).indexOf(cfg.tag) !== -1; });
    var km = {};
    items.forEach(function (s) { km[s.id] = origin && hasLocation(s) ? distanceKm(origin, s.location) : null; });
    // Without a starting point "nearest" means nothing, so only the short fixed lists show.
    if (!origin && kind !== "miu") items = [];
    items.sort(function (a, b) {
      return (km[a.id] === null ? Infinity : km[a.id]) - (km[b.id] === null ? Infinity : km[b.id]);
    });
    $(cfg.list).innerHTML = items.slice(0, cfg.count).map(function (s) { return placeHtml(s, km[s.id], kind); }).join("");
  }

  // The line above each list: where "near you" is measured from, and a postcode box.
  function renderOrigin(el) {
    var kind = el.dataset.near;
    var origin = originFor(kind);
    var usingHome = origin && origin === state.home;
    var text;
    if (usingHome) text = "Showing places near " + esc(state.home.postcode) + ".";
    else if (origin) text = "Showing places near where you are now.";
    else if (state.locStatus === "pending") text = "Finding your location\u2026";
    else text = "We do not know where you are yet. Type your postcode to see the nearest places.";
    // GPs go by home address, so always offer the postcode box there.
    var form = (!origin || kind === "gp" || usingHome)
      ? '<form class="postcode-form" novalidate>' +
          '<label class="visually-hidden" for="postcode-' + kind + '">Your postcode</label>' +
          '<input id="postcode-' + kind + '" type="text" autocomplete="postal-code" placeholder="Your postcode" value="' +
            esc(state.home ? state.home.postcode : "") + '">' +
          '<button type="submit" class="btn">Find</button></form>' +
        '<p class="field-error" aria-live="polite"></p>'
      : "";
    el.innerHTML = '<p class="muted small">' + text +
      (kind === "gp" && !usingHome ? " A GP has to cover your home address, so type your home postcode." : "") +
      '</p>' + form;
  }

  function renderNearby() {
    // Do not redraw a postcode box while someone is typing in it.
    if (!document.activeElement || !document.activeElement.closest(".postcode-form")) {
      $$(".near-origin").forEach(renderOrigin);
    }
    Object.keys(NEARBY).forEach(renderNearbyList);
    renderMyGp();
  }

  // Postcodes are looked up with postcodes.io, the same service the data scripts use.
  function lookupPostcode(form) {
    var error = form.nextElementSibling;
    var postcode = form.querySelector("input").value.trim().toUpperCase();
    error.textContent = "";
    if (!postcode) { error.textContent = "Please type your postcode."; return; }
    fetch("https://api.postcodes.io/postcodes/" + encodeURIComponent(postcode)).then(function (r) {
      if (r.status === 404) throw new Error("We could not find that postcode. Check it and try again.");
      if (!r.ok) throw new Error("We could not look up that postcode just now. Please try again.");
      return r.json();
    }).then(function (data) {
      state.home = { postcode: data.result.postcode, lat: data.result.latitude, lon: data.result.longitude };
      save(HOME_KEY, state.home);
      document.activeElement.blur();
      renderNearby();
    }).catch(function (err) {
      error.textContent = err instanceof TypeError
        ? "We could not look up that postcode just now. Please try again." : err.message;
    });
  }

  document.addEventListener("submit", function (e) {
    if (!e.target.classList.contains("postcode-form")) return;
    e.preventDefault();
    lookupPostcode(e.target);
  });

  document.addEventListener("click", function (e) {
    var detail = e.target.closest("[data-detail]");
    var gp = e.target.closest("[data-my-gp]");
    if (detail) {
      state.detailFrom = parseHash().view;
      go("detail/" + encodeURIComponent(detail.dataset.detail));
    } else if (gp) {
      setMyGp(gp.dataset.myGp);
      $("#screen").scrollTop = 0;
      $("#my-gp").querySelector("h2").focus();
    }
  });

  /* ---------- My GP ---------- */
  // Kept on this device, and on the account too when signed in.
  function setMyGp(id, fromAccount) {
    state.gp = id;
    if (id) save(GP_KEY, id); else remove(GP_KEY);
    if (!fromAccount && state.user && state.user.token) {
      fetch("/api/auth/gp", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + state.user.token },
        body: JSON.stringify({ gp_id: id }),
      }).catch(function () { /* still saved on this device */ });
    }
    renderNearby();
  }

  function renderMyGp() {
    var el = $("#my-gp");
    var gp = state.gp && state.services.filter(function (s) { return s.id === state.gp; })[0];
    if (!gp) {
      el.innerHTML = '<h2 class="section-title" tabindex="-1">My GP</h2>' +
        '<p class="muted">You have not picked a GP yet. When you have registered with one, ' +
        'find it in the list below and tap "This is my GP".</p>';
      return;
    }
    el.innerHTML = '<h2 class="section-title" tabindex="-1">My GP</h2>' +
      '<div><p class="account-value">' + esc(gp.name) + '</p>' +
      '<p class="muted">' + esc(gp.address.street) + ", " + esc(gp.address.postcode) + '</p></div>' +
      (gp.phone ? '<a class="btn primary block" href="tel:' + esc(gp.phone.replace(/\s/g, "")) + '">Call ' + esc(gp.phone) + '</a>' : "") +
      '<div class="btn-row">' +
        '<button type="button" class="btn" data-detail="' + esc(gp.id) + '">More details</button>' +
        '<button type="button" class="btn" id="gp-remove">This is not my GP</button>' +
      '</div>';
    $("#gp-remove").addEventListener("click", function () { setMyGp(null); });
  }

  /* ---------- Injury help ---------- */
  // Wording follows NHS inform (nhsinform.scot), rewritten in plain words.
  var INJURIES = [
    { id: "cut", name: "A cut or graze",
      source: "https://www.nhsinform.scot/illnesses-and-conditions/injuries/skin-injuries/cuts-and-grazes/",
      steps: [
        "Press on the cut with a clean cloth or bandage for 10 minutes. This stops the bleeding.",
        "If the cut is on your hand or arm, hold it above your head. If it is on your leg, lie down and lift your leg up.",
        "When the bleeding has stopped, clean the cut.",
        "Cover it with a plaster or a dressing.",
        "If it hurts, you can take paracetamol or ibuprofen.",
      ],
      emergency: [
        "the bleeding will not stop",
        "blood is coming out in spurts",
        "you cannot feel or move the part near the cut",
        "the cut is on your face or the palm of your hand and it is bad",
        "the cut is very big or deep",
        "something is stuck in the cut, like glass. Do not pull it out",
      ],
      urgent: [
        "the cut is still dirty after you cleaned it",
        "a person or an animal bit you",
        "the cut is red, swollen, getting more sore, or has pus in it",
        "the cut is longer than 5cm (2 inches)",
        "you feel unwell or hot",
      ],
      where: "For a small cut, a pharmacy can give you plasters and advice. If you think it needs stitches, go to a minor injuries unit." },
    { id: "burn", name: "A burn or scald",
      source: "https://www.nhsinform.scot/illnesses-and-conditions/injuries/skin-injuries/burns-and-scalds/",
      steps: [
        "Take off clothes or jewellery near the burn. Do not pull off anything that is stuck to the skin.",
        "Hold the burn under cold running water for 20 minutes. Do this as soon as you can.",
        "Do not use ice, creams or butter.",
        "Keep the rest of your body warm with a blanket or clothes.",
        "Lay cling film over the burn. Do not wrap it round your arm or leg.",
        "If it hurts, you can take paracetamol or ibuprofen.",
      ],
      emergency: [
        "the burn is very big or deep",
        "the burn is on your face, genitals or bottom",
        "the burn was caused by a chemical or by electricity",
      ],
      urgent: ["you are not sure what to do"],
      where: "For a small burn, a pharmacy can give you advice and dressings. For a bigger burn, go to a minor injuries unit." },
    { id: "other", name: "Something else",
      source: "https://www.nhsinform.scot/illnesses-and-conditions/injuries/",
      steps: ["Call 111. It is free. They will tell you what to do and where to go."],
      emergency: ["someone is badly hurt", "someone hit their head and is sleepy, confused or being sick"],
      urgent: [],
      where: "A pharmacy can help with small injuries. A minor injuries unit can help with sprains and broken bones." },
  ];

  function renderInjury() {
    $("#injury-chips").innerHTML = INJURIES.map(function (inj) {
      return '<button type="button" class="chip" data-injury="' + inj.id + '" aria-pressed="' +
        (state.injury === inj.id) + '">' + esc(inj.name) + '</button>';
    }).join("");

    var inj = INJURIES.filter(function (i) { return i.id === state.injury; })[0];
    var list = function (items, ordered) {
      var tag = ordered ? "ol" : "ul";
      return "<" + tag + ' class="steps">' + items.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</" + tag + ">";
    };
    $("#injury-advice").className = "advice";
    $("#injury-advice").innerHTML = !inj ? "" :
      '<div class="panel"><h2 class="section-title">What to do now</h2>' + list(inj.steps, true) + '</div>' +
      '<div class="callout"><p><strong>Call 999 or go to A&amp;E if:</strong></p>' + list(inj.emergency) +
        '<a class="btn primary" href="tel:999">Call 999</a></div>' +
      (inj.urgent.length ? '<div class="panel"><h2 class="section-title">Call 111 or your GP if:</h2>' + list(inj.urgent) +
        '<a class="btn block" href="tel:111">Call 111</a></div>' : "") +
      '<div class="panel"><h2 class="section-title">Where to go</h2><p>' + esc(inj.where) + '</p>' +
        '<a class="toggle-link" href="' + inj.source + '" target="_blank" rel="noopener">Read more on NHS inform</a></div>';
  }
  $("#injury-chips").addEventListener("click", function (e) {
    var chip = e.target.closest("[data-injury]");
    if (!chip) return;
    state.injury = chip.dataset.injury;
    renderInjury();
  });

  /* ---------- Young Scot card ---------- */
  // The photo and number never leave this device.
  var PHOTO_MAX_PX = 1000;

  function renderYoungScot() {
    var ys = load(YS_KEY) || {};
    $("#ys-photo").hidden = !ys.photo;
    if (ys.photo) $("#ys-photo").src = ys.photo; else $("#ys-photo").removeAttribute("src");
    $("#ys-photo-remove").hidden = !ys.photo;
    $("#ys-file-label").textContent = ys.photo ? "Change photo" : "Add a photo";
    if (document.activeElement !== $("#ys-number")) $("#ys-number").value = ys.number || "";
  }

  function saveYoungScot(changes, message) {
    var ys = load(YS_KEY) || {};
    Object.keys(changes).forEach(function (k) { ys[k] = changes[k]; });
    try {
      localStorage.setItem(YS_KEY, JSON.stringify(ys));
      $("#ys-status").textContent = message;
    } catch (e) {
      $("#ys-status").textContent = "We could not save that on this phone.";
    }
    renderYoungScot();
  }

  $("#ys-file").addEventListener("change", function (e) {
    var file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    var img = new Image();
    img.onload = function () {
      // Shrink the photo so it fits in the browser's small storage space.
      var scale = Math.min(1, PHOTO_MAX_PX / Math.max(img.width, img.height));
      var canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      saveYoungScot({ photo: canvas.toDataURL("image/jpeg", 0.8) }, "Photo saved on this phone.");
    };
    img.onerror = function () { $("#ys-status").textContent = "We could not open that photo."; };
    img.src = URL.createObjectURL(file);
  });
  $("#ys-photo-remove").addEventListener("click", function () {
    saveYoungScot({ photo: null }, "Photo removed.");
  });
  $("#ys-number").addEventListener("input", function (e) {
    saveYoungScot({ number: e.target.value.trim() }, "Card number saved on this phone.");
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
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.map);

    state.services.forEach(function (s) {
      if (!hasLocation(s)) return;
      var marker = L.circleMarker([s.location.lat, s.location.lon], {
        radius: 9,
        className: "marker-dot",
        fillColor: colorFor(s.category),
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
      state.hereMarker = L.circleMarker(ll, { radius: 11, className: "here-dot" })
        .bindPopup("You are here")
        .addTo(state.map);
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
    return '<span class="cat"><i class="cat-dot" style="background:' + colorFor(cat) + '"></i>' +
      esc(cat) + "</span>";
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
    if (state.hereMarker) state.hereMarker.bringToFront(); // keep "you" above re-added pins
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
        (state.user.student ? '<p class="muted small">Student, ' + esc(YEAR_LABELS[state.user.year] || "") + '</p>' : '') +
        '<button type="button" class="btn block" id="sign-out">Sign out</button>';
      $("#sign-out").addEventListener("click", function () {
        if (state.user.token) {
          fetch("/api/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + state.user.token } })
            .catch(function () { /* signing out locally is enough */ });
        }
        state.user = null;
        state.gp = null;
        [USER_KEY, GP_KEY, YS_KEY].forEach(function (key) { remove(key); });
        remove(SKIP_KEY, sessionStorage);
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
  state.gp = load(GP_KEY);
  state.home = load(HOME_KEY);
  var savedPrefs = load(PREFS_KEY);
  if (savedPrefs) {
    state.prefs.textSize = Math.min(TEXT_SIZES.length - 1, Math.max(0, savedPrefs.textSize | 0));
    state.prefs.highContrast = !!savedPrefs.highContrast;
  }
  applyPrefs();
  renderHelplines();
  renderFaqs();
  renderCaptions();
  renderInjury();
  renderYoungScot();
  route();

  // Signed in on this device before: pick up anything changed on the account,
  // or sign out here if the account's session has ended.
  if (state.user && state.user.token) {
    fetch("/api/auth/me", { headers: { Authorization: "Bearer " + state.user.token } }).then(function (r) {
      if (r.status === 401) {
        state.user = null;
        remove(USER_KEY);
        route();
        return;
      }
      if (!r.ok) return;
      return r.json().then(function (user) {
        state.user.student = user.is_student;
        state.user.year = user.year;
        save(USER_KEY, state.user);
        if (user.gp_id) setMyGp(user.gp_id, true);
        $("#home-youngscot").hidden = !isStudent();
      });
    }).catch(function () { /* offline: keep what is saved on this device */ });
  }
})();
