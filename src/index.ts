
import express from 'express';
import session from 'express-session';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;


app.use(express.json());

// Enable CORS for React frontend (localhost in dev, julietteandjacob.com in prod)
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      'http://localhost:3000',
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

declare module 'express-session' {
  interface SessionData {
    isAuthenticated: boolean;
  }
}

app.use(session({
    secret: process.env.SESSION_SECRET || 'some_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 1000 * 60 * 60 * 24 // Expires in 24 hours
    }
}));

const MASTER_PASSWORD = process.env.WEBSITE_PASSWORD;

// --- API Endpoints ---

// POST /api/login: Validate password and create a session
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password && password === MASTER_PASSWORD) {
    req.session.isAuthenticated = true;
    return res.status(200).json({ message: 'Login successful' });
  }
  return res.status(401).json({ message: 'Invalid password' });
});

// GET /api/status: Check if the user is authenticated
app.get('/api/status', (req, res) => {
  if (req.session.isAuthenticated) {
    return res.status(200).json({ isAuthenticated: true });
  }
  return res.status(401).json({ isAuthenticated: false });
});

// POST /api/logout: Destroy the session
app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ message: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    return res.status(200).json({ message: 'Logout successful' });
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!MASTER_PASSWORD) {
    console.warn('Warning: MASTER_PASSWORD is not set. Please set it in your .env file.');
  }
});