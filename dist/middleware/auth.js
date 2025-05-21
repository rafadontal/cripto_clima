"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setUsersCollection = setUsersCollection;
exports.auth = auth;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const mongodb_1 = require("mongodb");
let usersCollection;
function setUsersCollection(collection) {
    usersCollection = collection;
}
async function auth(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        req.user = decoded;
        // Check subscription status for API routes
        if (req.path.startsWith('/api/') && !req.path.startsWith('/api/subscription/')) {
            const user = await usersCollection.findOne({ _id: new mongodb_1.ObjectId(decoded.userId) });
            if (!user || user.subscriptionStatus === 'unpaid') {
                return res.status(403).json({
                    error: 'Subscription required',
                    redirectTo: '/landing.html'
                });
            }
        }
        next();
    }
    catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}
