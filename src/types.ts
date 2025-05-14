import { Request } from 'express';
import { ObjectId } from 'mongodb';

export interface User {
  _id?: ObjectId;
  email: string;
  password?: string;
  name?: string;
  googleId?: string;
  createdAt: Date;
}

export interface Channel {
  _id?: ObjectId;
  userId: ObjectId;
  channelUrl: string;
  createdAt: Date;
}

export interface Video {
  _id?: ObjectId;
  channelUrl: string;
  videoId: string;
  title: string;
  publishedAt: string;
  summary: string;
  createdAt: Date;
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
} 