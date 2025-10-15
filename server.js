const express = require("express");
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");
const cors = require("cors");
const path = require("path");
const session = require("express-session");

const app = express();
const port = 3000;

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.static("public"));

app.use(session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

// MySQL Connection
const db = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "12345",
    database: "hostel_management"
});

db.connect((err) => {
    if (err) {
        console.error("Database connection failed:", err);
    } else {
        console.log("Connected to MySQL database");
    }
});

// Middleware to check student login
function isAuthenticated(req, res, next) {
    if (req.session.studentID) {
        next();
    } else {
        res.status(401).json({ message: "Unauthorized" });
    }
}

// Middleware to check warden login
function isWardenAuthenticated(req, res, next) {
    if (req.session.wardenID) {
        next();
    } else {
        res.status(401).json({ message: "Unauthorized (Warden)" });
    }
}

// ROUTES
app.get("/signup", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "signup.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "login.html"));
});

// Student Signup
app.post("/signup", async (req, res) => {
    const { student_Id, name, email, Phone_Number, date_of_admission, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = "INSERT INTO student (student_Id, name, email, Phone_Number, date_of_admission, password) VALUES (?, ?, ?, ?, ?, ?)";

        db.query(query, [student_Id, name, email, Phone_Number, date_of_admission, hashedPassword], (err) => {
            if (err) return res.status(500).json({ message: "Error signing up", error: err });
            res.status(200).json({ message: "Signup successful" });
        });
    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
});

// Login (for both student and warden)
app.post("/login", (req, res) => {
    const { student_Id, password } = req.body;

    const isWarden = student_Id[0].toLowerCase() === 'w';
    const table = isWarden ? 'warden' : 'student';
    const idField = isWarden ? 'Warden_ID' : 'Student_ID';

    const query = `SELECT * FROM ${table} WHERE ${idField} = ?`;
    db.query(query, [student_Id], async (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });

        if (results.length === 0) {
            return res.status(401).json({ message: `Invalid ${isWarden ? 'Warden' : 'Student'} ID or Password` });
        }

        const user = results[0];
        if (!user.Password) return res.status(401).json({ message: "Password not set" });

        try {
            const isMatch = await bcrypt.compare(password, user.Password);
            if (!isMatch) return res.status(401).json({ message: "Invalid ID or Password" });

            if (isWarden) {
                req.session.wardenID = student_Id;
                req.session.wardenHostelID = user.Hostel_ID; // <- This is crucial!
            } else {
                req.session.studentID = student_Id;
            }
            req.session.save(err => {
                if (err) return res.status(500).json({ message: "Session error" });

                res.json({
                    success: true,
                    userType: isWarden ? "warden" : "student",
                    userId: student_Id
                });
            });

        } catch (error) {
            res.status(500).json({ message: "Login error", error });
        }
    });
});

// Logout
app.post('/logout', (req, res) => {
    req.session.destroy();
    res.clearCookie('connect.sid');
    res.json({ success: true });
});

// Update Profile
app.post("/update-profile", isAuthenticated, (req, res) => {
    const student_Id = req.session.studentID;
    const { name, email, phone } = req.body;
    console.log("Student ID in session:", student_Id);
    const query = "UPDATE student SET Name = ?, Email = ?, Phone_Number = ? WHERE Student_ID = ?";
    db.query(query, [name, email, phone, student_Id], (err, result) => {
        if (err) {
            console.error("Error updating student info:", err);
            return res.status(500).json({ success: false, message: "Database update failed" });
        }
        console.log("Update query result:", result);
        res.status(200).json({ success: true, message: "Profile updated successfully" });
    });
});


// Apply Leave
app.post('/apply-leave', isAuthenticated, (req, res) => {
    const student_id = req.session.studentID;
    const { start_date, end_date, reason, destination } = req.body;

    const apply_time = new Date();
    const status = "Pending";

    const sql = `INSERT INTO leaves (Student_ID, Start_Date, End_Date, Reason, Status, Destination, Apply_Time) 
               VALUES (?, ?, ?, ?, ?, ?, ?)`;

    db.query(sql, [student_id, start_date, end_date, reason, status, destination, apply_time], (err) => {
        if (err) return res.status(500).json({ message: "Failed to apply for leave" });
        res.status(200).json({ message: "Leave applied successfully!" });
    });
});

// View Student Leaves
app.get("/view-leaves", isAuthenticated, (req, res) => {
    const student_id = req.session.studentID;

    db.query("SELECT * FROM leaves WHERE Student_ID = ?", [student_id], (err, results) => {
        if (err) return res.status(500).json({ message: "Failed to fetch applied leaves" });
        res.status(200).json(results);
    });
});

