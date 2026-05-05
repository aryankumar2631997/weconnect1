require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads', { recursive: true });
}

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const deptFolder = path.join('uploads', req.body.department || 'general');
    if (!fs.existsSync(deptFolder)) {
      fs.mkdirSync(deptFolder, { recursive: true });
    }
    cb(null, deptFolder);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG, WEBP) are allowed!'));
    }
  }
});

// Google Sheets & Drive Authentication
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.file',
  ],
});

const sheets = google.sheets({ version: 'v4', auth });
const drive = google.drive({ version: 'v3', auth });

// Google Sheets ID
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

// Sheet names for each department
const SHEET_NAMES = {
  doctor: 'Doctor_Hospital',
  banquet: 'Hotel_Banquet',
  transport: 'Transport',
  school: 'School_Tuition',
  marriage: 'Marriage_Event',
  local: 'Local_Services',
  general: 'General_Merchants'
};

// Initialize Google Sheets with headers
async function initializeSheets() {
  try {
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });

    const existingSheets = spreadsheet.data.sheets.map(s => s.properties.title);

    // Doctor Sheet Headers
    const doctorHeaders = [
      'ID', 'Timestamp', 'Hospital Name', 'Doctor Name', 'Phone', 'Address', 'Landmark',
      'Timing', 'Specialization', 'Qualification', 'Experience', 'Fee',
      'OPD', 'Emergency', 'Surgery', 'Maternity', 'Lab', 'X-Ray',
      'Appointment Required', '24/7 Emergency', 'Max Patients',
      'GPS Location', 'Photo Links', 'WhatsApp Share Link'
    ];

    // Banquet Sheet Headers
    const banquetHeaders = [
      'ID', 'Timestamp', 'Hotel Name', 'Owner Name', 'Phone', 'Address',
      'Room Types', 'Price/Night', 'Availability', 'Banquet Hall', 'Capacity',
      'Marriage/Party', 'Food Available', 'Catering Included',
      'Advance Required', 'Check-in/out', 'GPS Location', 'Photo Links', 'WhatsApp Share Link'
    ];

    // Transport Headers
    const transportHeaders = [
      'ID', 'Timestamp', 'Driver Name', 'Vehicle Type', 'Phone', 'Location',
      'Vehicle Number', 'AC/Non-AC', 'Seating', 'Per Km Rate', 'Min Charge',
      'Local/Outstation', 'Working Hours', 'Instant Available',
      'GPS Location', 'Photo Links', 'WhatsApp Share Link'
    ];

    // School Headers
    const schoolHeaders = [
      'ID', 'Timestamp', 'Institute Name', 'Principal', 'Phone', 'Address',
      'Classes', 'Board', 'Medium', 'Admission Fee', 'Monthly Fee',
      'Seats', 'Admission Open', 'Contact Person',
      'GPS Location', 'Photo Links', 'WhatsApp Share Link'
    ];

    // Marriage Headers
    const marriageHeaders = [
      'ID', 'Timestamp', 'Venue Name', 'Owner', 'Phone', 'Address',
      'Hall Capacity', 'Indoor/Outdoor', 'Decoration', 'Catering', 'Photography',
      'Basic Price', 'Premium Price', 'Advance Required', 'Cancellation Policy',
      'GPS Location', 'Photo Links', 'WhatsApp Share Link'
    ];

    // Local Services Headers
    const localHeaders = [
      'ID', 'Timestamp', 'Provider Name', 'Phone', 'Location', 'Skill Type',
      'Per Visit Charge', 'Emergency Charge', 'Emergency Service', 'Working Hours',
      'Service Radius', 'GPS Location', 'Photo Links', 'WhatsApp Share Link'
    ];

    const headersMap = {
      'Doctor_Hospital': doctorHeaders,
      'Hotel_Banquet': banquetHeaders,
      'Transport': transportHeaders,
      'School_Tuition': schoolHeaders,
      'Marriage_Event': marriageHeaders,
      'Local_Services': localHeaders,
      'General_Merchants': ['ID', 'Timestamp', 'Name', 'Phone', 'Address', 'Category', 'Working Hours', 'GPS Location', 'Photo Links', 'WhatsApp Share Link']
    };

    // Create sheets if they don't exist and add headers
    for (const [sheetName, headers] of Object.entries(headersMap)) {
      if (!existingSheets.includes(sheetName)) {
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId: SHEET_ID,
          requestBody: {
            requests: [{
              addSheet: {
                properties: { title: sheetName }
              }
            }]
          }
        });

        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${sheetName}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [headers] }
        });
        console.log(`✅ Created sheet: ${sheetName}`);
      }
    }
  } catch (error) {
    console.error('Error initializing sheets:', error.message);
  }
}

