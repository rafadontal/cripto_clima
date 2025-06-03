import dotenv from 'dotenv';

// Load environment variables with override
dotenv.config({ override: true });

// Debug: Log all environment variables (safely)
console.log('Environment variables loaded:');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY?.substring(0, 8) + '...');
console.log('STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET?.substring(0, 8) + '...');
console.log('MONGODB_URI:', process.env.MONGODB_URI?.substring(0, 8) + '...');
console.log('JWT_SECRET:', process.env.JWT_SECRET?.substring(0, 8) + '...');
console.log('RESEND_API_KEY:', process.env.RESEND_API_KEY?.substring(0, 8) + '...');

import express, { Request, Response } from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import { OpenAI } from 'openai';
import { google } from 'googleapis';
import { YoutubeTranscript } from 'youtube-transcript';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { auth, setUsersCollection } from './middleware/auth';
import { AuthRequest, User, Channel, Video, UserChannel, UserVideoSummary } from './types';
import { SUBSCRIPTION_PLANS, STRIPE_CONFIG } from './config';
import Stripe from 'stripe';
import { getStripeConfig } from './config';
import { sendWelcomeEmail, sendPaymentSuccessEmail, sendPaymentFailedEmail, sendPasswordResetEmail, sendSubscriptionCancelledEmail } from './services/email';

// Enhanced logging utility
const logError = (error: any, context: string, additionalInfo?: any) => {
  // Add immediate console.error for visibility
  console.error(`[ERROR] ${context}:`, error.message);
  
  try {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      context,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      ...additionalInfo
    };
    console.error(JSON.stringify(errorInfo));
  } catch (e) {
    // Fallback if JSON.stringify fails
    console.error('Raw error info:', error, 'Context:', context, 'Additional info:', additionalInfo);
  }
};

const logInfo = (message: string, data?: any) => {
  // Add immediate console.log for visibility
  console.log(`[INFO] ${message}`);
  
  try {
    const logInfo = {
      timestamp: new Date().toISOString(),
      message,
      ...data
    };
    console.log(JSON.stringify(logInfo));
  } catch (e) {
    // Fallback if JSON.stringify fails
    console.log('Raw log info:', message, 'Data:', data);
  }
};

// Request logging middleware
const requestLogger = (req: Request, res: Response, next: Function) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    try {
      logInfo('Request completed', {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('user-agent'),
        ip: req.ip
      });
    } catch (e) {
      console.error('Error in request logger:', e);
    }
  });
  next();
};

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Apply request logging middleware
app.use(requestLogger);

// Google OAuth setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Middleware
app.use(cors());
app.use(express.json());

// API routes should be defined BEFORE static file serving

// MongoDB connection
let client: MongoClient;
let db: any;
let usersCollection: any;
let channelsCollection: any;
let userChannelsCollection: any;
let videosCollection: any;
let userVideoSummariesCollection: any;

// Export functions needed by background jobs
export { youtube, getChannelId, generateSummary };

async function connectToMongo() {
  try {
    client = new MongoClient(process.env.MONGODB_URI || '');
    await client.connect();
    logInfo('Connected to MongoDB successfully');
    db = client.db('youtube_summaries');
    usersCollection = db.collection('users');
    channelsCollection = db.collection('channels');
    userChannelsCollection = db.collection('user_channels');
    videosCollection = db.collection('videos');
    userVideoSummariesCollection = db.collection('user_video_summaries');
    
    setUsersCollection(usersCollection);

    const { initializeCollections, startBackgroundJobs } = require('./backgroundJobs');
    await initializeCollections(client);
    await startBackgroundJobs();
  } catch (error) {
    logError(error, 'MongoDB connection', {
      uri: process.env.MONGODB_URI?.substring(0, 8) + '...'
    });
    process.exit(1);
  }
}

// YouTube API setup
const youtube = google.youtube({
  version: 'v3',
  auth: process.env.YOUTUBE_API_KEY
});

// OpenAI setup
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Initialize Stripe
const stripe = new Stripe(getStripeConfig().secretKey, {
    apiVersion: '2025-04-30.basil'
});

// Debug: Log the first few characters of the key being used
console.log('Stripe key being used (first 8 chars):', getStripeConfig().secretKey.substring(0, 8));

// Google OAuth Routes
app.get('/api/auth/google/url', (req: Request, res: Response) => {
  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  res.json({ url: authUrl });
});

app.get('/api/auth/google/callback', async (req: Request, res: Response) => {
  try {
    const { code } = req.query;
    if (!code) {
      logError(new Error('Missing authorization code'), 'Google OAuth callback');
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    const { tokens } = await oauth2Client.getToken(code as string);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({
      auth: oauth2Client,
      version: 'v2'
    });

    const { data } = await oauth2.userinfo.get();
    if (!data.email) {
      logError(new Error('Email not found in Google response'), 'Google OAuth callback', { data });
      return res.status(400).json({ error: 'Email not found' });
    }

    let user = await usersCollection.findOne({ email: data.email });
    
    if (!user) {
      logInfo('Creating new user from Google OAuth', { email: data.email });
      const newUser: User = {
        email: data.email,
        name: data.name || '',
        googleId: data.id || undefined,
        createdAt: new Date(),
        tier: 'basic',
        subscriptionStatus: 'unpaid'
      };
      
      const result = await usersCollection.insertOne(newUser);
      user = { ...newUser, _id: result.insertedId };
    }

    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email },
      JWT_SECRET
    );

    res.redirect(`${process.env.FRONTEND_URL}/auth-callback.html?token=${token}`);
  } catch (error) {
    logError(error, 'Google OAuth callback', {
      query: req.query,
      frontendUrl: process.env.FRONTEND_URL
    });
    res.redirect(`${process.env.FRONTEND_URL}/login.html?error=Authentication failed`);
  }
});