// Request Visitor
app.post("/request-visitor", isAuthenticated, (req, res) => {
    const { visitor_name, phone_number, id_proof, visit_date, in_time, out_time, purpose } = req.body;
    const student_id = req.session.studentID;

    const checkVisitorSQL = "SELECT Visitor_ID FROM visitors WHERE Phone_Number = ?";

    db.query(checkVisitorSQL, [phone_number], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error" });

        if (results.length > 0) {
            insertVisitLog(results[0].Visitor_ID);
        } else {
            db.query("INSERT INTO visitors (Name, Phone_Number, ID_Proof) VALUES (?, ?, ?)",
                [visitor_name, phone_number, id_proof], (err, result) => {
                    if (err) return res.status(500).json({ message: "Error adding visitor" });
                    insertVisitLog(result.insertId);
                });
        }
    });

    function insertVisitLog(visitor_id) {
        const sql = `INSERT INTO visitor_log (Visitor_ID, Student_ID, Visit_Date, In_Time, Out_Time, Purpose, Warden_Approval)
                 VALUES (?, ?, ?, ?, ?, ?, 'Pending')`;

        db.query(sql, [visitor_id, student_id, visit_date, in_time, out_time, purpose], (err) => {
            if (err) return res.status(500).json({ message: "Error submitting visit request" });
            res.json({ message: "Visitor request submitted successfully" });
        });
    }
});

// View Visitor Logs
app.get("/view-visitors", isAuthenticated, (req, res) => {
    const student_id = req.session.studentID;

    const sql = `
    SELECT v.Name AS Visitor_Name, v.Phone_Number, v.ID_Proof, l.Visit_Date, l.In_Time, l.Out_Time, l.Purpose, l.Warden_Approval
    FROM visitor_log l
    JOIN visitors v ON l.Visitor_ID = v.Visitor_ID
    WHERE l.Student_ID = ?
    ORDER BY l.Visit_Date DESC
  `;

    db.query(sql, [student_id], (err, results) => {
        if (err) return res.status(500).json({ message: "Error fetching visitor data" });
        res.json(results);
    });
});

// File Complaint
app.post("/file-complaint", isAuthenticated, (req, res) => {
    const student_id = req.session.studentID;
    const { description } = req.body;

    db.query("INSERT INTO complaint (Student_ID, Description) VALUES (?, ?)", [student_id, description], (err) => {
        if (err) return res.status(500).json({ message: "Failed to file complaint" });
        res.status(200).json({ message: "Complaint filed successfully" });
    });
});

// View Complaints
app.get("/view-complaints", isAuthenticated, (req, res) => {
    const student_id = req.session.studentID;

    db.query("SELECT * FROM complaint WHERE Student_ID = ? ORDER BY Date_Logged DESC", [student_id], (err, results) => {
        if (err) return res.status(500).json({ message: "Failed to fetch complaints" });
        res.status(200).json(results);
    });
});

// Warden Signup Page
app.get("/warden_signup", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "warden_signup.html"));
});

// Warden Signup
app.post("/warden_signup", async (req, res) => {
    const { Warden_ID, Name, Phone_Number, Hostel_ID, password } = req.body;

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.query("INSERT INTO warden (Warden_ID, Name, Phone_Number, Hostel_ID, Password) VALUES (?, ?, ?, ?, ?)",
            [Warden_ID, Name, Phone_Number, Hostel_ID, hashedPassword],
            (err) => {
                if (err) return res.status(500).json({ message: "Error signing up", error: err });
                res.status(200).json({ message: "Warden signed up successfully" });
            });
    } catch (error) {
        res.status(500).json({ message: "Server error", error });
    }
});


