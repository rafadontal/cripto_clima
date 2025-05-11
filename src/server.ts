import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { OpenAI } from 'openai';
import { google } from 'googleapis';
import { YoutubeTranscript } from 'youtube-transcript';
import path from 'path';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// MongoDB connection
let client: MongoClient;
let db: any;
let channelsCollection: any;
let videosCollection: any;

async function connectToMongo() {
  try {
    client = new MongoClient(process.env.MONGODB_URI || '');
    await client.connect();
    console.log('Connected to MongoDB');
    db = client.db('youtube_summaries');
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

// Routes
app.get('/', (req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Add a new channel
app.post('/api/channels', async (req: Request, res: Response) => {
  try {
    const { channelUrl } = req.body;
    if (!channelUrl) {
      return res.status(400).json({ error: 'Channel URL is required' });
    }

    // Check if channel already exists
    const existingChannel = await channelsCollection.findOne({ channelUrl });
    if (existingChannel) {
      return res.status(400).json({ error: 'Channel already exists' });
    }

    // Store the channel
    const channelInfo = {
      channelUrl,
      createdAt: new Date()
    };

    await channelsCollection.insertOne(channelInfo);
    res.json(channelInfo);
  } catch (error) {
    console.error('Error adding channel:', error);
    res.status(500).json({ error: 'Failed to add channel' });
  }
});

// Get all channels
app.get('/api/channels', async (req: Request, res: Response) => {
  try {
    const channels = await channelsCollection.find({}).toArray();
    res.json(channels);
  } catch (error) {
    console.error('Error getting channels:', error);
    res.status(500).json({ error: 'Failed to get channels' });
  }
});

// Get latest video summary for a channel
app.get('/api/channels/:channelUrl/video', async (req: Request, res: Response) => {
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
    const videoInfo = {
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
  if (!video || !video.id?.videoId || !video.snippet) {
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
          content: "You are a helpful assistant that summarizes YouTube videos."
        },
        {
          role: "user",
          content: `Summarize the following YouTube transcript into 5 bullet points:\n\n${text}`
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