// Auth Routes
app.post('/api/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    logInfo('Attempting user registration', { email });

    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      logError(new Error('User already exists'), 'User registration', { email });
      return res.status(400).json({ error: 'User already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user: User = {
      email,
      password: hashedPassword,
      createdAt: new Date(),
      tier: 'basic',
      subscriptionStatus: 'unpaid'
    };

    const result = await usersCollection.insertOne(user);
    const token = jwt.sign({ userId: result.insertedId.toString(), email }, JWT_SECRET);

    logInfo('User registered successfully', { email, userId: result.insertedId.toString() });

    await sendWelcomeEmail(email, email.split('@')[0]);

    res.status(201).json({ token });
  } catch (error) {
    logError(error, 'User registration', { email: req.body.email });
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    logInfo('Login attempt', { email });

    const user = await usersCollection.findOne({ email });
    if (!user) {
      logError(new Error('User not found'), 'Login', { email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.password) {
      logError(new Error('User has no password set'), 'Login', { email });
      return res.status(401).json({ error: 'Please use Google login' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      logError(new Error('Invalid password'), 'Login', { email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id.toString(), email: user.email },
      JWT_SECRET
    );

    logInfo('User logged in successfully', { email, userId: user._id.toString() });

    res.json({ token });
  } catch (error) {
    logError(error, 'Login', { email: req.body.email });
    res.status(500).json({ error: 'Login failed' });
  }
});

// Channel Routes
app.post('/api/channels', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { channelUrl } = req.body;
    if (!channelUrl) {
      return res.status(400).json({ error: 'Channel URL is required' });
    }

    if (!req.user?.email) {
      return res.status(401).json({ error: 'User email not found' });
    }

    // Get channel ID
    const channelId = await getChannelId(channelUrl);
    if (!channelId) {
      return res.status(400).json({ error: 'Invalid channel URL' });
    }

    // Get channel info from YouTube
    const response = await youtube.channels.list({
      part: ['snippet'],
      id: [channelId]
    });
    
    const channelInfo = response.data.items?.[0];
    if (!channelInfo) {
      return res.status(400).json({ error: 'Channel not found' });
    }

    const channelHandle = channelInfo.snippet?.customUrl || channelInfo.snippet?.title;
    if (!channelHandle) {
      return res.status(400).json({ error: 'Could not get channel handle' });
    }

    // Check if channel already exists in channels collection
    let channel = await channelsCollection.findOne({ channelHandle });
    
    if (!channel) {
      // Create new channel
      channel = {
        channelUrl,
        channelId,
        channelHandle,
        profilePictureUrl: channelInfo.snippet?.thumbnails?.default?.url,
        lastAdded: new Date(),
        createdAt: new Date()
      };

      await channelsCollection.insertOne(channel);
    } else {
      // Update lastAdded timestamp
      await channelsCollection.updateOne(
        { _id: channel._id },
        { $set: { lastAdded: new Date() } }
      );
    }

    // Check if user already has this channel
    const existingUserChannel = await userChannelsCollection.findOne({
      userEmail: req.user.email,
      channelHandle
    });

    if (existingUserChannel) {
      return res.status(400).json({ error: 'Channel already exists' });
    }

    // Create user-channel relationship
    const userChannel: UserChannel = {
      userEmail: req.user.email,
      channelHandle,
      createdAt: new Date()
    };

    await userChannelsCollection.insertOne(userChannel);
    res.json({ ...channel, _id: userChannel._id });
  } catch (error) {
    console.error('Error adding channel:', error);
    res.status(500).json({ error: 'Failed to add channel' });
  }
});

// Update the channels endpoint to include profile picture
app.get('/api/channels', auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.email) {
            return res.status(401).json({ error: 'User email not found' });
        }

        // Get user's channels through the user_channels collection
        const userChannels = await userChannelsCollection.find({ 
            userEmail: req.user.email
        }).toArray();

        // Get the actual channel data for each user channel
        const channels = await Promise.all(userChannels.map(async (userChannel: UserChannel) => {
            const channel = await channelsCollection.findOne({ channelHandle: userChannel.channelHandle });
            return {
                ...channel,
                _id: userChannel._id // Use the user_channel ID for frontend operations
            };
        }));

        res.json(channels);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

app.delete('/api/channels/:channelUrl', auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.email) {
      return res.status(401).json({ error: 'User email not found' });
    }

    const { channelUrl } = req.params;

    // Find the channel
    const channel = await channelsCollection.findOne({ channelUrl });
    if (!channel) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Delete the user-channel relationship
    const result = await userChannelsCollection.deleteOne({ 
      channelHandle: channel.channelHandle,
      userEmail: req.user.email
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Check if any other users have this channel
    const remainingUsers = await userChannelsCollection.countDocuments({ channelHandle: channel.channelHandle });
    
    // If no users have this channel, delete it from channels collection
    if (remainingUsers === 0) {
      await channelsCollection.deleteOne({ _id: channel._id });
    }

    res.json({ message: 'Channel removed successfully' });
  } catch (error) {
    console.error('Error removing channel:', error);
    res.status(500).json({ error: 'Failed to remove channel' });
  }
});

// Get latest video summary for a channel
app.get('/api/channels/:channelUrl/video', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { channelUrl } = req.params;
    console.log('Processing channel:', channelUrl);

    // Check for existing recent video in database
    const recentVideo = await videosCollection.findOne(
      { channelUrl },
      { sort: { createdAt: -1 } }
    );

    // If we have a recent video (less than 24 hours old), return it
    if (recentVideo && (new Date().getTime() - new Date(recentVideo.createdAt).getTime() < 24 * 60 * 60 * 1000)) {
      console.log('Returning existing video from database');
      return res.json(recentVideo);
    }

    // Get channel ID
    const channelId = await getChannelId(channelUrl);
    if (!channelId) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Get latest video
    const videoData = await getLatestVideo(channelId);
    if (!videoData) {
      return res.status(404).json({ error: 'No videos found for this channel' });
    }

    // Generate summary
    const result = await generateSummary(videoData.videoId);
    if (!result) {
      return res.status(500).json({ error: 'Failed to generate summary' });
    }

    // Save to database
    const videoInfo: Video = {
      channelUrl,
      videoId: videoData.videoId,
      title: videoData.title,
      publishedAt: videoData.publishedAt,
      summary: result.summary,
      transcript: result.transcript,
      createdAt: new Date()
    };

    await videosCollection.insertOne(videoInfo);
    res.json(videoInfo);
  } catch (error) {
    console.error('Error getting video summary:', error);
    res.status(500).json({ error: 'Failed to get video summary' });
  }
});

