require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const app = express();
const nodemailer = require('nodemailer');
const crypto = require('crypto');

// Configure CORS with proper headers and preflight handling
const allowedOrigins = [
  'http://localhost:3000',
  'http://192.168.254.154:3000',
  'https://frontend-nine-gamma-56.vercel.app'
];

// Database connection is now handled in database.js
// Use cors middleware with specific options
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar']
}));

// Handle preflight requests
app.options('*', cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
}));
app.use(express.json({ limit: '50mb' }));
app.use(bodyParser.json({ limit: '50mb' }));

const { sendStatusEmail, sendRenewalStatusEmail, sendRevokeEmail, sendTerminationEmail, sendReverificationEmail } = require('./services/emailService');

// Cloudinary setup
const cloudinary = require('cloudinary').v2;
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const { pool, queryDatabase } = require('./database');
const mysql = require('mysql2/promise');

// Add logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Import routes
const documentsRouter = require('./routes/documents');
const usersRouter = require('./routes/users');
const faceAuthRouter = require('./routes/faceAuth');
const forumRouter = require('./routes/forumRoutes');
const idCardRouter = require('./routes/idCard');

// Use routes
app.use('/api/documents', documentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/forum', forumRouter);
app.use('/api/events', require('./routes/events'));  // Use the events router
app.use('/api/idcard', idCardRouter);  // Use the idCard router

// NOTIFICATIONS ENDPOINTS for SuperAdminSideBar.jsx
// GET all notifications for superadmin
app.get('/api/notifications', async (req, res) => {
  try {
    // Adjust the query as needed for your schema
    const notifications = await queryDatabase('SELECT * FROM superadminnotifications ORDER BY created_at DESC');
    res.json({ success: true, notifications });
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
  }
});

// DELETE all notifications for superadmin
app.delete('/api/notifications', async (req, res) => {
  try {
    await queryDatabase('DELETE FROM superadminnotifications');
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to clear notifications' });
  }
});

// PUT: Mark a notification as read
app.put('/api/notifications/mark-as-read/:notifId', async (req, res) => {
  const notifId = req.params.notifId;
  try {
    const updateQuery = 'UPDATE superadminnotifications SET is_read = 1 WHERE id = ?';
    const result = await queryDatabase(updateQuery, [notifId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
  }
});

// --- ADMIN NOTIFICATIONS ENDPOINTS ---
// GET all notifications for admin (filtered by barangay)
app.get('/api/adminnotifications', async (req, res) => {
  const { barangay } = req.query;
  try {
    if (!barangay) {
      return res.status(400).json({ success: false, error: 'Barangay is required' });
    }
    const notifications = await queryDatabase('SELECT * FROM adminnotifications WHERE barangay = ? ORDER BY id DESC', [barangay]);
    res.json({ success: true, notifications });
  } catch (err) {
    console.error('Error fetching admin notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
  }
});

// DELETE all notifications for admin
app.delete('/api/adminnotifications', async (req, res) => {
  const { barangay } = req.query;
  if (!barangay) {
    return res.status(400).json({ success: false, error: 'Barangay is required' });
  }
  try {
    await queryDatabase('DELETE FROM adminnotifications WHERE barangay = ?', [barangay]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error clearing admin notifications:', err);
    res.status(500).json({ success: false, error: 'Failed to clear notifications' });
  }
});

// PUT: Mark an admin notification as read
app.put('/api/adminnotifications/mark-as-read/:notifId', async (req, res) => {
  const notifId = req.params.notifId;
  try {
    const updateQuery = 'UPDATE adminnotifications SET is_read = 1 WHERE id = ?';
    const result = await queryDatabase(updateQuery, [notifId]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    res.json({ success: true, message: 'Notification marked as read' });
  } catch (error) {
    console.error('Error marking admin notification as read:', error);
    res.status(500).json({ success: false, error: 'Failed to mark notification as read' });
  }
});

// Configure special route for face authentication with logging
app.use('/api/authenticate-face', (req, res, next) => {
  console.log('Face auth route accessed with method:', req.method);
  console.log('Request body contains descriptor:', req.body && req.body.descriptor ? 'Yes' : 'No');
  console.log('Request headers:', req.headers);
  // Skip token verification for face authentication
  next();
}, faceAuthRouter);

// Implement direct route for check-user-status
app.post('/api/check-user-status', async (req, res) => {
  try {
    const { email } = req.body;
    console.log('User status check requested for email:', email);
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }
    
    // Get user by email
    const users = await queryDatabase(
      'SELECT id, email, name, code_id, status, faceRecognitionPhoto FROM users WHERE email = ?', 
      [email]
    );
    
    if (!users || users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found with this email' 
      });
    }
    
    const user = users[0];
    
    // Return user status and whether they have face recognition
    return res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        hasFaceRecognition: user.faceRecognitionPhoto ? true : false
      }
    });
  } catch (error) {
    console.error('Error checking user status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error while checking user status' 
    });
  }
});

// Endpoint to create announcement (accepts JSON: title, description, link, imageBase64)
app.post('/api/announcements', async (req, res) => {
  try {
    const { title, description, link, imageBase64, endDate } = req.body;
    let imageUrl = null;

    // Upload image to Cloudinary if imageBase64 is provided
    if (imageBase64) {
      try {
        const uploadRes = await cloudinary.uploader.upload(imageBase64, {
          folder: 'announcements'
        });
        imageUrl = uploadRes.secure_url;
      } catch (error) {
        console.error('Cloudinary upload error:', error);
        return res.status(500).json({ error: 'Cloudinary upload failed' });
      }
    }
    // Save announcement to database
    try {
      const insertQuery = `INSERT INTO announcements (title, description, image_url, link, end_date, \`date\`) VALUES (?, ?, ?, ?, ?, NOW())`;
      const dbResult = await queryDatabase(insertQuery, [title, description, imageUrl, link, endDate || null]);
      const [announcement] = await queryDatabase('SELECT * FROM announcements WHERE id = ?', [dbResult.insertId]);
      res.status(201).json({ success: true, announcement });
    } catch (err) {
      console.error('Error saving announcement:', err);
      res.status(500).json({ error: 'Failed to save announcement' });
    }
  } catch (err) {
    console.error('Error in /api/announcements:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Endpoint to fetch all announcements
app.get('/api/announcements', async (req, res) => {
  try {
    const results = await queryDatabase('SELECT * FROM announcements WHERE `date` <= NOW() AND (end_date IS NULL OR end_date > NOW()) ORDER BY `date` DESC');
    res.json({ success: true, announcements: results });
  } catch (err) {
    console.error('Error fetching announcements:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch announcements' });
  }
});

// Endpoint to fetch children age data for dashboard
app.get('/children-age-data', async (req, res) => {
  try {
    // Get filter parameters
    const { barangay, startDate, endDate } = req.query;
    
    // Build the base query
    let query = `
      SELECT s2.age, COUNT(*) as count
      FROM step2_family_occupation s2
      JOIN users u ON s2.code_id = u.code_id
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN accepted_users au ON u.id = au.user_id
      WHERE u.status IN ('Verified')
      AND s2.age IS NOT NULL
      AND s2.age > 0
    `;
    
    const queryParams = [];
    
    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      queryParams.push(barangay);
    }
    
    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN DATE(?) AND DATE(?)`;
      queryParams.push(startDate, endDate);
    }
    
    // Group by age and order
    query += ` GROUP BY s2.age ORDER BY s2.age`;
    
    console.log('Executing age data query:', query, 'with params:', queryParams);
    
    // Execute the query
    const results = await queryDatabase(query, queryParams);
    console.log(`Found ${results ? results.length : 0} age records`);
    
    // Process the results into age groups
    const ageGroups = {
      '0-5': 0,
      '6-12': 0,
      '13-17': 0,
      '18-21': 0,
      '22+': 0
    };
    
    // Raw data for detailed analysis
    const rawData = [];
    
    results.forEach(row => {
      const age = parseInt(row.age);
      rawData.push({ age, count: row.count });
      
      if (age <= 5) {
        ageGroups['0-5'] += row.count;
      } else if (age <= 12) {
        ageGroups['6-12'] += row.count;
      } else if (age <= 17) {
        ageGroups['13-17'] += row.count;
      } else if (age <= 21) {
        ageGroups['18-21'] += row.count;
      } else {
        ageGroups['22+'] += row.count;
      }
    });
    
    res.json({
      ageGroups,
      rawData
    });
  } catch (err) {
    console.error('Error fetching children age data:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch children age data' });
  }
});

// Endpoint to fetch solo parent age data for dashboard
app.get('/solo-parent-age-data', async (req, res) => {
  try {
    // Get filter parameters
    const { barangay, startDate, endDate } = req.query;
    
    // Build the base query
    let query = `
      SELECT s1.age, COUNT(*) as count
      FROM step1_identifying_information s1
      JOIN users u ON s1.code_id = u.code_id
      LEFT JOIN accepted_users au ON u.id = au.user_id
      WHERE u.status IN ('Verified')
      AND s1.age IS NOT NULL
      AND s1.age > 0
    `;
    
    const queryParams = [];
    
    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      queryParams.push(barangay);
    }
    
    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN DATE(?) AND DATE(?)`;
      queryParams.push(startDate, endDate);
    }
    
    // Group by age and order
    query += ` GROUP BY s1.age ORDER BY s1.age`;
    
    console.log('Executing solo parent age data query:', query, 'with params:', queryParams);
    
    // Execute the query
    const results = await queryDatabase(query, queryParams);
    console.log(`Found ${results ? results.length : 0} solo parent age records`);
    
    // Process the results into age groups
    const ageGroups = {
      '18-25': 0,
      '26-35': 0,
      '36-45': 0,
      '46-55': 0,
      '56+': 0
    };
    
    // Raw data for detailed analysis
    const rawData = [];
    
    results.forEach(row => {
      const age = parseInt(row.age);
      rawData.push({ age, count: row.count });
      
      if (age <= 25) {
        ageGroups['18-25'] += row.count;
      } else if (age <= 35) {
        ageGroups['26-35'] += row.count;
      } else if (age <= 45) {
        ageGroups['36-45'] += row.count;
      } else if (age <= 55) {
        ageGroups['46-55'] += row.count;
      } else {
        ageGroups['56+'] += row.count;
      }
    });
    
    res.json({
      ageGroups,
      rawData
    });
  } catch (err) {
    console.error('Error fetching solo parent age data:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch solo parent age data' });
  }
});

// Endpoint to fetch children count data for dashboard
app.get('/children-count-data', async (req, res) => {
  try {
    // Get barangay from query parameters
    const { barangay } = req.query;
    
    // Validate barangay parameter
    if (!barangay) {
      return res.status(400).json({ 
        success: false, 
        error: 'Barangay parameter is required' 
      });
    }
    
    console.log('Fetching children count data for barangay:', barangay);

    // Step 1: Get users from the same barangay
    const userQuery = `
      SELECT 
        u.id,
        u.code_id
      FROM users u
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE 
        u.status IN ('Verified')
        AND s1.barangay = ?
    `;
    const users = await queryDatabase(userQuery, [barangay]);

    if (!users || users.length === 0) {
      return res.json({ childrenCounts: {}, chartData: [], rawData: [] });
    }

    const codeIds = users.map(user => user.code_id);

    // Step 2: Count only children for each family
    const familyQuery = `
      SELECT 
        code_id,
        COUNT(*) as children_count
      FROM step2_family_occupation
      WHERE code_id IN (?)
      GROUP BY code_id
    `;
    const familyMembers = await queryDatabase(familyQuery, [codeIds]);

    // Step 3: Format the results
    const childrenCounts = {
      '1 child': 0,
      '2 children': 0,
      '3 children': 0,
      '4 children': 0,
      '5+ children': 0,
      '0 children': 0
    };

    const usersWithChildren = new Set(familyMembers.map(fm => fm.code_id));
    const rawData = [];

    // Count families with no children
    const zeroChildrenCount = codeIds.filter(codeId => !usersWithChildren.has(codeId)).length;
    childrenCounts['0 children'] = zeroChildrenCount;

    // Count families with children
    familyMembers.forEach(row => {
      const count = parseInt(row.children_count);
      rawData.push({ count });

      if (count === 1) childrenCounts['1 child']++;
      else if (count === 2) childrenCounts['2 children']++;
      else if (count === 3) childrenCounts['3 children']++;
      else if (count === 4) childrenCounts['4 children']++;
      else if (count >= 5) childrenCounts['5+ children']++;
    });

    // Prepare chart data
    const chartData = Object.entries(childrenCounts).map(([label, value]) => ({
      label,
      value,
      count:
        label === '1 child' ? 1 :
        label === '2 children' ? 2 :
        label === '3 children' ? 3 :
        label === '4 children' ? 4 :
        label === '5+ children' ? 5 :
        0
    }));

    res.json({
      childrenCounts,
      chartData,
      rawData
    });

  } catch (err) {
    console.error('Error fetching children count data:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch children count data' });
  }
});

// Test route to verify server is running
app.get('/api/test', (req, res) => {
    res.json({ message: 'Server is running!' });
});

// Endpoint to get admin information by ID
app.get('/admin-info', async (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ success: false, error: 'Admin ID is required' });
    }
    
    const adminQuery = 'SELECT id, email, barangay FROM admin WHERE id = ?';
    const results = await queryDatabase(adminQuery, [id]);
    
    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    
    res.json(results[0]);
  } catch (err) {
    console.error('Error fetching admin info:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch admin info' });
  }
});

// Endpoint to get population users data for admin dashboard
app.get('/admin-population-users', async (req, res) => {
  try {
    const { adminId, startDate, endDate } = req.query;
    
    console.log('Admin population users request:', { adminId, startDate, endDate });
    
    if (!adminId) {
      return res.status(400).json({ success: false, error: 'Admin ID is required' });
    }
    
    // Get admin's barangay
    const adminQuery = 'SELECT barangay FROM admin WHERE id = ?';
    console.log('Executing admin query:', adminQuery, 'with adminId:', adminId);
    
    const adminResults = await queryDatabase(adminQuery, [adminId]);
    console.log('Admin query results:', adminResults);
    
    if (!adminResults || adminResults.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    
    const barangay = adminResults[0].barangay;
    console.log('Found barangay:', barangay);
    
    // Build the base query
    let query = `
      SELECT u.id, u.email, u.name, u.status, au.accepted_at, u.code_id,
             s1.gender, s1.employment_status
      FROM users u
      LEFT JOIN accepted_users au ON u.id = au.user_id
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.status = 'Verified'
      AND (s1.barangay = ? OR s1.barangay IS NULL)
    `;
    
    // Alternative query if the above doesn't work
    // This query first gets all verified users, then filters by barangay
    const alternativeQuery = `
      SELECT u.id, u.email, u.name, u.status, au.accepted_at, u.code_id,
             s1.gender, s1.employment_status
      FROM users u
      LEFT JOIN accepted_users au ON u.id = au.user_id
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.status = 'Verified'
      AND s1.barangay = ?
    `;
    
    console.log('Using query:', query);
    
    const queryParams = [barangay];
    
    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN DATE(?) AND DATE(?)`;
      queryParams.push(startDate, endDate);
    }
    
    console.log('Executing population query with params:', queryParams);
    
    // Try the main query first
    try {
      const results = await queryDatabase(query, queryParams);
      console.log(`Found ${results ? results.length : 0} population users with main query`);
      // Return the array directly instead of wrapping it in an object
      res.json(results || []);
    } catch (innerErr) {
      // If the main query fails, try the alternative approach
      console.error('Main query failed, trying alternative:', innerErr.message);
      try {
        // First get all verified users
        const userQuery = `
          SELECT u.id, u.email, u.name, u.status, au.accepted_at, u.code_id
          FROM users u
          LEFT JOIN accepted_users au ON u.id = au.user_id
          WHERE u.status = 'Verified'
        `;
        const users = await queryDatabase(userQuery, []);
        console.log(`Found ${users ? users.length : 0} verified users`);
        
        // Then get demographic data separately
        if (users && users.length > 0) {
          const codeIds = users.map(user => user.code_id).filter(id => id);
          
          if (codeIds.length > 0) {
            const demoQuery = `
              SELECT s1.code_id, s1.gender, s1.employment_status
              FROM step1_identifying_information s1
              WHERE s1.barangay = ? AND s1.code_id IN (?)
            `;
            const demographics = await queryDatabase(demoQuery, [barangay, codeIds]);
            console.log(`Found ${demographics ? demographics.length : 0} matching demographics`);
            
            // Merge the data
            const mergedResults = users.map(user => {
              const demo = demographics.find(d => d.code_id === user.code_id) || {};
              return {
                ...user,
                gender: demo.gender || null,
                employment_status: demo.employment_status || null
              };
            });
            
            // Return the array directly instead of wrapping it in an object
            res.json(mergedResults || []);
            return; // Exit early since we've sent the response
          }
        }
        
        // If we get here, return empty results
        res.json([]);
      } catch (fallbackErr) {
        console.error('Alternative query also failed:', fallbackErr);
        throw fallbackErr; // Let the outer catch handle this
      }
    }
  } catch (err) {
    console.error('Error fetching population users data:', err);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch population users data', 
      details: err.message 
    });
  }
});

// Endpoint to get remarks data for admin dashboard
app.get('/remarks-users', async (req, res) => {
  try {
    const { adminId, startDate, endDate } = req.query;
    
    if (!adminId) {
      return res.status(400).json({ success: false, error: 'Admin ID is required' });
    }
    
    // Get admin's barangay
    const adminQuery = 'SELECT barangay FROM admin WHERE id = ?';
    const adminResults = await queryDatabase(adminQuery, [adminId]);
    
    if (!adminResults || adminResults.length === 0) {
      return res.status(404).json({ success: false, error: 'Admin not found' });
    }
    
    const barangay = adminResults[0].barangay;
    
    // Build the base query for remarks
    let query = `
      SELECT r.id, r.user_id, r.remarks, r.remarks_at, u.name, u.email
      FROM user_remarks r
      JOIN users u ON r.user_id = u.id
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE s1.barangay = ?
    `;
    
    const queryParams = [barangay];
    
    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND r.remarks_at BETWEEN ? AND ?`;
      queryParams.push(startDate, endDate);
    }
    
    // Execute the query
    const results = await queryDatabase(query, queryParams);
    
    res.json(results);
  } catch (err) {
    console.error('Error fetching remarks data:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch remarks data' });
  }
});

