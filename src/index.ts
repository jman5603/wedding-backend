import express from 'express';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';
import { sendRsvpConfirmation, sendEmail } from './email';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

const dbConfig = {
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.NODE_ENV === 'production' 
    ? '/cloudsql/' + process.env.DB_INSTANCE_CONNECTION_NAME 
    : process.env.DB_HOST || 'localhost',
  port: process.env.NODE_ENV === 'production' 
    ? undefined 
    : parseInt(process.env.DB_PORT || '5432'),
};

const pool = new pg.Pool(dbConfig);

// Stripe setup
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const calculateOrderAmount = (items: any[]) => {
  // Calculate the order total on the server to prevent
  // people from directly manipulating the amount on the client
  let total = 0;
  items.forEach((item) => {
    total += item.amount;
  });
  return total;
};

app.use(express.json());

// Enable CORS for React frontend (localhost in dev, julietteandjacob.com in prod)
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:8080',
      'https://julietteandjacob.com',
      'https://www.julietteandjacob.com',
    ];
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));


const JWT_SECRET = process.env.JWT_SECRET || 'jwt_secret_key';

const MASTER_PASSWORD = process.env.WEBSITE_PASSWORD;

interface Donor {
  type: 'anonymous' | 'named';
  firstName?: string;
  lastName?: string;
}

// Middleware to check JWT

interface AuthPayload {
  isAuthenticated: boolean;
  iat?: number;
  exp?: number;
}

function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.sendStatus(403);
    (req as any).user = user as AuthPayload;
    next();
  });
}

// --- API Endpoints ---


// POST /api/login: Validate password and return JWT
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === MASTER_PASSWORD) {
    const token = jwt.sign({ isAuthenticated: true }, JWT_SECRET, { expiresIn: '1d' });
    return res.status(200).json({ message: 'Login successful', token: token });
  }
  return res.status(401).json({ message: 'Invalid password' });
});

// GET /api/status: Check if the user is authenticated
app.get('/api/status', authenticateToken, (req, res) => {
  return res.status(200).json({ isAuthenticated: true });
});


// POST /api/logout: (optional, just for frontend compatibility)
app.post('/api/logout', (req, res) => {
  // With JWT, logout is handled on the client by deleting the token
  return res.status(200).json({ message: 'Logout successful' });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!MASTER_PASSWORD) {
    console.warn('Warning: MASTER_PASSWORD is not set. Please set it in your .env file.');
  }
});

// Stripe integration

app.post("/create-payment-intent", async (req, res) => {
  const { donor, items } = req.body;

  const metadata: { [key: string]: string } = {
      product_type: 'honeymoon_fund',
      donor_type: donor.type, // 'anonymous' or 'named'
    };

  if (donor.type === 'named') {
      metadata.firstName = donor.firstName;
      metadata.lastName = donor.lastName;
      metadata.fullName = `${donor.firstName} ${donor.lastName}`;
    }

  // Create a PaymentIntent with the order amount and currency
  const paymentIntent = await stripe.paymentIntents.create({
    amount: calculateOrderAmount(items),
    currency: "usd",
    automatic_payment_methods: {
      enabled: true,
    },
    metadata: metadata,
    description: donor.type === 'anonymous' 
        ? 'Honeymoon Fund Contribution (Anonymous)'
        : `Honeymoon Fund Contribution from ${donor.firstName} ${donor.lastName}`,
  });

  res.send({
    clientSecret: paymentIntent.client_secret,
  });
});