// Get latest videos for a channel
app.get('/api/channels/:channelUrl/videos', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { channelUrl } = req.params;
    const limit = parseInt(req.query.limit as string) || 5;

    // Get today's date at midnight
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get recent videos from database, sorted by publishedAt
    const videos = await videosCollection.find(
      { channelUrl },
      { 
        sort: { publishedAt: -1 },
        limit 
      }
    ).toArray();

    // Check if we have any videos from today
    const hasRecentVideo = videos.some((video: Video) => {
      const videoDate = new Date(video.publishedAt);
      return videoDate >= today;
    });

    if (!hasRecentVideo) {
      // If no recent videos, fetch latest video from YouTube
      const channelId = await getChannelId(channelUrl);
      if (!channelId) {
        return res.status(404).json({ error: 'Channel not found' });
      }

      const videoData = await getLatestVideo(channelId);
      if (!videoData) {
        return res.status(404).json({ error: 'No videos found for this channel' });
      }

      // Check if this video is already in our database
      const existingVideo = await videosCollection.findOne({
        channelUrl,
        videoId: videoData.videoId
      });

      if (existingVideo) {
        // If the video exists in our database, just return the existing videos
        res.json(videos);
        return;
      }

      // Only fetch transcript and create new entry if it's a new video
      const result = await generateSummary(videoData.videoId);
      if (!result) {
        return res.status(500).json({ error: 'Failed to generate summary' });
      }

      const videoInfo: Video = {
        channelUrl,
        videoId: videoData.videoId,
        title: videoData.title,
        publishedAt: videoData.publishedAt,
        summary: result.summary,
        transcript: result.transcript,
        createdAt: new Date()
      };

      await videosCollection.insertOne(videoInfo);
      videos.unshift(videoInfo); // Add the new video to the beginning of the array
    }

    res.json(videos);
  } catch (error) {
    console.error('Error getting videos:', error);
    res.status(500).json({ error: 'Failed to get videos' });
  }
});

// Get video ID from URL
async function getVideoIdFromUrl(videoUrl: string): Promise<string | null> {
  try {
    const url = new URL(videoUrl);
    const videoId = url.searchParams.get('v');
    if (videoId) {
      return videoId;
    }

    // Handle youtu.be URLs
    if (url.hostname === 'youtu.be') {
      return url.pathname.slice(1);
    }

    return null;
  } catch (error) {
    console.error('Error parsing video URL:', error);
    return null;
  }
}

// Get video details from YouTube API
async function getVideoDetails(videoId: string): Promise<{ videoId: string; title: string; publishedAt: string; } | null> {
  try {
    const response = await youtube.videos.list({
      part: ['snippet'],
      id: [videoId]
    });

    const video = response.data.items?.[0];
    if (!video?.snippet?.title || !video?.snippet?.publishedAt) {
      return null;
    }

    return {
      videoId,
      title: video.snippet.title,
      publishedAt: video.snippet.publishedAt
    };
  } catch (error) {
    console.error('Error getting video details:', error);
    return null;
  }
}