app.post('/users', async (req, res) => {
  const { email, password, name, barangay, role, status } = req.body;
  try {
    await queryDatabase('INSERT INTO users (email, password, name, barangay, role,  status) VALUES (?, ?, ?, ?, ?,?)', 
      [email, password, name, barangay, role, status]);
    res.status(201).json({ message: 'User created successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Error inserting user into database' });
  }
});

app.get("/admins", async (req, res) => {
  try {
    const results = await queryDatabase("SELECT id, email, barangay FROM admin");
    res.json({ success: true, users: results });
  } catch (err) {
    console.error('Error fetching admins:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/admins", async (req, res) => {
  const { email, password, barangay } = req.body;
  
  if (!email || !password || !barangay) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  try {
    const existingAdmins = await queryDatabase("SELECT * FROM admin WHERE email = ? OR barangay = ?", [email, barangay]);

    if (existingAdmins.length > 0) {
      const existingAdmin = existingAdmins[0];
      if (existingAdmin.email === email) {
        return res.status(400).json({ success: false, message: "Email already exists" });
      }
      if (existingAdmin.barangay === barangay) {
        return res.status(400).json({ success: false, message: "Barangay already has an admin" });
      }
    }

    await queryDatabase("INSERT INTO admin (email, password, barangay) VALUES (?, ?, ?)", [email, password, barangay]);
    res.json({ success: true, message: "Admin created successfully" });
  } catch (err) {
    console.error('Error adding admin:', err);
    res.status(500).json({ success: false, message: "Error adding admin", error: err.message });
  }
});

app.put("/admins/:id", async (req, res) => {
  const { id } = req.params;
  const { email, password, barangay } = req.body;
  
  if (!email || !barangay) {
    return res.status(400).json({ success: false, message: "Email and barangay are required" });
  }

  try {
    const existingAdmins = await queryDatabase("SELECT * FROM admin WHERE (email = ? OR barangay = ?) AND id != ?", 
      [email, barangay, id]);

    if (existingAdmins.length > 0) {
      const existingAdmin = existingAdmins[0];
      if (existingAdmin.email === email) {
        return res.status(400).json({ success: false, message: "Email already exists" });
      }
      if (existingAdmin.barangay === barangay) {
        return res.status(400).json({ success: false, message: "Barangay already has an admin" });
      }
    }

    const updateFields = password 
      ? [email, password, barangay, id]
      : [email, barangay, id];

    const sql = password
      ? "UPDATE admin SET email = ?, password = ?, barangay = ? WHERE id = ?"
      : "UPDATE admin SET email = ?, barangay = ? WHERE id = ?";

    const result = await queryDatabase(sql, updateFields);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Admin not found" });
    }
    res.json({ success: true, message: "Admin updated successfully" });
  } catch (err) {
    console.error('Error updating admin:', err);
    res.status(500).json({ success: false, message: "Error updating admin", error: err.message });
  }
});

app.get('/pendingUsers', async (req, res) => {
  try {
    const users = await queryDatabase(`
      SELECT u.id AS userId, u.email, u.name, u.status, u.code_id, u.approval,
             s1.first_name, s1.middle_name, s1.last_name, s1.suffix, s1.age, s1.gender, 
             s1.date_of_birth, s1.place_of_birth, s1.barangay, s1.education, 
             s1.civil_status, s1.occupation, s1.religion, s1.company, 
             s1.income, s1.employment_status, s1.contact_number, s1.email, 
             s1.pantawid_beneficiary, s1.indigenous,
             s3.classification,
             s4.needs_problems,
             s5.emergency_name, s5.emergency_relationship, 
             s5.emergency_address, s5.emergency_contact
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN step3_classification s3 ON u.code_id = s3.code_id
      LEFT JOIN step4_needs_problems s4 ON u.code_id = s4.code_id
      LEFT JOIN step5_in_case_of_emergency s5 ON u.code_id = s5.code_id
      WHERE u.approval = 'Approved' AND u.status = 'Pending'
    `);

    if (users.length === 0) {
      return res.status(200).json([]);
    }

    const codeIds = users.map(user => user.code_id);

    const familyQuery = `
      SELECT code_id, 
             family_member_name,
             birthdate,
             educational_attainment,
             age
      FROM step2_family_occupation
      WHERE code_id IN (?)
    `;

    const familyMembers = await queryDatabase(familyQuery, [codeIds]);

    const familyByUser = {};
    familyMembers.forEach(member => {
      if (!familyByUser[member.code_id]) {
        familyByUser[member.code_id] = [];
      }
      familyByUser[member.code_id].push(member);
    });

    // Fetch documents for each user from all document tables
    const documentTables = [
      'psa_documents',
      'itr_documents', 
      'med_cert_documents', 
      'marriage_documents', 
      'cenomar_documents', 
      'death_cert_documents'
    ];
    
    let allDocuments = [];
    
    // Query each document table and combine results
    for (const table of documentTables) {
      const documentsQuery = `
        SELECT t.* FROM (
          SELECT code_id,
                 file_name,
                 uploaded_at,
                 display_name,
                 status,
                 '${table}' as document_type,
                 CASE 
                   WHEN file_name LIKE 'http%' THEN file_name 
                   ELSE CONCAT('http://localhost:8081/uploads/', file_name) 
                 END as file_url
          FROM ${table}
          WHERE code_id IN (?)
          ORDER BY uploaded_at DESC
        ) t
        GROUP BY t.code_id
      `;
    
      try {
        const docs = await queryDatabase(documentsQuery, [codeIds]);
        allDocuments = [...allDocuments, ...docs];
      } catch (err) {
        console.error(`Error fetching from ${table}:`, err);
        // Continue with other tables even if one fails
      }
    }

    const documentsByUser = {};
    allDocuments.forEach(doc => {
      if (!documentsByUser[doc.code_id]) {
        documentsByUser[doc.code_id] = [];
      }
      documentsByUser[doc.code_id].push(doc);
    });

    const usersWithFamily = users.map(user => ({
      ...user,
      familyMembers: familyByUser[user.code_id] || [],
      documents: documentsByUser[user.code_id] || []
    }));

    res.status(200).json(usersWithFamily);
  } catch (err) {
    console.error('Error fetching pending users:', err);
    res.status(500).json({ error: 'Error fetching pending users' });
  }
});

app.get('/pendingUsersAdmin', async (req, res) => {
  try {
    const users = await queryDatabase(`
      SELECT u.id AS userId, u.email, u.name, u.status, u.code_id, u.approval,
             s1.first_name, s1.middle_name, s1.last_name, s1.suffix, s1.age, s1.gender, 
             s1.date_of_birth, s1.place_of_birth, s1.barangay, s1.education, 
             s1.civil_status, s1.occupation, s1.religion, s1.company, 
             s1.income, s1.employment_status, s1.contact_number, s1.email, 
             s1.pantawid_beneficiary, s1.indigenous,
             s3.classification,
             s4.needs_problems,
             s5.emergency_name, s5.emergency_relationship, 
             s5.emergency_address, s5.emergency_contact
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN step3_classification s3 ON u.code_id = s3.code_id
      LEFT JOIN step4_needs_problems s4 ON u.code_id = s4.code_id
      LEFT JOIN step5_in_case_of_emergency s5 ON u.code_id = s5.code_id
      WHERE u.status = 'Pending' AND (u.approval IS NULL OR u.approval != 'Approved')
    `);

    if (users.length === 0) {
      return res.status(200).json([]);
    }

    const codeIds = users.map(user => user.code_id);

    const familyQuery = `
      SELECT code_id, 
             family_member_name,
             birthdate,
             educational_attainment,
             age
      FROM step2_family_occupation
      WHERE code_id IN (?)
    `;

    const familyMembers = await queryDatabase(familyQuery, [codeIds]);

    const familyByUser = {};
    familyMembers.forEach(member => {
      if (!familyByUser[member.code_id]) {
        familyByUser[member.code_id] = [];
      }
      familyByUser[member.code_id].push(member);
    });

    // Fetch documents for each user from all document tables
    const documentTables = [
      'psa_documents',
      'itr_documents', 
      'med_cert_documents', 
      'marriage_documents', 
      'cenomar_documents', 
      'death_cert_documents'
    ];
    
    let allDocuments = [];
    
    // Query each document table and combine results
    for (const table of documentTables) {
      const documentsQuery = `
        SELECT t.* FROM (
          SELECT code_id,
                 file_name,
                 uploaded_at,
                 display_name,
                 status,
                 '${table}' as document_type,
                 CASE 
                   WHEN file_name LIKE 'http%' THEN file_name 
                   ELSE CONCAT('http://localhost:8081/uploads/', file_name) 
                 END as file_url
          FROM ${table}
          WHERE code_id IN (?)
          ORDER BY uploaded_at DESC
        ) t
        GROUP BY t.code_id
      `;
    
      try {
        const docs = await queryDatabase(documentsQuery, [codeIds]);
        allDocuments = [...allDocuments, ...docs];
      } catch (err) {
        console.error(`Error fetching from ${table}:`, err);
        // Continue with other tables even if one fails
      }
    }

    const documentsByUser = {};
    allDocuments.forEach(doc => {
      if (!documentsByUser[doc.code_id]) {
        documentsByUser[doc.code_id] = [];
      }
      documentsByUser[doc.code_id].push(doc);
    });

    const usersWithFamily = users.map(user => ({
      ...user,
      familyMembers: familyByUser[user.code_id] || [],
      documents: documentsByUser[user.code_id] || []
    }));

    res.status(200).json(usersWithFamily);
  } catch (err) {
    console.error('Error fetching pending users:', err);
    res.status(500).json({ error: 'Error fetching pending users' });
  }
});

// New endpoint for declined users
app.get('/declineInfo', async (req, res) => {
  try {
    // Use userId from session, user, or query
    const userId = req.user?.id || req.session?.userId || req.query.userId;
    if (!userId) {
      return res.status(400).json({ error: 'No user id found' });
    }

    // Fetch code_id and email for this user
    const userResult = await queryDatabase('SELECT code_id, email FROM users WHERE id = ?', [userId]);
    if (!userResult || userResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const currentCodeId = userResult[0].code_id;
    const currentEmail = userResult[0].email;

    // Fetch only the declined user matching the logged-in user
    const users = await queryDatabase(`
      SELECT u.id AS userId, u.email, u.name, u.status, u.code_id,
             s1.first_name, s1.middle_name, s1.last_name, s1.suffix, s1.age, s1.gender, u.faceRecognitionPhoto,
             s1.date_of_birth, s1.place_of_birth, s1.barangay, s1.education, 
             s1.civil_status, s1.occupation, s1.religion, s1.company, 
             s1.income, s1.employment_status, s1.contact_number, s1.email, 
             s1.pantawid_beneficiary, s1.indigenous,
             s3.classification,
             s4.needs_problems,
             s5.emergency_name, s5.emergency_relationship, 
             s5.emergency_address, s5.emergency_contact
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN step3_classification s3 ON u.code_id = s3.code_id
      LEFT JOIN step4_needs_problems s4 ON u.code_id = s4.code_id
      LEFT JOIN step5_in_case_of_emergency s5 ON u.code_id = s5.code_id
      WHERE u.status = 'Declined' AND (u.code_id = ? OR u.email = ?)
    `, [currentCodeId, currentEmail]);

    if (users.length === 0) {
      return res.status(200).json([]);
    }

    const codeIds = users.map(user => user.code_id);

    const familyQuery = `
      SELECT code_id, 
             family_member_name,
             birthdate,
             educational_attainment,
             age
      FROM step2_family_occupation
      WHERE code_id IN (?)
    `;

    const familyMembers = await queryDatabase(familyQuery, [codeIds]);

    const familyByUser = {};
    familyMembers.forEach(member => {
      if (!familyByUser[member.code_id]) {
        familyByUser[member.code_id] = [];
      }
      familyByUser[member.code_id].push(member);
    });

    // Fetch documents for each user from all document tables
    const documentTables = [
      'psa_documents',
      'itr_documents', 
      'med_cert_documents', 
      'marriage_documents', 
      'cenomar_documents', 
      'death_cert_documents'
    ];
    
    let allDocuments = [];
    
    // Query each document table and combine results
    for (const table of documentTables) {
      const documentsQuery = `
        SELECT code_id,
               file_name,
               uploaded_at,
               display_name,
               status,
               '${table}' as document_type,
               CASE 
                 WHEN file_name LIKE 'http%' THEN file_name 
                 ELSE CONCAT('http://localhost:8081/uploads/', file_name) 
               END as file_url
        FROM ${table}
        WHERE code_id IN (?) AND category = 'application'
      `;

      try {
        const docs = await queryDatabase(documentsQuery, [codeIds]);
        allDocuments = [...allDocuments, ...docs];
      } catch (err) {
        console.error(`Error fetching from ${table}:`, err);
        // Continue with other tables even if one fails
      }
    }

    const documentsByUser = {};
    allDocuments.forEach(doc => {
      if (!documentsByUser[doc.code_id]) {
        documentsByUser[doc.code_id] = [];
      }
      documentsByUser[doc.code_id].push(doc);
    });

    const usersWithFamily = users.map(user => ({
      ...user,
      familyMembers: familyByUser[user.code_id] || [],
      documents: documentsByUser[user.code_id] || []
    }));

    // Only return the first (should only be one)
    res.status(200).json(usersWithFamily[0]);
  } catch (err) {
    console.error('Error fetching declined user:', err);
    res.status(500).json({ error: 'Error fetching declined user' });
  }
});

app.get('/verifiedUsersSA', async (req, res) => {
  try {
    const users = await queryDatabase(`
      SELECT u.id AS userId, u.email, u.name, u.status, u.code_id, u.profilePic,  u.beneficiary_status,
             s1.first_name, s1.middle_name, s1.last_name, s1.suffix, s1.age, s1.gender, 
             s1.date_of_birth, s1.place_of_birth, s1.suffix, s1.barangay, s1.education, 
             s1.civil_status, s1.occupation, s1.religion, s1.company, 
             s1.income, s1.employment_status, s1.contact_number, s1.email, 
             s1.pantawid_beneficiary, s1.indigenous,
             s3.classification,
             s4.needs_problems,
             s5.emergency_name, s5.emergency_relationship, 
             s5.emergency_address, s5.emergency_contact,
             ur.remarks as latest_remarks,
             ur.remarks_at,
             DATE_FORMAT(DATE_ADD(au.accepted_at, INTERVAL 1 YEAR), "%Y-%m-%d") as validUntil
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN step3_classification s3 ON u.code_id = s3.code_id
      LEFT JOIN step4_needs_problems s4 ON u.code_id = s4.code_id
      LEFT JOIN step5_in_case_of_emergency s5 ON u.code_id = s5.code_id
      LEFT JOIN (
        SELECT code_id, remarks, remarks_at
        FROM user_remarks
        WHERE (code_id, remarks_at) IN (
          SELECT code_id, MAX(remarks_at)
          FROM user_remarks
          GROUP BY code_id
        )
      ) ur ON u.code_id = ur.code_id
      LEFT JOIN (
        SELECT user_id, MAX(accepted_at) as accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) au ON u.id = au.user_id
      WHERE u.status IN ('Verified', 'Pending Remarks', 'Terminated', 'Renewal')
    `);

    if (users.length === 0) {
      return res.status(200).json([]);
    }

    const codeIds = users.map(user => user.code_id);

    // Fetch family composition
    const familyQuery = `
      SELECT code_id, 
             family_member_name,
             birthdate,
             educational_attainment,
             age
      FROM step2_family_occupation
      WHERE code_id IN (?)
    `;

    const familyMembers = await queryDatabase(familyQuery, [codeIds]);

    const familyByUser = {};
    familyMembers.forEach(member => {
      if (!familyByUser[member.code_id]) {
        familyByUser[member.code_id] = [];
      }
      familyByUser[member.code_id].push(member);
    });

    // Fetch documents for each user from all document tables
    const documentTables = [
      'psa_documents',
      'itr_documents',
      'med_cert_documents',
      'marriage_documents',
      'cenomar_documents',
      'death_cert_documents',
      'barangay_cert_documents'
    ];
    
    let allDocuments = [];
    
    for (const table of documentTables) {
      const documentsQuery = `
        SELECT t.* FROM (
          SELECT code_id,
                 file_name,
                 uploaded_at,
                 display_name,
                 status,
                 '${table}' as document_type,
                 CASE 
                   WHEN file_name LIKE 'http%' THEN file_name 
                   ELSE CONCAT('http://localhost:8081/uploads/', file_name) 
                 END as file_url
          FROM ${table}
          WHERE code_id IN (?)
          ORDER BY uploaded_at DESC
        ) t
        GROUP BY t.code_id
      `;
    
      try {
        const docs = await queryDatabase(documentsQuery, [codeIds]);
        allDocuments = [...allDocuments, ...docs];
      } catch (err) {
        console.error(`Error fetching from ${table}:`, err);
        // Continue with other tables even if one fails
      }
    }

    const documentsByUser = {};
    allDocuments.forEach(doc => {
      if (!documentsByUser[doc.code_id]) {
        documentsByUser[doc.code_id] = [];
      }
      documentsByUser[doc.code_id].push(doc);
    });

    const usersWithFamily = users.map(user => ({
      ...user,
      familyMembers: familyByUser[user.code_id] || [],
      documents: documentsByUser[user.code_id] || []
    }));

    res.status(200).json(usersWithFamily);
  } catch (error) {
    console.error('Error fetching verified users:', error);
    res.status(500).json({ error: 'Failed to fetch verified users' });
  }
});

app.post('/pendingUsers/updateClassification', async (req, res) => {
  const { code_id, classification } = req.body;

  try {
    if (!code_id || !classification) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await queryDatabase(`
      UPDATE step3_classification 
      SET classification = ? 
      WHERE code_id = ?
    `, [classification, code_id]);

    res.status(200).json({ message: 'Classification updated successfully', classification });
  } catch (err) {
    console.error('Error updating classification:', err);
    res.status(500).json({ error: 'Error updating classification', details: err.message });
  }
});

app.get('/verifiedUsers', async (req, res) => {
  try {
    const query = `
      SELECT * FROM users 
      WHERE status = 'Verified' 
      ORDER BY created_at DESC
    `;
    const users = await queryDatabase(query);
    res.json({ success: true, users });
  } catch (error) {
    console.error('Error fetching verified users:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    let result;

    // Check users table first
    result = await queryDatabase('SELECT * FROM users WHERE email = ? AND password = ?', [email, password]);
    let user = result.length > 0 ? result[0] : null;

    // Check admin table if user not found
    if (!user) {
      result = await queryDatabase('SELECT * FROM admin WHERE email = ? AND password = ?', [email, password]);
      if (result.length > 0) {
        user = result[0];
        user.role = 'admin';
      }
    }

    // Check superadmin table if still not found
    if (!user) {
      result = await queryDatabase('SELECT * FROM superadmin WHERE email = ? AND password = ?', [email, password]);
      if (result.length > 0) {
        user = result[0];
        user.role = 'superadmin';
      }
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Prevent login if status is 'Pending'
    if (user.status === 'Pending') {
      return res.status(403).json({ error: 'Account is pending approval' });
    }

    // Update status to Verified on first login if previously Created
    if (user.status === 'Created') {
      try {
        console.log(`Updating status from Created to Verified for user ${user.id}`);
        const updateResult = await queryDatabase('UPDATE users SET status = ? WHERE id = ?', ['Verified', user.id]);
        console.log('Update result:', updateResult);
        
        // Verify the update
        const verifyResult = await queryDatabase('SELECT status FROM users WHERE id = ?', [user.id]);
        console.log('Verification result:', verifyResult);
        
        if (verifyResult.length > 0 && verifyResult[0].status === 'Verified') {
          user.status = 'Verified';
          console.log('Status successfully updated to Verified');

          // Insert notification for admin: new solo parent in barangay
          const [userInfo] = await queryDatabase(`
            SELECT u.id, u.name, s1.barangay
            FROM users u
            JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
            WHERE u.id = ?
          `, [user.id]);
          if (userInfo) {
            const notifMessage = `${userInfo.name} is a new solo parent in your barangay.`;
            await queryDatabase(
              'INSERT INTO adminnotifications (user_id, notif_type, message, barangay) VALUES (?, ?, ?, ?)',
              [userInfo.id, 'new_solo_parent', notifMessage, userInfo.barangay]
            );
          }
        } else {
          console.error('Status update verification failed');
        }
      } catch (updateError) {
        console.error('Error updating user status:', updateError);
        // Continue with login even if status update fails
      }
    }

    res.status(200).json({ 
      user: {
        id: user.id,
        email: user.email,
        status: user.status,
        role: user.role || 'user'
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/getUserDetails', async (req, res) => {
  const { userId } = req.body;
  try {
    const userResults = await queryDatabase(`
      SELECT u.*, s1.*, 
             (SELECT remarks 
              FROM user_remarks ur 
              WHERE ur.user_id = u.id 
              ORDER BY ur.remarks_at DESC 
              LIMIT 1) as latest_remarks,
             (SELECT remarks_at 
              FROM user_remarks ur 
              WHERE ur.user_id = u.id 
              ORDER BY ur.remarks_at DESC 
              LIMIT 1) as remarks_at
      FROM users u
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.id = ?`, [userId]);

    if (userResults.length > 0) {
      const user = userResults[0];
      
      // If status is Pending Remarks, return only remarks information
      if (user.status === 'Pending Remarks') {
        return res.status(200).json({
          id: user.id,
          code_id: user.code_id,
          status: user.status,
          remarks: user.latest_remarks || 'No remarks',
          remarks_at: user.remarks_at,
          name: user.name,
          email: user.email
        });
      }

      // For other statuses (like Verified), return all details
      const documentTables = [
        'psa_documents',
        'itr_documents', 
        'med_cert_documents', 
        'marriage_documents', 
        'cenomar_documents', 
        'death_cert_documents',
        'barangay_cert_documents'
      ];
      
      let allDocuments = [];
      
      // Query each document table and combine results
      for (const table of documentTables) {
        const documentsQuery = `
          SELECT code_id,
                 file_name,
                 uploaded_at,
                 display_name,
                 status,
                 '${table}' as document_type,
                 CASE 
                   WHEN file_name LIKE 'http%' THEN file_name 
                   ELSE CONCAT('http://localhost:8081/uploads/', file_name) 
                 END as file_url
          FROM ${table}
          WHERE code_id = ?
        `;

        try {
          const docs = await queryDatabase(documentsQuery, [user.code_id]);
          allDocuments = [...allDocuments, ...docs];
        } catch (err) {
          console.error(`Error fetching from ${table}:`, err);
        }
      }

      if (user.status === 'Verified') {
        const classificationResult = await queryDatabase(
          'SELECT classification FROM step3_classification WHERE code_id = ?', 
          [user.code_id]
        );

        const validDateResult = await queryDatabase(
          'SELECT DATE_FORMAT(DATE_ADD(accepted_at, INTERVAL 1 YEAR), "%Y-%m-%d") as accepted_at FROM accepted_users WHERE user_id = ? ORDER BY accepted_at DESC LIMIT 1', 
          [userId]
        );

        console.log('Valid date result:', validDateResult);
        console.log('Valid until date:', validDateResult.length > 0 ? validDateResult[0].accepted_at : 'No date found');

        const familyResults = await queryDatabase(
          `SELECT family_member_name, birthdate, educational_attainment, age
           FROM step2_family_occupation
           WHERE code_id = ?`, 
          [user.code_id]
        );
        
        // Get ID card images from user_id_cards table
        const idCardResults = await queryDatabase(
          `SELECT front_url, back_url FROM user_id_cards WHERE user_id = ? AND code_id = ?`,
          [userId, user.code_id]
        );

        return res.status(200).json({ 
          ...user,
          classification: classificationResult.length > 0 ? classificationResult[0].classification : null,
          validUntil: validDateResult.length > 0 ? validDateResult[0].accepted_at : null,
          familyMembers: familyResults || [],
          documents: allDocuments || [],
          idCard: idCardResults.length > 0 ? idCardResults[0] : null
        });
      } else {
        return res.status(200).json({
          ...user,
          documents: allDocuments || []
        });
      }
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  } catch (err) {
    console.error('Error fetching user details:', err);
    res.status(500).json({ error: 'Error fetching user details' });
  }
});

app.get('/users', async (req, res) => {
  try {
    const users = await queryDatabase('SELECT * FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching users' });
  }
});

app.get("/admins", async (req, res) => {
  try {
    const adminData = await queryDatabase("SELECT * FROM admin");
    res.json(adminData);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching admin data' });
  }
});

app.get("/superadmin", async (req, res) => {
  try {
    const superadminData = await queryDatabase("SELECT * FROM superadmin");
    res.json(superadminData);
  } catch (err) {
    res.status(500).json({ error: 'Error fetching superadmin data' });
  }
});

app.post('/updateUserStatus', async (req, res) => {
  const { code_id, status, remarks, email, firstName, action, updateDocumentStatus } = req.body;
  console.log('Received request to update status:', { code_id, status, remarks, email, firstName, action, updateDocumentStatus });

  let retries = 3;
  let lastError = null;

  while (retries > 0) {
    try {
      await queryDatabase('START TRANSACTION');

      const userResult = await queryDatabase(`
        SELECT u.id, u.status, s1.date_of_birth, u.password, s1.civil_status 
        FROM users u 
        JOIN step1_identifying_information s1 ON u.code_id = s1.code_id 
        WHERE u.code_id = ? 
        FOR UPDATE`, [code_id]);

      if (!userResult || userResult.length === 0) {
        console.error('User not found for code_id:', code_id);
        throw new Error('User not found');
      }

      const userId = userResult[0].id;
      const civilStatus = userResult[0].civil_status;

      // Update user status
      await queryDatabase('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
      console.log('User status updated successfully for user ID:', userId);

      // If accepting application and updateDocumentStatus is true, update all document statuses to 'Approved'
      if (action === "Accept" && updateDocumentStatus) {
        const requiredDocuments = getRequiredDocumentsByCivilStatus(civilStatus);
        console.log('Updating document statuses to Approved for documents:', requiredDocuments);

        // Update all document tables
        const documentTables = [
          'psa_documents',
          'itr_documents',
          'med_cert_documents',
          'marriage_documents',
          'cenomar_documents',
          'death_cert_documents',
          'barangay_cert_documents'
        ];

        for (const table of documentTables) {
          try {
            const updateResult = await queryDatabase(
              `UPDATE ${table} SET status = 'Approved' WHERE code_id = ?`,
              [code_id]
            );
            console.log(`Updated ${table} status to Approved for user ${userId}. Affected rows:`, updateResult.affectedRows);
          } catch (err) {
            console.error(`Error updating ${table}:`, err);
            // Continue with other tables even if one fails
          }
        }
      }

      // Handle different status updates
      if (status === "Renewal") {
        const message = 'Your ID has expired. Please submit your renewal application.';
        await queryDatabase(
          'INSERT INTO accepted_users (user_id, message, accepted_at, is_read) VALUES (?, ?, NOW(), 0)', 
          [userId, message]
        );
        console.log('Renewal notification created for user_id:', userId);
      } else if (status === "Declined" && remarks) {
        const existingDeclined = await queryDatabase(
          'SELECT * FROM declined_users WHERE user_id = ? AND is_read = 0',
          [userId]
        );

        if (existingDeclined.length === 0) {
          await queryDatabase(
            'INSERT INTO declined_users (user_id, remarks, declined_at, is_read) VALUES (?, ?, NOW(), 0)', 
            [userId, remarks]
          );
          console.log('Declined user record created for user_id:', userId);
        }
      } else if (status === "Verified" || status === "Created") {
        const message = 'Your application has been accepted.';
        const existingAccepted = await queryDatabase(
          'SELECT * FROM accepted_users WHERE user_id = ? AND message = ? AND is_read = 0',
          [userId, message]
        );

        if (existingAccepted.length === 0) {
          await queryDatabase(
            'INSERT INTO accepted_users (user_id, accepted_at, message, is_read) VALUES (?, NOW(), ?, 0)', 
            [userId, message]
          );
          console.log('Accepted user record created for user_id:', userId);
        }
      }

      const emailSent = await sendStatusEmail(
        email, 
        firstName, 
        action, 
        remarks, 
        userResult[0].date_of_birth,
        userResult[0].password
      );

      // If approval is provided in the request, update the approval column
      if (req.body.approval) {
        await queryDatabase('UPDATE users SET approval = ? WHERE code_id = ?', [req.body.approval, code_id]);
      }

      await queryDatabase('COMMIT');
      
      res.json({ 
        success: true, 
        message: emailSent ? 'Status updated and email sent' : 'Status updated but email failed'
      });
      return;

    } catch (err) {
      await queryDatabase('ROLLBACK');
      lastError = err;
      console.error('Error updating user status:', err);
      
      if (err.code !== 'ER_LOCK_WAIT_TIMEOUT') {
        res.status(500).json({ success: false, message: err.message });
        return;
      }
      
      retries--;
      if (retries === 0) {
        res.status(500).json({ error: 'Database error while updating user status. Please try again.' });
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
});

app.post('/updateDocumentStatus', async (req, res) => {
  const { document_type, status, rejection_reason, file_name } = req.body;
  let connection;

  // Document type display names for messages
  const DOCUMENT_DISPLAY_NAMES = {
    'psa': 'PSA Birth Certificate',
    'itr': 'Income Tax Return',
    'med_cert': 'Medical Certificate',
    'marriage': 'Marriage Certificate',
    'cenomar': 'CENOMAR',
    'death_cert': 'Death Certificate',
    'barangay_cert': 'Barangay Certificate'
  };

  // Define TABLE_NAMES at the top of the function
  const TABLE_NAMES = {
    'psa': { table: 'psa_documents' },
    'itr': { table: 'itr_documents' },
    'med_cert': { table: 'med_cert_documents' },
    'marriage': { table: 'marriage_documents' },
    'cenomar': { table: 'cenomar_documents' },
    'death_cert': { table: 'death_cert_documents' },
    'barangay_cert': { table: 'barangay_cert_documents' }
  };

  // Map full table names to shortened versions for document type checking
  const DOCUMENT_TYPE_MAP = {
    'psa_documents': 'psa',
    'itr_documents': 'itr',
    'med_cert_documents': 'med_cert',
    'marriage_documents': 'marriage',
    'cenomar_documents': 'cenomar',
    'death_cert_documents': 'death_cert',
    'barangay_cert_documents': 'barangay_cert'
  };

  try {
    // Validate required fields
    if (!document_type || !status || !file_name) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields (document_type, status, file_name)'
      });
    }

    // Convert full table name to shortened version if necessary
    const mappedDocType = DOCUMENT_TYPE_MAP[document_type] || document_type;

    // Check if document_type is valid
    const tableInfo = TABLE_NAMES[mappedDocType];
    if (!tableInfo) {
      return res.status(400).json({
        success: false,
        error: `Invalid document type: ${document_type}`
      });
    }

    // Get connection and start transaction
    connection = await new Promise((resolve, reject) => {
      pool.getConnection((err, conn) => {
        if (err) reject(err);
        else resolve(conn);
      });
    });

    await new Promise((resolve, reject) => {
      connection.beginTransaction(err => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Get user info for notification
    const userQuery = `
      SELECT u.id as user_id
      FROM ${tableInfo.table} d
      JOIN users u ON d.code_id = u.code_id
      WHERE d.file_name = ?
    `;
    
    const userResult = await new Promise((resolve, reject) => {
      connection.query(userQuery, [file_name], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // Update the document status
    const updateQuery = `
      UPDATE ${tableInfo.table} 
      SET status = ?, 
          rejection_reason = ?
      WHERE file_name = ?
    `;
    
    const result = await new Promise((resolve, reject) => {
      connection.query(updateQuery, [status, rejection_reason || null, file_name], (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    // Add notification to follow_up_documents
    if (userResult && userResult.length > 0) {
      const userId = userResult[0].user_id;
      const documentName = DOCUMENT_DISPLAY_NAMES[mappedDocType] || document_type;
      let message = '';

      if (status === 'Approved') {
        message = `Your ${documentName} has been accepted.`;
      } else if (status === 'Rejected') {
        message = `Your ${documentName} was rejected. ${rejection_reason || ''}`;
      }

      await new Promise((resolve, reject) => {
        connection.query(
          'INSERT INTO follow_up_documents (user_id, accepted_at, message, is_read) VALUES (?, NOW(), ?, 0)',
          [userId, message],
          (err, result) => {
            if (err) reject(err);
            else resolve(result);
          }
        );
      });
    }

    // Check if all documents are approved
    if (status === 'Approved') {
      const userQuery = `
        SELECT u.id, s1.civil_status 
        FROM users u 
        JOIN step1_identifying_information s1 ON u.code_id = s1.code_id 
        WHERE u.code_id = (SELECT code_id FROM ${tableInfo.table} WHERE file_name = ?)
      `;
      const userResult = await new Promise((resolve, reject) => {
        connection.query(userQuery, [file_name], (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      if (userResult && userResult.length > 0) {
        const civilStatus = userResult[0].civil_status;
        const requiredDocuments = getRequiredDocumentsByCivilStatus(civilStatus);
        let allDocumentsApproved = true;

        for (const docType of requiredDocuments) {
          const docTableInfo = TABLE_NAMES[docType];
          const checkDocQuery = `
            SELECT status 
            FROM ${docTableInfo.table} 
            WHERE file_name = ? 
            LIMIT 1
          `;
          const docResult = await new Promise((resolve, reject) => {
            connection.query(checkDocQuery, [file_name], (err, result) => {
              if (err) reject(err);
              else resolve(result);
            });
          });

          if (!docResult || docResult.length === 0 || docResult[0].status !== 'Approved') {
            allDocumentsApproved = false;
            break;
          }
        }

        if (allDocumentsApproved) {
          await new Promise((resolve, reject) => {
            connection.query(
              'UPDATE users SET status = ? WHERE code_id = (SELECT code_id FROM psa_documents WHERE file_name = ?)',
              ['Verified', file_name],
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
          });
        }
      }
    }

    // Commit the transaction
    await new Promise((resolve, reject) => {
      connection.commit(err => {
        if (err) {
          connection.rollback(() => reject(err));
        } else {
          resolve();
        }
      });
    });

    res.json({
      success: true,
      message: `Document status updated to ${status}`,
      affectedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error updating document status:', error);

    if (connection) {
      await new Promise(resolve => {
        connection.rollback(() => resolve());
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to update document status',
      details: error.message
    });
  } finally {
    if (connection) {
      await new Promise(resolve => {
        connection.release();
        resolve();
      });
    }
  }
})  ;

app.post('/updateUserProfile', async (req, res) => {
  const { userId, profilePic, faceRecognitionPhoto } = req.body;
  
  try {
    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }
    
    // Update profilePic if provided
    if (profilePic) {
      await queryDatabase('UPDATE users SET profilePic = ? WHERE id = ?', [profilePic, userId]);
    }
    
    // Update faceRecognitionPhoto if provided
    if (faceRecognitionPhoto) {
      await queryDatabase('UPDATE users SET faceRecognitionPhoto = ? WHERE id = ?', [faceRecognitionPhoto, userId]);
      console.log(`Updated faceRecognitionPhoto for user ${userId} to ${faceRecognitionPhoto}`);
    }
    
    res.status(200).json({ success: true, message: 'User profile updated successfully' });
  } catch (err) {
    console.error('Error updating user profile:', err);
    res.status(500).json({ error: 'Database error while updating user profile' });
  }
});

app.get('/debug/family-occupation', async (req, res) => {
  try {
    const results = await queryDatabase(`
      SELECT 
        s1.code_id,
        s1.first_name as parent_first_name,
        s1.last_name as parent_last_name,
        s2.family_member_name,
        s2.educational_attainment,
        s2.birthdate,
        s2.age
      FROM step1_identifying_information s1
      LEFT JOIN step2_family_occupation s2 ON s1.code_id = s2.code_id
      ORDER BY s1.code_id, s2.family_member_name
    `);
    
    const familyData = {};
    results.forEach(row => {
      if (!familyData[row.code_id]) {
        familyData[row.code_id] = {
          parent_name: `${row.parent_first_name} ${row.parent_last_name}`,
          family_members: []
        };
      }
      if (row.family_member_name) { 
        familyData[row.code_id].family_members.push({
          name: row.family_member_name,
          relationship: row.educational_attainment,
          occupation: row.birthdate,
          age: row.age
        });
      }
    });
    
    res.status(200).json(familyData);
  } catch (err) {
    console.error('Error in debug endpoint:', err);
    res.status(500).json({ error: 'Error fetching family occupation data' });
  }
});

app.get('/notifications/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const accepted = await queryDatabase(
      'SELECT accepted_at, is_read, message FROM accepted_users WHERE user_id = ? ORDER BY accepted_at DESC', 
      [userId]
    );
    
    const declined = await queryDatabase(
      'SELECT declined_at, remarks, is_read FROM declined_users WHERE user_id = ? ORDER BY declined_at DESC', 
      [userId]
    );

    const terminated = await queryDatabase(
      'SELECT terminated_at, message, is_read FROM terminated_users WHERE user_id = ? ORDER BY terminated_at DESC',
      [userId]
    );

    const remarks = await queryDatabase(
      'SELECT remarks_at, remarks, is_read FROM user_remarks WHERE user_id = ? ORDER BY remarks_at DESC',
      [userId]
    );
    
    let notifications = [];

    accepted.forEach(accept => {
      notifications.push({
        id: `accepted-${userId}-${accept.accepted_at}`,
        type: accept.message === "You have renewed" ? 'renewal_accepted' : 'application_accepted',
        message: accept.message,
        read: accept.is_read === 1,
        created_at: accept.accepted_at,
      });
    });

    declined.forEach(decline => {
      notifications.push({
        id: `declined-${userId}-${decline.declined_at}`,
        type: 'application_declined',
        message: `Your application has been declined. Remarks: ${decline.remarks}`,
        read: decline.is_read === 1,
        created_at: decline.declined_at,
      });
    });

    terminated.forEach(term => {
      notifications.push({
        id: `terminated-${userId}-${term.terminated_at}`,
        type: 'application_terminated',
        message: term.message,
        read: term.is_read === 1,
        created_at: term.terminated_at,
      });
    });

    remarks.forEach(remark => {
      notifications.push({
        id: `remark-${userId}-${remark.remarks_at}`,
        type: 'application_remarks',
        message: `Your application is currently under investigation. Kindly proceed to your designated SPO to complete the necessary compliance requirements. You are given 5 to 7 working days to comply.`,
        read: remark.is_read === 1,
        created_at: remark.remarks_at,
      });
    });

    notifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.status(200).json(notifications);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Database error while fetching notifications' });
  }
});

app.put('/notifications/mark-as-read/:userId/:type', async (req, res) => {
  const { userId, type } = req.params;
  let retries = 3;

  while (retries > 0) {
    try {
      await queryDatabase('START TRANSACTION');

      if (type === 'application_accepted' || type === 'renewal_accepted') {
        await queryDatabase(
          'SELECT * FROM accepted_users WHERE user_id = ? AND is_read = 0 FOR UPDATE',
          [userId]
        );
        await queryDatabase(
          'UPDATE accepted_users SET is_read = 1 WHERE user_id = ? AND is_read = 0',
          [userId]
        );
      } else if (type === 'application_declined') {
        await queryDatabase(
          'SELECT * FROM declined_users WHERE user_id = ? AND is_read = 0 FOR UPDATE',
          [userId]
        );
        await queryDatabase(
          'UPDATE declined_users SET is_read = 1 WHERE user_id = ? AND is_read = 0',
          [userId]
        );
      } else if (type === 'application_terminated') {
        await queryDatabase(
          'SELECT * FROM terminated_users WHERE user_id = ? AND is_read = 0 FOR UPDATE',
          [userId]
        );
        await queryDatabase(
          'UPDATE terminated_users SET is_read = 1 WHERE user_id = ? AND is_read = 0',
          [userId]
        );
      } else if (type === 'application_remarks') {
        await queryDatabase(
          'SELECT * FROM user_remarks WHERE user_id = ? AND is_read = 0 FOR UPDATE',
          [userId]
        );
        await queryDatabase(
          'UPDATE user_remarks SET is_read = 1 WHERE user_id = ? AND is_read = 0',
          [userId]
        );
      }

      await queryDatabase('COMMIT');
      res.json({ success: true, message: 'Notification marked as read' });
      return;

    } catch (err) {
      await queryDatabase('ROLLBACK');
      
      if (err.code !== 'ER_LOCK_WAIT_TIMEOUT') {
        throw err;
      }
      
      retries--;
      if (retries === 0) {
        console.error('Error updating notification after all retries:', err);
        res.status(500).json({ error: 'Database error while updating notifications. Please try again.' });
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
});

app.put('/notifications/mark-all-as-read/:userId', async (req, res) => {
  const { userId } = req.params;
  let retries = 3;

  while (retries > 0) {
    try {
      await queryDatabase('START TRANSACTION');

      await queryDatabase(
        'SELECT * FROM accepted_users WHERE user_id = ? AND is_read = 0 FOR UPDATE',
        [userId]
      );
      await queryDatabase(
        'UPDATE accepted_users SET is_read = 1 WHERE user_id = ? AND is_read = 0',
        [userId]
      );

      await queryDatabase(
        'SELECT * FROM declined_users WHERE user_id = ? AND is_read = 0 FOR UPDATE',
        [userId]
      );
      await queryDatabase(
        'UPDATE declined_users SET is_read = 1 WHERE user_id = ? AND is_read = 0',
        [userId]
      );

      await queryDatabase(
        'SELECT * FROM terminated_users WHERE user_id = ? AND is_read = 0 FOR UPDATE',
        [userId]
      );
      await queryDatabase(
        'UPDATE terminated_users SET is_read = 1 WHERE user_id = ? AND is_read = 0',
        [userId]
      );

      await queryDatabase(
        'SELECT * FROM user_remarks WHERE user_id = ? AND is_read = 0 FOR UPDATE',
        [userId]
      );
      await queryDatabase(
        'UPDATE user_remarks SET is_read = 1 WHERE user_id = ? AND is_read = 0',
        [userId]
      );

      await queryDatabase('COMMIT');
      res.json({ success: true, message: 'All notifications marked as read' });
      return;

    } catch (err) {
      await queryDatabase('ROLLBACK');
      
      if (err.code !== 'ER_LOCK_WAIT_TIMEOUT') {
        throw err;
      }
      
      retries--;
      if (retries === 0) {
        console.error('Error updating notifications after all retries:', err);
        res.status(500).json({ error: 'Database error while updating notifications. Please try again.' });
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }
});

app.get('/allRenewalUsers', async (req, res) => {
  try {
    // First get all renewal users
    const users = await queryDatabase(`
      SELECT u.id AS userId, u.code_id, s1.first_name, s1.middle_name, s1.last_name, s1.barangay
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.status = 'Renewal'
    `);

    // Get documents for each user
    const usersWithDocuments = await Promise.all(users.map(async (user) => {
      const documentsQuery = `
        SELECT code_id,
               file_name,
               uploaded_at,
               display_name,
               status,
               'barangay_cert_documents' as document_type,
               CASE 
                 WHEN file_name LIKE 'http%' THEN file_name 
                 ELSE CONCAT('http://localhost:8081/uploads/', file_name) 
               END as file_url
        FROM barangay_cert_documents
        WHERE code_id = ?
      `;

      try {
        const documents = await queryDatabase(documentsQuery, [user.code_id]);
        return {
          ...user,
          documents: documents
        };
      } catch (err) {
        console.error(`Error fetching documents for user ${user.code_id}:`, err);
        return {
          ...user,
          documents: []
        };
      }
    }));

    res.status(200).json(usersWithDocuments);
  } catch (err) {
    console.error('Error fetching renewal users:', err);
    res.status(500).json({ error: 'Error fetching renewal users' });
  }
});

app.post('/superadminUpdateStatus', async (req, res) => {
  const { userId, status, remarks } = req.body;
  
  try {
    // Get the user info first to get code_id and email
    const userInfo = await queryDatabase(`
      SELECT u.code_id, u.email, s1.first_name 
      FROM users u 
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id 
      WHERE u.id = ?
    `, [userId]);
    
    if (!userInfo || userInfo.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log('Processing renewal for user:', userInfo[0]);
    
    // Update user status
    await queryDatabase('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    console.log(`Updated user status to ${status} for userId: ${userId}`);
    
    // Add to accepted_users or declined_users based on status
    if (status === "Verified") {
      await queryDatabase(
        'INSERT INTO accepted_users (user_id, message, accepted_at, is_read) VALUES (?, ?, NOW(), 0)', 
        [userId, remarks || "Your renewal has been approved by a superadmin"]
      );
      console.log(`Added to accepted_users: ${userId}`);
      
      // Also set barangay_cert document status to Approved
      if (userInfo[0] && userInfo[0].code_id) {
        await queryDatabase(
          'UPDATE barangay_cert_documents SET status = ? WHERE code_id = ?',
          ['Approved', userInfo[0].code_id]
        );
        console.log(`Updated barangay_cert_documents status to Approved for code_id: ${userInfo[0].code_id}`);
      }
      
      // Send renewal acceptance email
      if (userInfo[0] && userInfo[0].email && userInfo[0].first_name) {
        console.log('Preparing to send renewal acceptance email to:', userInfo[0].email);
        
        // Use direct email sending instead of requiring the module again
        const emailResult = await sendRenewalStatusEmail(
          userInfo[0].email,
          userInfo[0].first_name,
          "Accept"
        );
        
        console.log('Renewal acceptance email result:', emailResult ? 'Sent successfully' : 'Failed to send');
      } else {
        console.log('Missing user information for email:', userInfo[0]);
      }
    } else if (status === "Renewal" && remarks && remarks.toLowerCase().includes("declined")) {
      // Set barangay_cert document status to Rejected and delete the record
      if (userInfo[0] && userInfo[0].code_id) {
        console.log('[DECLINE] Attempting to DELETE barangay_cert_documents for code_id:', userInfo[0].code_id, 'remarks:', remarks);
        const deleteResult = await queryDatabase(
          'DELETE FROM barangay_cert_documents WHERE code_id = ?',
          [userInfo[0].code_id]
        );
        console.log('[DECLINE] Delete result:', deleteResult);
        if (deleteResult.affectedRows === 0) {
          console.warn('[DECLINE] No barangay_cert_documents row found for code_id:', userInfo[0].code_id);
        }
      }
      
      // Send renewal decline email
      if (userInfo[0] && userInfo[0].email && userInfo[0].first_name) {
        console.log('Preparing to send renewal decline email to:', userInfo[0].email);
        
        // Use direct email sending instead of requiring the module again
        const emailResult = await sendRenewalStatusEmail(
          userInfo[0].email,
          userInfo[0].first_name,
          "Decline",
          remarks
        );
        
        console.log('Renewal decline email result:', emailResult ? 'Sent successfully' : 'Failed to send');
      } else {
        console.log('Missing user information for email:', userInfo[0]);
      }
    } else if (status === "Declined" && remarks) {
      // Also delete barangay_cert_documents if status is Declined
      if (userInfo[0] && userInfo[0].code_id) {
        console.log('[DECLINE] Attempting to DELETE barangay_cert_documents for code_id:', userInfo[0].code_id, 'remarks:', remarks);
        const deleteResult = await queryDatabase(
          'DELETE FROM barangay_cert_documents WHERE code_id = ?',
          [userInfo[0].code_id]
        );
        console.log('[DECLINE] Delete result:', deleteResult);
        if (deleteResult.affectedRows === 0) {
          console.warn('[DECLINE] No barangay_cert_documents row found for code_id:', userInfo[0].code_id);
        }
      }
      await queryDatabase(
        'INSERT INTO declined_users (user_id, remarks, declined_at, is_read) VALUES (?, ?, NOW(), 0)', 
        [userId, remarks]
      );
    }
    
    res.json({ success: true, message: 'Status updated successfully' });
  } catch (err) {
    console.error('Error updating user status by superadmin:', err);
    res.status(500).json({ success: false, message: 'Failed to update user status' });
  }
});

app.post('/updateAcceptedUser', async (req, res) => {
  const { code_id, message } = req.body;
  
  try {
    await queryDatabase(
      'INSERT INTO accepted_users (user_id, message, accepted_at) VALUES (?, ?, NOW())',
      [code_id, message]
    );

    res.status(200).json({ message: 'New notification added successfully' });
  } catch (error) {
    console.error('Error adding notification:', error);
    res.status(500).json({ error: 'Failed to add notification' });
  }
});

app.get('/getTerminatedUsers', async (req, res) => {
  try {
    let query = `
      SELECT 
        s1.code_id,
        CONCAT(s1.first_name, ' ', s1.last_name) as user_name,
        u.id as user_id,
        a.barangay as admin_barangay,
        tu.terminated_at
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      JOIN terminated_users tu ON u.id = tu.user_id
      LEFT JOIN admin a ON s1.barangay = a.barangay
      WHERE u.status = 'Terminated'
      ORDER BY tu.terminated_at DESC
    `;

    const terminatedUsers = await queryDatabase(query);
    res.json(terminatedUsers);
  } catch (err) {
    console.error('Error fetching terminated users:', err);
    res.status(500).json({ error: 'Failed to fetch terminated users' });
  }
});

app.post('/unTerminateUser', async (req, res) => {
  const { userId } = req.body;

  try {
    await queryDatabase('START TRANSACTION');

    await queryDatabase(
      'UPDATE users SET status = ? WHERE id = ?',
      ['Verified', userId]
    );

    await queryDatabase(
      'INSERT INTO accepted_users (user_id, message, accepted_at, is_read) VALUES (?, ?, NOW(), 0)',
      [userId, 'Your account has been reactivated.']
    );

    // Get user info (name, barangay, id)
    const [userInfo] = await queryDatabase(`
      SELECT u.id, u.name, s1.barangay
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.id = ?
    `, [userId]);

    if (userInfo) {
      const notifMessage = `${userInfo.name} is a new solo parent in your barangay.`;
      await queryDatabase(
        'INSERT INTO adminnotifications (user_id, notif_type, message, barangay) VALUES (?, ?, ?, ?)',
        [userInfo.id, 'cleared', notifMessage, userInfo.barangay]
      );
    }

    await queryDatabase('COMMIT');

    res.status(200).json({ success: true, message: 'User status updated to Verified' });
  } catch (error) {
    await queryDatabase('ROLLBACK');
    console.error('Error updating status:', error);
    res.status(500).json({ success: false, message: 'Failed to update status' });
  }
});

app.get('/verifiedUsers/:adminId', async (req, res) => {
  try {
    const { adminId } = req.params;
    const { status } = req.query; 
    
    const adminResult = await queryDatabase('SELECT barangay FROM admin WHERE id = ?', [adminId]);
    
    if (adminResult.length === 0) {
      return res.status(404).json({ error: 'Admin not found' });
    }

    const adminBarangay = adminResult[0].barangay;

    let statusCondition = "u.status IN ('Verified', 'Pending Remarks', 'Terminated')";
    if (status && (status === 'Verified' || status === 'Pending Remarks' || status === 'Terminated')) {
      statusCondition = "u.status = ?";
    }

    const users = await queryDatabase(`
      SELECT u.id AS userId, u.email, u.name, u.status, s1.barangay,
             s1.first_name, s1.middle_name, s1.last_name, s1.suffix, s1.age, s1.gender, 
             s1.date_of_birth, s1.place_of_birth, s1.education, 
             s1.civil_status, s1.occupation, s1.religion, s1.company, 
             s1.income, s1.employment_status, s1.contact_number, s1.email, 
             s1.pantawid_beneficiary, s1.indigenous, s1.code_id,
             s3.classification,
             s4.needs_problems,
             s5.emergency_name, s5.emergency_relationship, 
             s5.emergency_address, s5.emergency_contact,
             ur.remarks as latest_remarks
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN step3_classification s3 ON u.code_id = s3.code_id
      LEFT JOIN step4_needs_problems s4 ON u.code_id = s4.code_id
      LEFT JOIN step5_in_case_of_emergency s5 ON u.code_id = s5.code_id
      LEFT JOIN (
        SELECT user_id, remarks
        FROM user_remarks
        WHERE (user_id, remarks_at) IN (
          SELECT user_id, MAX(remarks_at)
          FROM user_remarks
          GROUP BY user_id
        )
      ) ur ON u.id = ur.user_id
      WHERE ${statusCondition} AND s1.barangay = ?
    `, status ? [status, adminBarangay] : [adminBarangay]);

    const usersWithChildren = await Promise.all(users.map(async (user) => {
      const children = await queryDatabase(`
        SELECT family_member_name, educational_attainment, birthdate, age
        FROM step2_family_occupation
        WHERE code_id = ?
      `, [user.code_id]);

      return {
        ...user,
        remarks: user.latest_remarks || 'No remarks',
        children: children
      };
    }));

    res.status(200).json(usersWithChildren);
  } catch (err) {
    console.error('Error fetching verified users:', err);
    res.status(500).json({ error: 'Error fetching verified users' });
  }
});

app.post('/saveRemarks', async (req, res) => {
  const { code_id, remarks, user_id, admin_id, superadmin_id } = req.body;
  console.log('Received request to save remarks:', { code_id, remarks, user_id, admin_id, superadmin_id });

  if (!code_id || !remarks || !user_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Missing required fields: code_id, remarks, and user_id are required' 
    });
  }

  // Ensure at least one of admin_id or superadmin_id is provided
  if (!admin_id && !superadmin_id) {
    return res.status(400).json({ 
      success: false, 
      message: 'Either admin_id or superadmin_id must be provided' 
    });
  }

  try {
    // Start a transaction
    await queryDatabase('START TRANSACTION');

    await queryDatabase(
      'INSERT INTO user_remarks (code_id, remarks, remarks_at, is_read, user_id, admin_id, superadmin_id) VALUES (?, ?, NOW(), 0, ?, ?, ?)',
      [code_id, remarks, user_id, admin_id, superadmin_id]
    );

    await queryDatabase(
      'UPDATE users SET status = ? WHERE id = ?',
      ['Pending Remarks', user_id]
    );

    // Get user information for the email and superadmin notification
    const userInfo = await queryDatabase(`
      SELECT u.email, s1.first_name, s1.last_name
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.id = ?
    `, [user_id]);

    // Get barangay name of the admin
    const adminInfo = await queryDatabase('SELECT barangay FROM admin WHERE id = ?', [admin_id]);

    // Prepare and insert superadmin notification
    if (userInfo && userInfo.length > 0 && adminInfo && adminInfo.length > 0) {
      const barangayName = adminInfo[0].barangay;
      const firstName = userInfo[0].first_name;
      const notifMessage = `From Barangay ${barangayName}: ${firstName} has pending remarks.`;
      await queryDatabase(
        'INSERT INTO superadminnotifications (user_id, notif_type, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())',
        [user_id, 'remarks', notifMessage]
      );
    }

    await queryDatabase('COMMIT');

    // Send revocation email if user email is available
    if (userInfo && userInfo.length > 0 && userInfo[0].email && userInfo[0].first_name) {
      try {
        const { sendRevokeEmail } = require('./services/emailService');
        await sendRevokeEmail(
          userInfo[0].email,
          userInfo[0].first_name
        );
        console.log('Revocation email sent to:', userInfo[0].email);
      } catch (emailError) {
        console.error('Error sending revocation email:', emailError);
        // Continue with the process even if email fails
      }
    }

    res.status(200).json({ message: 'Remarks saved successfully and status updated to Pending Remarks' });
  } catch (error) {
    // Rollback the transaction in case of error
    await queryDatabase('ROLLBACK');
    
    console.error('Error saving remarks:', error);
    res.status(500).json({ error: 'Failed to save remarks' });
  }
});

app.get('/getAllRemarks', async (req, res) => {
  try {
    let query = `
      SELECT 
        r.code_id,
        r.remarks,
        r.remarks_at,
        r.user_id,
        CONCAT(s1.first_name, ' ', s1.last_name) as user_name,
        a.barangay as admin_barangay,
        u.status
      FROM user_remarks r
      JOIN users u ON r.user_id = u.id
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      JOIN admin a ON r.admin_id = a.id
      WHERE u.status = 'Pending Remarks'
      ORDER BY r.remarks_at DESC
    `;

    const remarks = await queryDatabase(query);
    res.json(remarks);
  } catch (err) {
    console.error('Error fetching remarks:', err);
    res.status(500).json({ error: 'Failed to fetch remarks' });
  }
});

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 100;

const executeWithRetry = async (fn) => {
  let retries = 0;
  while (retries < MAX_RETRIES) {
    try {
      return await fn();
    } catch (error) {
      if (error.code === 'ER_LOCK_DEADLOCK' && retries < MAX_RETRIES - 1) {
        retries++;
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        continue;
      }
      throw error;
    }
  }
};

app.post('/acceptRemarks', async (req, res) => {
  const { code_id } = req.body;

  try {
    // Update user status
    await queryDatabase(
      'UPDATE users SET status = ? WHERE code_id = ?',
      ['Verified', code_id]
    );

    // Add to accepted_users table
    await queryDatabase(
      'INSERT INTO accepted_users (user_id, message, accepted_at, is_read) VALUES ((SELECT id FROM users WHERE code_id = ?), ?, NOW(), 0)',
      [code_id, 'Your account has been verified.']
    );

    res.status(200).json({ success: true, message: 'User verified successfully' });
  } catch (error) {
    console.error('Error verifying user:', error);
    res.status(500).json({ success: false, message: 'Failed to verify user' });
  }
});

app.post('/declineRemarks', async (req, res) => {
  const { code_id } = req.body;

  try {
    // Update user status
    await queryDatabase(
      'UPDATE users SET status = ? WHERE code_id = ?',
      ['Terminated', code_id]
    );

    // Add to terminated_users table
    await queryDatabase(
      'INSERT INTO terminated_users (user_id, message, terminated_at, is_read) VALUES ((SELECT id FROM users WHERE code_id = ?), ?, NOW(), 0)',
      [code_id, 'Your account has been terminated.']
    );

    res.status(200).json({ success: true, message: 'User terminated successfully' });
  } catch (error) {
    console.error('Error terminating user:', error);
    res.status(500).json({ success: false, message: 'Failed to terminate user' });
  }
});

app.post('/saveDocument', async (req, res) => {
  const { userId, documentType, documentUrl, documentName } = req.body;
  
  try {
    // Update the users table with the document information
    // We'll store documents as JSON in the documents column
    const user = await queryDatabase('SELECT * FROM users WHERE id = ?', [userId]);
    
    if (user.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Get existing documents or initialize empty array
    let documents = user[0].documents ? JSON.parse(user[0].documents) : [];

    // Update or add new document
    const existingDocIndex = documents.findIndex(doc => doc.type === documentType);
    if (existingDocIndex !== -1) {
      documents[existingDocIndex] = {
        ...documents[existingDocIndex],
        url: documentUrl,
        status: 'pending'
      };
    } else {
      documents.push({
        type: documentType,
        name: documentName,
        url: documentUrl,
        status: 'pending'
      });
    }

    // Update user's documents in the database
    await queryDatabase(
      'UPDATE users SET documents = ? WHERE id = ?',
      [JSON.stringify(documents), userId]
    );

    res.json({ success: true, documents });
  } catch (error) {
    console.error('Error saving document:', error);
    res.status(500).json({ success: false, message: 'Failed to save document' });
  }
});

app.get('/getUserDocuments/:userId', async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await queryDatabase('SELECT documents FROM users WHERE id = ?', [userId]);
    
    if (user.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const documents = user[0].documents ? JSON.parse(user[0].documents) : [];
    res.json({ success: true, documents });
  } catch (error) {
    console.error('Error fetching documents:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch documents' });
  }
});

app.get('/check-tables', async (req, res) => {
  try {
    const tables = [
      'step1_identifying_information',
      'step2_family_occupation',
      'step3_classification',
      'step4_needs_problems',
      'step5_in_case_of_emergency',
      'users',
      'psa_documents',
      'itr_documents',
      'med_cert_documents',
      'marriage_documents',
      'cenomar_documents',
      'death_cert_documents'
    ];

    const results = {};
    for (const table of tables) {
      try {
        const columns = await queryDatabase(`DESCRIBE ${table}`);
        results[table] = columns;
      } catch (err) {
        results[table] = { error: err.message };
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Error checking tables:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/getUserDocuments', async (req, res) => {
  const { code_id } = req.query;

  try {
    if (!code_id) {
      return res.status(400).json({ error: 'code_id is required' });
    }

    const documentsQuery = `
      SELECT code_id,
             file_name,
             uploaded_at,
             display_name,
             status,
             'barangay_cert_documents' as document_type,
             CASE 
               WHEN file_name LIKE 'http%' THEN file_name 
               ELSE CONCAT('http://localhost:8081/uploads/', file_name) 
             END as file_url
      FROM barangay_cert_documents
      WHERE code_id = ?
    `;

    const documents = await queryDatabase(documentsQuery, [code_id]);
    res.json(documents);
  } catch (err) {
    console.error('Error fetching barangay certificates:', err);
    res.status(500).json({ error: 'Error fetching barangay certificates' });
  }
});

app.use((err, req, res, next) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message
  });
});

// Set port and start server
const PORT = process.env.PORT || 8081;
try {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Face authentication endpoint: http://localhost:${PORT}/api/authenticate-face`);
  });
} catch (err) {
  console.error('Error starting server:', err);
}

// Add global unhandled exception handler
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...');
  console.error(err.name, err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Closing HTTP server...');
  pool.end((err) => {
    if (err) {
      console.error('Error closing database pool:', err);
    }
    process.exit(0);
  });
});

// Implement direct route for password reset
app.post('/api/reset-password-request', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email is required' 
      });
    }
    
    console.log(`Password reset requested for email: ${email}`);
    
    // Check if email exists in database and status is Verified
    const users = await queryDatabase(
      'SELECT id, email, name, status FROM users WHERE email = ?', 
      [email]
    );
    
    if (!users || users.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'User not found with this email' 
      });
    }
    
    const user = users[0];
    
    // Check if user status is Verified
    if (user.status !== 'Verified') {
      return res.status(403).json({ 
        success: false, 
        error: 'Only verified users can reset their password. Please contact an administrator.' 
      });
    }
    
    // Generate reset token and expiration
    const resetToken = crypto.randomBytes(20).toString('hex');
    const resetTokenExpires = new Date(Date.now() + 3600000); // 1 hour from now
    
    try {
      // Add resetPasswordToken column if it doesn't exist
      await queryDatabase(`
        ALTER TABLE users 
        ADD COLUMN IF NOT EXISTS resetPasswordToken VARCHAR(100) NULL,
        ADD COLUMN IF NOT EXISTS resetPasswordExpires DATETIME NULL
      `);
    } catch (alterError) {
      console.log("Table alteration attempted. If columns already exist, this error can be ignored.");
      console.error(alterError);
    }
    
    // Save token to database
    await queryDatabase(
      'UPDATE users SET resetPasswordToken = ?, resetPasswordExpires = ? WHERE id = ?',
      [resetToken, resetTokenExpires, user.id]
    );
    
    // Create reset URL
    const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;
    
    // Configure Nodemailer transporter
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: 'santamariasoloparent@gmail.com',
        pass: process.env.EMAIL_APP_PASSWORD || 'your-app-password-here'
      }
    });
    
    // Set up email options
    const mailOptions = {
      from: '"Solo Parent Support System" <santamariasoloparent@gmail.com>',
      to: email,
      subject: 'Password Reset - Solo Parent Support System',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #16C47F; text-align: center;">Password Reset Request</h2>
          <p>Hello ${user.name || email},</p>
          <p>We received a request to reset your password for the Solo Parent Support System. Please click the button below to reset your password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background-color: #16C47F; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Reset Your Password</a>
          </div>
          <p>If you didn't request this password reset, you can safely ignore this email. The link will expire in 1 hour.</p>
          <p>If the button doesn't work, copy and paste the following URL into your browser:</p>
          <p style="word-break: break-all; background-color: #f5f5f5; padding: 10px; border-radius: 5px;">${resetUrl}</p>
          <hr style="border-top: 1px solid #eee; margin: 30px 0;">
          <p style="text-align: center; color: #777; font-size: 14px;">Solo Parent Support System</p>
        </div>
      `
    };
    
    // Send email
    try {
      await transporter.sendMail(mailOptions);
      console.log(`Password reset email sent to: ${email}`);
      
      return res.json({ 
        success: true, 
        message: 'Password reset link has been sent to your email address'
      });
    } catch (emailError) {
      console.error('Error sending password reset email:', emailError);
      
      // Still return success but with a warning
      return res.json({ 
        success: true, 
        message: 'Password reset link was processed but email sending failed. For testing, you can use this token:',
        token: resetToken
      });
    }
    
  } catch (error) {
    console.error('Error in password reset request:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Server error processing password reset request: ' + error.message
    });
  }
});

// Verify reset token endpoint
app.get('/api/verify-reset-token/:token', async (req, res) => {
  try {
    const { token } = req.params;
    
    if (!token) {
      return res.status(400).json({
        valid: false,
        error: 'Token is required'
      });
    }
    
    // Look for user with this reset token
    const users = await queryDatabase(
      'SELECT id FROM users WHERE resetPasswordToken = ? AND resetPasswordExpires > NOW()', 
      [token]
    );
    
    if (!users || users.length === 0) {
      return res.status(404).json({
        valid: false,
        error: 'Invalid or expired token'
      });
    }
    
    // Token is valid
    res.json({ 
      valid: true,
      message: 'Token is valid'
    });
    
  } catch (error) {
    console.error('Error verifying reset token:', error);
    res.status(500).json({ 
      valid: false, 
      error: 'Server error verifying token: ' + error.message
    });
  }
});

// Process password reset
app.post('/api/reset-password', async (req, res) => {
  const { token, password } = req.body;
  
  if (!token || !password) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }
  
  try {
    // Verify token is valid and get associated email
    const [tokenResults] = await pool.execute(
      'SELECT * FROM password_reset_tokens WHERE token = ? AND expires > NOW()',
      [token]
    );
    
    if (tokenResults.length === 0) {
      return res.status(400).json({ success: false, error: 'Invalid or expired token' });
    }
    
    const { email } = tokenResults[0];
    
    // Check if new password is same as old password
    const [userResults] = await pool.execute(
      'SELECT password FROM users WHERE email = ?',
      [email]
    );
    
    if (userResults.length > 0 && userResults[0].password === password) {
      return res.status(400).json({ 
        success: false, 
        error: 'New password cannot be the same as your current password' 
      });
    }
    
    // Update user's password
    await pool.execute(
      'UPDATE users SET password = ? WHERE email = ?',
      [password, email]
    );
    
    // Delete used token
    await pool.execute(
      'DELETE FROM password_reset_tokens WHERE token = ?',
      [token]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Add route for changing password
app.post('/changePassword', async (req, res) => {
  const { userId, currentPassword, newPassword } = req.body;

  if (!userId || !currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // First, verify the current password
    const [rows] = await pool.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const storedPassword = rows[0].password;

    // Compare current password (basic comparison for now)
    if (storedPassword !== currentPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Update the password
    await pool.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [newPassword, userId]
    );

    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Define table names and ID columns for document types
const TABLE_NAMES = {
  psa: {
    table: 'psa_documents',
    idColumn: 'psa_id'
  },
  itr: {
    table: 'itr_documents',
    idColumn: 'itr_id'
  },
  med_cert: {
    table: 'med_cert_documents',
    idColumn: 'med_cert_id'
  },
  marriage: {
    table: 'marriage_documents',
    idColumn: 'marriage_id'
  },
  cenomar: {
    table: 'cenomar_documents',
    idColumn: 'cenomar_id'
  },
  death_cert: {
    table: 'death_cert_documents',
    idColumn: 'death_cert_id'
  }
};


app.post('/updateUserStatusIncompleteDocuments', async (req, res) => {
  const { code_id, status } = req.body;
  console.log('Received request to update status:', { code_id, status });

  if (!code_id) {
    return res.status(400).json({ 
      success: false, 
      error: 'Code ID is required' 
    });
  }

  try {
    // Start transaction
    await queryDatabase('START TRANSACTION');

    // Get user's civil status and current status
    const userQuery = `
      SELECT u.status, s1.civil_status 
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.code_id = ?
    `;
    const userResult = await queryDatabase(userQuery, [code_id]);

    if (!userResult || userResult.length === 0) {
      await queryDatabase('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    const currentStatus = userResult[0].status;
    const civilStatus = userResult[0].civil_status;

    // Get required documents based on civil status
    const requiredDocuments = getRequiredDocumentsByCivilStatus(civilStatus);
    console.log('Required documents for civil status:', civilStatus, ':', requiredDocuments);

    // Check if all required documents are submitted and approved
    let allDocumentsSubmitted = true;
    let hasPendingDocuments = false;
    for (const docType of requiredDocuments) {
      const tableInfo = TABLE_NAMES[docType];
      const checkDocQuery = `
        SELECT ${tableInfo.idColumn}, status
        FROM ${tableInfo.table} 
        WHERE code_id = ?
        LIMIT 1
      `;
      console.log('Checking document:', docType, 'with query:', checkDocQuery);
      const docResult = await queryDatabase(checkDocQuery, [code_id]);
      
      if (!docResult || docResult.length === 0) {
        console.log('Document not found:', docType);
        allDocumentsSubmitted = false;
        break;
      }

      // Check if document status is 'Pending'
      if (docResult[0].status === 'Pending') {
        console.log('Document is still Pending:', docType);
        hasPendingDocuments = true;
        allDocumentsSubmitted = false;
        break;
      }

      // Check if document status is 'Approved'
      if (docResult[0].status !== 'Approved') {
        console.log('Document status is not Approved:', docType, 'status:', docResult[0].status);
        allDocumentsSubmitted = false;
        break;
      }
    }

    console.log('All documents submitted and approved:', allDocumentsSubmitted);
    console.log('Has pending documents:', hasPendingDocuments);

    // Determine new status
    let newStatus;
    if (allDocumentsSubmitted && !hasPendingDocuments) {
      newStatus = 'Verified'; // Set to Verified if all documents are approved
    } else {
      newStatus = 'Incomplete'; // Keep as Incomplete if any document is missing, pending, or not approved
    }
    
    console.log('Setting status to:', newStatus, 'based on documents check');
    

    console.log('Updating status to:', newStatus);

    // Update user status
    const updateQuery = `UPDATE users SET status = ? WHERE code_id = ?`;
    const result = await queryDatabase(updateQuery, [newStatus, code_id]);

    if (result.affectedRows === 0) {
      await queryDatabase('ROLLBACK');
      return res.status(404).json({ 
        success: false, 
        error: 'User not found' 
      });
    }

    // Insert notification if user is now Verified
    if (newStatus === 'Verified') {
      // Get user info (name, barangay, id)
      const [userInfo] = await queryDatabase(`
        SELECT u.id, u.name, s1.barangay
        FROM users u
        JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
        WHERE u.code_id = ?
      `, [code_id]);
      if (userInfo) {
        const notifMessage = `${userInfo.name} is a new solo parent in your barangay.`;
        await queryDatabase(
          'INSERT INTO adminnotifications (user_id, notif_type, message, barangay) VALUES (?, ?, ?, ?)',
          [userInfo.id, 'new_solo_parent', notifMessage, userInfo.barangay]
        );
      }
    }

    // Commit transaction
    await queryDatabase('COMMIT');

    res.json({ 
      success: true,
      status: newStatus,
      allDocumentsSubmitted,
      message: `Status updated to ${newStatus}`
    });
  } catch (error) {
    console.error('Error updating user status:', error);
    await queryDatabase('ROLLBACK');
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update user status',
      details: error.message 
    });
  }
});

// Helper function to get required documents based on civil status
function getRequiredDocumentsByCivilStatus(civil_status) {
  const baseDocuments = ['psa', 'itr', 'med_cert'];
  
  switch (civil_status?.toLowerCase()) {
    case 'single':
      return [...baseDocuments, 'cenomar'];
    case 'married':
      return [...baseDocuments, 'marriage'];
    case 'divorced':
      return [...baseDocuments, 'marriage'];
    case 'widowed':
      return [...baseDocuments, 'marriage', 'death_cert'];
    default:
      return baseDocuments;
  }
}

// Add this new route for updating document status
app.post('/api/documents/updateStatus', async (req, res) => {
  const { code_id, documentType, status } = req.body;
  
  try {
    if (!code_id || !documentType || !status) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    // Get the table name and ID column for the document type
    const tableInfo = TABLE_NAMES[documentType];
    if (!tableInfo) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid document type' 
      });
    }

    // Update the document status
    const updateQuery = `
      UPDATE ${tableInfo.table} 
      SET status = ? 
      WHERE code_id = ?
    `;
    
    await queryDatabase(updateQuery, [status, code_id]);
    
    res.json({ 
      success: true, 
      message: `Document status updated to ${status}` 
    });
  } catch (error) {
    console.error('Error updating document status:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update document status' 
    });
  }
});

app.post('/updateRenewalDocument', async (req, res) => {
  const { code_id, document_type, status } = req.body;
  console.log('Received updateRenewalDocument request:', { code_id, document_type, status });

  try {
    if (!code_id || !document_type || !status) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields (code_id, document_type, status)'
      });
    }

    // Use TABLE_NAMES mapping for table info
    const tableInfo = TABLE_NAMES[document_type];
    if (!tableInfo) {
      return res.status(400).json({
        success: false,
        error: 'Invalid document type'
      });
    }

    const updateQuery = `UPDATE ${tableInfo.table} SET status = ? WHERE code_id = ?`;
    const result = await queryDatabase(updateQuery, [status, code_id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: 'No document found to update'
      });
    }

    res.json({
      success: true,
      message: `Document status updated to ${status}`
    });
  } catch (error) {
    console.error('Error in /updateRenewalDocument:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update renewal document status'
    });
  }
});

// Get all follow-up notifications for a user
app.get('/followup-notifications/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const results = await queryDatabase(
      'SELECT id, accepted_at as created_at, message, is_read FROM follow_up_documents WHERE user_id = ? ORDER BY accepted_at DESC',
      [userId]
    );
    res.json(results);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch follow-up notifications' });
  }
});

// Mark a single follow-up notification as read
app.put('/followup-notifications/mark-as-read/:userId/:notifId', async (req, res) => {
  const { userId, notifId } = req.params;
  try {
    await queryDatabase(
      'UPDATE follow_up_documents SET is_read = 1 WHERE user_id = ? AND id = ?',
      [userId, notifId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark follow-up notification as read' });
  }
});

// Mark all follow-up notifications as read for a user
app.put('/followup-notifications/mark-all-as-read/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    await queryDatabase(
      'UPDATE follow_up_documents SET is_read = 1 WHERE user_id = ?',
      [userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark all follow-up notifications as read' });
  }
});

app.post('/terminateUser', async (req, res) => {
  const { userId } = req.body;
  
  try {
    console.log('Terminating user with ID:', userId);
    
    // Get the user info first to get code_id, name, email, barangay
    const [userInfo] = await queryDatabase(`
      SELECT u.id, u.code_id, u.email, u.name, s1.barangay, s1.first_name
      FROM users u
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.id = ?
    `, [userId]);
    
    if (!userInfo) {
      console.error('User not found for termination:', userId);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log('Processing termination for user:', JSON.stringify(userInfo));
    
    // Update user status to Terminated
    await queryDatabase('UPDATE users SET status = ? WHERE id = ?', ['Terminated', userId]);
    console.log(`Updated user status to Terminated for userId: ${userId}`);

    // Insert into terminated_users
    await queryDatabase(
      'INSERT INTO terminated_users (user_id, message, terminated_at, is_read) VALUES (?, ?, NOW(), 0)',
      [userInfo.id, 'Your account has been terminated.']
    );

    // Insert into adminnotifications
    const notifMessage = `${userInfo.name} from your barangay has been not cleared and he's now disqualified as a solo parent after the review.`;
    await queryDatabase(
      'INSERT INTO adminnotifications (user_id, notif_type, message, barangay) VALUES (?, ?, ?, ?)',
      [userInfo.id, 'terminated', notifMessage, userInfo.barangay]
    );

    // Send termination email if user email is available
    if (userInfo.email && userInfo.first_name) {
      try {
        console.log('Preparing to send termination email to:', userInfo.email);
        
        // Use direct email sending instead of requiring the module again
        const { sendTerminationEmail } = require('./services/emailService');
        const emailResult = await sendTerminationEmail(
          userInfo.email,
          userInfo.first_name
        );
        
        console.log('Termination email result:', emailResult ? 'Sent successfully' : 'Failed to send');
      } catch (emailError) {
        console.error('Error sending termination email:', emailError);
        console.error('Error details:', JSON.stringify(emailError, null, 2));
        // Continue with the process even if email fails
      }
    } else {
      console.log('Missing user information for email:', JSON.stringify(userInfo));
    }

    res.json({ success: true, message: 'User account terminated successfully' });
  } catch (err) {
    console.error('Error terminating user account:', err);
    res.status(500).json({ success: false, message: 'Failed to terminate user account' });
  }
});

// Endpoint to re-verify a user account
app.post('/unTerminateUser', async (req, res) => {
  const { userId } = req.body;
  
  try {
    console.log('Re-verifying user with ID:', userId);
    
    // Get the user info first to get code_id and email
    const userInfo = await queryDatabase(`
      SELECT u.id, u.code_id, u.email, s1.first_name 
      FROM users u 
      JOIN step1_identifying_information s1 ON u.code_id = s1.code_id 
      WHERE u.id = ?
    `, [userId]);
    
    if (!userInfo || userInfo.length === 0) {
      console.error('User not found for re-verification:', userId);
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    console.log('Processing re-verification for user:', JSON.stringify(userInfo[0]));
    
    // Update user status to Verified
    await queryDatabase('UPDATE users SET status = ? WHERE id = ?', ['Verified', userId]);
    console.log(`Updated user status to Verified for userId: ${userId}`);
    
    // Send re-verification email if user email is available
    if (userInfo[0] && userInfo[0].email && userInfo[0].first_name) {
      try {
        console.log('Preparing to send re-verification email to:', userInfo[0].email);
        
        // Use direct import to ensure the function is available
        const { sendReverificationEmail } = require('./services/emailService');
        
        const emailResult = await sendReverificationEmail(
          userInfo[0].email,
          userInfo[0].first_name
        );
        
        console.log('Re-verification email result:', emailResult ? 'Sent successfully' : 'Failed to send');
      } catch (emailError) {
        console.error('Error sending re-verification email:', emailError);
        console.error('Error details:', JSON.stringify(emailError, null, 2));
        // Continue with the process even if email fails
      }
    } else {
      console.log('Missing user information for email:', JSON.stringify(userInfo[0]));
    }
    
    res.json({ success: true, message: 'User account re-verified successfully' });
  } catch (err) {
    console.error('Error re-verifying user account:', err);
    res.status(500).json({ success: false, message: 'Failed to re-verify user account' });
  }
});

app.get('/accepted-users', async (req, res) => {
  try {
    console.log('Fetching accepted users...');
    const query = `
      SELECT 
        au.id,
        u.name,
        au.accepted_at
      FROM users u
      INNER JOIN (
        SELECT user_id, MAX(accepted_at) as latest_accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) latest_au ON u.id = latest_au.user_id
      INNER JOIN accepted_users au ON u.id = au.user_id 
        AND au.accepted_at = latest_au.latest_accepted_at
      WHERE u.status IN ('Verified', 'Created')
      ORDER BY au.accepted_at DESC
      LIMIT 5
    `;
    
    console.log('Executing query:', query);
    const results = await queryDatabase(query);
    console.log('Query results:', results);
    
    if (!results || results.length === 0) {
      console.log('No accepted users found');
      return res.json([]);
    }
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching accepted users:', error);
    res.status(500).json({ 
      error: 'Failed to fetch accepted users', 
      details: error.message,
      stack: error.stack 
    });
  }
});

app.get('/polulations-users', async (req, res) => {
  try {
    console.log('Fetching population users...');
    const { startDate, endDate, barangay } = req.query;
    
    // List of valid barangays
    const validBarangays = [
      'Adia', 'Bagong Pook', 'Bagumbayan', 'Bubucal', 'Cabooan', 'Calangay',
      'Cambuja', 'Coralan', 'Cueva', 'Inayapan', 'Jose P. Laurel, Sr.',
      'Jose P. Rizal', 'Juan Santiago', 'Kayhacat', 'Macasipac', 'Masinao',
      'Matalinting', 'Pao-o', 'Parang ng Buho', 'Poblacion Dos',
      'Poblacion Quatro', 'Poblacion Tres', 'Poblacion Uno', 'Talangka', 'Tungkod'
    ];
    
    let query = `
        SELECT 
          au.accepted_at,
          u.status,
          s1.barangay,
          u.id as user_id,
          u.code_id,
          u.beneficiary_status
        FROM users u
        INNER JOIN (
          SELECT user_id, MAX(accepted_at) as accepted_at
          FROM accepted_users
          GROUP BY user_id
        ) au ON u.id = au.user_id
        INNER JOIN accepted_users au2 ON u.id = au2.user_id 
          AND au2.accepted_at = au.accepted_at
        INNER JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
        WHERE u.status IN ('Verified', 'Renewal', 'Pending Remarks', 'Terminated')
    `;
    const params = [];

    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      params.push(barangay);
    }

    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    query += ` ORDER BY au.accepted_at ASC`;
    
    console.log('Executing query:', query);
    console.log('Query params:', params);
    const results = await queryDatabase(query, params);
    console.log('Query results:', results);
    
    if (!results || results.length === 0) {
      console.log('No users found');
      return res.json([]);
    }
    
    // Log unique status counts
    const statusCounts = results.reduce((acc, curr) => {
      acc[curr.status] = (acc[curr.status] || 0) + 1;
      return acc;
    }, {});
    console.log('Status counts:', statusCounts);
    
    res.json(results);
  } catch (error) {
    console.error('Error fetching population users:', error);
    res.status(500).json({ 
      error: 'Failed to fetch population users', 
      details: error.message,
      stack: error.stack 
    });
  }
});

app.get('/populations-users', async (req, res) => {
  try {
    console.log('Fetching population users...');
    const { startDate, endDate, barangay } = req.query;
    
    let query = `
      SELECT 
        u.id,
        u.code_id,
        u.beneficiary_status,
        au.accepted_at,
        s1.barangay
      FROM users u
      LEFT JOIN (
        SELECT user_id, MAX(accepted_at) as accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) au ON u.id = au.user_id
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.status = 'Verified'
    `;

    const params = [];

    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      params.push(barangay);
    }

    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    query += ` ORDER BY au.accepted_at DESC`;
    
    console.log('Executing query:', query);
    console.log('Query params:', params);
    const results = await queryDatabase(query, params);
    
    if (!results || results.length === 0) {
      console.log('No population data found');
      return res.json({
        beneficiaries: 0,
        nonBeneficiaries: 0
      });
    }

    // Process the data by month
    const monthlyData = {};
    
    results.forEach(user => {
      if (user.accepted_at) {
        const date = new Date(user.accepted_at);
        const month = date.getMonth();
        const year = date.getFullYear();
        const key = `${year}-${month}`;
        
        if (!monthlyData[key]) {
          monthlyData[key] = {
            month,
            year,
            total: 0,
            beneficiaries: 0,
            nonBeneficiaries: 0
          };
        }
        
        monthlyData[key].total++;
        
        if (user.beneficiary_status === 'beneficiary') {
          monthlyData[key].beneficiaries++;
        } else if (user.beneficiary_status === 'non-beneficiary') {
          monthlyData[key].nonBeneficiaries++;
        }
      }
    });
    
    // Convert to array and sort by date
    const monthlyArray = Object.values(monthlyData).sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
    
    console.log('Processed monthly data:', monthlyArray);
    res.json(monthlyArray);
  } catch (error) {
    console.error('Error fetching population data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch population data', 
      details: error.message,
      stack: error.stack 
    });
  }
});

app.post('/removeBeneficiary', async (req, res) => {
  const { user_id, admin_id, superadmin_id } = req.body;
  
  if (!user_id || (!admin_id && !superadmin_id)) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['user_id', 'either admin_id or superadmin_id']
    });
  }

  try {
    // Verify admin/superadmin credentials
    if (superadmin_id) {
      const superadminCheck = await queryDatabase('SELECT id FROM superadmin WHERE id = ?', [superadmin_id]);
      if (!superadminCheck || superadminCheck.length === 0) {
        return res.status(403).json({ error: 'Invalid superadmin credentials' });
      }
    } else {
      const adminCheck = await queryDatabase('SELECT id FROM admin WHERE id = ?', [admin_id]);
      if (!adminCheck || adminCheck.length === 0) {
        return res.status(403).json({ error: 'Invalid admin credentials' });
      }
    }
    
    // Update beneficiary status to non-beneficiary
    const updateResult = await queryDatabase(
      'UPDATE users SET beneficiary_status = ? WHERE id = ?',
      ['non-beneficiary', user_id]
    );
    
    if (updateResult.affectedRows === 0) {
      return res.status(500).json({ error: 'No rows updated - possible database error' });
    }
    
    res.json({ 
      success: true,
      message: 'User removed as beneficiary',
      user_id,
      new_status: 'non-beneficiary'
    });
    
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ 
      error: 'Database operation failed',
      details: err.message
    });
  }
});

app.post('/updateBeneficiaryStatus', async (req, res) => {
  const { user_id, beneficiary_status, admin_id, superadmin_id } = req.body;
  
  // Validate required fields
  if (!user_id || !beneficiary_status || (!admin_id && !superadmin_id)) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['user_id', 'beneficiary_status', 'either admin_id or superadmin_id']
    });
  }

  // Validate beneficiary_status value
  if (!['beneficiary', 'non-beneficiary'].includes(beneficiary_status)) {
    return res.status(400).json({ 
      error: 'Invalid beneficiary_status',
      allowed_values: ['beneficiary', 'non-beneficiary']
    });
  }

  try {
    // Verify admin/superadmin credentials
    if (superadmin_id) {
      const superadminCheck = await queryDatabase('SELECT id FROM superadmin WHERE id = ?', [superadmin_id]);
      if (!superadminCheck || superadminCheck.length === 0) {
        return res.status(403).json({ error: 'Invalid superadmin credentials' });
      }
    } else {
      const adminCheck = await queryDatabase('SELECT id FROM admin WHERE id = ?', [admin_id]);
      if (!adminCheck || adminCheck.length === 0) {
        return res.status(403).json({ error: 'Invalid admin credentials' });
      }
    }
    
    // Update beneficiary status
    const updateResult = await queryDatabase(
      'UPDATE users SET beneficiary_status = ? WHERE id = ?',
      [beneficiary_status, user_id]
    );
    
    if (updateResult.affectedRows === 0) {
      return res.status(500).json({ error: 'No rows updated - possible database error' });
    }
    
    res.json({ 
      success: true,
      message: `User beneficiary status updated to ${beneficiary_status}`,
      user_id,
      new_status: beneficiary_status
    });
    
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ 
      error: 'Database operation failed',
      details: err.message
    });
  }
});

app.get('/beneficiaries-users', async (req, res) => {
  try {
    console.log('Fetching beneficiaries data...');
    const { startDate, endDate, barangay } = req.query;
    
    let query = `
      SELECT 
        u.id,
        u.code_id,
        u.beneficiary_status,
        au.accepted_at,
        s1.barangay
      FROM users u
      LEFT JOIN (
        SELECT user_id, MAX(accepted_at) as accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) au ON u.id = au.user_id
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.status = 'Verified'
    `;

    const params = [];

    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      params.push(barangay);
    }

    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    query += ` ORDER BY au.accepted_at DESC`;
    
    console.log('Executing query:', query);
    console.log('Query params:', params);
    const results = await queryDatabase(query, params);
    
    if (!results || results.length === 0) {
      console.log('No beneficiaries found');
      return res.json({
        beneficiaries: 0,
        nonBeneficiaries: 0
      });
    }

    // Count based on beneficiary_status
    const counts = results.reduce((acc, user) => {
      if (user.beneficiary_status === 'beneficiary') {
        acc.beneficiaries++;
      } else if (user.beneficiary_status === 'non-beneficiary') {
        acc.nonBeneficiaries++;
      }
      return acc;
    }, { beneficiaries: 0, nonBeneficiaries: 0 });

    console.log('Final beneficiary counts:', counts);
    res.json(counts);
  } catch (error) {
    console.error('Error fetching beneficiaries data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch beneficiaries data', 
      details: error.message,
      stack: error.stack 
    });
  }
});

// Add the beneficiaries-users endpoint
app.get('/beneficiaries-users', async (req, res) => {
  try {
    console.log('Fetching beneficiaries data...');
    const { startDate, endDate, barangay } = req.query;
    
    let query = `
      SELECT 
        u.id,
        u.code_id,
        u.beneficiary_status,
        au.accepted_at,
        s1.barangay
      FROM users u
      LEFT JOIN (
        SELECT user_id, MAX(accepted_at) as accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) au ON u.id = au.user_id
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      WHERE u.status = 'Verified'
    `;

    const params = [];

    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      params.push(barangay);
    }

    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    query += ` ORDER BY au.accepted_at DESC`;
    
    console.log('Executing query:', query);
    console.log('Query params:', params);
    const results = await queryDatabase(query, params);
    
    if (!results || results.length === 0) {
      console.log('No beneficiaries found');
      return res.json({
        beneficiaries: 0,
        nonBeneficiaries: 0
      });
    }

    // Count based on beneficiary_status
    const counts = results.reduce((acc, user) => {
      if (user.beneficiary_status === 'beneficiary') {
        acc.beneficiaries++;
      } else if (user.beneficiary_status === 'non-beneficiary') {
        acc.nonBeneficiaries++;
      }
      return acc;
    }, { beneficiaries: 0, nonBeneficiaries: 0 });

    console.log('Final beneficiary counts:', counts);
    res.json(counts);
  } catch (error) {
    console.error('Error fetching beneficiaries data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch beneficiaries data', 
      details: error.message,
      stack: error.stack 
    });
  }
});

