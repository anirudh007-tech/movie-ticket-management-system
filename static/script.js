/**
 * Movie Ticket Management System - script.js
 * Single-page application logic (no frameworks)
 *
 * Flow:
 *  Step 1 – Pick a date        (date pills)
 *  Step 2 – Pick a show        (show cards)
 *  Step 3 – Pick seats         (seat map)
 *  Step 4 – Enter details      (form in summary panel)
 *  Step 5 – Receipt / Confirm  (ticket view)
 */

/* ── State ─────────────────────────────────────────────── */
const state = {
  selectedDate:  null,   // 'YYYY-MM-DD'
  selectedShow:  null,   // full show object
  showSeats:     null,   // seats array from /api/shows/:id/seats
  selectedSeats: [],     // seat objects the user clicked
  pollTimer:     null,   // interval ID for seat-map polling
};

/* ── DOM references ─────────────────────────────────────── */
const $ = id => document.getElementById(id);

const steps = {
  1: $("step1"),
  2: $("step2"),
  3: $("step3"),
  4: $("step4"),   // step4 is the receipt step
};

/* ── Utility helpers ────────────────────────────────────── */

/** Show only the requested step; update progress bar */
function goToStep(n) {
  Object.values(steps).forEach(el => el.classList.remove("active"));
  if (steps[n]) steps[n].classList.add("active");

  // Update progress dots
  document.querySelectorAll(".progress-step").forEach((el, i) => {
    el.classList.remove("active", "done");
    const stepNum = i + 1;
    if (stepNum < n)       el.classList.add("done");
    else if (stepNum === n) el.classList.add("active");
  });
}