// Single video summary endpoint
app.post('/api/videos/summary', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { videoUrl } = req.body;
    if (!videoUrl) {
      return res.status(400).json({ error: 'Video URL is required' });
    }

    if (!req.user?.email) {
      return res.status(401).json({ error: 'User email not found' });
    }

    const videoId = await getVideoIdFromUrl(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube video URL' });
    }

    // First check if we already have this summary in user's history
    const existingUserSummary = await userVideoSummariesCollection.findOne({
      userEmail: req.user.email,
      videoId
    });

    if (existingUserSummary) {
      return res.json(existingUserSummary);
    }

    // Then check if we have this video in any channel
    const existingChannelVideo = await videosCollection.findOne({
      videoId
    });

    if (existingChannelVideo) {
      // Create a copy in user's history
      const videoSummary: UserVideoSummary = {
        userEmail: req.user.email,
        videoId,
        title: existingChannelVideo.title,
        publishedAt: existingChannelVideo.publishedAt,
        summary: existingChannelVideo.summary,
        transcript: existingChannelVideo.transcript || undefined,
        createdAt: new Date()
      };

      await userVideoSummariesCollection.insertOne(videoSummary);
      return res.json(videoSummary);
    }

    // If no existing summary found, get video details and generate new summary
    const videoData = await getVideoDetails(videoId);
    if (!videoData || !videoData.title || !videoData.publishedAt) {
      return res.status(404).json({ error: 'Video not found or missing required information' });
    }

    // Generate summary
    const result = await generateSummary(videoId);
    if (!result) {
      return res.status(503).json({ 
        error: 'Não foi possível gerar o resumo neste momento. O vídeo pode não ter legendas disponíveis ou pode ser muito curto.',
        retryAfter: 3600 // Suggest retrying after 1 hour
      });
    }

    // Save to database
    const videoSummary: UserVideoSummary = {
      userEmail: req.user.email,
      videoId,
      title: videoData.title,
      publishedAt: videoData.publishedAt,
      summary: result.summary,
      transcript: result.transcript || undefined,
      createdAt: new Date()
    };

    await userVideoSummariesCollection.insertOne(videoSummary);
    res.json(videoSummary);
  } catch (error) {
    console.error('Error generating video summary:', error);
    res.status(500).json({ error: 'Failed to generate video summary' });
  }
});

// Get user's video summary history
app.get('/api/videos/summaries', auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.email) {
      return res.status(401).json({ error: 'User email not found' });
    }

    const limit = parseInt(req.query.limit as string) || 0;
    const query = { userEmail: req.user.email };
    const options = { 
      sort: { createdAt: -1 },
      ...(limit > 0 && { limit })
    };

    const summaries = await userVideoSummariesCollection.find(query, options).toArray();
    res.json(summaries);
  } catch (error) {
    console.error('Error getting video summaries:', error);
    res.status(500).json({ error: 'Failed to get video summaries' });
  }
});

// Helper functions
async function getChannelId(channelUrl: string): Promise<string | null> {
  try {
    const url = new URL(channelUrl);
    const path = url.pathname;

    if (path.includes('/channel/')) {
      return path.split('/channel/')[1];
    }

    if (path.includes('/@')) {
      const handle = path.split('/@')[1];
      const searchResponse = await youtube.search.list({
        part: ['snippet'],
        q: handle,
        type: ['channel'],
        maxResults: 1
      });

      const items = searchResponse.data.items;
      if (items && items.length > 0 && items[0].id?.channelId) {
        return items[0].id.channelId;
      }
    }

    return null;
  } catch (error) {
    console.error('Error getting channel ID:', error);
    return null;
  }
}

async function getLatestVideo(channelId: string) {
  const response = await youtube.search.list({
    part: ['snippet'],
    channelId,
    order: 'date',
    maxResults: 1,
    type: ['video']
  });

  const video = response.data.items?.[0];
  if (!video?.id?.videoId || !video.snippet?.title || !video.snippet.publishedAt) {
    return null;
  }

  return {
    videoId: video.id.videoId,
    title: video.snippet.title,
    publishedAt: video.snippet.publishedAt
  };
}

interface SummaryResult {
  summary: string;
  transcript: string;
}

async function generateSummary(videoId: string): Promise<SummaryResult | null> {
  try {
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    
    // Check if transcript is empty or too short
    if (!transcript || transcript.length === 0) {
      console.log(`No transcript available for video ${videoId}`);
      return null;
    }

    // Join transcript segments and check if there's meaningful content
    const text = transcript.map(item => item.text).join(' ');
    
    // Check if the text is too short or contains only common phrases
    const minLength = 100; // Minimum characters for a meaningful transcript
    const commonPhrases = [
      "please provide the transcript",
      "no transcript available",
      "transcript not found",
      "unable to get transcript"
    ];

    if (text.length < minLength || commonPhrases.some(phrase => text.toLowerCase().includes(phrase))) {
      console.log(`Invalid or too short transcript for video ${videoId}`);
      return null;
    }

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that summarizes YouTube videos and provides clear, structured insights."
        },
        {
          role: "user",
          content: `Summarize the following YouTube video transcript. Focus on extracting the most important insights, main arguments, and conclusions. If the video includes any practical tips, actionable advice, step-by-step methods, or frameworks, list them clearly and concisely.

Structure the output as follows:
1. Summary – A concise overview of the video's key points.
2. Key Insights – Bullet points of the most valuable takeaways or ideas.
3. Actionable Advice / Practical Steps – Any recommended actions, strategies, or how-to instructions mentioned in the video.

Please ensure the tone is neutral and informative, and avoid filler or repetition. Prioritize clarity and usefulness.

Transcript:
${text}`
        }
      ],
      temperature: 0.5,
      max_tokens: 800
    });

    const summary = response.choices[0].message.content;

    // Validate the summary to ensure it's not a generic response
    if (!summary || summary.toLowerCase().includes("please provide the transcript")) {
      console.log(`Invalid summary generated for video ${videoId}`);
      return null;
    }

    // Return both summary and transcript
    return { summary, transcript: text };
  } catch (error) {
    console.error('Error generating summary:', error);
    return null;
  }
}