// Add the application-status endpoint
app.get('/application-status', async (req, res) => {
  try {
    console.log('Fetching application status...');
    const { barangay, startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        u.status,
        COUNT(*) as count,
        MAX(
          CASE 
            WHEN u.status = 'Verified' THEN au.accepted_at
            WHEN u.status = 'Created' THEN au.accepted_at
            WHEN u.status = 'Pending Remarks' THEN ur.remarks_at
            WHEN u.status = 'Terminated' THEN tu.terminated_at
            WHEN u.status = 'Declined' THEN COALESCE(du.declined_at, u.created_at)
            WHEN u.status = 'Pending' THEN u.created_at
          END
        ) as latest_status_date
      FROM users u
      INNER JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN (
        SELECT user_id, MAX(accepted_at) as accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) au ON u.id = au.user_id
      LEFT JOIN (
        SELECT user_id, MAX(remarks_at) as remarks_at
        FROM user_remarks
        GROUP BY user_id
      ) ur ON u.id = ur.user_id
      LEFT JOIN (
        SELECT user_id, MAX(terminated_at) as terminated_at
        FROM terminated_users
        GROUP BY user_id
      ) tu ON u.id = tu.user_id
      LEFT JOIN (
        SELECT user_id, MAX(declined_at) as declined_at
        FROM declined_users
        GROUP BY user_id
      ) du ON u.id = du.user_id
      WHERE u.status IN ('Declined', 'Pending', 'Verified', 'Created', 'Pending Remarks', 'Terminated')
    `;

    const params = [];

    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      params.push(barangay);
    }

    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(
        CASE 
          WHEN u.status = 'Verified' THEN au.accepted_at
          WHEN u.status = 'Created' THEN au.accepted_at
          WHEN u.status = 'Pending Remarks' THEN ur.remarks_at
          WHEN u.status = 'Terminated' THEN tu.terminated_at
          WHEN u.status = 'Declined' THEN COALESCE(du.declined_at, u.created_at)
          WHEN u.status = 'Pending' THEN u.created_at
        END
      ) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    query += ` GROUP BY u.status`;
    
    console.log('Executing query:', query);
    console.log('Query params:', params);
    const results = await queryDatabase(query, params);
    console.log('Query results:', results);
    
    // Initialize counts
    const statusCounts = {
      declined: 0,
      pending: 0,
      accepted: 0
    };

    // Process results
    results.forEach(row => {
      if (row.status === 'Declined') {
        statusCounts.declined = row.count;
      } else if (row.status === 'Pending') {
        statusCounts.pending = row.count;
      } else if (row.status === 'Verified' || row.status === 'Created' || 
                 row.status === 'Pending Remarks' || row.status === 'Terminated') {
        statusCounts.accepted += row.count;  // Add all accepted-type statuses to accepted count
      }
    });
    
    res.json(statusCounts);
  } catch (error) {
    console.error('Error fetching application status:', error);
    res.status(500).json({ 
      error: 'Failed to fetch application status', 
      details: error.message,
      stack: error.stack 
    });
  }
});

app.get('/family-age-analytics', async (req, res) => {
  try {
    console.log('Fetching family member age analytics...');
    
    let query = `
      SELECT 
        f.age,
        COUNT(*) as count
      FROM step2_family_occupation f
      WHERE f.age IS NOT NULL AND f.age > 0 AND f.age < 120
      GROUP BY f.age 
      ORDER BY f.age
    `;
    
    console.log('Executing query:', query);
    const results = await queryDatabase(query);
    
    // Return the raw data directly
    res.json(results);
  } catch (error) {
    console.error('Error fetching family member age analytics:', error);
    res.status(500).json({ 
      error: 'Failed to fetch family member age analytics', 
      details: error.message,
      stack: error.stack 
    });
  }
});

// Add the users-age-data endpoint
app.get('/users-age-data', async (req, res) => {
  try {
    console.log('Fetching users age data...');
    const { barangay, startDate, endDate } = req.query;
    
    let query = `
      SELECT 
        u.id,
        u.code_id,
        s1.date_of_birth as birthdate,
        s1.age,
        s1.barangay,
        au.accepted_at
      FROM users u
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN (
        SELECT user_id, MAX(accepted_at) as accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) au ON u.id = au.user_id
      WHERE u.status = 'Verified' AND s1.date_of_birth IS NOT NULL
    `;

    const params = [];

    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      query += ` AND s1.barangay = ?`;
      params.push(barangay);
    }

    // Add date range filter if specified
    if (startDate && endDate) {
      query += ` AND DATE(au.accepted_at) BETWEEN ? AND ?`;
      params.push(startDate, endDate);
    }

    query += ` ORDER BY s1.age ASC`;
    
    console.log('Executing query:', query);
    console.log('Query params:', params);
    const results = await queryDatabase(query, params);
    
    if (!results || results.length === 0) {
      console.log('No users with age data found');
      return res.json([]);
    }

    console.log(`Found ${results.length} users with age data`);
    res.json(results);
  } catch (error) {
    console.error('Error fetching users age data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch users age data', 
      details: error.message,
      stack: error.stack 
    });
  }
});

// Endpoint to get children count data for solo parents
app.get('/children-count-data-superadmin', async (req, res) => {
  try {
    console.log('Fetching children count data for solo parents...');
    const { barangay, startDate, endDate } = req.query;
    
    // First, get all verified users with their code_ids
    let userQuery = `
      SELECT 
        u.id,
        u.code_id,
        s1.barangay,
        au.accepted_at
      FROM users u
      LEFT JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
      LEFT JOIN (
        SELECT user_id, MAX(accepted_at) as accepted_at
        FROM accepted_users
        GROUP BY user_id
      ) au ON u.id = au.user_id
      WHERE u.status = 'Verified'
    `;

    const userParams = [];

    // Add barangay filter if specified
    if (barangay && barangay !== 'All') {
      userQuery += ` AND s1.barangay = ?`;
      userParams.push(barangay);
    }

    // Add date range filter if specified
    if (startDate && endDate) {
      userQuery += ` AND DATE(au.accepted_at) BETWEEN ? AND ?`;
      userParams.push(startDate, endDate);
    }
    
    const users = await queryDatabase(userQuery, userParams);
    
    if (!users || users.length === 0) {
      console.log('No verified users found');
      return res.json({ childrenCountDistribution: [] });
    }
    
    // Get code_ids of all verified users
    const codeIds = users.map(user => user.code_id);
    
    // Now get family members for these users
    const familyQuery = `
      SELECT 
        code_id,
        COUNT(*) as children_count
      FROM step2_family_occupation
      WHERE code_id IN (?)
      GROUP BY code_id
    `;
    
    const familyMembers = await queryDatabase(familyQuery, [codeIds]);

    // Create a distribution of children counts
    const childrenCountMap = {};
    
    // Initialize with 0 children (solo parents with no children in the system)
    childrenCountMap['0'] = codeIds.length - familyMembers.length;
    
    // Count frequency of each children count
    familyMembers.forEach(family => {
      const count = family.children_count.toString();
      if (childrenCountMap[count]) {
        childrenCountMap[count]++;
      } else {
        childrenCountMap[count] = 1;
      }
    });
    
    // Convert to array format for the frontend
    const childrenCountDistribution = Object.entries(childrenCountMap)
      .map(([count, frequency]) => ({ count, frequency }))
      .sort((a, b) => parseInt(a.count) - parseInt(b.count));
    
    console.log(`Found children count distribution for ${users.length} users`);
    res.json({ childrenCountDistribution });
  } catch (error) {
    console.error('Error fetching children count data:', error);
    res.status(500).json({ 
      error: 'Failed to fetch children count data', 
      details: error.message,
      stack: error.stack 
    });
  }
});

app.post('/update-beneficiary-status', async (req, res) => {
  const { code_id, status } = req.body;
  
  // Validate required fields
  if (!code_id || !status) {
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['code_id', 'status']
    });
  }

  try {
    // First, get the user_id from the code_id
    const userQuery = await queryDatabase('SELECT id FROM users WHERE code_id = ?', [code_id]);
    
    if (!userQuery || userQuery.length === 0) {
      return res.status(404).json({ error: 'User not found with this code_id' });
    }
    
    const user_id = userQuery[0].id;
    
    // Get superadmin ID (using the first superadmin in the system for now)
    const superadminQuery = await queryDatabase('SELECT id FROM superadmin LIMIT 1');
    
    if (!superadminQuery || superadminQuery.length === 0) {
      return res.status(500).json({ error: 'No superadmin found in the system' });
    }
    
    const superadmin_id = superadminQuery[0].id;
    
    // Convert status to the format expected by the database
    const beneficiary_status = status.toLowerCase();
    
    // Validate beneficiary_status value
    if (!['beneficiary', 'non-beneficiary'].includes(beneficiary_status)) {
      return res.status(400).json({ 
        error: 'Invalid beneficiary_status',
        allowed_values: ['beneficiary', 'non-beneficiary']
      });
    }
    
    // Update beneficiary status
    const updateResult = await queryDatabase(
      'UPDATE users SET beneficiary_status = ? WHERE id = ?',
      [beneficiary_status, user_id]
    );
    
    if (updateResult.affectedRows === 0) {
      return res.status(500).json({ error: 'No rows updated - possible database error' });
    }
    
    res.json({ 
      success: true,
      message: `User beneficiary status updated to ${beneficiary_status}`,
      user_id,
      new_status: beneficiary_status
    });
    
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ 
      error: 'Database operation failed',
      details: err.message
    });
  }
});

app.post('/api/updateUserInformation', async (req, res) => {
  const { 
    userId, first_name, middle_name, last_name, suffix,
    gender, date_of_birth, place_of_birth, religion, civil_status, income, contact_number
  } = req.body;
  
  try {
    if (!userId) {
      return res.status(400).json({ error: 'Missing required field: userId' });
    }

    const userResult = await queryDatabase('SELECT code_id FROM users WHERE id = ?', [userId]);
    if (!userResult || userResult.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const code_id = userResult[0].code_id;

    const fieldsToUpdate = {
      first_name,
      middle_name,
      last_name,
      suffix,
      gender,
      date_of_birth,
      place_of_birth,
      religion,
      civil_status,
      income, // Assuming the column name in the DB is `income`
      contact_number
    };

    const updateFields = [];
    const updateValues = [];

    for (const [key, value] of Object.entries(fieldsToUpdate)) {
      if (value !== undefined && value !== null) {
        updateFields.push(`${key} = ?`);
        updateValues.push(value);
      }
    }

    if (updateFields.length > 0) {
      updateValues.push(code_id);
      const query = `UPDATE step1_identifying_information SET ${updateFields.join(', ')} WHERE code_id = ?`;
      await queryDatabase(query, updateValues);
    }
    
    res.status(200).json({ success: true, message: 'User information updated successfully' });
  } catch (err) {
    console.error('Error updating user information:', err);
    res.status(500).json({ error: 'Database error while updating user information' });
  }
});

// Add route for superadmin change password
app.post('/api/superadmin/change-password', async (req, res) => {
  let { superadminId, email, currentPassword, newPassword } = req.body;
  console.log('Received superadmin change password request for superadminId:', superadminId, 'email:', email);

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  // Ensure superadminId is treated as a number if it's a numeric string
  if (superadminId) {
    superadminId = Number(superadminId) || superadminId;
    console.log('Processed superadminId (after conversion):', superadminId, 'Type:', typeof superadminId);
  }

  try {
    let superadminResults = [];
    
    // First try to find superadmin by ID
    if (superadminId) {
      console.log('Trying to find superadmin by ID:', superadminId);
      const superadminByIdQuery = 'SELECT id, email, password FROM superadmin WHERE id = ?';
      console.log('SQL Query (by ID):', superadminByIdQuery, 'Params:', [superadminId]);
      
      superadminResults = await queryDatabase(superadminByIdQuery, [superadminId]);
      console.log('Query results by ID:', JSON.stringify(superadminResults, null, 2));
    }
    
    // If not found by ID and email is provided, try to find by email
    if ((!superadminResults || superadminResults.length === 0) && email) {
      console.log('Superadmin not found by ID, trying email:', email);
      const superadminByEmailQuery = 'SELECT id, email, password FROM superadmin WHERE email = ?';
      console.log('SQL Query (by email):', superadminByEmailQuery, 'Params:', [email]);
      
      superadminResults = await queryDatabase(superadminByEmailQuery, [email]);
      console.log('Query results by email:', JSON.stringify(superadminResults, null, 2));
    }
    
    // Still not found
    if (!superadminResults || superadminResults.length === 0) {
      console.log('Superadmin not found with ID:', superadminId, 'or email:', email);
      return res.status(404).json({ message: 'Superadmin not found' });
    }

    const superadmin = superadminResults[0];
    console.log('Found superadmin:', JSON.stringify(superadmin, null, 2));
    const storedPassword = superadmin.password;
    console.log('Current password in DB:', storedPassword);
    console.log('Provided current password:', currentPassword);

    // Compare current password (simple string comparison)
    if (storedPassword !== currentPassword) {
      console.log('Password mismatch for superadmin:', superadmin.id);
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    // Prevent using the same password
    if (currentPassword === newPassword) {
      console.log('Superadmin attempted to reuse the same password:', superadmin.id);
      return res.status(400).json({ message: 'New password must be different from your current password' });
    }

    // Set superadminId to the one we found in the database
    superadminId = superadmin.id;

    // Update the password
    console.log('Updating password for superadmin:', superadminId);
    const updateQuery = 'UPDATE superadmin SET password = ? WHERE id = ?';
    console.log('Update SQL Query:', updateQuery, 'Params:', [newPassword, superadminId]);
    
    const updateResult = await queryDatabase(updateQuery, [newPassword, superadminId]);
    
    console.log('Password update result:', JSON.stringify(updateResult, null, 2));
    
    if (updateResult && updateResult.affectedRows > 0) {
      console.log('Password successfully updated for superadmin:', superadminId);
      return res.status(200).json({ message: 'Password updated successfully' });
    } else {
      console.log('No rows affected when updating password for superadmin:', superadminId);
      return res.status(500).json({ message: 'Failed to update password' });
    }
  } catch (error) {
    console.error('Error changing superadmin password:', error);
    res.status(500).json({ message: 'Server error', details: error.message });
  }
});

// Change password for admin
app.post('/api/admins/change-password', async (req, res) => {
  const { adminId, currentPassword, newPassword } = req.body;

  if (!adminId || !currentPassword || !newPassword) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // Get current password from admin table
    const admins = await queryDatabase('SELECT password FROM admin WHERE id = ?', [adminId]);
    if (!admins || admins.length === 0) {
      return res.status(404).json({ message: 'Admin not found' });
    }
    const admin = admins[0];
    if (admin.password !== currentPassword) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ message: 'New password must be different from your current password' });
    }
    // Update password
    await queryDatabase('UPDATE admin SET password = ? WHERE id = ?', [newPassword, adminId]);
    res.status(200).json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Error changing admin password:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

app.post('/updateUserStatusAdmin', async (req, res) => {
  const { code_id, approval } = req.body;

  if (!code_id || !approval) {
    return res.status(400).json({ success: false, error: 'Missing code_id or approval value' });
  }

  try {
    // Update approval
    const result = await queryDatabase(
      'UPDATE users SET approval = ? WHERE code_id = ?',
      [approval, code_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, error: 'User/application not found' });
    }

    // Get user_id and barangay for notification (join step1_identifying_information)
    const [userInfo] = await queryDatabase(
      `SELECT u.id, s1.barangay
       FROM users u
       JOIN step1_identifying_information s1 ON u.code_id = s1.code_id
       WHERE u.code_id = ?`,
      [code_id]
    );

    if (userInfo) {
      // Insert notification for superadmin
      await queryDatabase(
        'INSERT INTO superadminnotifications (user_id, notif_type, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())',
        [
          userInfo.id,
          'admin_approved',
          `Admin from ${userInfo.barangay} approved an application.`
        ]
      );
    }

    res.json({ success: true, message: 'Approval updated and superadmin notified.' });
  } catch (err) {
    console.error('Error updating approval:', err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// In your server.js or routes file
app.post('/newchildrequest', async (req, res) => {
  const {
    code_id,
    first_name,
    middle_name,
    last_name,
    suffix,
    birthdate,
    age,
    educational_attainment
  } = req.body;

  if (!code_id || !first_name || !last_name || !birthdate || !educational_attainment) {
    return res.status(400).json({ success: false, message: 'Missing required fields.' });
  }

  try {
    // Look up user_id from code_id
    const userResult = await queryDatabase('SELECT id FROM users WHERE code_id = ?', [code_id]);
    if (!userResult || userResult.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found for this code_id.' });
    }
    const user_id = userResult[0].id;

    // Get barangay from step1_identifying_information
    const barangayResult = await queryDatabase('SELECT barangay FROM step1_identifying_information WHERE code_id = ?', [code_id]);
    const barangay = barangayResult && barangayResult.length > 0 ? barangayResult[0].barangay : null;

    const sql = `
      INSERT INTO newchildrequest
        (code_id, first_name, middle_name, last_name, suffix, birthdate, age, educational_attainment, barangay, status, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', NOW())
    `;
    await queryDatabase(sql, [
      code_id,
      first_name,
      middle_name,
      last_name,
      suffix,
      birthdate,
      age,
      educational_attainment,
      barangay
    ]);

    // Notify admin of the same barangay
    if (barangay) {
      // Insert notification for admin
      const notifMessage = `A new child request has been submitted by a user in your barangay.`;
      await queryDatabase(
        'INSERT INTO adminnotifications (user_id, notif_type, message, barangay, is_read, created_at) VALUES (?, ?, ?, ?, 0, NOW())',
        [user_id, 'new_child_request', notifMessage, barangay]
      );
    }

    res.json({ success: true, message: 'Child request submitted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.get('/newchildrequest', async (req, res) => {
  try {
    const rows = await queryDatabase('SELECT * FROM newchildrequest ORDER BY requested_at DESC');
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST approve/decline
app.post('/newchildrequest/approve', async (req, res) => {
  const { id } = req.body;
  try {
    // 1. Approve the child request
    await queryDatabase('UPDATE newchildrequest SET status = ? WHERE id = ?', ['Approved', id]);

    // 2. Get code_id and user_id from the child request
    const [childRequest] = await queryDatabase('SELECT code_id FROM newchildrequest WHERE id = ?', [id]);
    if (!childRequest) {
      return res.status(404).json({ success: false, message: 'Child request not found.' });
    }
    const { code_id } = childRequest;
    const [user] = await queryDatabase('SELECT id FROM users WHERE code_id = ?', [code_id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user_id = user.id;

    // 3. Set user status to 'Pending Request'
    await queryDatabase('UPDATE users SET status = ? WHERE id = ?', ['Pending Request', user_id]);

    // 4. Send notification to the user (now using user_childrequest table)
    const notifMessage = 'Your child request has been accepted by your barangay and is now waiting for approval from the MSWDO.';
    await queryDatabase(
      'INSERT INTO user_childrequest (user_id, message_accepted, is_read) VALUES (?, ?, 0)',
      [user_id, notifMessage]
    );

    // 5. Notify superadmin
    const [barangayRow] = await queryDatabase('SELECT barangay FROM newchildrequest WHERE id = ?', [id]);
    const barangay = barangayRow ? barangayRow.barangay : 'Unknown';
    const superadminNotif = `A child request has been approved from barangay ${barangay}.`;
    await queryDatabase(
      'INSERT INTO superadminnotifications (user_id, notif_type, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())',
      [user_id, 'child_request_approved', superadminNotif]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});
app.post('/newchildrequest/decline', async (req, res) => {
  const { id } = req.body;
  try {
    // Get code_id and user_id from the child request before deleting
    const [childRequest] = await queryDatabase('SELECT code_id FROM newchildrequest WHERE id = ?', [id]);
    if (childRequest) {
      const { code_id } = childRequest;
      const [user] = await queryDatabase('SELECT id FROM users WHERE code_id = ?', [code_id]);
      if (user) {
        const user_id = user.id;
        const notifMessage = 'Sorry that your barangay admin has declined your request.';
        await queryDatabase(
          'INSERT INTO user_childrequest (user_id, message_accepted, is_read) VALUES (?, ?, 0)',
          [user_id, notifMessage]
        );
      }
    }
    // Delete the request
    await queryDatabase('DELETE FROM newchildrequest WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.get('/newchildrequest/by-code-id', async (req, res) => {
  const { code_id } = req.query;
  if (!code_id) {
    return res.status(400).json({ success: false, message: 'Missing code_id parameter.' });
  }
  try {
    const rows = await queryDatabase('SELECT * FROM newchildrequest WHERE code_id = ? ORDER BY requested_at DESC', [code_id]);
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.get('/newchildrequest/by-barangay', async (req, res) => {
  const { barangay } = req.query;
  if (!barangay) {
    return res.status(400).json({ success: false, message: 'Missing barangay parameter.' });
  }
  try {
    const rows = await queryDatabase('SELECT * FROM newchildrequest WHERE barangay = ? ORDER BY requested_at DESC', [barangay]);
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Endpoint to get all child request notifications for a user
app.get('/api/user-childrequest/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Missing userId parameter.' });
  }
  try {
    const rows = await queryDatabase('SELECT * FROM user_childrequest WHERE user_id = ? ORDER BY created_at DESC', [userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Mark all user_childrequest notifications as read for a user
app.put('/api/user-childrequest/mark-all-as-read/:userId', async (req, res) => {
  const { userId } = req.params;
  if (!userId) {
    return res.status(400).json({ success: false, message: 'Missing userId parameter.' });
  }
  try {
    await queryDatabase('UPDATE user_childrequest SET is_read = 1 WHERE user_id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.get('/newchildrequest/all', async (req, res) => {
  try {
    const rows = await queryDatabase('SELECT * FROM newchildrequest ORDER BY requested_at DESC');
    res.json({ success: true, requests: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.post('/newchildrequest/superadmin-approve', async (req, res) => {
  const { id } = req.body;
  try {
    // 1. Get all child request data
    const [childRequest] = await queryDatabase('SELECT * FROM newchildrequest WHERE id = ?', [id]);
    if (!childRequest) {
      return res.status(404).json({ success: false, message: 'Child request not found.' });
    }
    const { code_id, first_name, middle_name, last_name, suffix, age, educational_attainment, birthdate } = childRequest;
    const [user] = await queryDatabase('SELECT id FROM users WHERE code_id = ?', [code_id]);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const user_id = user.id;

    // 2. Insert child into step2_family_occupation
    const family_member_name = `${first_name} ${middle_name ? middle_name + ' ' : ''}${last_name}${suffix ? ' ' + suffix : ''}`.trim();
    await queryDatabase(
      'INSERT INTO step2_family_occupation (code_id, family_member_name, age, educational_attainment, birthdate) VALUES (?, ?, ?, ?, ?)',
      [code_id, family_member_name, age, educational_attainment, birthdate]
    );

    // 3. Set user status to 'Verified'
    await queryDatabase('UPDATE users SET status = ? WHERE id = ?', ['Verified', user_id]);

    // 4. Send notification to the user (now using user_childrequest table)
    const notifMessage = 'Your child request has been approved by the MSWDO.';
    await queryDatabase(
      'INSERT INTO user_childrequest (user_id, message_accepted, is_read) VALUES (?, ?, 0)',
      [user_id, notifMessage]
    );

    // 5. Delete the child request from the table
    await queryDatabase('DELETE FROM newchildrequest WHERE id = ?', [id]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.post('/newchildrequest/superadmin-decline', async (req, res) => {
  const { id } = req.body;
  try {
    // Get code_id and user_id from the child request before deleting
    const [childRequest] = await queryDatabase('SELECT code_id FROM newchildrequest WHERE id = ?', [id]);
    if (childRequest) {
      const { code_id } = childRequest;
      const [user] = await queryDatabase('SELECT id FROM users WHERE code_id = ?', [code_id]);
      if (user) {
        const user_id = user.id;
        // Set user status to 'Verified' even on decline
        await queryDatabase('UPDATE users SET status = ? WHERE id = ?', ['Verified', user_id]);
        const notifMessage = 'Sorry, your child request has been declined by the MSWDO.';
        await queryDatabase(
          'INSERT INTO user_childrequest (user_id, message_accepted, is_read) VALUES (?, ?, 0)',
          [user_id, notifMessage]
        );
      }
    }
    // Delete the request from the table
    await queryDatabase('DELETE FROM newchildrequest WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// --- EXPORT LIMITS ENDPOINTS ---

// GET export limit for admin
app.get('/api/export-limit/:adminId', async (req, res) => {
  const { adminId } = req.params;
  try {
    // Check if admin exists in export_limits table
    const [exportLimit] = await queryDatabase('SELECT * FROM export_limits WHERE admin_id = ?', [adminId]);
    
    if (!exportLimit) {
      // If no record exists, create one with default values
      await queryDatabase(
        'INSERT INTO export_limits (admin_id, export_count, excel_count, pdf_count, last_export_date) VALUES (?, 0, 0, 0, NULL)',
        [adminId]
      );
      return res.json({ 
        success: true, 
        exportCount: 0,
        excelCount: 0,
        pdfCount: 0,
        lastExportDate: null,
        canExport: true,
        canExportExcel: true,
        canExportPdf: true
      });
    }
    
    // Check if it's a new day (reset export count)
    const today = new Date().toDateString();
    const lastExportDate = exportLimit.last_export_date ? new Date(exportLimit.last_export_date).toDateString() : null;
    
    if (lastExportDate !== today) {
      // Reset export count for new day
      await queryDatabase(
        'UPDATE export_limits SET export_count = 0, excel_count = 0, pdf_count = 0, last_export_date = NULL WHERE admin_id = ?',
        [adminId]
      );
      return res.json({ 
        success: true, 
        exportCount: 0,
        excelCount: 0,
        pdfCount: 0,
        lastExportDate: null,
        canExport: true,
        canExportExcel: true,
        canExportPdf: true
      });
    }
    
    const canExportExcel = (exportLimit.excel_count ?? 0) < 5; // Max 5 Excel exports per day
    const canExportPdf = (exportLimit.pdf_count ?? 0) < 5; // Max 5 PDF exports per day
    const canExport = canExportExcel || canExportPdf; // Can export if either type is available
    
    res.json({ 
      success: true, 
      exportCount: exportLimit.export_count, 
      excelCount: exportLimit.excel_count ?? 0,
      pdfCount: exportLimit.pdf_count ?? 0,
      lastExportDate: exportLimit.last_export_date,
      canExport,
      canExportExcel,
      canExportPdf
    });
  } catch (err) {
    console.error('Error fetching export limit:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST increment export count for admin (supports type: excel | pdf)
app.post('/api/export-limit/increment/:adminId', async (req, res) => {
  const { adminId } = req.params;
  const { type } = req.body; // 'excel' | 'pdf'
  try {
    // Check if admin exists in export_limits table
    const [exportLimit] = await queryDatabase('SELECT * FROM export_limits WHERE admin_id = ?', [adminId]);
    
    if (!exportLimit) {
      // Create new record with export count = 1 and type count = 1
      await queryDatabase(
        'INSERT INTO export_limits (admin_id, export_count, excel_count, pdf_count, last_export_date) VALUES (?, 1, ?, ?, NOW())',
        [adminId, type === 'excel' ? 1 : 0, type === 'pdf' ? 1 : 0]
      );
    } else {
      // Check if it's a new day
      const today = new Date().toDateString();
      const lastExportDate = exportLimit.last_export_date ? new Date(exportLimit.last_export_date).toDateString() : null;
      
      if (lastExportDate !== today) {
        // Reset for new day and increment
        const excelInc = type === 'excel' ? 1 : 0;
        const pdfInc = type === 'pdf' ? 1 : 0;
        await queryDatabase(
          'UPDATE export_limits SET export_count = 1, excel_count = ?, pdf_count = ?, last_export_date = NOW() WHERE admin_id = ?',
          [excelInc, pdfInc, adminId]
        );
      } else {
        // Increment existing counts
        if (type === 'excel') {
          await queryDatabase(
            'UPDATE export_limits SET export_count = export_count + 1, excel_count = excel_count + 1, last_export_date = NOW() WHERE admin_id = ?',
            [adminId]
          );
        } else if (type === 'pdf') {
          await queryDatabase(
            'UPDATE export_limits SET export_count = export_count + 1, pdf_count = pdf_count + 1, last_export_date = NOW() WHERE admin_id = ?',
            [adminId]
          );
        } else {
          // Fallback: increment only total
          await queryDatabase(
            'UPDATE export_limits SET export_count = export_count + 1, last_export_date = NOW() WHERE admin_id = ?',
            [adminId]
          );
        }
      }
    }
    
    // Get updated export limit
    const [updatedLimit] = await queryDatabase('SELECT * FROM export_limits WHERE admin_id = ?', [adminId]);
    
    res.json({ 
      success: true, 
      exportCount: updatedLimit.export_count,
      excelCount: updatedLimit.excel_count ?? 0,
      pdfCount: updatedLimit.pdf_count ?? 0,
      lastExportDate: updatedLimit.last_export_date,
      canExport: (updatedLimit.excel_count ?? 0) < 5 || (updatedLimit.pdf_count ?? 0) < 5,
      canExportExcel: (updatedLimit.excel_count ?? 0) < 5,
      canExportPdf: (updatedLimit.pdf_count ?? 0) < 5
    });
  } catch (err) {
    console.error('Error incrementing export count:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET all export limits (for super admin monitoring)
app.get('/api/export-limits/all', async (req, res) => {
  try {
    const exportLimits = await queryDatabase(`
      SELECT 
        el.*,
        a.barangay,
        a.first_name,
        a.last_name
      FROM export_limits el
      LEFT JOIN admins a ON el.admin_id = a.id
      ORDER BY el.updated_at DESC
    `);
    
    res.json({ success: true, exportLimits });
  } catch (err) {
    console.error('Error fetching all export limits:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST reset export limit for specific admin (for super admin)
app.post('/api/export-limits/reset/:adminId', async (req, res) => {
  const { adminId } = req.params;
  try {
    await queryDatabase(
      'UPDATE export_limits SET export_count = 0, excel_count = 0, pdf_count = 0, last_export_date = NULL WHERE admin_id = ?',
      [adminId]
    );
    
    res.json({ success: true, message: 'Export limit reset successfully' });
  } catch (err) {
    console.error('Error resetting export limit:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST reset all export limits (for super admin)
app.post('/api/export-limits/reset-all', async (req, res) => {
  try {
    await queryDatabase('UPDATE export_limits SET export_count = 0, excel_count = 0, pdf_count = 0, last_export_date = NULL');
    
    res.json({ success: true, message: 'All export limits reset successfully' });
  } catch (err) {
    console.error('Error resetting all export limits:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

