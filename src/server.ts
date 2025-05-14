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
import { auth } from './middleware/auth';
import { AuthRequest, User, Channel, Video } from './types';

dotenv.config();

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
app.use(express.static(path.join(__dirname, '../public')));

// MongoDB connection
let client: MongoClient;
let db: any;
let usersCollection: any;
let channelsCollection: any;
let videosCollection: any;

async function connectToMongo() {
  try {
    client = new MongoClient(process.env.MONGODB_URI || '');
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db('youtube_summaries');
    usersCollection = db.collection('users');
    channelsCollection = db.collection('channels');
    videosCollection = db.collection('videos');
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
        createdAt: new Date()
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
      createdAt: new Date()
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
    res.json({ token });
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

app.get('/api/channels', auth, async (req: AuthRequest, res: Response) => {
  try {
    const channels = await channelsCollection.find({ 
      userId: new ObjectId(req.user?.userId)
    }).toArray();
    res.json(channels);
  } catch (error) {
    console.error('Error getting channels:', error);
    res.status(500).json({ error: 'Failed to get channels' });
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
    const text = transcript.map(item => item.text).join(' ');

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant that summarizes YouTube videos and give insights into the video."
        },
        {
          role: "user",
          content: `Summarize the following YouTube transcript into 5 bullet points. If the video is talking about specific crypto tokens, please include the token names in the summary and if the sentiment is positive or negative, please include that in the summary.:\n\n${text}`
        }
      ],
      temperature: 0.5,
      max_tokens: 400
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error generating summary:', error);
    return null;
  }
}

// Start server
connectToMongo().then(() => {
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}); 