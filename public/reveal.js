/* looot-reveal tracking snippet. Sends the page path and referrer, and nothing else, after consent.
   Consent: call window.revealGrant() from your cookie banner, or set localStorage "reveal-consent" to "granted".
   It sends nothing when the browser sends the Global Privacy Control signal or Do Not Track. */
(function () {
  var tag = document.currentScript;
  var endpoint = (tag && tag.getAttribute("data-endpoint")) || (tag && tag.src ? new URL("/api/collect", tag.src).href : "/api/collect");
  function allowed() {
    if (navigator.globalPrivacyControl || navigator.doNotTrack === "1") return false;
    try {
      return window.revealConsent === true || localStorage.getItem("reveal-consent") === "granted";
    } catch (e) {
      return window.revealConsent === true;
    }
  }
  function send() {
    if (!allowed()) return;
    var body = JSON.stringify({ path: location.pathname, referrer: document.referrer ? new URL(document.referrer).origin : "", consent: true });
    try {
      fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/plain" }, body: body, keepalive: true, mode: "cors" }).catch(function () {});
    } catch (e) {}
  }
  window.revealGrant = function () {
    try {
      localStorage.setItem("reveal-consent", "granted");
    } catch (e) {}
    send();
  };
  send();
})();
