// Client-side enhancements: bulk selection, filter dropdown, ⌘K command
// palette, and unacked-incident sound notification. Vanilla — no framework.
// Event delegation is used wherever possible so HTMX swaps don't strand
// listeners.

(function () {
  // ============================================================
  // Bulk operations
  // ============================================================
  function setupBulk() {
    const toolbar = document.getElementById("dash-bulk-toolbar");
    if (!toolbar) return;
    const idInputs = ["pause", "resume", "mute", "delete"]
      .map((k) => document.getElementById("dash-bulk-ids-" + k))
      .filter(Boolean);
    const count = document.getElementById("dash-bulk-count");
    const selectAll = document.getElementById("dash-row-check-all");
    const clearBtn = document.getElementById("dash-bulk-clear");

    function refresh() {
      const boxes = document.querySelectorAll(".dash-row-checkbox");
      const selected = [];
      for (const b of boxes) if (b.checked) selected.push(b.value);
      const csv = selected.join(",");
      for (const inp of idInputs) inp.value = csv;
      count.textContent = String(selected.length);
      toolbar.classList.toggle("visible", selected.length > 0);
      if (selectAll) {
        selectAll.indeterminate = selected.length > 0 && selected.length < boxes.length;
        selectAll.checked = boxes.length > 0 && selected.length === boxes.length;
      }
    }

    document.addEventListener("change", function (e) {
      const t = e.target;
      if (t && t.classList && t.classList.contains("dash-row-checkbox")) refresh();
    });

    if (selectAll) {
      selectAll.addEventListener("change", function () {
        document.querySelectorAll(".dash-row-checkbox").forEach(function (b) {
          b.checked = selectAll.checked;
        });
        refresh();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        document.querySelectorAll(".dash-row-checkbox").forEach(function (b) { b.checked = false; });
        if (selectAll) selectAll.checked = false;
        refresh();
      });
    }
  }

  // ============================================================
  // Filter dropdown — open/close on trigger click + outside click
  // ============================================================
  function setupFilter() {
    const trigger = document.getElementById("filter-dropdown-trigger");
    const container = document.getElementById("filter-dropdown");
    if (!trigger || !container) return;
    trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      container.dataset.open = container.dataset.open === "1" ? "" : "1";
    });
    document.addEventListener("click", function (e) {
      if (!container.contains(e.target)) container.dataset.open = "";
    });
  }

  // ============================================================
  // Command palette (⌘K / Ctrl+K)
  // ============================================================
  function setupPalette() {
    const backdrop = document.createElement("div");
    backdrop.id = "cmdk-backdrop";
    backdrop.className = "cmdk-backdrop";
    backdrop.innerHTML =
      '<div class="cmdk-panel">' +
      '<input type="text" class="cmdk-input" id="cmdk-input" placeholder="Type a command or search…" autocomplete="off" spellcheck="false" />' +
      '<div class="cmdk-results" id="cmdk-results"></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector("#cmdk-input");
    const results = backdrop.querySelector("#cmdk-results");

    const baseActions = [
      { label: "Go to Monitors", kind: "nav", href: "/dashboard" },
      { label: "Go to Incidents", kind: "nav", href: "/incidents" },
      { label: "Go to Webhooks (admin)", kind: "nav", href: "/webhooks" },
      { label: "Go to Settings (admin)", kind: "nav", href: "/settings" },
      { label: "+ New monitor", kind: "action", href: "/monitors/new" },
      { label: "Toggle theme", kind: "action", run: "toggleTheme" },
      { label: "Set density: comfort", kind: "action", run: "setDensity", arg: "comfort" },
      { label: "Set density: compact", kind: "action", run: "setDensity", arg: "compact" },
      { label: "Set density: dense", kind: "action", run: "setDensity", arg: "dense" },
      { label: "Toggle sound notifications", kind: "action", run: "toggleSound" },
    ];

    // Augment with monitor jumps scraped from the current page.
    function discoverMonitorActions() {
      const out = [];
      document.querySelectorAll(".dash-row").forEach(function (a) {
        const name = a.querySelector(".dash-name-text");
        if (!name || !a.href) return;
        out.push({ label: "Open: " + name.textContent.trim(), kind: "monitor", href: a.getAttribute("href") });
      });
      return out;
    }

    let activeIdx = 0;
    let lastFiltered = [];

    function getActions() {
      return baseActions.concat(discoverMonitorActions());
    }

    function filter(q) {
      const ql = q.toLowerCase();
      if (!ql) return getActions();
      return getActions().filter(function (a) { return a.label.toLowerCase().indexOf(ql) >= 0; });
    }

    function render() {
      lastFiltered = filter(input.value);
      if (lastFiltered.length === 0) {
        results.innerHTML = '<div class="cmdk-empty">No matches.</div>';
        return;
      }
      if (activeIdx >= lastFiltered.length) activeIdx = lastFiltered.length - 1;
      if (activeIdx < 0) activeIdx = 0;
      const html = lastFiltered.map(function (a, i) {
        const cls = i === activeIdx ? " active" : "";
        return '<div class="cmdk-item' + cls + '" data-idx="' + i + '">' +
          '<span>' + escapeHTML(a.label) + '</span>' +
          '<span class="cmdk-item-kind">' + a.kind + '</span>' +
          '</div>';
      }).join("");
      results.innerHTML = html;
      results.querySelectorAll(".cmdk-item").forEach(function (el) {
        el.addEventListener("click", function () {
          activeIdx = Number(el.dataset.idx);
          execute();
        });
      });
    }

    function execute() {
      const a = lastFiltered[activeIdx];
      if (!a) return;
      if (a.href) { window.location = a.href; return; }
      if (a.run === "toggleTheme") {
        const cur = document.body.dataset.theme === "light" ? "dark" : "light";
        submitForm("/preferences/theme", { theme: cur, next: window.location.pathname });
      } else if (a.run === "setDensity") {
        submitForm("/preferences/density", { density: a.arg, next: window.location.pathname });
      } else if (a.run === "toggleSound") {
        const cur = localStorage.getItem("uptime-sound") === "off" ? "on" : "off";
        localStorage.setItem("uptime-sound", cur);
        alert("Incident sound notifications: " + cur);
        close();
      }
    }

    function submitForm(action, fields) {
      const f = document.createElement("form");
      f.method = "post"; f.action = action;
      for (const k in fields) {
        const i = document.createElement("input");
        i.type = "hidden"; i.name = k; i.value = fields[k];
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    }

    function escapeHTML(s) {
      return s.replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
      });
    }

    function open() {
      backdrop.classList.add("open");
      input.value = "";
      activeIdx = 0;
      render();
      setTimeout(function () { input.focus(); }, 10);
    }
    function close() {
      backdrop.classList.remove("open");
    }

    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); open(); return; }
      if (!backdrop.classList.contains("open")) return;
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); activeIdx++; render(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); activeIdx--; render(); }
      else if (e.key === "Enter") { e.preventDefault(); execute(); }
    });
    input.addEventListener("input", function () { activeIdx = 0; render(); });
    backdrop.addEventListener("click", function (e) { if (e.target === backdrop) close(); });

    // Topbar "Search · jump to monitor" button — same open path as ⌘K.
    document.querySelectorAll(".kbd-button").forEach(function (btn) {
      btn.addEventListener("click", open);
    });

    // Swap the macOS-glyph hint to "Ctrl K" on non-macOS so Windows/Linux
    // users see the shortcut their platform uses.
    const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
    if (!isMac) {
      document.querySelectorAll(".kbd-button kbd").forEach(function (el) {
        el.textContent = "Ctrl K";
      });
    }
  }

  // ============================================================
  // Sound notification on new unacked incident
  // ============================================================
  function setupSoundPoll() {
    let lastCount = -1;

    function soundEnabled() {
      return localStorage.getItem("uptime-sound") !== "off";
    }

    function beep() {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        const ctx = new AC();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
      } catch (e) { /* ignore */ }
    }

    function flashTitle(delta, count) {
      const orig = document.title;
      let i = 0;
      const id = setInterval(function () {
        document.title = i % 2 === 0 ? "(!) " + count + " incident" + (count === 1 ? "" : "s") : orig;
        if (++i > 8) { clearInterval(id); document.title = orig; }
      }, 600);
    }

    async function poll() {
      try {
        const res = await fetch("/incidents/poll", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const cur = Number(data.unacked || 0);
        if (lastCount >= 0 && cur > lastCount && soundEnabled()) {
          beep();
          flashTitle(cur - lastCount, cur);
        }
        lastCount = cur;
      } catch (e) { /* ignore */ }
    }

    poll();
    setInterval(poll, 5000);
  }

  function init() {
    setupBulk();
    setupFilter();
    setupPalette();
    setupSoundPoll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
