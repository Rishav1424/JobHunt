import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../core/config';
import { logger } from '../core/logger';

export const authRouter = Router();

// POST /api/auth/login
authRouter.post('/login', (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (password !== config.DASHBOARD_PASSWORD) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    const token = jwt.sign({ role: 'admin' }, config.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token });
  } catch (error) {
    logger.error('Login error', { error });
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Middleware to require authentication
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // Check if it's the login route
  if (req.path === '/auth/login' || req.path === '/login') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.split(' ')[1];
  try {
    jwt.verify(token, config.JWT_SECRET);
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