// Upload photo to Google Drive
async function uploadToDrive(filePath, fileName, folderId) {
  try {
    const response = await drive.files.create({
      requestBody: {
        name: fileName,
        parents: [folderId],
        mimeType: 'image/jpeg',
      },
      media: {
        mimeType: 'image/jpeg',
        body: fs.createReadStream(filePath),
      },
      fields: 'id, webViewLink, webContentLink',
    });

    // Make file publicly accessible
    await drive.permissions.create({
      fileId: response.data.id,
      requestBody: {
        role: 'reader',
        type: 'anyone',
      },
    });

    return {
      id: response.data.id,
      viewLink: response.data.webViewLink,
      downloadLink: response.data.webContentLink,
    };
  } catch (error) {
    console.error('Error uploading to Drive:', error.message);
    return null;
  }
}

// Append data to Google Sheet
async function appendToSheet(sheetName, rowData) {
  try {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${sheetName}!A:Z`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [rowData] },
    });
  } catch (error) {
    console.error('Error appending to sheet:', error.message);
  }
}

// Generate WhatsApp share link
function generateWhatsAppLink(data, department) {
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const viewUrl = `${baseUrl}/view/${data.id}`;
  const message = encodeURIComponent(
    `📋 *New ${department.toUpperCase()} Registration*\n\n` +
    `View full details: ${viewUrl}\n\n` +
    `Submitted: ${data.timestamp}`
  );
  return `https://wa.me/?text=${message}`;
}

// Main registration endpoint
app.post('/api/register', upload.array('photos', 3), async (req, res) => {
  try {
    const department = req.body.department || 'general';
    const sheetName = SHEET_NAMES[department] || 'General_Merchants';
    const timestamp = new Date().toISOString();
    const id = uuidv4();

    // Upload photos to Google Drive
    const photoLinks = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const driveLink = await uploadToDrive(file.path, file.filename, DRIVE_FOLDER_ID);
        if (driveLink) {
          photoLinks.push(driveLink.viewLink);
        }
        // Clean up local file after upload
        fs.unlink(file.path, (err) => {
          if (err) console.error('Error deleting file:', err);
        });
      }
    }

    // Build GPS location string
    const gpsLocation = req.body.lat && req.body.lng 
      ? `https://maps.google.com/?q=${req.body.lat},${req.body.lng}`
      : 'Not captured';

    // Prepare row data based on department
    let rowData = [];
    
    switch (department) {
      case 'doctor':
        rowData = [
          id, timestamp,
          req.body.hospitalName, req.body.doctorName, req.body.phone,
          req.body.address, req.body.landmark, req.body.timing,
          req.body.specialization, req.body.qualification, req.body.experience, req.body.fee,
          req.body.opd, req.body.emergency, req.body.surgery,
          req.body.maternity, req.body.lab, req.body.xray,
          req.body.appointment, req.body.emergencyAvail, req.body.maxPatients,
          gpsLocation, photoLinks.join(', '),
          generateWhatsAppLink({ id, timestamp }, department)
        ];
        break;
      
      case 'banquet':
        rowData = [
          id, timestamp,
          req.body.hotelName, req.body.owner, req.body.phone, req.body.address,
          req.body.roomTypes, req.body.priceNight, req.body.availability,
          req.body.banquetHall, req.body.capacity,
          req.body.marriage, req.body.food, req.body.catering,
          req.body.advance, req.body.checkInOut,
          gpsLocation, photoLinks.join(', '),
          generateWhatsAppLink({ id, timestamp }, department)
        ];
        break;
      
      case 'transport':
        rowData = [
          id, timestamp,
          req.body.driverName, req.body.vehicleType, req.body.phone, req.body.location,
          req.body.vehicleNum, req.body.ac, req.body.seating,
          req.body.perKm, req.body.minCharge,
          req.body.localOut, req.body.workingHours, req.body.instant,
          gpsLocation, photoLinks.join(', '),
          generateWhatsAppLink({ id, timestamp }, department)
        ];
        break;
      
      case 'school':
        rowData = [
          id, timestamp,
          req.body.name, req.body.principal, req.body.phone, req.body.address,
          req.body.classes, req.body.board, req.body.medium,
          req.body.admissionFee, req.body.monthlyFee,
          req.body.seats, req.body.admissionOpen, req.body.contactPerson,
          gpsLocation, photoLinks.join(', '),
          generateWhatsAppLink({ id, timestamp }, department)
        ];
        break;
      
      case 'marriage':
        rowData = [
          id, timestamp,
          req.body.venueName, req.body.owner, req.body.phone, req.body.address,
          req.body.hallCapacity, req.body.indoorOutdoor,
          req.body.decoration, req.body.catering, req.body.photography,
          req.body.basicPrice, req.body.premiumPrice,
          req.body.advance, req.body.cancellation,
          gpsLocation, photoLinks.join(', '),
          generateWhatsAppLink({ id, timestamp }, department)
        ];
        break;
      
      case 'local':
        rowData = [
          id, timestamp,
          req.body.name, req.body.phone, req.body.location, req.body.skill,
          req.body.perVisit, req.body.emergencyCharge,
          req.body.emergencyService, req.body.workingHours, req.body.radius,
          gpsLocation, photoLinks.join(', '),
          generateWhatsAppLink({ id, timestamp }, department)
        ];
        break;
      
      default:
        rowData = [
          id, timestamp,
          req.body.name, req.body.phone, req.body.address,
          req.body.category, req.body.workingHours,
          gpsLocation, photoLinks.join(', '),
          generateWhatsAppLink({ id, timestamp }, department)
        ];
    }

    // Append to Google Sheet
    await appendToSheet(sheetName, rowData);

    // Send success response
    res.json({
      success: true,
      message: 'Registration submitted successfully!',
      data: {
        id,
        timestamp,
        photoLinks,
        sheetName,
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error submitting registration',
      error: error.message
    });
  }
});