// 1. Room Status with Occupants
app.get("/room_status", isWardenAuthenticated, (req, res) => {
    const wardenID = req.session.wardenID;
    const getHostelSQL = "SELECT Hostel_ID FROM warden WHERE Warden_ID = ?";

    db.query(getHostelSQL, [wardenID], (err, results) => {
        if (err || results.length === 0) {
            console.error("Error fetching warden's hostel:", err);
            return res.status(500).json({ message: "Error fetching warden's hostel" });
        }

        const hostelID = results[0].Hostel_ID;

        const sql = `
      SELECT r.Room_ID, r.Room_Number, r.Capacity, r.Status,
             s.Student_ID, s.Name
      FROM room r
      LEFT JOIN room_allocation ra ON r.Room_ID = ra.Room_ID
      LEFT JOIN student s ON ra.Student_ID = s.Student_ID
      WHERE r.Hostel_ID = ?
      ORDER BY r.Room_Number;
    `;

        db.query(sql, [hostelID], (err, rows) => {
            if (err) return res.status(500).json({ message: "Error fetching rooms" });

            const roomMap = {};
            rows.forEach(row => {
                if (!roomMap[row.Room_ID]) {
                    roomMap[row.Room_ID] = {
                        Room_ID: row.Room_ID,
                        Room_Number: row.Room_Number,
                        Capacity: row.Capacity,
                        Status: row.Status,
                        occupants: []
                    };
                }
                if (row.Student_ID) {
                    roomMap[row.Room_ID].occupants.push({
                        Student_ID: row.Student_ID,
                        Name: row.Name
                    });
                }
            });

            res.json({ hostelID, rooms: Object.values(roomMap) });
        });
    });
});

// 2. Get Unallocated Students (Only if previous hostels are full)
app.get("/unallocated_students", isWardenAuthenticated, (req, res) => {
    const wardenID = req.session.wardenID;
    const getHostelSQL = "SELECT Hostel_ID FROM warden WHERE Warden_ID = ?";

    db.query(getHostelSQL, [wardenID], async (err, result) => {
        if (err || result.length === 0) return res.status(500).json({ message: "Hostel not found" });

        const currentHostel = result[0].Hostel_ID;

        // Check if previous hostels are full
        for (let i = 1; i < currentHostel; i++) {
            const [roomsNotFull] = await db.promise().query(
                `SELECT * FROM room WHERE Hostel_ID = ? AND Status != 'Full'`, [i]
            );
            if (roomsNotFull.length > 0) return res.json([]);
        }

        const sql = `
      SELECT Student_ID, Name FROM student
      WHERE Student_ID NOT IN (SELECT Student_ID FROM room_allocation)
    `;
        db.query(sql, (err, students) => {
            if (err) return res.status(500).json({ message: "Error fetching students" });
            res.json(students);
        });
    });
});

// 3. Allocate Room
app.post("/allocate_room", isWardenAuthenticated, (req, res) => {
    const { roomID, studentID } = req.body;
    if (!roomID || !studentID) return res.status(400).json({ message: "Room ID and Student ID are required." });

    db.query("SELECT * FROM room_allocation WHERE Student_ID = ?", [studentID], (err, studentRes) => {
        if (err) return res.status(500).json({ message: "Error checking student's room" });
        if (studentRes.length > 0) return res.status(400).json({ message: "Student already has a room allocated." });

        db.query("SELECT COUNT(*) AS count FROM room_allocation WHERE Room_ID = ?", [roomID], (err, result) => {
            if (err) return res.status(500).json({ message: "Error checking occupancy" });

            const currentCount = result[0].count;
            db.query("SELECT Capacity FROM room WHERE Room_ID = ?", [roomID], (err, capacityResult) => {
                if (err || capacityResult.length === 0) {
                    return res.status(500).json({ message: "Error checking room capacity" });
                }

                const maxCapacity = capacityResult[0].Capacity;
                if (currentCount >= maxCapacity) {
                    return res.status(400).json({ message: "Room is already full!" });
                }

                db.query(`
          INSERT INTO room_allocation (Room_ID, Student_ID, Allocation_Date, Allocation_Timestamp)
          VALUES (?, ?, CURDATE(), NOW())`,
                    [roomID, studentID], (err) => {
                        if (err) return res.status(500).json({ message: "Error allocating room" });

                        if (currentCount + 1 === maxCapacity) {
                            db.query("UPDATE room SET Status = 'Full' WHERE Room_ID = ?", [roomID]);
                        }

                        return res.status(200).json({ message: "✅ Student successfully allocated to room." });
                    }
                );
            });
        });
    });
});