// Add new endpoint for the feed
app.get('/api/feed', auth, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user?.email) {
            return res.status(401).json({ error: 'User email not found' });
        }

        // Get user's channels through the user_channels collection
        const userChannels = await userChannelsCollection.find({ 
            userEmail: req.user.email
        }).toArray();

        // Get the actual channel data for each user channel
        const channels = await Promise.all(userChannels.map(async (userChannel: UserChannel) => {
            const channel = await channelsCollection.findOne({ channelHandle: userChannel.channelHandle });
            return channel;
        }));

        // Filter out any null channels
        const validChannels = channels.filter((channel): channel is Channel => channel !== null);
        
        // Get the latest video from each channel
        const latestVideos = await Promise.all(validChannels.map(async (channel: Channel) => {
            try {
                // First check if we have recent videos in the database
                const recentVideos = await videosCollection.find(
                    { channelUrl: channel.channelUrl },
                    { sort: { createdAt: -1 }, limit: 1 }
                ).toArray();

                if (recentVideos.length > 0) {
                    const lastVideo = recentVideos[0];
                    const lastUpdate = new Date(lastVideo.createdAt);
                    const now = new Date();
                    const hoursSinceUpdate = (now.getTime() - lastUpdate.getTime()) / (1000 * 60 * 60);

                    // If the last update was less than 6 hours ago, use the cached version
                    if (hoursSinceUpdate < 6) {
                        return lastVideo;
                    }
                }

                // Get the channel ID first
                const channelId = await getChannelId(channel.channelUrl);
                if (!channelId) {
                    console.error('Could not get channel ID for:', channel.channelUrl);
                    return null;
                }

                // If no recent videos or cache expired, fetch from YouTube
                const response = await youtube.search.list({
                    part: ['snippet'],
                    channelId: channelId,
                    order: 'date',
                    maxResults: 1,
                    type: ['video']
                });

                const video = response.data.items?.[0];
                if (!video?.id?.videoId) return null;

                // Check if we already have this video in the database
                const existingVideo = await videosCollection.findOne({
                    channelUrl: channel.channelUrl,
                    videoId: video.id.videoId
                });

                if (existingVideo) {
                    return existingVideo;
                }

                // If not in database, generate summary and save
                const videoDetails = await youtube.videos.list({
                    part: ['snippet', 'contentDetails'],
                    id: [video.id.videoId]
                });

                const videoInfo = videoDetails.data.items?.[0];
                if (!videoInfo?.snippet?.title || !videoInfo?.snippet?.publishedAt) return null;

                const result = await generateSummary(video.id.videoId);
                if (!result) return null;

                // Get channel profile picture
                const channelResponse = await youtube.channels.list({
                    part: ['snippet'],
                    id: [channelId]
                });
                
                const channelInfo = channelResponse.data.items?.[0];
                const profilePictureUrl = channelInfo?.snippet?.thumbnails?.default?.url || null;
                
                // Save to database
                const videoInfoToSave: Video = {
                    channelUrl: channel.channelUrl,
                    videoId: video.id.videoId,
                    title: videoInfo.snippet.title,
                    publishedAt: videoInfo.snippet.publishedAt,
                    summary: result.summary,
                    transcript: result.transcript,
                    createdAt: new Date(),
                    profilePictureUrl
                };

                await videosCollection.insertOne(videoInfoToSave);

                return videoInfoToSave;
            } catch (error) {
                console.error('Error fetching channel videos:', error);
                return null;
            }
        }));

        // Filter out null values and sort by publish date
        const validVideos = latestVideos
            .filter((video): video is Video => video !== null)
            .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

        res.json(validVideos);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch feed' });
    }
});

// Get subscription plans
app.get('/api/subscription/plans', (req: Request, res: Response) => {
    res.json(SUBSCRIPTION_PLANS);
});

// Serve landing page as default
app.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../public/landing.html'));
});

