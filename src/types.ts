import { Request } from 'express';
import { ObjectId } from 'mongodb';

export type UserTier = 'basic' | 'pro' | 'premium';

export interface SubscriptionPlan {
    id: string;
    name: string;
    tier: UserTier;
    price: number;
    maxChannels: number;
    maxVideosPerMonth: number;
    features: string[];
    paymentLink: string;
}

export interface User {
    _id?: ObjectId;
    email: string;
    password?: string;
    name?: string;
    googleId?: string;
    createdAt: Date;
    tier: UserTier;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    subscriptionStatus: 'active' | 'canceled' | 'past_due' | 'unpaid';
    currentPeriodEnd?: Date;
    promoCode?: string | null;
    resetToken?: string;
    resetTokenExpires?: Date;
}

export interface UsageStats {
    channelsCount: number;
    videosThisMonth: number;
    maxChannels: number;
    maxVideosPerMonth: number;
    tier: UserTier;
    subscriptionStatus: string;
    nextBillingDate?: Date;
}

export interface Channel {
    _id?: ObjectId;
    channelUrl: string;
    channelId?: string;
    channelHandle?: string;
    profilePictureUrl?: string;
    lastAdded: Date;
    lastUpdated?: Date;
    createdAt: Date;
}

export interface UserChannel {
    _id?: ObjectId;
    userEmail: string;
    channelHandle: string;
    createdAt: Date;
}

export interface Video {
    _id?: ObjectId;
    channelUrl: string;
    videoId: string;
    title: string;
    publishedAt: string;
    summary: string;
    transcript?: string;
    createdAt: Date;
    profilePictureUrl?: string | null;
}

export interface UserVideoSummary {
    _id?: ObjectId;
    userEmail: string;
    videoId: string;
    title: string;
    publishedAt: string;
    summary: string;
    transcript?: string | null;
    createdAt: Date;
}

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
} 