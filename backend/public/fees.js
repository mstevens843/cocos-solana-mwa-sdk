// fees.js - Part 13 Bundle D.
// Loads the admin snapshot once on page load (the page is public;
// no token gate) and populates the 3 hero stats. No auto-refresh
// - users reload to see fresh numbers.

(function () {
  'use strict';

  function lamportsToSol(s) {
    if (typeof s !== 'string') return '0.0000';
    try {
      const n = BigInt(s);
      const whole = n / 1_000_000_000n;
      const frac = Number(n % 1_000_000_000n) / 1e9;
      return (Number(whole) + frac).toFixed(4);
    } catch (_) { return '0.0000'; }
  }

  fetch('/fees/snapshot', { headers: { accept: 'application/json' } })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then((snap) => {
      const rw = document.getElementById('rakeWeek');
      const ra = document.getElementById('rakeAllTime');
      const mw = document.getElementById('matchesWitnessed');
      if (rw) rw.textContent = lamportsToSol(snap.rakeAccruedThisWeek);
      if (ra) ra.textContent = lamportsToSol(snap.rakeAccruedAllTime);
      if (mw) mw.textContent = (snap.totalMatchesWitnessed || 0).toLocaleString();
    })
    .catch((e) => {
      console.error('fees snapshot fetch failed:', e);
      ['rakeWeek', 'rakeAllTime', 'matchesWitnessed'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = '-';
      });
    });
})();