// Get Available Rooms in Warden's Hostel
app.get("/available_rooms", isWardenAuthenticated, async (req, res) => {
    const wardenID = req.session.wardenID;
    const { excludeStudent } = req.query; // Optional parameter to exclude student's current room

    try {
        // 1. Get warden's hostel
        const [wardenResult] = await db.promise().query(
            "SELECT Hostel_ID FROM warden WHERE Warden_ID = ?", 
            [wardenID]
        );
        
        if (wardenResult.length === 0) {
            return res.status(404).json({ success: false, message: "Warden hostel not found" });
        }

        const hostelID = wardenResult[0].Hostel_ID;

        // 2. Build query based on parameters
        let query = `
            SELECT 
                r.Room_ID, 
                r.Room_Number, 
                r.Capacity, 
                COUNT(ra.Student_ID) AS current_occupants,
                (r.Capacity - COUNT(ra.Student_ID)) AS available_beds,
                r.Status,
                GROUP_CONCAT(s.Name ORDER BY s.Name SEPARATOR ', ') AS occupants_names
            FROM room r
            LEFT JOIN room_allocation ra ON r.Room_ID = ra.Room_ID
            LEFT JOIN student s ON ra.Student_ID = s.Student_ID
            WHERE r.Hostel_ID = ?
        `;

        const params = [hostelID];

        // Add exclusion if student ID is provided
        if (excludeStudent) {
            query += ` AND r.Room_ID NOT IN (
                SELECT Room_ID FROM room_allocation WHERE Student_ID = ?
            )`;
            params.push(excludeStudent);
        }

        // Complete query
        query += `
            GROUP BY r.Room_ID
            HAVING available_beds > 0
            ORDER BY 
                CASE WHEN r.Status = 'Empty' THEN 0 ELSE 1 END,
                available_beds DESC,
                r.Room_Number ASC
        `;

        // 3. Execute query
        const [rooms] = await db.promise().query(query, params);

        // 4. Format response
        const formattedRooms = rooms.map(room => ({
            id: room.Room_ID,
            number: room.Room_Number,
            capacity: room.Capacity,
            available: room.available_beds,
            status: room.Status,
            currentOccupants: room.current_occupants,
            occupants: room.occupants_names || "None"
        }));

        res.json({
            success: true,
            data: formattedRooms
        });

    } catch (err) {
        console.error("Error fetching available rooms:", err);
        res.status(500).json({ 
            success: false,
            message: "Failed to fetch available rooms",
            error: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});



app.get('/warden_transfer_requests', (req, res) => {
    const wardenID = req.session.wardenID;
    if (!wardenID) return res.status(401).json({ message: "Unauthorized" });

    const getHostelQuery = 'SELECT Hostel_ID FROM warden WHERE Warden_ID = ?';
    db.query(getHostelQuery, [wardenID], (err, hostelResult) => {
        if (err) {
            console.error('Error fetching warden hostel:', err);
            return res.status(500).json({ message: 'Server error' });
        }

        if (hostelResult.length === 0)
            return res.status(404).json({ message: 'Hostel not found for warden' });

        const hostelID = hostelResult[0].Hostel_ID;

        const getRequestsQuery = `
        SELECT tr.Student_ID, tr.Reason, tr.Request_Date
        FROM room_transfer_requests tr
        JOIN room_allocation ra ON tr.Student_ID = ra.Student_ID
        JOIN room r ON ra.Room_ID = r.Room_ID
        WHERE r.Hostel_ID = ? AND tr.Status = 'Pending'
      `;

        db.query(getRequestsQuery, [hostelID], (err, requests) => {
            if (err) {
                console.error('Error fetching transfer requests:', err);
                return res.status(500).json({ message: 'Server error' });
            }

            res.json(requests);
        });
    });
});

app.post("/process_transfer/:studentId", isWardenAuthenticated, async (req, res) => {
    const studentId = req.params.studentId;
    const { selectedRoomId } = req.body; // Added: Get selected room from request body
    const wardenID = req.session.wardenID;

    try {
        // 1. Get Warden's Hostel
        const [[wardenRow]] = await db.promise().query(
            "SELECT Hostel_ID FROM warden WHERE Warden_ID = ?",
            [wardenID]
        );
        const hostelID = wardenRow.Hostel_ID;

        // 2. Validate selected room (NEW LOGIC)
        if (!selectedRoomId) {
            return res.status(400).json({ message: "No room selected" });
        }

        // Check if selected room exists and has capacity
        const [[room]] = await db.promise().query(`
            SELECT r.Room_ID, r.Capacity, 
                   COUNT(ra.Student_ID) AS current_occupants
            FROM room r
            LEFT JOIN room_allocation ra ON r.Room_ID = ra.Room_ID
            WHERE r.Room_ID = ? AND r.Hostel_ID = ?
            GROUP BY r.Room_ID
            HAVING current_occupants < r.Capacity
        `, [selectedRoomId, hostelID]);

        if (!room) {
            return res.status(400).json({ 
                message: "Selected room is invalid or already full" 
            });
        }

        // 3. Get student's current room (for status updates)
        const [[currentAllocation]] = await db.promise().query(
            "SELECT Room_ID FROM room_allocation WHERE Student_ID = ?",
            [studentId]
        );

        // Start transaction
        await db.promise().query("START TRANSACTION");

        try {
            // 4. Transfer the student
            await db.promise().query(`
                UPDATE room_allocation
                SET Room_ID = ?, 
                    Allocation_Date = CURDATE(), 
                    Allocation_Timestamp = NOW()
                WHERE Student_ID = ?
            `, [selectedRoomId, studentId]);

            // 5. Update room statuses (both old and new rooms)
            await db.promise().query(`
                UPDATE room r
                JOIN (
                    SELECT Room_ID, COUNT(Student_ID) AS count 
                    FROM room_allocation 
                    GROUP BY Room_ID
                ) AS occupancy ON r.Room_ID = occupancy.Room_ID
                SET r.Status = CASE
                    WHEN occupancy.count >= r.Capacity THEN 'Full'
                    WHEN occupancy.count = 0 THEN 'Empty'
                    ELSE 'Available'
                END
                WHERE r.Room_ID IN (?, ?)
            `, [currentAllocation?.Room_ID, selectedRoomId]);

            await db.promise().query(`
                UPDATE room_transfer_requests
                SET Status = 'Approved'
                WHERE Student_ID = ? AND Status = 'Pending'
            `, [studentId]);                       

            // Commit transaction
            await db.promise().query("COMMIT");

            res.status(200).json({ 
                success: true,
                message: `✅ Student transferred to room ${selectedRoomId}`,
                roomNumber: room.Room_Number // Optional: Return room number
            });

        } catch (err) {
            // Rollback on error
            await db.promise().query("ROLLBACK");
            throw err;
        }

    } catch (err) {
        console.error("Error processing transfer request:", err);
        res.status(500).json({ 
            success: false,
            message: "Internal server error" 
        });
    }
});

app.get('/student_room', (req, res) => {
    const studentID = req.session.studentID;
    if (!studentID) {
        return res.status(401).json({ message: "Not logged in" });
    }

    const roomQuery = `
      SELECT r.Room_ID, r.Room_Number, r.Capacity, h.Hostel_Name
      FROM room_allocation ra
      JOIN room r ON ra.Room_ID = r.Room_ID
      JOIN hostel h ON r.Hostel_ID = h.Hostel_ID
      WHERE ra.Student_ID = ?
    `;

    db.query(roomQuery, [studentID], (err, roomResult) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ message: "Room info fetch error" });
        }

        if (roomResult.length === 0) {
            return res.json({ message: "Room not yet allocated" });
        }

        const { Room_ID, Room_Number, Capacity, Hostel_Name } = roomResult[0];

        const roommatesQuery = `
          SELECT s.Student_ID, s.Name
          FROM room_allocation ra
          JOIN student s ON ra.Student_ID = s.Student_ID
          WHERE ra.Room_ID = ?
        `;

        db.query(roommatesQuery, [Room_ID], (err, roommateResults) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ message: "Roommate fetch error" });
            }

            const roommates = roommateResults.map(r => ({
                name: r.Name,
                id: r.Student_ID
            }));

            // Fill empty slots with 'Not Allotted Yet'
            while (roommates.length < Capacity) {
                roommates.push({ name: "Not Allotted Yet", id: "-" });
            }

            res.json({
                roomNumber: Room_Number,
                hostelName: Hostel_Name,
                roommates
            });
        });
    });
});

