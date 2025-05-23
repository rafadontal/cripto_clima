import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient, ObjectId } from 'mongodb';
import { OpenAI } from 'openai';
import { google } from 'googleapis';
import { YoutubeTranscript } from 'youtube-transcript';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { auth, setUsersCollection } from './middleware/auth';
import { AuthRequest, User, Channel, Video } from './types';
import { SUBSCRIPTION_PLANS, STRIPE_CONFIG } from './config';
import Stripe from 'stripe';
import { getStripeConfig } from './config';

// Load environment variables with override
dotenv.config({ override: true });

// Debug: Log all environment variables (safely)
console.log('Environment variables loaded:');
console.log('STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY?.substring(0, 8) + '...');
console.log('STRIPE_WEBHOOK_SECRET:', process.env.STRIPE_WEBHOOK_SECRET?.substring(0, 8) + '...');
console.log('MONGODB_URI:', process.env.MONGODB_URI?.substring(0, 8) + '...');
console.log('JWT_SECRET:', process.env.JWT_SECRET?.substring(0, 8) + '...');

const app = express();
const port = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

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
let videosCollection: any;
let userVideoSummariesCollection: any;

async function connectToMongo() {
  try {
    client = new MongoClient(process.env.MONGODB_URI || '');
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db('youtube_summaries');
    usersCollection = db.collection('users');
    channelsCollection = db.collection('channels');
    videosCollection = db.collection('videos');
    userVideoSummariesCollection = db.collection('user_video_summaries');
    
    // Set users collection in auth middleware
    setUsersCollection(usersCollection);
  } catch (error) {
    console.error('MongoDB connection error:', error);
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
      return res.status(400).json({ error: 'Email not found' });
    }

    // Check if user exists
    let user = await usersCollection.findOne({ email: data.email });
    
    if (!user) {
      // Create new user
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

    // Redirect to frontend with token
    res.redirect(`${process.env.FRONTEND_URL}/auth-callback.html?token=${token}`);
  } catch (error) {
    console.error('Google auth error:', error);
    res.redirect(`${process.env.FRONTEND_URL}/login.html?error=Authentication failed`);
  }
});

// Auth Routes
app.post('/api/register', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Check if user already exists
    const existingUser = await usersCollection.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user: User = {
      email,
      password: hashedPassword,
      createdAt: new Date(),
      tier: 'basic',
      subscriptionStatus: 'unpaid'
    };

    const result = await usersCollection.insertOne(user);
    const token = jwt.sign({ userId: result.insertedId.toString(), email }, JWT_SECRET);

    res.status(201).json({ token });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await usersCollection.findOne({ email });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id.toString(), email }, JWT_SECRET);
    
    // Check subscription status
    if (user.subscriptionStatus === 'active') {
      // User has active subscription, return token and redirect to app
      return res.json({ 
        token,
        subscriptionStatus: 'active',
        redirectTo: '/index.html'
      });
    } else {
      // User needs to subscribe, return token and redirect to landing
      return res.json({ 
        token,
        subscriptionStatus: 'unpaid',
        subscriptionRequired: true,
        redirectTo: '/landing.html'
      });
    }
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to log in' });
  }
});

// Channel Routes
app.post('/api/channels', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { channelUrl } = req.body;
    if (!channelUrl) {
      return res.status(400).json({ error: 'Channel URL is required' });
    }

    // Check if channel already exists for this user
    const existingChannel = await channelsCollection.findOne({ 
      channelUrl,
      userId: new ObjectId(req.user?.userId)
    });
    if (existingChannel) {
      return res.status(400).json({ error: 'Channel already exists' });
    }

    // Store the channel
    const channelInfo: Channel = {
      channelUrl,
      userId: new ObjectId(req.user?.userId),
      createdAt: new Date()
    };

    await channelsCollection.insertOne(channelInfo);
    res.json(channelInfo);
  } catch (error) {
    console.error('Error adding channel:', error);
    res.status(500).json({ error: 'Failed to add channel' });
  }
});