/** Format ISO date -> "Mon 5 Oct" */
function fmtDate(isoStr) {
  const d = new Date(isoStr + "T00:00:00");
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

/** Escape HTML to prevent XSS */
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Show a toast notification */
function showToast(msg, type = "success", duration = 4000) {
  const container = $("toast-container");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  t.innerHTML = `<span class="toast-icon ${type}">${type === "success" ? "✓" : "✕"}</span>
                 <span>${esc(msg)}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add("hiding");
    setTimeout(() => t.remove(), 350);
  }, duration);
}

/** Disable / enable a button and show spinner */
function setLoading(btn, loading) {
  if (loading) {
    btn.disabled = true;
    btn._origText = btn.innerHTML;
    btn.innerHTML = `<span class="spinner"></span> Loading…`;
  } else {
    btn.disabled = false;
    btn.innerHTML = btn._origText || "Book Now";
  }
}

/* ── URL hash routing ───────────────────────────────────── */
function handleHash() {
  const hash = window.location.hash;

  if (hash.startsWith("#receipt/")) {
    const id = parseInt(hash.split("/")[1]);
    if (!isNaN(id)) loadReceipt(id);
    return;
  }
  if (hash.startsWith("#payment/")) {
    const id = parseInt(hash.split("/")[1]);
    if (!isNaN(id)) {
      showPaymentDetails(id);
      return;
    }
  }
  // Default: go to step 1 with today's date
  initDatePills();
  goToStep(1);
}

window.addEventListener("hashchange", handleHash);
window.addEventListener("DOMContentLoaded", handleHash);

/* ── STEP 1 – Date Picker ───────────────────────────────── */
function initDatePills() {
  const row = $("date-row");
  row.innerHTML = "";

  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const iso = d.toISOString().split("T")[0];
    const label = i === 0 ? "Today" : (i === 1 ? "Tomorrow" : fmtDate(iso));

    const btn = document.createElement("button");
    btn.className = "date-pill" + (i === 0 ? " active" : "");
    btn.textContent = label;
    btn.setAttribute("data-date", iso);
    btn.setAttribute("aria-label", `Shows on ${iso}`);
    btn.addEventListener("click", () => selectDate(iso, btn));
    row.appendChild(btn);
  }

  // Auto-select today
  selectDate(today.toISOString().split("T")[0], row.firstChild);
}

function selectDate(dateStr, pillBtn) {
  state.selectedDate = dateStr;
  document.querySelectorAll(".date-pill").forEach(b => b.classList.remove("active"));
  pillBtn.classList.add("active");
  loadShows(dateStr);
}

/* ── STEP 2 – Show Cards ────────────────────────────────── */
async function loadShows(dateStr) {
  const grid = $("show-grid");
  grid.innerHTML = `<div class="empty-state"><div class="spinner" style="width:32px;height:32px;margin:0 auto 12px;"></div><p>Loading shows…</p></div>`;
  goToStep(1);

  try {
    const res  = await fetch(`/api/shows?date=${dateStr}`);
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || "Failed to load shows");

    if (data.length === 0) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><h3>No shows available</h3><p>Try a different date</p></div>`;
      return;
    }

    grid.innerHTML = "";
    data.forEach(show => {
      const pct = Math.round((show.booked_count / show.total_seats) * 100);
      const card = document.createElement("button");
      card.className = "show-card";
      card.setAttribute("aria-label", `${show.title} at ${show.show_time}`);
      card.innerHTML = `
        <div class="card-movie-title">${esc(show.title)}</div>
        <div class="card-tags">
          <span class="tag">${esc(show.language)}</span>
          <span class="tag">${esc(show.genre)}</span>
          <span class="tag">${show.duration_min} min</span>
        </div>
        <div class="card-time">${esc(show.show_time)}</div>
        <div class="card-venue">${esc(show.theatre)} &bull; ${esc(show.screen)}</div>
        <div class="card-price">From <strong>&#8377;${show.base_price.toFixed(0)}</strong></div>
        <div class="card-occupancy">${show.booked_count} booked / ${show.available} available</div>
        <div class="occupancy-bar"><div class="occupancy-fill" style="width:${pct}%"></div></div>`;
      card.addEventListener("click", () => openSeatMap(show));
      grid.appendChild(card);
    });
  } catch (err) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><h3>Error</h3><p>${esc(err.message)}</p></div>`;
    showToast(err.message, "error");
  }
}

/* ── STEP 3 – Seat Map ──────────────────────────────────── */
async function openSeatMap(show) {
  state.selectedShow  = show;
  state.selectedSeats = [];

  // Update show info in the summary panel
  $("summary-show-info").innerHTML = `
    <strong>${esc(show.title)}</strong><br>
    ${esc(show.theatre)} &bull; ${esc(show.screen)}<br>
    ${esc(show.show_date)} at <strong>${esc(show.show_time)}</strong>`;

  goToStep(2);
  await fetchAndRenderSeats();

  // Start polling every 6 seconds to reflect other users' bookings
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(pollSeats, 6000);
}

/** Fetch seat data from API and re-render the seat map */
async function fetchAndRenderSeats() {
  const mapEl = $("seat-map");
  mapEl.innerHTML = `<div class="empty-state"><div class="spinner" style="width:28px;height:28px;margin:0 auto 8px;"></div><p>Loading seats…</p></div>`;

  try {
    const res  = await fetch(`/api/shows/${state.selectedShow.show_id}/seats`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load seats");

    state.showSeats = data.seats;
    renderSeatMap(data);
  } catch (err) {
    $("seat-map").innerHTML = `<p class="text-error" style="text-align:center">${esc(err.message)}</p>`;
    showToast(err.message, "error");
  }
}

/** Re-poll without resetting the user's current selection */
async function pollSeats() {
  try {
    const res  = await fetch(`/api/shows/${state.selectedShow.show_id}/seats`);
    const data = await res.json();
    if (!res.ok) return;

    // Remove newly-booked seats from the selection
    const newlyBooked = new Set(data.seats.filter(s => s.booked).map(s => s.seat_id));
    state.selectedSeats = state.selectedSeats.filter(s => !newlyBooked.has(s.seat_id));

    state.showSeats = data.seats;
    renderSeatMap(data);
  } catch (_) { /* silently ignore poll errors */ }
}

/** Build the seat grid HTML */
function renderSeatMap(data) {
  const seats = data.seats;

  // Compute price per type from base_price
  const prices = {
    Regular: (data.base_price * 1.00).toFixed(0),
    Premium: (data.base_price * 1.25).toFixed(0),
    VIP:     (data.base_price * 1.50).toFixed(0),
  };

  // Update counters
  const booked    = seats.filter(s => s.booked).length;
  const selected  = state.selectedSeats.length;
  const available = seats.length - booked;

  $("cnt-total").textContent    = seats.length;
  $("cnt-booked").textContent   = booked;
  $("cnt-avail").textContent    = available;

  // Price badges
  $("price-info").innerHTML = `
    <span class="price-badge regular">Regular — &#8377;${prices.Regular}</span>
    <span class="price-badge premium">Premium — &#8377;${prices.Premium}</span>
    <span class="price-badge vip">VIP — &#8377;${prices.VIP}</span>`;

  // Group seats into rows (A-E)
  const rows = {};
  seats.forEach(s => {
    const row = s.seat_number[0];
    if (!rows[row]) rows[row] = [];
    rows[row].push(s);
  });

  const selectedIds = new Set(state.selectedSeats.map(s => s.seat_id));

  let html = "";
  Object.keys(rows).sort().forEach(row => {
    html += `<div class="seat-row"><span class="row-label">${esc(row)}</span>`;
    rows[row].sort((a, b) => parseInt(a.seat_number.slice(1)) - parseInt(b.seat_number.slice(1)))
             .forEach((s, idx) => {
      const cls  = s.booked ? "booked" : (selectedIds.has(s.seat_id) ? "selected" : "");
      const dis  = s.booked ? "disabled" : "";
      const num  = s.seat_number.slice(1);  // just the number part

      // Aisle gap after seat 4
      const aisleHtml = (idx === 3) ? `<span class="aisle-gap"></span>` : "";

      html += `${aisleHtml}<button class="seat ${cls}" ${dis}
                 data-seat-id="${s.seat_id}"
                 data-seat-type="${esc(s.seat_type)}"
                 data-seat-number="${esc(s.seat_number)}"
                 data-price="${s.price}"
                 title="${esc(s.seat_number)} (${esc(s.seat_type)}) — ${s.booked ? "Booked" : "Available"}"
                 aria-label="${esc(s.seat_number)}"
                 aria-pressed="${selectedIds.has(s.seat_id)}">${esc(num)}</button>`;
    });
    html += `</div>`;
  });

  $("seat-map").innerHTML = html;

  // Attach click handlers
  $("seat-map").querySelectorAll(".seat:not(.booked)").forEach(btn => {
    btn.addEventListener("click", () => toggleSeat(btn));
  });

  updateSummary();
}

