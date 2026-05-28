// Sparkline hover tooltip.
// Event-delegated on document so HTMX row swaps don't strand listeners.
//
// Reads from data-* attributes on .spark[data-interactive] spans:
//   data-spark      comma-separated numbers
//   data-spark-w    SVG viewBox width (default 76)
//   data-spark-unit unit suffix shown in tooltip (default "ms")

(function () {
  let tip = null;
  let crosshair = null;

  function ensureTip() {
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "spark-tip";
      tip.style.display = "none";
      document.body.appendChild(tip);
    }
    return tip;
  }

  function hideTip() {
    if (tip) tip.style.display = "none";
    if (crosshair && crosshair.parentNode) crosshair.parentNode.removeChild(crosshair);
    crosshair = null;
  }

  function nearestIdx(mouseX, rect, count) {
    const ratio = Math.max(0, Math.min(1, (mouseX - rect.left) / rect.width));
    return Math.round(ratio * (count - 1));
  }

  function onMove(e) {
    const target = e.target;
    if (!target || !target.closest) { hideTip(); return; }
    const host = target.closest(".spark[data-interactive]");
    if (!host) { hideTip(); return; }
    const svg = host.querySelector("svg");
    if (!svg) { hideTip(); return; }

    const dataAttr = host.getAttribute("data-spark") || "";
    const values = dataAttr.split(",").map(Number).filter(function (n) { return !Number.isNaN(n); });
    // 1-point series can't have a crosshair (stepX would divide by zero and
    // every coordinate becomes NaN). Server-side renders these as a "—"
    // placeholder, but defend here too in case a partial DOM slipped through.
    if (values.length < 2) { hideTip(); return; }

    const w = Number(host.getAttribute("data-spark-w") || svg.getAttribute("width") || 76);
    const h = Number(svg.getAttribute("height") || 20);
    const unit = host.getAttribute("data-spark-unit") || "ms";

    const rect = svg.getBoundingClientRect();
    const idx = nearestIdx(e.clientX, rect, values.length);
    const value = values[idx];

    // Compute the SVG-space coordinates of the data point (same formula as makeSparkPath).
    const pad = 2;
    const max = Math.max.apply(null, values);
    const min = Math.min.apply(null, values);
    const range = max - min || 1;
    const stepX = (w - pad * 2) / (values.length - 1);
    const px = pad + idx * stepX;
    const py = pad + (h - pad * 2) * (1 - (value - min) / range);

    // Draw vertical crosshair line + dot at the data point.
    if (!crosshair || crosshair.parentNode !== svg) {
      if (crosshair && crosshair.parentNode) crosshair.parentNode.removeChild(crosshair);
      crosshair = document.createElementNS("http://www.w3.org/2000/svg", "g");
      crosshair.setAttribute("pointer-events", "none");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("stroke", "currentColor");
      line.setAttribute("opacity", "0.45");
      line.setAttribute("stroke-width", "0.6");
      crosshair.appendChild(line);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", "2.2");
      dot.setAttribute("fill", "currentColor");
      dot.setAttribute("stroke", "var(--bg-2)");
      dot.setAttribute("stroke-width", "1.2");
      crosshair.appendChild(dot);
      svg.appendChild(crosshair);
    }
    const line = crosshair.childNodes[0];
    const dot = crosshair.childNodes[1];
    line.setAttribute("x1", String(px));
    line.setAttribute("x2", String(px));
    line.setAttribute("y1", "0");
    line.setAttribute("y2", String(h));
    dot.setAttribute("cx", String(px));
    dot.setAttribute("cy", String(py));

    // Tooltip in document space — escapes any overflow:hidden on the row.
    const t = ensureTip();
    const tipX = rect.left + (px / w) * rect.width;
    const tipY = rect.top - 8;
    t.textContent = unit === "%" ? value.toFixed(1) + "%" : Math.round(value) + unit;
    t.style.left = tipX + "px";
    t.style.top = tipY + "px";
    t.style.display = "block";
  }

  document.addEventListener("mousemove", onMove, { passive: true });
  document.addEventListener("mouseleave", hideTip, true);
  document.addEventListener("scroll", hideTip, true);
})();