// Backend route to fetch student data
app.get('/get_student_data', (req, res) => {
    const studentID = req.session.studentID;

    if (!studentID) {
        return res.status(401).json({ message: 'Unauthorized. Please log in first.' });
    }

    // Changed from 'students' to 'student' to match your login query
    const studentQuery = "SELECT Name FROM student WHERE Student_ID = ?";

    db.query(studentQuery, [studentID], (err, studentResults) => {
        if (err) {
            console.error("Error fetching student data:", err);
            return res.status(500).json({ message: "Server error fetching student data." });
        }

        if (studentResults.length === 0) {
            return res.status(404).json({ message: "Student not found." });
        }

        const { Name } = studentResults[0];

        res.json({
            studentID: studentID,
            name: Name
        });
    });
});

// Get Warden Data
app.get('/get_warden_data', isWardenAuthenticated, (req, res) => {
    console.log("Full session:", req.session); // Debug
    console.log("Warden ID from session:", req.session.wardenID); // Debug
    
    const wardenID = req.session.wardenID;

    if (!wardenID) {
        console.log("❌ No wardenID in session");
        return res.status(401).json({ message: 'Unauthorized. Please log in first.' });
    }

    console.log("✅ Found wardenID:", wardenID);

    const wardenQuery = "SELECT Name, Hostel_ID FROM warden WHERE Warden_ID = ?";

    db.query(wardenQuery, [wardenID], (err, wardenResults) => {
        if (err) {
            console.error("Error fetching warden data:", err);
            return res.status(500).json({ message: "Server error fetching warden data." });
        }

        if (wardenResults.length === 0) {
            console.log("❌ Warden not found in database");
            return res.status(404).json({ message: "Warden not found." });
        }

        const { Name, Hostel_ID } = wardenResults[0];
        console.log("✅ Warden found:", Name);

        // Optionally get hostel name
        db.query("SELECT Hostel_Name FROM hostel WHERE Hostel_ID = ?", [Hostel_ID], (err2, hostelResults) => {
            const hostelName = (hostelResults && hostelResults.length > 0) 
                ? hostelResults[0].Hostel_Name 
                : `Hostel ${Hostel_ID}`;

            res.json({
                wardenID: wardenID,
                name: Name,
                hostelID: Hostel_ID,
                hostelName: hostelName
            });
        });
    });
});