/** Toggle a seat in the selection */
function toggleSeat(btn) {
  const seatId   = parseInt(btn.dataset.seatId);
  const seatNum  = btn.dataset.seatNumber;
  const seatType = btn.dataset.seatType;
  const price    = parseFloat(btn.dataset.price);

  const idx = state.selectedSeats.findIndex(s => s.seat_id === seatId);
  if (idx === -1) {
    state.selectedSeats.push({ seat_id: seatId, seat_number: seatNum, seat_type: seatType, price });
    btn.classList.add("selected");
    btn.setAttribute("aria-pressed", "true");
  } else {
    state.selectedSeats.splice(idx, 1);
    btn.classList.remove("selected");
    btn.setAttribute("aria-pressed", "false");
  }
  updateSummary();
}

/** Refresh the summary panel below the seat map */
function updateSummary() {
  const listEl   = $("selected-seats-list");
  const totalEl  = $("total-price");
  const bookBtn  = $("btn-book");

  if (state.selectedSeats.length === 0) {
    listEl.innerHTML = `<span class="text-muted">No seats selected yet</span>`;
    totalEl.innerHTML = `&#8377;0`;
    bookBtn.disabled = true;
    return;
  }

  let total = 0;
  let tags  = "";
  state.selectedSeats.forEach(s => {
    total += s.price;
    tags  += `<span class="selected-seat-tag">${esc(s.seat_number)}</span>`;
  });
  listEl.innerHTML   = tags;
  totalEl.innerHTML  = `&#8377;${total.toFixed(2)} <span>(${state.selectedSeats.length} seat${state.selectedSeats.length > 1 ? "s" : ""})</span>`;
  bookBtn.disabled   = false;
}