// Database calls
app.get('/api/items', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM items');
    res.json(result.rows);
    client.release();
  } catch (err) {
    console.error('Error fetching items:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Add 1 to amount purchased for item with given id
app.post('/api/purchase', async (req, res) => {
  const { itemId } = req.body;
  const id = Number(itemId);
  if (!Number.isInteger(id)) {
    return res.status(400).json({ message: 'itemId must be an integer' });
  }

  try {
    const client = await pool.connect();
    const result = await client.query('UPDATE items SET amount_purchased = amount_purchased + 1 WHERE id = $1 RETURNING *', [id]);
    client.release();

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Item not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating item:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/rsvp', async (req, res) => {
  let { name } = req.body;
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ message: 'characters to search are required' });
  }

  // Basic sanitization: trim, limit length, and remove unexpected characters
  name = name.trim().slice(0, 100);
  // Allow letters, numbers, spaces, hyphens, apostrophes
  const safeName = name.replace(/[^\p{L}\p{N}\s\-']/gu, '');
  const param = `%${safeName}%`;

  try {
    const client = await pool.connect();
    const result = await client.query(
      "SELECT * FROM guests WHERE first_name ILIKE $1 OR last_name ILIKE $1",
      [param]
    );
    client.release();

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No guests found' });
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error retrieving rsvp results: ', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/submit-rsvp', async (req, res) => {
  const { guests } = req.body;
  if (!Array.isArray(guests) || guests.length === 0) {
    return res.status(400).json({ message: 'guests array is required' });
  }

  try {
    const client = await pool.connect();
    const results: any[] = [];
    const updatedGuests: any[] = [];
    let primaryGuest: { email?: string; name?: string } | null = null;

    for (let i = 0; i < guests.length; i++) {
      const guest = guests[i];
      const guestId = Number(guest.id);
      const attending = guest.is_attending;
      const email = typeof guest.email === 'string' ? guest.email.slice(0, 255) : null;
      const mealChoice = typeof guest.meal_choice === 'string' ? guest.meal_choice.slice(0, 100) : null;
      const dietaryRestrictions = typeof guest.dietary_restrictions === 'string' ? guest.dietary_restrictions.slice(0, 255) : null;

      if (!Number.isInteger(guestId) || attending === undefined) {
        results.push({ guestId: guest.guestId, success: false, message: 'guestId (int) and attending are required' });
        continue;
      }

      const result = await client.query(
        `UPDATE guests
         SET is_attending = $1, email = $2, meal_choice = $3, dietary_restrictions = $4, rsvp_submitted = TRUE
         WHERE id = $5
         RETURNING *`,
        [attending, email, mealChoice, dietaryRestrictions, guestId]
      );

      if (result.rowCount === 0) {
        results.push({ guestId, success: false, message: 'Guest not found' });
      } else {
        const updatedGuest = result.rows[0];
        updatedGuests.push(updatedGuest);
        results.push({ guestId, success: true, guest: updatedGuest });

        // Detect primary guest flags but do not send email here; choose recipient after processing all guests
        const isPrimaryFlag = guest.isPrimary === true || guest.primary === true || guest.is_primary === true;
        if (!primaryGuest && isPrimaryFlag && updatedGuest.email) {
          primaryGuest = { email: updatedGuest.email, name: updatedGuest.first_name || updatedGuest.firstName || '' };
        }
      }
    }

    // Fallback: if no primary flagged, use first updated guest with an email
    if (!primaryGuest && updatedGuests.length > 0) {
      const firstWithEmail = updatedGuests.find(g => g.email);
      if (firstWithEmail) {
        primaryGuest = { email: firstWithEmail.email, name: firstWithEmail.first_name || firstWithEmail.firstName || '' };
      }
    }

    // Attempt to send one confirmation email summarizing all guests for the party
    let emailResult: any = { emailSent: false };
    if (primaryGuest && primaryGuest.email) {
      try {
        const to = primaryGuest.email;
        const subject = 'Your RSVP confirmation';

        // Build a detailed text summary for each guest
        const detailedLines = updatedGuests.map(g => {
          const fullName = `${(g.first_name || g.firstName || '').toString()} ${(g.last_name || g.lastName || '').toString()}`.trim() || 'Unnamed Guest';
          const emailAddr = g.email || 'N/A';
          const attending = g.attending ? 'Yes' : 'No';
          const meal = (g.meal_choice || g.mealChoice) || 'N/A';
          const dietary = (g.dietary_restrictions || g.dietaryRestrictions) || 'None';

          return `Name: ${fullName}\nEmail: ${emailAddr}\nAttending: ${attending}\nMeal choice: ${meal}\nDietary restrictions: ${dietary}`;
        });

        const text = `Hi ${primaryGuest.name || ''},\n\nThanks for RSVPing. Below are the selections for each guest in your party:\n\n${detailedLines.join('\n\n')}\n\nIf you need to change anything, reply to this email or visit the RSVP page.`;

        // Build an HTML table with full details
        const rowsHtml = updatedGuests.map(g => {
          const fullName = `${(g.first_name || g.firstName || '').toString()} ${(g.last_name || g.lastName || '').toString()}`.trim() || 'Unnamed Guest';
          const emailAddr = g.email || 'N/A';
          const attending = g.is_attending ? 'Yes' : 'No';
          const meal = (g.meal_choice || g.mealChoice) || 'N/A';
          const dietary = (g.dietary_restrictions || g.dietaryRestrictions) || 'None';

          return `<tr>
                    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(fullName)}</td>
                    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(emailAddr)}</td>
                    <td style="padding:8px;border:1px solid #ddd">${attending}</td>
                    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(meal)}</td>
                    <td style="padding:8px;border:1px solid #ddd">${escapeHtml(dietary)}</td>
                  </tr>`;
        }).join('');

        const html = `
          <p>Hi ${escapeHtml(primaryGuest.name || '')},</p>
          <p>Thanks for RSVPing. Below are the selections for each guest in your party:</p>
          <table style="border-collapse:collapse;border:1px solid #ddd;">
            <thead>
              <tr>
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Name</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Email</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Attending</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Meal choice</th>
                <th style="padding:8px;border:1px solid #ddd;text-align:left">Dietary restrictions</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <p>If you need to change anything, reply to this email or visit the RSVP page.</p>`;

        await sendEmail(to, subject, text, html);
        emailResult = { emailSent: true };
      } catch (emailErr) {
        console.error('Error sending RSVP confirmation email:', emailErr);
        emailResult = { emailSent: false, emailError: String(emailErr) };
      }
    }

    client.release();
    res.json({ message: 'RSVPs processed', results, emailResult });
  } catch (err) {
    console.error('Error submitting RSVPs: ', err);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/api/party', async (req, res) => {
  const partyId = Number(req.body.partyId);
  if (!Number.isInteger(partyId)) {
    return res.status(400).json({ message: 'partyId must be an integer' });
  }
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT * FROM guests WHERE party_id = $1', [partyId]);
    client.release();

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'No guests found for this party' });
    }

    res.json(result.rows);
  } catch (err) {
    console.error('Error retrieving party guests: ', err);
    res.status(500).send('Internal Server Error');
  }
});

// Helper: simple HTML escape to avoid breaking the email
function escapeHtml(str: any) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