// Add new interface for channel info
interface ChannelInfo {
    channelUrl: string;
    channelHandle: string;
    profilePictureUrl: string;
}

// Update the channels endpoint to include profile picture
app.get('/api/channels', auth, async (req: AuthRequest, res: Response) => {
    try {
        const channels = await channelsCollection.find({ 
            userId: new ObjectId(req.user?.userId)
        }).toArray();
        
        // Get channel info including profile pictures
        const channelsWithInfo = await Promise.all(channels.map(async (channel: Channel) => {
            try {
                // Get the channel ID first
                const channelId = await getChannelId(channel.channelUrl);
                if (!channelId) {
                    console.error('Could not get channel ID for:', channel.channelUrl);
                    return {
                        ...channel,
                        profilePictureUrl: null
                    };
                }

                const response = await youtube.channels.list({
                    part: ['snippet'],
                    id: [channelId]
                });
                
                const channelInfo = response.data.items?.[0];
                return {
                    ...channel,
                    profilePictureUrl: channelInfo?.snippet?.thumbnails?.default?.url || null
                };
            } catch (error) {
                console.error('Error fetching channel info:', error);
                return {
                    ...channel,
                    profilePictureUrl: null
                };
            }
        }));

        res.json(channelsWithInfo);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

app.delete('/api/channels/:channelUrl', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { channelUrl } = req.params;
    const result = await channelsCollection.deleteOne({ 
      channelUrl,
      userId: new ObjectId(req.user?.userId)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Channel not found' });
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
    const summary = await generateSummary(videoData.videoId);
    if (!summary) {
      return res.status(500).json({ error: 'Failed to generate summary' });
    }

    // Save to database
    const videoInfo: Video = {
      channelUrl,
      videoId: videoData.videoId,
      title: videoData.title,
      publishedAt: videoData.publishedAt,
      summary,
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

    // Get recent videos from database
    const videos = await videosCollection.find(
      { channelUrl },
      { sort: { createdAt: -1 }, limit }
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
      const summary = await generateSummary(videoData.videoId);
      if (!summary) {
        return res.status(500).json({ error: 'Failed to generate summary' });
      }

      const videoInfo: Video = {
        channelUrl,
        videoId: videoData.videoId,
        title: videoData.title,
        publishedAt: videoData.publishedAt,
        summary,
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
async function getVideoDetails(videoId: string) {
  try {
    const response = await youtube.videos.list({
      part: ['snippet'],
      id: [videoId]
    });

    const video = response.data.items?.[0];
    if (!video?.snippet) {
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

    const videoId = await getVideoIdFromUrl(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Invalid YouTube video URL' });
    }

    // First check if we already have this summary in user's history
    const existingUserSummary = await userVideoSummariesCollection.findOne({
      userId: new ObjectId(req.user?.userId),
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
      const videoSummary = {
        userId: new ObjectId(req.user?.userId),
        videoId,
        title: existingChannelVideo.title,
        publishedAt: existingChannelVideo.publishedAt,
        summary: existingChannelVideo.summary,
        createdAt: new Date()
      };

      await userVideoSummariesCollection.insertOne(videoSummary);
      return res.json(videoSummary);
    }

    // If no existing summary found, get video details and generate new summary
    const videoData = await getVideoDetails(videoId);
    if (!videoData) {
      return res.status(404).json({ error: 'Video not found' });
    }

    // Generate summary
    const summary = await generateSummary(videoId);
    if (!summary) {
      return res.status(503).json({ 
        error: 'Não foi possível gerar o resumo neste momento. O vídeo pode não ter legendas disponíveis ou pode ser muito curto.',
        retryAfter: 3600 // Suggest retrying after 1 hour
      });
    }

    // Save to database
    const videoSummary = {
      userId: new ObjectId(req.user?.userId),
      videoId,
      title: videoData.title,
      publishedAt: videoData.publishedAt,
      summary,
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
    const limit = parseInt(req.query.limit as string) || 0;
    const query = { userId: new ObjectId(req.user?.userId) };
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

async function generateSummary(videoId: string): Promise<string | null> {
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

    return summary;
  } catch (error) {
    console.error('Error generating summary:', error);
    return null;
  }
}

// Add new endpoint for the feed
app.get('/api/feed', auth, async (req: AuthRequest, res: Response) => {
    try {
        // Get all channels for the user
        const channels = await channelsCollection.find({ 
            userId: new ObjectId(req.user?.userId)
        }).toArray();
        
        // Get the latest video from each channel
        const latestVideos = await Promise.all(channels.map(async (channel: Channel) => {
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

                const summary = await generateSummary(video.id.videoId);
                if (!summary) return null;

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
                    summary,
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

        res.json({ url: session.url });
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

        // Count channels
        const channelsCount = await channelsCollection.countDocuments({
            userId: new ObjectId(req.user?.userId)
        });

        // Count videos this month
        const videosThisMonth = await videosCollection.countDocuments({
            userId: new ObjectId(req.user?.userId),
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
    if (!stripe) {
        return res.status(503).json({ error: 'Subscription service is currently unavailable' });
    }
    const sig = req.headers['stripe-signature'];

    try {
        const event = stripe.webhooks.constructEvent(
            req.body,
            sig as string,
            getStripeConfig().webhookSecret
        );

        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const userId = session.metadata?.userId;
                const planId = session.metadata?.planId;

                if (!userId || !planId) {
                    throw new Error('Missing metadata');
                }

                const plan = SUBSCRIPTION_PLANS.find(p => p.id === planId);
                if (!plan) {
                    throw new Error('Invalid plan');
                }

                await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    {
                        $set: {
                            tier: plan.tier,
                            subscriptionStatus: 'active',
                            stripeSubscriptionId: session.subscription as string,
                            currentPeriodEnd: new Date(session.expires_at! * 1000)
                        }
                    }
                );
                break;
            }

            case 'customer.subscription.updated':
            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription;
                const customer = await stripe.customers.retrieve(subscription.customer as string) as Stripe.Customer;
                const userId = customer.metadata?.userId;

                if (!userId) {
                    throw new Error('Missing user ID');
                }

                if (subscription.status === 'active') {
                    const periodEnd = (subscription as any).current_period_end;
                    await usersCollection.updateOne(
                        { _id: new ObjectId(userId) },
                        {
                            $set: {
                                subscriptionStatus: 'active',
                                currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : undefined
                            }
                        }
                    );
                } else {
                    await usersCollection.updateOne(
                        { _id: new ObjectId(userId) },
                        {
                            $set: {
                                subscriptionStatus: subscription.status,
                                tier: 'basic' // Downgrade to basic tier
                            }
                        }
                    );
                }
                break;
            }
        }

        res.json({ received: true });
    } catch (error: any) {
        console.error('Webhook error:', error);
        res.status(400).send(`Webhook Error: ${error.message}`);
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

        // Retrieve the checkout session
        const session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ['total_details.breakdown.discounts']
        });
        
        if (session.payment_status !== 'paid') {
            return res.status(400).json({ error: 'Payment not completed' });
        }

        // Get the subscription
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        
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

        // Update user's subscription status
        await usersCollection.updateOne(
            { _id: new ObjectId(user._id) },
            { 
                $set: { 
                    subscriptionStatus: 'active',
                    subscriptionId: subscription.id,
                    subscriptionTier: planId,
                    subscriptionStartDate: new Date(),
                    promoCode: promoCode // Store the promo code used
                }
            }
        );

        res.json({ 
            subscriptionStatus: 'active',
            message: 'Subscription activated successfully',
            promoCode: promoCode
        });
    } catch (error) {
        console.error('Error verifying subscription:', error);
        res.status(500).json({ error: 'Error verifying subscription' });
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