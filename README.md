# Police Administration System

A minimal full-stack Police Administration and FIR Management project built with Node.js, Express, MySQL, and plain HTML/CSS/JavaScript.

All important records are stored in the XAMPP MySQL database. The app does not use seed data or file-system storage for normal CRUD operations.

## Features

- First admin account setup
- User sign in and sign out
- User CRUD: create, view, update, delete users
- Station CRUD: create, view, update, delete police stations
- FIR CRUD: create, view, update, delete FIR records
- Admin users can manage users, stations, and all FIRs
- Officer users can manage FIRs for their assigned station
- Passwords are stored as bcrypt hashes
- MySQL database and tables are created automatically when the server starts

## Technology Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express.js
- Database: MySQL using XAMPP
- Database Driver: mysql2
- Password Hashing: bcryptjs

## Project Structure

```text
Police_Admin_System/
+-- server.js
+-- package.json
+-- .env
+-- .env.example
+-- db/
|   +-- schema.sql
|   +-- seed.sql
+-- public/
    +-- index.html
    +-- css/
    |   +-- styles.css
    +-- js/
        +-- app.js
```

## Requirements

- Node.js installed
- XAMPP installed
- MySQL running from XAMPP Control Panel

Apache is not required for this project because the Node/Express server serves the frontend.

## Environment Setup

Update `.env` in the project root:

```env
PORT=5000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=
DB_NAME=police_fir_system
```

For default XAMPP, `DB_USER` is usually `root` and `DB_PASSWORD` is usually blank.

If your MySQL root user has a password, add it:

```env
DB_PASSWORD=your_mysql_password
```

## How To Run

1. Start XAMPP.
2. Start MySQL from the XAMPP Control Panel.
3. Open a terminal in the project folder:

```powershell
cd D:\db_lab\Police_Admin_System
```

4. Install dependencies:

```powershell
npm install
```

5. Start the server:

```powershell
npm start
```

6. Open the app in your browser:

```text
http://localhost:5000
```

If port `5000` is already busy, change `.env`:

```env
PORT=5001
```

Then restart the server and open:

```text
http://localhost:5001
```

## First Time Use

When the database has no users, the app shows the **First Admin Setup** page.

Create an admin account, for example:

```text
Name: Admin
Username: admin
Password: admin123
```

After creating the admin, sign in and add:

- Police stations
- Officer users
- FIR records

## Database

The server automatically creates the database and these tables:

- `stations`
- `users`
- `firs`

Database name:

```text
police_fir_system
```

You can view the database in phpMyAdmin:

```text
http://localhost/phpmyadmin
```

The `db/schema.sql` file contains the table structure for manual import if required.

The `db/seed.sql` file is intentionally not used because this version stores real data entered from the frontend.

## Useful Commands

Stop all running Node servers:

```powershell
Get-Process node | Stop-Process -Force
```

Start again:

```powershell
npm start
```

Check server JavaScript syntax:

```powershell
node --check server.js
```

## Security Notes

The backend uses parameterized SQL queries through `mysql2`, which helps protect against SQL injection.

Passwords are hashed using `bcryptjs`.

For a class project, this is suitable. For production use, add HTTPS, rate limiting, persistent sessions, audit logs, and stronger access controls.