app.post('/transfer_request', (req, res) => {
    const studentID = req.session.studentID;
    const { reason } = req.body;

    if (!studentID) {
        return res.status(401).json({ message: 'Unauthorized. Please log in first.' });
    }

    const today = new Date().toISOString().slice(0, 10);

    db.query(
        "SELECT * FROM room_transfer_requests WHERE Student_ID = ? AND Status = 'Pending'",
        [studentID],
        (err, results) => {
            if (err) {
                console.error("Error checking existing requests:", err);
                return res.status(500).json({ message: "Server error." });
            }

            if (results.length > 0) {
                return res.status(400).json({ message: "You already have a pending transfer request." });
            }

            db.query(
                "INSERT INTO room_transfer_requests (Student_ID, Reason, Request_Date) VALUES (?, ?, ?)",
                [studentID, reason, today],
                (err2, result2) => {
                    if (err2) {
                        console.error("Error inserting transfer request:", err2);
                        return res.status(500).json({ message: "Server error inserting request." });
                    }

                    res.json({ message: "Transfer request submitted successfully." });
                }
            );
        }
    );
});

app.get('/w_leaves', isWardenAuthenticated, (req, res) => {
    const wardenID = req.session.wardenID;

    // First, get the hostel ID for this warden
    const getHostelQuery = 'SELECT Hostel_ID FROM warden WHERE Warden_ID = ?';
    db.query(getHostelQuery, [wardenID], (err, hostelResult) => {
        if (err) {
            console.error('Error fetching warden hostel:', err);
            return res.status(500).json({ message: 'Server error' });
        }

        if (hostelResult.length === 0) {
            return res.status(404).json({ message: 'Hostel not found for warden' });
        }

        const hostelID = hostelResult[0].Hostel_ID;

        const sql = `
            SELECT l.Leave_ID, l.Student_ID, s.Name AS Student_Name, l.Start_Date, l.End_Date, l.Reason, l.Status AS Warden_Approval, l.Destination, l.Apply_Time
            FROM leaves l
            JOIN student s ON l.Student_ID = s.Student_ID
            JOIN room_allocation ra ON s.Student_ID = ra.Student_ID
            JOIN room r ON ra.Room_ID = r.Room_ID
            WHERE r.Hostel_ID = ?
            ORDER BY l.Apply_Time DESC
        `;
        db.query(sql, [hostelID], (err, results) => {
            if (err) {
                console.error('Error fetching leaves:', err);
                return res.status(500).json({ message: "Error fetching leave requests" });
            }
            res.json(results);
        });
    });
});
// Add this route for warden leaves page
app.get("/w_leaves.html", isWardenAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "w_leaves.html"));
});

app.get('/w_complaints', isWardenAuthenticated, (req, res) => {
    const hostelID = req.session.wardenHostelID;

    const sql = `
        SELECT c.Complaint_ID, c.Student_ID, s.Name, c.Description, c.Status, c.Date_Logged
        FROM complaint c
        JOIN student s ON c.Student_ID = s.Student_ID
        JOIN room_allocation ra ON s.Student_ID = ra.Student_ID
        JOIN room r ON ra.Room_ID = r.Room_ID
        WHERE r.Hostel_ID = ?
        ORDER BY c.Date_Logged DESC
    `;
    db.query(sql, [hostelID], (err, results) => {
        if (err) return res.status(500).json({ message: "Error fetching complaints" });
        res.json(results);
    });
});

