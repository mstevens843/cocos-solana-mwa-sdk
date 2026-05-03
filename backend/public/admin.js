// admin.js - Part 12 Bundle B.
// Pure vanilla JS; no framework. Opens an EventSource on /admin/stream,
// renders StatsSnapshot on each event. Auto-reconnects on drop via
// EventSource's native behavior (browser handles it with exponential backoff).

(function () {
  'use strict';

  const streamStatus = document.getElementById('streamStatus');
  const serverPubkey = document.getElementById('serverPubkey');
  const treeAddress = document.getElementById('treeAddress');
  const uptime = document.getElementById('uptime');
  const receiptsEl = document.getElementById('receiptsSigned');
  const rejectsEl = document.getElementById('cheatRejects');
  const sessionsEl = document.getElementById('sessionsAlive');
  const matchesEl = document.getElementById('totalMatches');
  const receiptsSub = document.getElementById('receiptsSub');
  const rejectsSub = document.getElementById('rejectsSub');
  const sessionsSub = document.getElementById('sessionsSub');
  const matchesSub = document.getElementById('matchesSub');
  const receiptsList = document.getElementById('recentReceipts');
  const rejectsList = document.getElementById('recentRejects');
  const settlementsList = document.getElementById('recentSettlements');
  const rakeToday = document.getElementById('rakeToday');
  const rakeWeek = document.getElementById('rakeWeek');
  const rakeAllTime = document.getElementById('rakeAllTime');
  const tokensTracked = document.getElementById('tokensTracked');
  const tokensSub = document.getElementById('tokensSub');
  const tokenStatsBody = document.getElementById('tokenStatsBody');
  const tournamentsToday = document.getElementById('tournamentsToday');
  const tournamentsSub = document.getElementById('tournamentsSub');
  const tournamentHost = document.getElementById('tournamentHost');

  function shortPk(pk) {
    if (!pk) return '';
    return pk.length <= 10 ? pk : `${pk.slice(0, 4)}…${pk.slice(-4)}`;
  }

  function fmtUptime(sec) {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
  }

  function fmtRelative(atSec) {
    const delta = Math.floor(Date.now() / 1000) - atSec;
    if (delta < 2) return 'just now';
    if (delta < 60) return `${delta}s ago`;
    if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
    return `${Math.floor(delta / 3600)}h ago`;
  }

  function renderReceipts(entries) {
    if (!entries || entries.length === 0) {
      receiptsList.innerHTML = '<div class="log-empty">No receipts yet - waiting for the first match to finalize.</div>';
      return;
    }
    receiptsList.innerHTML = entries.map((e) => `
      <div class="log-item">
        <span class="time">${fmtRelative(e.at)}</span>
        <span class="msg">${shortPk(e.player)} · match ${shortPk(e.matchPda)} · h=${e.height}</span>
        <span class="tag">${e.verified ? '✓ VERIFIED' : 'legacy'}</span>
      </div>
    `).join('');
  }

  function renderRejects(entries) {
    if (!entries || entries.length === 0) {
      rejectsList.innerHTML = '<div class="log-empty">No rejects. Physics validator is happy.</div>';
      return;
    }
    rejectsList.innerHTML = entries.map((e) => `
      <div class="log-item reject">
        <span class="time">${fmtRelative(e.at)}</span>
        <span class="msg">${shortPk(e.player)} · ${e.reason}${e.blockIdx != null ? ` · blk ${e.blockIdx}` : ''}</span>
        <span class="tag">✗</span>
      </div>
    `).join('');
  }

  // Part 13: parse bigint-string lamports → SOL (4 decimals).
  function lamportsToSol(s) {
    if (typeof s !== 'string') return '0.0000';
    try {
      const n = BigInt(s);
      const whole = n / 1_000_000_000n;
      const frac = Number((n % 1_000_000_000n)) / 1e9;
      return (Number(whole) + frac).toFixed(4);
    } catch (_) { return '0.0000'; }
  }

  function renderSettlements(entries) {
    if (!settlementsList) return;
    if (!entries || entries.length === 0) {
      settlementsList.innerHTML = '<div class="log-empty">No settlements yet - listener is armed.</div>';
      return;
    }
    settlementsList.innerHTML = entries.map((e) => `
      <div class="log-item">
        <span class="time">${fmtRelative(e.at)}</span>
        <span class="msg">${shortPk(e.winner)} won ${lamportsToSol(e.potLamports)} SOL · match ${shortPk(e.matchPda)}</span>
        <span class="tag" style="color: var(--purple)">${lamportsToSol(e.rakeLamports)} rake</span>
      </div>
    `).join('');
  }

  function renderTokenStats(rows) {
    if (!tokenStatsBody) return;
    if (!rows || rows.length === 0) {
      tokenStatsBody.innerHTML = '<tr><td colspan="4" class="empty">no matches yet - play a few to populate</td></tr>';
      return;
    }
    tokenStatsBody.innerHTML = rows.map((r) => `
      <tr>
        <td class="mint">${shortPk(r.mint)}</td>
        <td>${r.matches}</td>
        <td>${r.wins}</td>
        <td class="winrate">${r.winratePct.toFixed(1)}%</td>
      </tr>
    `).join('');
  }

  function apply(snap) {
    streamStatus.textContent = 'live';
    streamStatus.style.color = 'var(--green)';
    serverPubkey.textContent = snap.serverPubkey || '(unset)';
    treeAddress.textContent = snap.treeAddress ? shortPk(snap.treeAddress) : '(not configured)';
    uptime.textContent = fmtUptime(snap.uptimeSec || 0);

    receiptsEl.textContent = snap.receiptsSigned.toLocaleString();
    rejectsEl.textContent = snap.cheatRejects.toLocaleString();
    sessionsEl.textContent = snap.sessionsAliveNow.toLocaleString();
    matchesEl.textContent = snap.totalMatchesWitnessed.toLocaleString();

    receiptsSub.textContent = `lifetime · ${snap.recentReceipts.length} recent`;
    rejectsSub.textContent = snap.blacklistedPlayers > 0
      ? `lifetime · ${snap.blacklistedPlayers} blacklisted now`
      : 'lifetime · 0 blacklisted';
    sessionsSub.textContent = `+ ${snap.spectatorsAliveNow} spectators`;
    matchesSub.textContent = `${snap.totalSessionsEver.toLocaleString()} sessions ever · ${snap.spectatorsConnectedEver.toLocaleString()} spectators ever`;

    renderReceipts(snap.recentReceipts);
    renderRejects(snap.recentRejects);

    // Part 13: rake cards + settlement log + token stats.
    if (rakeToday) rakeToday.textContent = lamportsToSol(snap.rakeAccruedToday);
    if (rakeWeek) rakeWeek.textContent = lamportsToSol(snap.rakeAccruedThisWeek);
    if (rakeAllTime) rakeAllTime.textContent = lamportsToSol(snap.rakeAccruedAllTime);
    if (tokensTracked) tokensTracked.textContent = (snap.tokenStats || []).length.toString();
    if (tokensSub) tokensSub.textContent = `this week · ${(snap.recentSettlements || []).length} recent settles`;
    renderSettlements(snap.recentSettlements);
    renderTokenStats(snap.tokenStats);

    // Part 14: tournament card.
    if (tournamentsToday) tournamentsToday.textContent = (snap.tournamentsSeededToday || 0).toString();
    if (tournamentsSub) {
      const completed = snap.tournamentsCompletedAllTime || 0;
      const seededAllTime = snap.tournamentsSeededAllTime || 0;
      tournamentsSub.textContent = `seeded · ${completed}/${seededAllTime} completed all-time`;
    }
    if (tournamentHost) {
      tournamentHost.textContent = snap.tournamentHost ? shortPk(snap.tournamentHost) : '(disabled)';
    }
  }

  // Token passthrough from URL so a ?token= that loaded the page also gates the stream.
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  const streamUrl = token ? `/admin/stream?token=${encodeURIComponent(token)}` : '/admin/stream';

  let es = null;
  function connect() {
    if (es) es.close();
    streamStatus.textContent = 'connecting…';
    streamStatus.style.color = 'var(--fg-mute)';
    es = new EventSource(streamUrl);
    es.onmessage = (ev) => {
      try { apply(JSON.parse(ev.data)); }
      catch (e) { console.error('bad snapshot', e); }
    };
    es.onerror = () => {
      streamStatus.textContent = 'reconnecting…';
      streamStatus.style.color = 'var(--red)';
    };
  }
  connect();
})();