// Subscription routes
app.post('/api/subscription/create-checkout', auth, async (req: AuthRequest, res: Response) => {
    try {
        const { planId } = req.body;
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user?.userId) });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get the plan details
        const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
        if (!plan) {
            return res.status(400).json({ error: 'Invalid plan' });
        }

        // Get or create Stripe customer
        let customer;
        if (user.stripeCustomerId) {
            customer = await stripe.customers.retrieve(user.stripeCustomerId);
        } else {
            customer = await stripe.customers.create({
                email: user.email,
                metadata: {
                    userId: user._id.toString()
                }
            });
            // Update user with Stripe customer ID
            await usersCollection.updateOne(
                { _id: new ObjectId(user._id) },
                { $set: { stripeCustomerId: customer.id } }
            );
        }

        // Create checkout session
        const session = await stripe.checkout.sessions.create({
            customer: customer.id,
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'brl',
                    product_data: {
                        name: plan.name,
                    },
                    unit_amount: plan.price * 100, // Convert to cents
                    recurring: {
                        interval: 'month'
                    },
                },
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: `${process.env.FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.FRONTEND_URL}/landing.html`,
            metadata: {
                userId: user._id.toString(),
                planId: plan.id
            },
            allow_promotion_codes: true // Enable promo codes
        });

        res.json({ 
            sessionId: session.id,
            url: session.url 
        });
    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ error: 'Error creating checkout session' });
    }
});

// Add success page endpoint
app.get('/success', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/success.html'));
});

// Get user's usage statistics
app.get('/api/account/usage', auth, async (req: AuthRequest, res: Response) => {
    console.log('User in /api/account/usage:', req.user);
    try {
        if (!req.user?.email) {
            return res.status(401).json({ error: 'User email not found' });
        }

        const user = await usersCollection.findOne({ _id: new ObjectId(req.user?.userId) });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const plan = SUBSCRIPTION_PLANS.find(p => p.tier === user.tier);
        if (!plan) {
            return res.status(404).json({ error: 'Plan not found' });
        }

        // Get current month's start date
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        // Count channels using user_channels collection
        const channelsCount = await userChannelsCollection.countDocuments({
            userEmail: req.user.email
        });

        // Count videos this month using user_video_summaries collection
        const videosThisMonth = await userVideoSummariesCollection.countDocuments({
            userEmail: req.user.email,
            createdAt: { $gte: startOfMonth }
        });

        res.json({
            channelsCount,
            videosThisMonth,
            maxChannels: plan.maxChannels,
            maxVideosPerMonth: plan.maxVideosPerMonth,
            tier: user.tier,
            subscriptionStatus: user.subscriptionStatus,
            nextBillingDate: user.currentPeriodEnd
        });
    } catch (error) {
        console.error('Error getting usage statistics:', error);
        res.status(500).json({ error: 'Failed to get usage statistics' });
    }
});