/* ── Book Now ───────────────────────────────────────────── */
$("btn-book").addEventListener("click", async () => {
  if (!validateForm()) return;
  await submitBooking();
});

function validateForm() {
  let valid = true;

  const fields = [
    { id: "inp-name",  errId: "err-name",  test: v => v.length >= 2,              msg: "Please enter your full name" },
    { id: "inp-email", errId: "err-email", test: v => /^[^@]+@[^@]+\.[^@]+$/.test(v), msg: "Enter a valid email address" },
    { id: "inp-phone", errId: "err-phone", test: v => /^[6-9]\d{9}$/.test(v),    msg: "Enter a valid 10-digit phone number" },
  ];

  fields.forEach(f => {
    const inp = $(f.id);
    const err = $(f.errId);
    if (!f.test(inp.value.trim())) {
      inp.classList.add("error");
      err.classList.add("visible");
      err.textContent = f.msg;
      valid = false;
    } else {
      inp.classList.remove("error");
      err.classList.remove("visible");
    }
  });

  if (state.selectedSeats.length === 0) {
    showToast("Please select at least one seat", "error");
    valid = false;
  }

  return valid;
}

async function submitBooking() {
  const bookBtn = $("btn-book");
  setLoading(bookBtn, true);

  const payload = {
    show_id:        state.selectedShow.show_id,
    seat_ids:       state.selectedSeats.map(s => s.seat_id),
    name:           $("inp-name").value.trim(),
    email:          $("inp-email").value.trim(),
    phone:          $("inp-phone").value.trim(),
    payment_method: $("inp-payment").value,
  };

  try {
    const res  = await fetch("/api/book", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.status === 409) {
      showToast(data.error, "error", 6000);
      // Refresh seat map to show newly booked seats
      await fetchAndRenderSeats();
      setLoading(bookBtn, false);
      return;
    }
    if (!res.ok) throw new Error(data.error || "Booking failed");

    // Success!
    clearInterval(state.pollTimer);
    showToast("Booking confirmed!", "success");
    window.location.hash = `#receipt/${data.booking_id}`;

  } catch (err) {
    showToast(err.message, "error");
    setLoading(bookBtn, false);
  }
}

