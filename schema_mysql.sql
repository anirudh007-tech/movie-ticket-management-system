-- ============================================================
-- Movie Ticket Management System – MySQL Schema
-- Equivalent to the SQLite schema used in the application.
-- Normalized to 3NF with primary keys, foreign keys, and
-- appropriate constraints.
--
-- Usage:
--   mysql -u root -p < schema_mysql.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS movie_ticket_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE movie_ticket_db;

-- ── Movie ──────────────────────────────────────────────────
-- Stores the catalogue of films available in the system.
CREATE TABLE IF NOT EXISTS Movie (
    movie_id      INT          NOT NULL AUTO_INCREMENT,
    title         VARCHAR(255) NOT NULL,
    genre         VARCHAR(100) NOT NULL,
    language      VARCHAR(100) NOT NULL,
    duration_min  INT          NOT NULL CHECK (duration_min > 0),
    PRIMARY KEY (movie_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Theatre ────────────────────────────────────────────────
-- A physical cinema building that contains one or more screens.
CREATE TABLE IF NOT EXISTS Theatre (
    theatre_id  INT          NOT NULL AUTO_INCREMENT,
    name        VARCHAR(255) NOT NULL,
    city        VARCHAR(100) NOT NULL,
    PRIMARY KEY (theatre_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Screen ─────────────────────────────────────────────────
-- An auditorium / hall within a theatre.
CREATE TABLE IF NOT EXISTS Screen (
    screen_id    INT          NOT NULL AUTO_INCREMENT,
    theatre_id   INT          NOT NULL,
    screen_name  VARCHAR(100) NOT NULL,
    total_seats  INT          NOT NULL CHECK (total_seats > 0),
    PRIMARY KEY (screen_id),
    CONSTRAINT fk_screen_theatre
        FOREIGN KEY (theatre_id) REFERENCES Theatre(theatre_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Seat ───────────────────────────────────────────────────
-- A specific physical seat in a screen.
-- seat_type determines the price multiplier:
--   Regular → ×1.0 | Premium → ×1.25 | VIP → ×1.5
CREATE TABLE IF NOT EXISTS Seat (
    seat_id     INT         NOT NULL AUTO_INCREMENT,
    screen_id   INT         NOT NULL,
    seat_number VARCHAR(10) NOT NULL,
    seat_type   ENUM('Regular','Premium','VIP') NOT NULL,
    PRIMARY KEY (seat_id),
    UNIQUE KEY uq_seat (screen_id, seat_number),    -- no duplicate seats per screen
    CONSTRAINT fk_seat_screen
        FOREIGN KEY (screen_id) REFERENCES Screen(screen_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Show_Time ──────────────────────────────────────────────
-- A specific screening of a movie at a particular screen,
-- date, and time.
CREATE TABLE IF NOT EXISTS Show_Time (
    show_id     INT          NOT NULL AUTO_INCREMENT,
    movie_id    INT          NOT NULL,
    screen_id   INT          NOT NULL,
    show_date   DATE         NOT NULL,
    show_time   TIME         NOT NULL,
    base_price  DECIMAL(8,2) NOT NULL CHECK (base_price > 0),
    PRIMARY KEY (show_id),
    UNIQUE KEY uq_show (screen_id, show_date, show_time),  -- one show per slot
    CONSTRAINT fk_show_movie
        FOREIGN KEY (movie_id)  REFERENCES Movie(movie_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_show_screen
        FOREIGN KEY (screen_id) REFERENCES Screen(screen_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Customer ───────────────────────────────────────────────
-- A person who places one or more bookings.
-- email is the natural key used to detect returning customers.
CREATE TABLE IF NOT EXISTS Customer (
    customer_id  INT          NOT NULL AUTO_INCREMENT,
    name         VARCHAR(255) NOT NULL,
    email        VARCHAR(320) NOT NULL UNIQUE,   -- email is natural key
    phone        VARCHAR(15)  NOT NULL,
    PRIMARY KEY (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Booking ────────────────────────────────────────────────
-- The header record for a ticket purchase; linked to a
-- specific customer and show.
CREATE TABLE IF NOT EXISTS Booking (
    booking_id    INT          NOT NULL AUTO_INCREMENT,
    customer_id   INT          NOT NULL,
    show_id       INT          NOT NULL,
    booking_time  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    total_amount  DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status        ENUM('Confirmed','Cancelled','Pending') NOT NULL DEFAULT 'Confirmed',
    PRIMARY KEY (booking_id),
    CONSTRAINT fk_booking_customer
        FOREIGN KEY (customer_id) REFERENCES Customer(customer_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_booking_show
        FOREIGN KEY (show_id) REFERENCES Show_Time(show_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Booking_Seat ───────────────────────────────────────────
-- Links specific seats to a booking for a show.
-- The UNIQUE(show_id, seat_id) constraint is the critical
-- database-level guard that prevents a seat from being booked
-- twice for the same show, even under concurrent load.
CREATE TABLE IF NOT EXISTS Booking_Seat (
    booking_id  INT          NOT NULL,
    show_id     INT          NOT NULL,
    seat_id     INT          NOT NULL,
    price       DECIMAL(8,2) NOT NULL,
    PRIMARY KEY (booking_id, seat_id),
    UNIQUE KEY uq_seat_booking (show_id, seat_id),   -- *** PREVENTS DOUBLE-BOOKING ***
    CONSTRAINT fk_bs_booking
        FOREIGN KEY (booking_id) REFERENCES Booking(booking_id)
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT fk_bs_show
        FOREIGN KEY (show_id)    REFERENCES Show_Time(show_id)
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT fk_bs_seat
        FOREIGN KEY (seat_id)    REFERENCES Seat(seat_id)
        ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ── Payment ────────────────────────────────────────────────
-- Stores the financial record for a booking.
CREATE TABLE IF NOT EXISTS Payment (
    payment_id    INT          NOT NULL AUTO_INCREMENT,
    booking_id    INT          NOT NULL,
    amount        DECIMAL(10,2) NOT NULL,
    method        ENUM('UPI','Card','Cash','NetBanking') NOT NULL DEFAULT 'UPI',
    payment_time  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status        ENUM('Success','Failed','Refunded') NOT NULL DEFAULT 'Success',
    PRIMARY KEY (payment_id),
    CONSTRAINT fk_payment_booking
        FOREIGN KEY (booking_id) REFERENCES Booking(booking_id)
        ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- SAMPLE QUERIES (for DBMS viva / project report)
-- ============================================================

-- 1. Show-wise bookings: how many seats are booked per show
-- SELECT st.show_id, m.title, st.show_date, st.show_time,
--        COUNT(bs.seat_id) AS booked_seats
-- FROM Show_Time st
-- JOIN Movie m ON m.movie_id = st.movie_id
-- LEFT JOIN Booking_Seat bs ON bs.show_id = st.show_id
-- GROUP BY st.show_id
-- ORDER BY st.show_date, st.show_time;

-- 2. Revenue per movie
-- SELECT m.title, SUM(p.amount) AS total_revenue
-- FROM Payment p
-- JOIN Booking b ON b.booking_id = p.booking_id
-- JOIN Show_Time st ON st.show_id = b.show_id
-- JOIN Movie m ON m.movie_id = st.movie_id
-- WHERE p.status = 'Success'
-- GROUP BY m.movie_id
-- ORDER BY total_revenue DESC;

-- 3. Seat occupancy per show (percentage)
-- SELECT st.show_id, m.title, st.show_date, st.show_time,
--        sc.total_seats,
--        COUNT(bs.seat_id) AS booked,
--        ROUND(COUNT(bs.seat_id) * 100.0 / sc.total_seats, 1) AS occupancy_pct
-- FROM Show_Time st
-- JOIN Movie m ON m.movie_id = st.movie_id
-- JOIN Screen sc ON sc.screen_id = st.screen_id
-- LEFT JOIN Booking_Seat bs ON bs.show_id = st.show_id
-- GROUP BY st.show_id;

-- 4. Available seats for a specific show (replace ? with show_id)
-- SELECT s.seat_number, s.seat_type
-- FROM Seat s
-- WHERE s.screen_id = (SELECT screen_id FROM Show_Time WHERE show_id = ?)
--   AND s.seat_id NOT IN (
--       SELECT seat_id FROM Booking_Seat WHERE show_id = ?
--   );

-- 5. Payment lookup by payment_id (replace 1 with the desired ID)
-- SELECT p.payment_id, c.name, c.email, m.title,
--        p.amount, p.method, p.status
-- FROM Payment p
-- JOIN Booking b ON b.booking_id = p.booking_id
-- JOIN Customer c ON c.customer_id = b.customer_id
-- JOIN Show_Time st ON st.show_id = b.show_id
-- JOIN Movie m ON m.movie_id = st.movie_id
-- WHERE p.payment_id = 1;