// Stripe webhook handler
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  // Immediate console log for webhook receipt
  console.log('Webhook received:', {
    signature: typeof sig === 'string' ? sig.substring(0, 8) + '...' : 'missing',
    type: req.headers['stripe-event-type']
  });

  logInfo('Received webhook', { 
    signature: typeof sig === 'string' ? sig.substring(0, 8) + '...' : 'missing',
    type: req.headers['stripe-event-type']
  });

  if (!sig || !webhookSecret) {
    console.error('Missing webhook signature or secret');
    logError(new Error('Missing webhook signature or secret'), 'Stripe webhook');
    return res.status(400).json({ error: 'Missing webhook signature or secret' });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    console.log('Webhook event constructed successfully:', event.type);
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    logError(error, 'Stripe webhook signature verification', {
      signature: typeof sig === 'string' ? sig.substring(0, 8) + '...' : 'missing',
      body: JSON.stringify(req.body).substring(0, 100) + '...'
    });
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;

        logInfo('Processing checkout session completion', {
          sessionId: session.id,
          userId,
          customerEmail: session.customer_email
        });

        if (!userId) {
          throw new Error('No userId in session metadata');
        }

        const user = await usersCollection.findOne({ _id: new ObjectId(userId) });
        if (!user) {
          throw new Error(`User not found: ${userId}`);
        }

        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const currentPeriodEnd = new Date((subscription as any).current_period_end * 1000);
        
        await usersCollection.updateOne(
          { _id: new ObjectId(userId) },
          {
            $set: {
              subscriptionId: subscription.id,
              subscriptionStatus: 'active',
              tier: subscription.items.data[0].price.nickname || 'basic',
              currentPeriodEnd
            }
          }
        );

        logInfo('Subscription activated successfully', {
          userId,
          subscriptionId: subscription.id,
          tier: subscription.items.data[0].price.nickname
        });

        await sendPaymentSuccessEmail(user.email, user.name || user.email.split('@')[0], 'Subscription', 0);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as any;
        const user = await usersCollection.findOne({ subscriptionId: subscription.id });

        logInfo('Processing subscription deletion', {
          subscriptionId: subscription.id,
          userId: user?._id.toString()
        });

        if (user) {
          await usersCollection.updateOne(
            { _id: user._id },
            {
              $set: {
                subscriptionStatus: 'cancelled',
                tier: 'basic'
              }
            }
          );

          logInfo('Subscription cancelled successfully', {
            userId: user._id.toString(),
            email: user.email
          });

          await sendSubscriptionCancelledEmail(user.email, user.name || user.email.split('@')[0], new Date(subscription.current_period_end * 1000));
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as any;
        const subscriptionId = invoice.subscription;
        const user = await usersCollection.findOne({ subscriptionId });

        logInfo('Processing failed payment', {
          invoiceId: invoice.id,
          subscriptionId,
          userId: user?._id.toString()
        });

        if (user) {
          await usersCollection.updateOne(
            { _id: user._id },
            { $set: { subscriptionStatus: 'payment_failed' } }
          );

          logInfo('Updated user subscription status to payment_failed', {
            userId: user._id.toString(),
            email: user.email
          });

          await sendPaymentFailedEmail(user.email, user.name || user.email.split('@')[0]);
        }
        break;
      }

      default:
        logInfo('Unhandled webhook event type', { type: event.type });
    }

    res.json({ received: true });
  } catch (error) {
    logError(error, 'Webhook processing', {
      eventType: event.type,
      eventId: event.id
    });
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// Add subscription verification endpoint
app.post('/api/subscription/verify', auth, async (req: AuthRequest, res: Response) => {
    try {
        const { sessionId } = req.body;
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user?.userId) });
        
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // First check if user is already active
        if (user.subscriptionStatus === 'active') {
            return res.json({ 
                subscriptionStatus: 'active',
                message: 'Subscription already active',
                promoCode: user.promoCode,
                nextBillingDate: user.currentPeriodEnd
            });
        }

        // Retrieve the checkout session with expanded subscription
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['subscription', 'total_details.breakdown.discounts']
        });
        
        if (session.payment_status !== 'paid') {
            return res.status(400).json({ error: 'Payment not completed' });
        }

        // Get the subscription ID from the session
        const subscriptionId = typeof session.subscription === 'string' 
            ? session.subscription 
            : session.subscription?.id;

        if (!subscriptionId) {
            console.error('Session data:', JSON.stringify(session, null, 2));
            return res.status(400).json({ error: 'Invalid subscription ID' });
        }

        // Get the subscription
        const subscription = await stripe.subscriptions.retrieve(subscriptionId) as Stripe.Subscription;
        
        if (subscription.status !== 'active') {
            return res.status(400).json({ error: 'Subscription not active' });
        }

        // Get plan ID from session metadata
        const planId = session.metadata?.planId;
        if (!planId) {
            return res.status(400).json({ error: 'Invalid session metadata' });
        }

        // Get promo code information if used
        let promoCode = null;
        if (session.total_details?.breakdown?.discounts && session.total_details.breakdown.discounts.length > 0) {
            const discount = session.total_details.breakdown.discounts[0] as any;
            promoCode = discount.promotion_code?.code || discount.coupon?.id;
        }

        // Calculate next billing date from billing_cycle_anchor
        const billingCycleAnchor = (subscription as any).billing_cycle_anchor;
        if (!billingCycleAnchor || typeof billingCycleAnchor !== 'number') {
            console.error('Invalid billing_cycle_anchor from subscription:', subscription);
            return res.status(500).json({ error: 'Invalid subscription period' });
        }

        // Create date from billing cycle anchor and add one month
        const nextBillingDate = new Date(billingCycleAnchor * 1000); // Convert seconds to milliseconds
        nextBillingDate.setMonth(nextBillingDate.getMonth() + 1); // Add one month
        
        console.log('Billing cycle anchor:', new Date(billingCycleAnchor * 1000).toISOString());
        console.log('Next billing date:', nextBillingDate.toISOString());

        // Update user's subscription status
        const updateResult = await usersCollection.updateOne(
            { _id: new ObjectId(user._id) },
            { 
                $set: { 
                    subscriptionStatus: 'active',
                    stripeSubscriptionId: subscriptionId,
                    tier: planId,
                    currentPeriodEnd: nextBillingDate,
                    subscriptionStartDate: new Date(),
                    promoCode: promoCode
                }
            }
        );

        if (updateResult.modifiedCount === 0) {
            console.error('Failed to update user subscription status');
            return res.status(500).json({ error: 'Failed to update subscription status' });
        }

        // Get plan details for email
        const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
        if (!plan) {
            console.error('Plan not found for ID:', planId);
        } else {
            // Calculate amount paid
            const amountPaid = session.amount_total ? session.amount_total / 100 : plan.price;
            
            // Send payment success email
            try {
                await sendPaymentSuccessEmail(
                    user.email,
                    user.name || user.email.split('@')[0],
                    plan.name,
                    amountPaid
                );
                console.log('Payment success email sent from verify endpoint');
            } catch (emailError) {
                console.error('Error sending payment success email:', emailError);
                // Don't fail the request if email fails
            }
        }

        res.json({ 
            subscriptionStatus: 'active',
            message: 'Subscription activated successfully',
            promoCode: promoCode,
            nextBillingDate: nextBillingDate
        });
    } catch (error) {
        console.error('Error verifying subscription:', error);
        res.status(500).json({ error: 'Error verifying subscription' });
    }
});

