# CineBook – Movie Ticket Management System

A full-stack academic DBMS project built with **Flask + SQLite + vanilla HTML/CSS/JS**.
The database is normalized to **3NF** and demonstrates real-world concerns like
concurrent booking prevention, parameterized SQL, and atomic transactions.

---

## Project Structure

```
movie_app/
├── app.py              # Flask backend – all API endpoints and DB logic
├── requirements.txt    # Python dependencies (Flask only)
├── movie.db            # SQLite database (auto-created on first run)
├── schema_mysql.sql    # Equivalent MySQL DDL for DBMS submission
├── README.md           # This file
└── static/
    ├── index.html      # Single-page frontend
    ├── style.css       # Dark cinema theme styles
    └── script.js       # SPA logic – routing, seat map, booking flow
```

---

## Quick Start

### 1. Prerequisites
- Python 3.9+ installed
- pip available

### 2. Install dependencies

```bash
cd movie_app
pip install -r requirements.txt
```

### 3. Run the server

```bash
python app.py
```

On the first run, the server automatically:
- Creates `movie.db` with all 9 tables.
- Seeds 4 movies, 2 theatres, 3 screens, 120 seats, and shows for the next 7 days.

### 4. Open in browser

```
http://localhost:5000
```

---

## Database Tables (3NF)

| Table | Description |
|-------|-------------|
| **Movie** | Film catalogue: title, genre, language, duration |
| **Theatre** | Physical cinema building with name and city |
| **Screen** | Auditorium inside a theatre (holds seats) |
| **Seat** | Individual seat with type (Regular / Premium / VIP) |
| **Show_Time** | A specific movie screening: date, time, base price |
| **Customer** | Person booking tickets; identified by unique email |
| **Booking** | Header record linking a customer to a show |
| **Booking_Seat** | Which seats belong to a booking; **UNIQUE(show_id, seat_id) prevents double-booking** |
| **Payment** | Financial record: amount, method (UPI/Card/Cash/NetBanking), status |

### Price Multipliers by Seat Type
| Type | Multiplier |
|------|-----------|
| Regular (rows A–B) | ×1.00 |
| Premium (rows C–D) | ×1.25 |
| VIP (row E)        | ×1.50 |

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/shows?date=YYYY-MM-DD` | All shows for a date with availability |
| GET | `/api/shows/<show_id>/seats` | Show info + every seat with booked status |
| POST | `/api/book` | Atomic booking with conflict detection |
| GET | `/api/booking/<booking_id>` | Full receipt for a booking |
| GET | `/api/payment/<payment_id>` | Full payment details |

### POST /api/book – Request Body
```json
{
  "show_id": 1,
  "seat_ids": [1, 2],
  "name": "Alice",
  "email": "alice@example.com",
  "phone": "9876543210",
  "payment_method": "UPI"
}
```

### POST /api/book – Response
```json
{ "booking_id": 1, "payment_id": 1 }
```

---

## How Double-Booking Is Prevented

1. The booking API runs inside `BEGIN IMMEDIATE` – this acquires a write lock so
   concurrent requests are serialized at the SQLite level.
2. Before inserting, the code explicitly checks whether any requested seat is
   already in `Booking_Seat` for that show.
3. Even if two requests race past step 2, the `UNIQUE(show_id, seat_id)` constraint
   in `Booking_Seat` fires as a final safety net and triggers a rollback.

---

## Demo – Sample SQL Queries

### Show-wise bookings
```sql
SELECT st.show_id, m.title, st.show_date, st.show_time,
       COUNT(bs.seat_id) AS booked_seats
FROM Show_Time st
JOIN Movie m ON m.movie_id = st.movie_id
LEFT JOIN Booking_Seat bs ON bs.show_id = st.show_id
GROUP BY st.show_id
ORDER BY st.show_date, st.show_time;
```

### Revenue per movie
```sql
SELECT m.title, SUM(p.amount) AS total_revenue
FROM Payment p
JOIN Booking b ON b.booking_id = p.booking_id
JOIN Show_Time st ON st.show_id = b.show_id
JOIN Movie m ON m.movie_id = st.movie_id
WHERE p.status = 'Success'
GROUP BY m.movie_id
ORDER BY total_revenue DESC;
```

### Seat occupancy per show
```sql
SELECT st.show_id, m.title, st.show_date, st.show_time,
       sc.total_seats,
       COUNT(bs.seat_id) AS booked,
       ROUND(COUNT(bs.seat_id) * 100.0 / sc.total_seats, 1) AS occupancy_pct
FROM Show_Time st
JOIN Movie m ON m.movie_id = st.movie_id
JOIN Screen sc ON sc.screen_id = st.screen_id
LEFT JOIN Booking_Seat bs ON bs.show_id = st.show_id
GROUP BY st.show_id;
```

### Available seats for a specific show (replace 1 with your show_id)
```sql
SELECT s.seat_number, s.seat_type
FROM Seat s
WHERE s.screen_id = (SELECT screen_id FROM Show_Time WHERE show_id = 1)
  AND s.seat_id NOT IN (
      SELECT seat_id FROM Booking_Seat WHERE show_id = 1
  );
```

### Payment lookup by payment_id
```sql
SELECT p.payment_id, c.name, c.email, m.title,
       p.amount, p.method, p.status
FROM Payment p
JOIN Booking b ON b.booking_id = p.booking_id
JOIN Customer c ON c.customer_id = b.customer_id
JOIN Show_Time st ON st.show_id = b.show_id
JOIN Movie m ON m.movie_id = st.movie_id
WHERE p.payment_id = 1;
```

---

## Testing Checklist

The following scenarios were tested end-to-end:

| # | Test | Expected Result |
|---|------|----------------|
| 1 | Pick today's date | Show cards appear |
| 2 | Click a show | Seat map loads with A1-E8 layout |
| 3 | Select A1, A2 – fill form – click Book Now | Receipt shows Booking ID and Payment ID |
| 4 | Go back to same show | A1, A2 appear red (Booked) and not clickable |
| 5 | Try to book A1 again | HTTP 409 with friendly error toast |
| 6 | Restart the server | A1, A2 still booked (persisted in movie.db) |
| 7 | Enter Booking ID in header | Receipt reloads correctly |
| 8 | Enter Payment ID in header | Payment details card shows |
| 9 | Search non-existent Payment ID 9999 | Error toast "Payment not found" |
| 10 | Navigate to `#receipt/1` in URL | Receipt loads directly |
| 11 | Navigate to `#payment/1` in URL | Payment details load directly |

---

## Notes for Viva

- **Parameterized SQL only** – no string concatenation anywhere. All user input
  goes through `?` placeholders to prevent SQL injection.
- **WAL journal mode** – enables concurrent reads while a write is in progress.
- **Row factory** – `conn.row_factory = sqlite3.Row` lets you access columns by
  name (e.g. `row["title"]`) instead of index for cleaner, safer code.
- **Seat price calculation** happens at the application layer using the
  `PRICE_MULT` dictionary so the base price remains a single source of truth.
- The frontend **polls the seat map every 6 seconds** while it is open, so
  bookings made in another tab automatically appear as locked seats.