/* ── STEP 4 – Receipt ───────────────────────────────────── */
async function loadReceipt(bookingId) {
  goToStep(4);
  const receiptEl = $("receipt-content");
  receiptEl.innerHTML = `<div class="empty-state"><div class="spinner" style="width:32px;height:32px;margin:0 auto 12px;"></div><p>Loading receipt…</p></div>`;

  try {
    const res  = await fetch(`/api/booking/${bookingId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Booking not found");

    renderReceipt(data);
  } catch (err) {
    receiptEl.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${esc(err.message)}</p></div>`;
    showToast(err.message, "error");
  }
}

function renderReceipt(d) {
  const seatRows = d.seats.map(s =>
    `<div class="receipt-seat-item">
       <span>${esc(s.seat_number)} (${esc(s.seat_type)})</span>
       <span>&#8377;${s.price.toFixed(2)}</span>
     </div>`
  ).join("");

  const payStatusCls = d.payment_status === "Success" ? "success"
                     : d.payment_status === "Refunded" ? "refunded" : "error";

  $("receipt-content").innerHTML = `
    <div class="receipt-wrap">
      <div class="receipt-header">
        <h2>Booking Confirmed</h2>
        <p>Your seats are reserved — enjoy the show!</p>
      </div>
      <div class="receipt-body">
        <div class="receipt-ids">
          <div class="receipt-id-box">
            <div class="receipt-id-label">Booking ID</div>
            <div class="receipt-id-value">#${d.booking_id}</div>
          </div>
          <div class="receipt-id-box">
            <div class="receipt-id-label">Payment ID</div>
            <div class="receipt-id-value">#${d.payment_id}</div>
          </div>
        </div>

        <hr class="receipt-divider">

        <div class="receipt-row"><span class="receipt-label">Movie</span><span class="receipt-value">${esc(d.title)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Language / Genre</span><span class="receipt-value">${esc(d.language)} / ${esc(d.genre)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Theatre</span><span class="receipt-value">${esc(d.theatre)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Screen</span><span class="receipt-value">${esc(d.screen)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Date</span><span class="receipt-value">${esc(d.show_date)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Time</span><span class="receipt-value">${esc(d.show_time)}</span></div>

        <hr class="receipt-divider">

        <div class="receipt-row"><span class="receipt-label">Customer</span><span class="receipt-value">${esc(d.customer_name)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Email</span><span class="receipt-value">${esc(d.email)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Phone</span><span class="receipt-value">${esc(d.phone)}</span></div>

        <hr class="receipt-divider">

        <div class="receipt-seats">${seatRows}</div>

        <div class="receipt-row"><span class="receipt-label">Payment Method</span><span class="receipt-value">${esc(d.payment_method)}</span></div>
        <div class="receipt-row"><span class="receipt-label">Payment Status</span>
          <span class="receipt-value"><span class="status-badge ${payStatusCls}">${esc(d.payment_status)}</span></span>
        </div>
        <div class="receipt-row"><span class="receipt-label">Booking Status</span>
          <span class="receipt-value"><span class="status-badge success">${esc(d.status)}</span></span>
        </div>

        <div class="receipt-total">
          <span>Total Paid</span>
          <span>&#8377;${d.total_amount.toFixed(2)}</span>
        </div>

        <div class="receipt-actions">
          <button class="btn-primary" onclick="window.print()" style="width:auto;padding:10px 24px">Print / Download</button>
          <button class="btn-secondary" onclick="goHome()">Book Another</button>
          <button class="btn-secondary" onclick="window.location.hash='#payment/${d.payment_id}'">View Payment</button>
        </div>
      </div>
    </div>`;
}

/* ── Payment Details ────────────────────────────────────── */
async function showPaymentDetails(paymentId) {
  goToStep(4);
  const receiptEl = $("receipt-content");
  receiptEl.innerHTML = `<div class="empty-state"><div class="spinner" style="width:32px;height:32px;margin:0 auto 12px;"></div><p>Loading payment details…</p></div>`;

  try {
    const res  = await fetch(`/api/payment/${paymentId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Payment not found");

    renderPaymentDetails(data);
  } catch (err) {
    receiptEl.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${esc(err.message)}</p></div>`;
    showToast(err.message, "error");
  }
}

function renderPaymentDetails(d) {
  const seatRows = d.seats.map(s =>
    `<div class="receipt-seat-item">
       <span>${esc(s.seat_number)} (${esc(s.seat_type)})</span>
       <span>&#8377;${s.price.toFixed(2)}</span>
     </div>`
  ).join("");

  const payStatusCls = d.payment_status === "Success" ? "success"
                     : d.payment_status === "Refunded" ? "refunded" : "error";

  $("receipt-content").innerHTML = `
    <div class="payment-card">
      <div class="payment-card-title">Payment Details</div>

      <div class="receipt-ids">
        <div class="receipt-id-box">
          <div class="receipt-id-label">Payment ID</div>
          <div class="receipt-id-value">#${d.payment_id}</div>
        </div>
        <div class="receipt-id-box">
          <div class="receipt-id-label">Booking ID</div>
          <div class="receipt-id-value">#${d.booking_id}</div>
        </div>
      </div>

      <hr class="receipt-divider">

      <div class="receipt-row"><span class="receipt-label">Amount Paid</span><span class="receipt-value bold">&#8377;${d.amount.toFixed(2)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Method</span><span class="receipt-value">${esc(d.method)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Payment Time</span><span class="receipt-value">${esc(d.payment_time)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Status</span>
        <span class="receipt-value"><span class="status-badge ${payStatusCls}">${esc(d.payment_status)}</span></span>
      </div>

      <hr class="receipt-divider">

      <div class="receipt-row"><span class="receipt-label">Customer</span><span class="receipt-value">${esc(d.customer_name)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Email</span><span class="receipt-value">${esc(d.email)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Phone</span><span class="receipt-value">${esc(d.phone)}</span></div>

      <hr class="receipt-divider">

      <div class="receipt-row"><span class="receipt-label">Movie</span><span class="receipt-value">${esc(d.title)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Theatre</span><span class="receipt-value">${esc(d.theatre)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Screen</span><span class="receipt-value">${esc(d.screen)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Show Date</span><span class="receipt-value">${esc(d.show_date)}</span></div>
      <div class="receipt-row"><span class="receipt-label">Show Time</span><span class="receipt-value">${esc(d.show_time)}</span></div>

      <hr class="receipt-divider">

      <div style="margin-bottom:8px;font-size:13px;color:var(--muted);font-weight:600">SEATS BOOKED</div>
      <div class="receipt-seats">${seatRows}</div>

      <div class="receipt-total">
        <span>Total</span>
        <span>&#8377;${d.amount.toFixed(2)}</span>
      </div>

      <div class="receipt-actions">
        <button class="btn-primary" onclick="window.print()" style="width:auto;padding:10px 24px">Print</button>
        <button class="btn-secondary" onclick="window.location.hash='#receipt/${d.booking_id}'">View Booking</button>
        <button class="btn-secondary" onclick="goHome()">Home</button>
      </div>
    </div>`;
}

/* ── Header search boxes ────────────────────────────────── */
$("btn-find-booking").addEventListener("click", () => {
  const id = parseInt($("inp-find-booking").value.trim());
  if (!id || id < 1) { showToast("Enter a valid Booking ID", "error"); return; }
  window.location.hash = `#receipt/${id}`;
});

$("inp-find-booking").addEventListener("keypress", e => {
  if (e.key === "Enter") $("btn-find-booking").click();
});

$("btn-find-payment").addEventListener("click", () => {
  const id = parseInt($("inp-find-payment").value.trim());
  if (!id || id < 1) { showToast("Enter a valid Payment ID", "error"); return; }
  window.location.hash = `#payment/${id}`;
});

$("inp-find-payment").addEventListener("keypress", e => {
  if (e.key === "Enter") $("btn-find-payment").click();
});

/* ── Back button ─────────────────────────────────────────── */
$("btn-back-shows").addEventListener("click", () => {
  clearInterval(state.pollTimer);
  state.selectedSeats = [];
  goToStep(1);
});

/* ── Go Home ─────────────────────────────────────────────── */
function goHome() {
  clearInterval(state.pollTimer);
  state.selectedSeats = [];
  state.selectedShow  = null;
  window.location.hash = "";
  initDatePills();
  goToStep(1);
}

/* ── Clear field errors on input ─────────────────────────── */
["inp-name", "inp-email", "inp-phone"].forEach(id => {
  $(id).addEventListener("input", () => {
    $(id).classList.remove("error");
    const errId = id.replace("inp-", "err-");
    $(errId).classList.remove("visible");
  });
});