// View submission endpoint
app.get('/view/:id', async (req, res) => {
  try {
    const { id } = req.params;
    // Search all sheets for the ID
    const spreadsheet = await sheets.spreadsheets.get({
      spreadsheetId: SHEET_ID,
    });

    let foundData = null;
    
    for (const sheet of spreadsheet.data.sheets) {
      const sheetName = sheet.properties.title;
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${sheetName}!A:Z`,
      });

      const rows = response.data.values || [];
      const headers = rows[0];
      const dataRows = rows.slice(1);

      for (const row of dataRows) {
        if (row[0] === id) {
          foundData = { sheetName, headers, data: row };
          break;
        }
      }
      if (foundData) break;
    }

    if (foundData) {
      // Create HTML view
      let html = '<html><head><style>body{font-family:Arial;padding:20px;max-width:800px;margin:auto}table{width:100%;border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}th{background:#f0f4ff;text-align:left}</style></head><body>';
      html += `<h2>📋 ${foundData.sheetName.replace(/_/g, ' ')} Registration</h2>`;
      html += '<table>';
      foundData.headers.forEach((header, i) => {
        if (header !== 'ID') {
          html += `<tr><th>${header}</th><td>${foundData.data[i] || 'N/A'}</td></tr>`;
        }
      });
      html += '</table></body></html>';
      res.send(html);
    } else {
      res.status(404).send('Registration not found');
    }
  } catch (error) {
    res.status(500).send('Error retrieving data');
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, async () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  await initializeSheets();
});