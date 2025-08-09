import express from 'express';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import dotenv from 'dotenv';
import pg from 'pg';

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

interface Donor {
  type: 'anonymous' | 'named';
  firstName?: string;
  lastName?: string;
}

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
