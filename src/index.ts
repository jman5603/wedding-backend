import express from 'express';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
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