app.get('/w_visitors', isWardenAuthenticated, (req, res) => {
    const hostelID = req.session.wardenHostelID;
    const sql = `
        SELECT v.Name AS Visitor_Name, v.Phone_Number, v.ID_Proof, l.Visit_Date, l.In_Time, l.Out_Time, l.Purpose, l.Warden_Approval, l.Log_ID, s.Name AS Student_Name
        FROM visitor_log l
        JOIN visitors v ON l.Visitor_ID = v.Visitor_ID
        JOIN student s ON l.Student_ID = s.Student_ID
        JOIN room_allocation r ON s.Student_ID = r.Student_ID
        JOIN room rm ON r.Room_ID = rm.Room_ID
        WHERE rm.Hostel_ID = ?
        ORDER BY l.Visit_Date DESC;
    `;

    db.query(sql, [hostelID], (err, results) => {
        if (err) {
            console.error("Error fetching visitor logs:", err);
            return res.status(500).json({ message: "Error fetching visitor logs" });
        }
        res.json(results);
    });
});

app.put('/update_visitor_approval/:logID', isWardenAuthenticated, (req, res) => {
    const { logID } = req.params;
    const { status } = req.body;

    const query = "UPDATE visitor_log SET Warden_Approval = ? WHERE Log_ID = ?";
    db.query(query, [status, logID], (err, result) => {
        if (err) {
            console.error("Error updating approval:", err);
            return res.status(500).json({ message: "Database error" });
        }
        res.json({ message: "Visitor approval updated successfully" });
    });
});

app.put('/update_leave_approval/:leaveID', isWardenAuthenticated, (req, res) => {
    const { leaveID } = req.params;
    const { status } = req.body;

    const query = "UPDATE leaves SET Status = ? WHERE Leave_ID = ?";
    db.query(query, [status, leaveID], (err, result) => {
        if (err) {
            console.error("Error updating leave approval:", err);
            return res.status(500).json({ message: "Database error" });
        }
        res.json({ message: "Leave status updated successfully" });
    });
});

app.put('/update_complaint_status/:complaintID', isWardenAuthenticated, (req, res) => {
    const { complaintID } = req.params;
    const { status, resolutionDetails, usedInventory } = req.body;
    // usedInventory: [{ inventoryID: 3, quantityUsed: 1 }, ...]

    const updateStatusQuery = "UPDATE complaint SET Status = ? WHERE Complaint_ID = ?";

    db.query(updateStatusQuery, [status, complaintID], (err, result) => {
        if (err) {
            console.error("Error updating complaint status:", err);
            return res.status(500).json({ message: "Error updating status" });
        }

        // If resolved, insert resolution + inventory usage
        if (status === 'Resolved') {
            const insertResolutionQuery = `
                INSERT INTO complaint_resolution (Complaint_ID, Resolution_Details, Resolved_Date)
                VALUES (?, ?, NOW())
            `;

            db.query(insertResolutionQuery, [complaintID, resolutionDetails], (err2) => {
                if (err2) {
                    console.error("Error inserting into complaint_resolution:", err2);
                    return res.status(500).json({ message: "Error saving resolution" });
                }

                if (!usedInventory || usedInventory.length === 0) {
                    return res.json({ message: "Complaint resolved without inventory usage" });
                }

                // Insert inventory usage
                const usageInserts = usedInventory.map(item => [
                    complaintID,
                    item.inventoryID,
                    item.quantityUsed,
                    new Date()
                ]);

                const usageQuery = `
                    INSERT INTO complaint_inventory_usage (Complaint_ID, Inventory_ID, Quantity_Used, Used_Date)
                    VALUES ?
                `;

                db.query(usageQuery, [usageInserts], (err3) => {
                    if (err3) {
                        console.error("Error inserting inventory usage:", err3);
                        return res.status(500).json({ message: "Error logging inventory usage" });
                    }

                    // Update inventory quantities
                    const updates = usedInventory.map(item => {
                        return new Promise((resolve, reject) => {
                            db.query(
                                `UPDATE inventory SET Quantity = Quantity - ? WHERE Inventory_ID = ?`,
                                [item.quantityUsed, item.inventoryID],
                                (err4) => err4 ? reject(err4) : resolve()
                            );
                        });
                    });

                    Promise.all(updates)
                        .then(() => {
                            res.json({ message: "Complaint resolved and inventory updated" });
                        })
                        .catch(err => {
                            console.error("Error updating inventory quantities:", err);
                            res.status(500).json({ message: "Error updating inventory quantities" });
                        });
                });
            });

        } else {
            return res.json({ message: "Complaint status updated" });
        }
    });
});

