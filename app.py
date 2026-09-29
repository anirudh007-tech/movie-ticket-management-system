"""
Movie Ticket Management System - Backend (Flask + SQLite)
=========================================================
Academic DBMS Project - 3NF normalized schema with full ACID guarantees.

Tables: Movie, Theatre, Screen, Seat, Show_Time, Customer, Booking,
        Booking_Seat, Payment

Run:  python app.py
      Then open http://localhost:5000
"""

import sqlite3
import os
import datetime
from flask import Flask, request, jsonify, send_from_directory

# -- App setup ----------------------------------------------------------------
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(BASE_DIR, "movie.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")

app = Flask(__name__, static_folder=STATIC_DIR)


# -- Database helpers ---------------------------------------------------------

def get_db():
    """Open a database connection with foreign-key enforcement and row factory."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row        # rows accessible like dicts
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")   # allows concurrent readers
    return conn


# -- Schema creation ----------------------------------------------------------

DDL = """
CREATE TABLE IF NOT EXISTS Movie (
    movie_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    title         TEXT    NOT NULL,
    genre         TEXT    NOT NULL,
    language      TEXT    NOT NULL,
    duration_min  INTEGER NOT NULL CHECK(duration_min > 0)
);

CREATE TABLE IF NOT EXISTS Theatre (
    theatre_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    city        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Screen (
    screen_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    theatre_id   INTEGER NOT NULL REFERENCES Theatre(theatre_id),
    screen_name  TEXT    NOT NULL,
    total_seats  INTEGER NOT NULL CHECK(total_seats > 0)
);

CREATE TABLE IF NOT EXISTS Seat (
    seat_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    screen_id   INTEGER NOT NULL REFERENCES Screen(screen_id),
    seat_number TEXT    NOT NULL,
    seat_type   TEXT    NOT NULL CHECK(seat_type IN ('Regular','Premium','VIP')),
    UNIQUE(screen_id, seat_number)
);

CREATE TABLE IF NOT EXISTS Show_Time (
    show_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    movie_id    INTEGER NOT NULL REFERENCES Movie(movie_id),
    screen_id   INTEGER NOT NULL REFERENCES Screen(screen_id),
    show_date   TEXT    NOT NULL,
    show_time   TEXT    NOT NULL,
    base_price  REAL    NOT NULL CHECK(base_price > 0),
    UNIQUE(screen_id, show_date, show_time)
);

CREATE TABLE IF NOT EXISTS Customer (
    customer_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    email        TEXT NOT NULL UNIQUE,
    phone        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS Booking (
    booking_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id   INTEGER NOT NULL REFERENCES Customer(customer_id),
    show_id       INTEGER NOT NULL REFERENCES Show_Time(show_id),
    booking_time  TEXT    NOT NULL DEFAULT (datetime('now')),
    total_amount  REAL    NOT NULL DEFAULT 0,
    status        TEXT    NOT NULL DEFAULT 'Confirmed'
                          CHECK(status IN ('Confirmed','Cancelled','Pending'))
);

CREATE TABLE IF NOT EXISTS Booking_Seat (
    booking_id  INTEGER NOT NULL REFERENCES Booking(booking_id),
    show_id     INTEGER NOT NULL REFERENCES Show_Time(show_id),
    seat_id     INTEGER NOT NULL REFERENCES Seat(seat_id),
    price       REAL    NOT NULL,
    PRIMARY KEY (booking_id, seat_id),
    UNIQUE(show_id, seat_id)
);

CREATE TABLE IF NOT EXISTS Payment (
    payment_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    booking_id    INTEGER NOT NULL REFERENCES Booking(booking_id),
    amount        REAL    NOT NULL,
    method        TEXT    NOT NULL DEFAULT 'UPI'
                          CHECK(method IN ('UPI','Card','Cash','NetBanking')),
    payment_time  TEXT    NOT NULL DEFAULT (datetime('now')),
    status        TEXT    NOT NULL DEFAULT 'Success'
                          CHECK(status IN ('Success','Failed','Refunded'))
);
"""


def create_schema():
    """Create all tables if they do not exist yet."""
    conn = get_db()
    conn.executescript(DDL)
    conn.commit()
    conn.close()


# -- Seed data ----------------------------------------------------------------

def seed_data():
    """Populate the DB with demo data - only runs once."""
    conn = get_db()
    cur  = conn.cursor()

    if cur.execute("SELECT COUNT(*) FROM Movie").fetchone()[0] > 0:
        conn.close()
        return

    movies = [
        ("Interstellar",        "Sci-Fi",   "English", 169),
        ("Baahubali 2",         "Action",   "Telugu",  167),
        ("3 Idiots",            "Comedy",   "Hindi",   170),
        ("Avengers: Endgame",   "Action",   "English", 181),
    ]
    cur.executemany(
        "INSERT INTO Movie(title,genre,language,duration_min) VALUES(?,?,?,?)",
        movies
    )

    theatres = [
        ("PVR Cinemas",    "Hyderabad"),
        ("INOX Multiplex", "Hyderabad"),
    ]
    cur.executemany("INSERT INTO Theatre(name,city) VALUES(?,?)", theatres)

    screens = [
        (1, "Screen 1", 40),
        (1, "Screen 2", 40),
        (2, "Screen 1", 40),
    ]
    cur.executemany(
        "INSERT INTO Screen(theatre_id,screen_name,total_seats) VALUES(?,?,?)",
        screens
    )

    rows = [
        ("A", "Regular"), ("B", "Regular"),
        ("C", "Premium"), ("D", "Premium"),
        ("E", "VIP"),
    ]
    seat_rows = []
    for screen_id in (1, 2, 3):
        for row_letter, seat_type in rows:
            for num in range(1, 9):
                seat_rows.append((screen_id, f"{row_letter}{num}", seat_type))

    cur.executemany(
        "INSERT INTO Seat(screen_id,seat_number,seat_type) VALUES(?,?,?)",
        seat_rows
    )

    today = datetime.date.today()
    schedule_template = [
        (1, 1, "10:00", 150.0),
        (2, 1, "13:30", 180.0),
        (3, 2, "10:30", 120.0),
        (4, 2, "14:00", 200.0),
        (1, 3, "11:00", 160.0),
        (4, 3, "15:00", 210.0),
        (2, 1, "17:00", 180.0),
        (3, 3, "18:30", 130.0),
    ]
    shows = []
    for day_offset in range(7):
        show_date = (today + datetime.timedelta(days=day_offset)).isoformat()
        slots = schedule_template[(day_offset % 3):(day_offset % 3) + 3]
        for movie_id, screen_id, show_time, base_price in slots:
            shows.append((movie_id, screen_id, show_date, show_time, base_price))

    cur.executemany(
        "INSERT OR IGNORE INTO Show_Time(movie_id,screen_id,show_date,show_time,base_price)"
        " VALUES(?,?,?,?,?)",
        shows
    )

    conn.commit()
    conn.close()
    print("[SEED] Database seeded with demo data.")


# -- Price multiplier per seat type -------------------------------------------

PRICE_MULT = {"Regular": 1.0, "Premium": 1.25, "VIP": 1.5}

def seat_price(base_price: float, seat_type: str) -> float:
    return round(base_price * PRICE_MULT.get(seat_type, 1.0), 2)


# -- API Routes ---------------------------------------------------------------

@app.route("/")
def index():
    """Serve the single-page frontend."""
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/api/shows", methods=["GET"])
def api_shows():
    """
    GET /api/shows?date=YYYY-MM-DD
    Returns all shows for the given date with availability info.
    """
    date_str = request.args.get("date", datetime.date.today().isoformat())

    try:
        datetime.date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "Invalid date format. Use YYYY-MM-DD"}), 400

    conn = get_db()
    rows = conn.execute("""
        SELECT
            st.show_id,
            m.title,
            m.genre,
            m.language,
            m.duration_min,
            th.name        AS theatre_name,
            th.city,
            sc.screen_name,
            st.show_date,
            st.show_time,
            st.base_price,
            sc.total_seats,
            COUNT(bs.seat_id) AS booked_count
        FROM Show_Time st
        JOIN Movie   m  ON m.movie_id   = st.movie_id
        JOIN Screen  sc ON sc.screen_id = st.screen_id
        JOIN Theatre th ON th.theatre_id = sc.theatre_id
        LEFT JOIN Booking_Seat bs ON bs.show_id = st.show_id
        WHERE st.show_date = ?
        GROUP BY st.show_id
        ORDER BY st.show_time
    """, (date_str,)).fetchall()
    conn.close()

    shows = []
    for r in rows:
        shows.append({
            "show_id":      r["show_id"],
            "title":        r["title"],
            "genre":        r["genre"],
            "language":     r["language"],
            "duration_min": r["duration_min"],
            "theatre":      r["theatre_name"],
            "city":         r["city"],
            "screen":       r["screen_name"],
            "show_date":    r["show_date"],
            "show_time":    r["show_time"],
            "base_price":   r["base_price"],
            "total_seats":  r["total_seats"],
            "booked_count": r["booked_count"],
            "available":    r["total_seats"] - r["booked_count"],
        })
    return jsonify(shows)


@app.route("/api/shows/<int:show_id>/seats", methods=["GET"])
def api_show_seats(show_id):
    """
    GET /api/shows/<show_id>/seats
    Returns show metadata plus every seat of that screen with booking status.
    """
    conn = get_db()

    show = conn.execute("""
        SELECT
            st.show_id, st.show_date, st.show_time, st.base_price,
            m.title, m.genre, m.language, m.duration_min,
            th.name AS theatre_name, sc.screen_name, sc.screen_id,
            sc.total_seats
        FROM Show_Time st
        JOIN Movie   m  ON m.movie_id   = st.movie_id
        JOIN Screen  sc ON sc.screen_id = st.screen_id
        JOIN Theatre th ON th.theatre_id = sc.theatre_id
        WHERE st.show_id = ?
    """, (show_id,)).fetchone()

    if not show:
        conn.close()
        return jsonify({"error": "Show not found"}), 404

    screen_id = show["screen_id"]

    seats_rows = conn.execute("""
        SELECT
            s.seat_id,
            s.seat_number,
            s.seat_type,
            CASE WHEN bs.seat_id IS NOT NULL THEN 1 ELSE 0 END AS booked
        FROM Seat s
        LEFT JOIN Booking_Seat bs
               ON bs.seat_id = s.seat_id
              AND bs.show_id = ?
        WHERE s.screen_id = ?
        ORDER BY s.seat_number
    """, (show_id, screen_id)).fetchall()
    conn.close()

    seats = []
    for s in seats_rows:
        seats.append({
            "seat_id":     s["seat_id"],
            "seat_number": s["seat_number"],
            "seat_type":   s["seat_type"],
            "price":       seat_price(show["base_price"], s["seat_type"]),
            "booked":      bool(s["booked"]),
        })

    return jsonify({
        "show_id":      show["show_id"],
        "show_date":    show["show_date"],
        "show_time":    show["show_time"],
        "base_price":   show["base_price"],
        "title":        show["title"],
        "genre":        show["genre"],
        "language":     show["language"],
        "duration_min": show["duration_min"],
        "theatre":      show["theatre_name"],
        "screen":       show["screen_name"],
        "total_seats":  show["total_seats"],
        "seats":        seats,
    })


@app.route("/api/book", methods=["POST"])
def api_book():
    """
    POST /api/book
    Body: { show_id, seat_ids[], name, email, phone, payment_method }

    All DB writes are in a single BEGIN IMMEDIATE transaction to prevent
    concurrent double-booking. The UNIQUE(show_id, seat_id) constraint in
    Booking_Seat is the final safety net.
    Returns: { booking_id, payment_id } or HTTP 409 on conflict.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Invalid JSON body"}), 400

    show_id        = data.get("show_id")
    seat_ids       = data.get("seat_ids", [])
    name           = (data.get("name") or "").strip()
    email          = (data.get("email") or "").strip().lower()
    phone          = (data.get("phone") or "").strip()
    payment_method = data.get("payment_method", "UPI")

    if not all([show_id, seat_ids, name, email, phone]):
        return jsonify({"error": "Missing required fields"}), 400
    if payment_method not in ("UPI", "Card", "Cash", "NetBanking"):
        return jsonify({"error": "Invalid payment method"}), 400
    if not isinstance(seat_ids, list) or len(seat_ids) == 0:
        return jsonify({"error": "seat_ids must be a non-empty list"}), 400

    conn = get_db()
    try:
        conn.execute("BEGIN IMMEDIATE")

        show = conn.execute(
            "SELECT show_id, screen_id, base_price FROM Show_Time WHERE show_id = ?",
            (show_id,)
        ).fetchone()
        if not show:
            conn.execute("ROLLBACK")
            conn.close()
            return jsonify({"error": "Show not found"}), 404

        screen_id  = show["screen_id"]
        base_price = show["base_price"]

        placeholders = ",".join("?" * len(seat_ids))
        valid_seats  = conn.execute(
            f"SELECT seat_id, seat_type FROM Seat WHERE screen_id=? AND seat_id IN ({placeholders})",
            [screen_id] + list(seat_ids)
        ).fetchall()

        if len(valid_seats) != len(seat_ids):
            conn.execute("ROLLBACK")
            conn.close()
            return jsonify({"error": "One or more seats do not belong to this screen"}), 400

        already_booked = conn.execute(
            f"SELECT seat_id FROM Booking_Seat WHERE show_id=? AND seat_id IN ({placeholders})",
            [show_id] + list(seat_ids)
        ).fetchall()

        if already_booked:
            conflict_ids = [r["seat_id"] for r in already_booked]
            conn.execute("ROLLBACK")
            conn.close()
            return jsonify({
                "error": f"Some seats are already booked (seat IDs: {conflict_ids}). Please choose different seats."
            }), 409

        customer = conn.execute(
            "SELECT customer_id FROM Customer WHERE email = ?", (email,)
        ).fetchone()

        if customer:
            customer_id = customer["customer_id"]
            conn.execute(
                "UPDATE Customer SET name=?, phone=? WHERE customer_id=?",
                (name, phone, customer_id)
            )
        else:
            cur = conn.execute(
                "INSERT INTO Customer(name,email,phone) VALUES(?,?,?)",
                (name, email, phone)
            )
            customer_id = cur.lastrowid

        booking_cur = conn.execute(
            "INSERT INTO Booking(customer_id,show_id,total_amount,status) VALUES(?,?,0,'Confirmed')",
            (customer_id, show_id)
        )
        booking_id = booking_cur.lastrowid

        seat_map = {s["seat_id"]: s["seat_type"] for s in valid_seats}
        total    = 0.0

        for s_id in seat_ids:
            s_type = seat_map[s_id]
            price  = seat_price(base_price, s_type)
            total += price
            conn.execute(
                "INSERT INTO Booking_Seat(booking_id,show_id,seat_id,price) VALUES(?,?,?,?)",
                (booking_id, show_id, s_id, price)
            )

        conn.execute(
            "UPDATE Booking SET total_amount=? WHERE booking_id=?",
            (round(total, 2), booking_id)
        )

        payment_cur = conn.execute(
            "INSERT INTO Payment(booking_id,amount,method,status) VALUES(?,?,?,'Success')",
            (booking_id, round(total, 2), payment_method)
        )
        payment_id = payment_cur.lastrowid

        conn.execute("COMMIT")
        conn.close()
        return jsonify({"booking_id": booking_id, "payment_id": payment_id}), 201

    except sqlite3.IntegrityError:
        conn.execute("ROLLBACK")
        conn.close()
        return jsonify({"error": "Double-booking detected. Please choose different seats."}), 409
    except Exception as e:
        conn.execute("ROLLBACK")
        conn.close()
        return jsonify({"error": str(e)}), 500


@app.route("/api/booking/<int:booking_id>", methods=["GET"])
def api_booking(booking_id):
    """
    GET /api/booking/<booking_id>
    Returns the full receipt for a booking.
    """
    conn = get_db()

    booking = conn.execute("""
        SELECT
            b.booking_id, b.booking_time, b.total_amount, b.status,
            c.name AS customer_name, c.email, c.phone,
            m.title, m.genre, m.language,
            th.name AS theatre_name,
            sc.screen_name,
            st.show_date, st.show_time,
            p.payment_id, p.method AS payment_method, p.status AS payment_status
        FROM Booking b
        JOIN Customer  c  ON c.customer_id  = b.customer_id
        JOIN Show_Time st ON st.show_id      = b.show_id
        JOIN Movie     m  ON m.movie_id      = st.movie_id
        JOIN Screen    sc ON sc.screen_id    = st.screen_id
        JOIN Theatre   th ON th.theatre_id   = sc.theatre_id
        LEFT JOIN Payment p ON p.booking_id  = b.booking_id
        WHERE b.booking_id = ?
        ORDER BY p.payment_id DESC
        LIMIT 1
    """, (booking_id,)).fetchone()

    if not booking:
        conn.close()
        return jsonify({"error": "Booking not found"}), 404

    seats = conn.execute("""
        SELECT s.seat_number, s.seat_type, bs.price
        FROM Booking_Seat bs
        JOIN Seat s ON s.seat_id = bs.seat_id
        WHERE bs.booking_id = ?
        ORDER BY s.seat_number
    """, (booking_id,)).fetchall()
    conn.close()

    return jsonify({
        "booking_id":     booking["booking_id"],
        "booking_time":   booking["booking_time"],
        "total_amount":   booking["total_amount"],
        "status":         booking["status"],
        "customer_name":  booking["customer_name"],
        "email":          booking["email"],
        "phone":          booking["phone"],
        "title":          booking["title"],
        "genre":          booking["genre"],
        "language":       booking["language"],
        "theatre":        booking["theatre_name"],
        "screen":         booking["screen_name"],
        "show_date":      booking["show_date"],
        "show_time":      booking["show_time"],
        "payment_id":     booking["payment_id"],
        "payment_method": booking["payment_method"],
        "payment_status": booking["payment_status"],
        "seats": [
            {"seat_number": s["seat_number"],
             "seat_type":   s["seat_type"],
             "price":       s["price"]}
            for s in seats
        ],
    })


@app.route("/api/payment/<int:payment_id>", methods=["GET"])
def api_payment(payment_id):
    """
    GET /api/payment/<payment_id>
    Returns full payment details joined across all relevant tables.
    """
    conn = get_db()

    payment = conn.execute("""
        SELECT
            p.payment_id, p.amount, p.method,
            p.payment_time, p.status AS payment_status,
            b.booking_id, b.booking_time, b.status AS booking_status,
            c.name AS customer_name, c.email, c.phone,
            m.title, th.name AS theatre_name, sc.screen_name,
            st.show_date, st.show_time
        FROM Payment  p
        JOIN Booking   b  ON b.booking_id  = p.booking_id
        JOIN Customer  c  ON c.customer_id = b.customer_id
        JOIN Show_Time st ON st.show_id    = b.show_id
        JOIN Movie     m  ON m.movie_id    = st.movie_id
        JOIN Screen    sc ON sc.screen_id  = st.screen_id
        JOIN Theatre   th ON th.theatre_id = sc.theatre_id
        WHERE p.payment_id = ?
    """, (payment_id,)).fetchone()

    if not payment:
        conn.close()
        return jsonify({"error": "Payment not found"}), 404

    seats = conn.execute("""
        SELECT s.seat_number, s.seat_type, bs.price
        FROM Booking_Seat bs
        JOIN Seat s ON s.seat_id = bs.seat_id
        WHERE bs.booking_id = ?
        ORDER BY s.seat_number
    """, (payment["booking_id"],)).fetchall()
    conn.close()

    return jsonify({
        "payment_id":     payment["payment_id"],
        "amount":         payment["amount"],
        "method":         payment["method"],
        "payment_time":   payment["payment_time"],
        "payment_status": payment["payment_status"],
        "booking_id":     payment["booking_id"],
        "booking_time":   payment["booking_time"],
        "booking_status": payment["booking_status"],
        "customer_name":  payment["customer_name"],
        "email":          payment["email"],
        "phone":          payment["phone"],
        "title":          payment["title"],
        "theatre":        payment["theatre_name"],
        "screen":         payment["screen_name"],
        "show_date":      payment["show_date"],
        "show_time":      payment["show_time"],
        "seats": [
            {"seat_number": s["seat_number"],
             "seat_type":   s["seat_type"],
             "price":       s["price"]}
            for s in seats
        ],
    })


# -- Startup ------------------------------------------------------------------

if __name__ == "__main__":
    create_schema()
    seed_data()
    print(f"[DB] Using database: {DB_PATH}")
    print("[SERVER] Starting on http://localhost:5000")
    app.run(debug=True, port=5000)
