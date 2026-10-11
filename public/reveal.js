/* looot-reveal tracking snippet. Sends the page path and referrer, and nothing else, after consent.
   Consent: call window.revealGrant() from your cookie banner, or set localStorage "reveal-consent" to "granted".
   It sends nothing when the browser sends the Global Privacy Control signal or Do Not Track.

   Optional person-level mode (US only, off unless the server turns it on): add data-person="1" to the script tag.
   - It sends a first-party random id (localStorage "reveal-vid") and the page URL, and only after a second consent:
     window.revealGrantPerson(), localStorage "reveal-person-consent" = "granted", or OneTrust (C0004), Cookiebot
     (marketing) or CookieYes (advertisement). Add data-person-consent="not-required" to skip that wait.
   - window.revealIdentify(email) hashes an email you already hold (login, form submit) with SHA-256 in the browser and
     sends the hash. The email never leaves the page. A SHA-256 in the URL parameter reveal_eh does the same for an email click.
   - With GPC or DNT it sends one empty signal so the server can log that it skipped. No id, no path.
   It makes no call to any third-party domain. */
(function () {
  var tag = document.currentScript;
  var endpoint = (tag && tag.getAttribute("data-endpoint")) || (tag && tag.src ? new URL("/api/collect", tag.src).href : "/api/collect");
  var personMode = !!tag && tag.getAttribute("data-person") === "1";
  var personFree = !!tag && tag.getAttribute("data-person-consent") === "not-required";

  function objects() {
    return navigator.globalPrivacyControl ? "gpc" : navigator.doNotTrack === "1" ? "dnt" : "";
  }
  function allowed() {
    if (objects()) return false;
    try {
      return window.revealConsent === true || localStorage.getItem("reveal-consent") === "granted";
    } catch (e) {
      return window.revealConsent === true;
    }
  }
  function post(obj) {
    try {
      fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(obj), keepalive: true, mode: "cors" }).catch(function () {});
    } catch (e) {}
  }

  function personConsent() {
    if (personFree) return true;
    try {
      if (window.revealPersonConsent === true || localStorage.getItem("reveal-person-consent") === "granted") return true;
      if (typeof window.OnetrustActiveGroups === "string" && window.OnetrustActiveGroups.indexOf("C0004") >= 0) return true;
      if (window.Cookiebot && window.Cookiebot.consent && window.Cookiebot.consent.marketing === true) return true;
      if (/(?:^|;\s*)cookieyes-consent=[^;]*advertisement:yes/.test(document.cookie)) return true;
    } catch (e) {}
    return false;
  }
  function visitorId() {
    try {
      var id = localStorage.getItem("reveal-vid");
      if (!id) {
        var b = new Uint8Array(16);
        crypto.getRandomValues(b);
        id = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
        localStorage.setItem("reveal-vid", id);
      }
      return id;
    } catch (e) {
      return "";
    }
  }
  var emailHash = "";
  function takeUrlHash() {
    var m = /[?&]reveal_eh=([a-fA-F0-9]{64})(?:&|$)/.exec(location.search);
    if (m) emailHash = m[1].toLowerCase();
  }
  var personSent = false;
  function sendPerson(force) {
    if (!personMode || !allowed() || !personConsent()) return;
    if (personSent && !force) return;
    personSent = true;
    var body = { personOnly: true, consent: true, personConsent: true, path: location.pathname, origin: location.origin, vid: visitorId() };
    if (emailHash) body.emailHash = emailHash;
    post(body);
  }

  var pageSent = false;
  function send() {
    var o = objects();
    if (o) {
      if (personMode) post({ signal: o });
      return;
    }
    if (!allowed()) return;
    if (!pageSent) {
      pageSent = true;
      post({ path: location.pathname, referrer: document.referrer ? new URL(document.referrer).origin : "", consent: true });
    }
    sendPerson(false);
  }

  window.revealGrant = function () {
    try {
      localStorage.setItem("reveal-consent", "granted");
    } catch (e) {}
    send();
  };
  window.revealGrantPerson = function () {
    try {
      localStorage.setItem("reveal-person-consent", "granted");
    } catch (e) {}
    sendPerson(false);
  };
  /* Pass the email you already hold. It is hashed here and only the SHA-256 is sent. */
  window.revealIdentify = function (email) {
    if (!personMode || typeof email !== "string" || !window.crypto || !crypto.subtle) return;
    var bytes = new TextEncoder().encode(email.trim().toLowerCase());
    crypto.subtle.digest("SHA-256", bytes).then(function (buf) {
      emailHash = Array.prototype.map.call(new Uint8Array(buf), function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      sendPerson(true);
    });
  };
  window.revealIdentifyHash = function (hex) {
    if (personMode && typeof hex === "string" && /^[a-fA-F0-9]{64}$/.test(hex)) {
      emailHash = hex.toLowerCase();
      sendPerson(true);
    }
  };
  if (personMode) {
    takeUrlHash();
    ["OneTrustGroupsUpdated", "CookiebotOnAccept", "cookieyes_consent_update"].forEach(function (ev) {
      window.addEventListener(ev, function () { sendPerson(false); });
    });
  }
  send();
})();