app.get('/inventory/:hostelID', isWardenAuthenticated, (req, res) => {
    const { hostelID } = req.params;

    const query = `SELECT Inventory_ID, Item_Name, Quantity FROM inventory WHERE Hostel_ID = ?`;
    db.query(query, [hostelID], (err, results) => {
        if (err) {
            console.error("Error fetching inventory:", err);
            return res.status(500).json({ message: "Error fetching inventory" });
        }

        res.json(results);
    });
});

app.post('/add_inventory', isWardenAuthenticated, (req, res) => {
    const { itemName, quantity } = req.body;
    const wardenID = req.session.wardenID;

    if (!wardenID) {
        return res.status(403).json({ message: "Unauthorized" });
    }

    const getHostelQuery = `SELECT Hostel_ID FROM warden WHERE Warden_ID = ?`;
    db.query(getHostelQuery, [wardenID], (err, result) => {
        if (err || result.length === 0) {
            console.error("Error fetching warden hostel:", err);
            return res.status(500).json({ message: "Server error" });
        }

        const hostelID = result[0].Hostel_ID;
        const insertQuery = `
            INSERT INTO inventory (Hostel_ID, Item_Name, Quantity, Last_Updated)
            VALUES (?, ?, ?, NOW())
        `;

        db.query(insertQuery, [hostelID, itemName, quantity], (err2) => {
            if (err2) {
                console.error("Error inserting inventory:", err2);
                return res.status(500).json({ message: "Database insert error" });
            }

            return res.json({ message: "Inventory item added successfully!" });
        });
    });
});

app.get('/get_warden_inventory', (req, res) => {
    const wardenID = req.session.wardenID;

    if (!wardenID) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const getHostelIDQuery = `SELECT Hostel_ID FROM warden WHERE Warden_ID = ?`;
    db.query(getHostelIDQuery, [wardenID], (err, result) => {
        if (err || result.length === 0) {
            return res.status(500).json({ error: 'Hostel not found for warden' });
        }

        const hostelID = result[0].Hostel_ID;
        const getInventoryQuery = `SELECT Inventory_ID, Item_Name, Quantity, Last_Updated FROM inventory WHERE Hostel_ID = ?`;

        db.query(getInventoryQuery, [hostelID], (err2, data) => {
            if (err2) {
                return res.status(500).json({ error: 'Inventory fetch error' });
            }

            res.json(data); // Send inventory list
        });
    });
});


// GET route to fetch students of the current warden's hostel
app.get("/warden_attendance", isWardenAuthenticated, (req, res) => {
    const hostelID = req.session.wardenHostelID;

    const query = `
        SELECT s.Student_ID, s.Name 
        FROM student s
        JOIN room_allocation r ON s.Student_ID = r.Student_ID
        JOIN room rm ON r.Room_ID = rm.Room_ID
        WHERE rm.Hostel_ID = ?
    `;

    db.query(query, [hostelID], (err, results) => {
        if (err) {
            console.error("Error fetching students for attendance:", err);
            return res.status(500).json({ message: "Error fetching students" });
        }

        res.json(results);
    });
});

// POST route to save attendance for a specific date
app.post("/warden_attendance", isWardenAuthenticated, (req, res) => {
    const wardenID = req.session.wardenID;
    const { date, attendance } = req.body; // [{ Student_ID, Status }, ...]

    const values = attendance.map(entry => [entry.Student_ID, date, entry.Status, wardenID]);

    const query = `
        INSERT INTO attendance (Student_ID, Date, Status, Warden_ID)
        VALUES ?
        ON DUPLICATE KEY UPDATE Status = VALUES(Status)
    `;

    db.query(query, [values], (err) => {
        if (err) {
            console.error("Error saving attendance:", err);
            return res.status(500).json({ message: "Error saving attendance" });
        }

        res.json({ message: "Attendance saved successfully!" });
    });
});

app.get('/student_attendance', (req, res) => {
    const studentID = req.session.studentID;

    if (!studentID) {
        return res.status(401).json({ message: "Not logged in" });
    }

    const query = `
      SELECT Date, Status
      FROM attendance
      WHERE Student_ID = ?
      ORDER BY Date ASC
    `;

    db.query(query, [studentID], (err, results) => {
        if (err) {
            console.error("DB error fetching attendance:", err);
            return res.status(500).json({ message: "Server error" });
        }

        // Convert MySQL date to 'YYYY-MM-DD' string
        const formatted = results.map(row => ({
            Date: row.Date.toISOString().split('T')[0],
            Status: row.Status
        }));
        res.json(formatted);
    });
});

// Start Server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});