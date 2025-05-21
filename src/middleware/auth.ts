import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthRequest } from '../types';
import { MongoClient, Collection, ObjectId } from 'mongodb';

// Define JWT payload type
interface JWTPayload {
    userId: string;
    email: string;
}

let usersCollection: Collection;

export function setUsersCollection(collection: Collection) {
    usersCollection = collection;
}

export async function auth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as JWTPayload;
        (req as AuthRequest).user = decoded;

        // Check subscription status for API routes
        if (req.path.startsWith('/api/') && !req.path.startsWith('/api/subscription/')) {
            const user = await usersCollection.findOne({ _id: new ObjectId(decoded.userId) });
            if (!user || user.subscriptionStatus === 'unpaid') {
                return res.status(403).json({ 
                    error: 'Subscription required',
                    redirectTo: '/landing.html'
                });
            }
        }

        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
} 