// Add subscription status endpoint
app.get('/api/subscription/status', auth, async (req: AuthRequest, res: Response) => {
    try {
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user?.userId) });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Check if subscription is cancelled but still within period
        const isWithinCancelledPeriod = user.subscriptionStatus === 'cancelled' && 
            user.currentPeriodEnd && 
            new Date(user.currentPeriodEnd) > new Date();

        res.json({
            subscriptionStatus: isWithinCancelledPeriod ? 'active' : user.subscriptionStatus,
            tier: user.tier,
            currentPeriodEnd: user.currentPeriodEnd,
            subscriptionStartDate: user.subscriptionStartDate,
            isCancelled: user.subscriptionStatus === 'cancelled'
        });
    } catch (error) {
        console.error('Error checking subscription status:', error);
        res.status(500).json({ error: 'Failed to check subscription status' });
    }
});

// Add search endpoint
app.get('/api/search', auth, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.email) {
      return res.status(401).json({ error: 'User email not found' });
    }

    const { query, type = 'all' } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const searchQuery = query.toString().toLowerCase();
    let results: (UserVideoSummary | Video & { source: string })[] = [];

    // Search in user's summarized videos
    if (type === 'all' || type === 'history') {
      const userSummaries = await userVideoSummariesCollection.find({
        userEmail: req.user.email,
        $or: [
          { title: { $regex: searchQuery, $options: 'i' } },
          { summary: { $regex: searchQuery, $options: 'i' } }
        ]
      }).toArray();

      results = results.concat(userSummaries.map((summary: UserVideoSummary) => ({
        ...summary,
        source: 'history'
      })));
    }

    // Search in channel videos
    if (type === 'all' || type === 'channels') {
      // Get user's channels
      const userChannels = await userChannelsCollection.find({
        userEmail: req.user.email
      }).toArray();

      // Get videos from user's channels
      const channelVideos = await videosCollection.find({
        channelHandle: { $in: userChannels.map((uc: UserChannel) => uc.channelHandle) },
        $or: [
          { title: { $regex: searchQuery, $options: 'i' } },
          { summary: { $regex: searchQuery, $options: 'i' } }
        ]
      }).toArray();

      results = results.concat(channelVideos.map((video: Video) => ({
        ...video,
        source: 'channel'
      })));
    }

    // Sort results by creation date
    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.json(results);
  } catch (error) {
    console.error('Error searching videos:', error);
    res.status(500).json({ error: 'Failed to search videos' });
  }
});

// Add password reset request endpoint
app.post('/api/auth/forgot-password', async (req: Request, res: Response) => {
    try {
        const { email } = req.body;
        
        // Find user
        const user = await usersCollection.findOne({ email });
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado' });
        }

        // Generate reset token
        const resetToken = jwt.sign(
            { userId: user._id.toString(), email },
            JWT_SECRET,
            { expiresIn: '1h' }
        );

        // Store reset token in user document
        await usersCollection.updateOne(
            { _id: user._id },
            { $set: { resetToken, resetTokenExpires: new Date(Date.now() + 3600000) } }
        );

        // Send reset email
        await sendPasswordResetEmail(email, resetToken);

        res.json({ message: 'Email de redefinição de senha enviado' });
    } catch (error) {
        console.error('Error sending reset email:', error);
        res.status(500).json({ error: 'Erro ao enviar email de redefinição' });
    }
});

// Add password reset endpoint
app.post('/api/auth/reset-password', async (req: Request, res: Response) => {
    try {
        const { token, password } = req.body;

        // Verify token
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: string, email: string };
        
        // Find user
        const user = await usersCollection.findOne({
            _id: new ObjectId(decoded.userId),
            resetToken: token,
            resetTokenExpires: { $gt: new Date() }
        });

        if (!user) {
            return res.status(400).json({ error: 'Token inválido ou expirado' });
        }

        // Hash new password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Update password and clear reset token
        await usersCollection.updateOne(
            { _id: user._id },
            {
                $set: { password: hashedPassword },
                $unset: { resetToken: "", resetTokenExpires: "" }
            }
        );

        res.json({ message: 'Senha atualizada com sucesso' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ error: 'Erro ao redefinir senha' });
    }
});

// Add subscription cancellation endpoint
app.post('/api/subscription/cancel', auth, async (req: AuthRequest, res: Response) => {
    try {
        const user = await usersCollection.findOne({ _id: new ObjectId(req.user?.userId) });
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.stripeSubscriptionId) {
            return res.status(400).json({ error: 'No active subscription found' });
        }

        // Cancel the subscription in Stripe
        await stripe.subscriptions.update(user.stripeSubscriptionId, {
            cancel_at_period_end: true
        });

        // Update user's subscription status
        await usersCollection.updateOne(
            { _id: new ObjectId(user._id) },
            { 
                $set: { 
                    subscriptionStatus: 'cancelled',
                    subscriptionCancelledAt: new Date()
                }
            }
        );

        // Send cancellation confirmation email
        try {
            await sendSubscriptionCancelledEmail(
                user.email,
                user.name || user.email.split('@')[0],
                user.currentPeriodEnd
            );
        } catch (emailError) {
            console.error('Error sending cancellation email:', emailError);
            // Don't fail the request if email fails
        }

        res.json({ 
            message: 'Subscription cancelled successfully',
            currentPeriodEnd: user.currentPeriodEnd
        });
    } catch (error) {
        console.error('Error cancelling subscription:', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
    }
});

// Static files (should be last)
app.use(express.static(path.join(__dirname, '../public')));

// Start server
connectToMongo().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}); 