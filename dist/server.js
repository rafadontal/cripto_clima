"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const mongodb_1 = require("mongodb");
const openai_1 = require("openai");
const googleapis_1 = require("googleapis");
const youtube_transcript_1 = require("youtube-transcript");
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
const app = (0, express_1.default)();
const port = process.env.PORT || 3000;
// Middleware
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(__dirname, '../public')));
// MongoDB connection
let client;
let db;
let channelsCollection;
let videosCollection;
async function connectToMongo() {
    try {
        client = new mongodb_1.MongoClient(process.env.MONGODB_URI || '');
        await client.connect();
        console.log('Connected to MongoDB');
        db = client.db('youtube_summaries');
        channelsCollection = db.collection('channels');
        videosCollection = db.collection('videos');
    }
    catch (error) {
        console.error('MongoDB connection error:', error);
        process.exit(1);
    }
}
// YouTube API setup
const youtube = googleapis_1.google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});
// OpenAI setup
const openai = new openai_1.OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});
// Routes
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(__dirname, '../public/index.html'));
});
// Add a new channel
app.post('/api/channels', async (req, res) => {
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
    }
    catch (error) {
        console.error('Error adding channel:', error);
        res.status(500).json({ error: 'Failed to add channel' });
    }
});
// Get all channels
app.get('/api/channels', async (req, res) => {
    try {
        const channels = await channelsCollection.find({}).toArray();
        res.json(channels);
    }
    catch (error) {
        console.error('Error getting channels:', error);
        res.status(500).json({ error: 'Failed to get channels' });
    }
});
// Get latest video summary for a channel
app.get('/api/channels/:channelUrl/video', async (req, res) => {
    try {
        const { channelUrl } = req.params;
        console.log('Processing channel:', channelUrl);
        // Check for existing recent video in database
        const recentVideo = await videosCollection.findOne({ channelUrl }, { sort: { createdAt: -1 } });
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
    }
    catch (error) {
        console.error('Error getting video summary:', error);
        res.status(500).json({ error: 'Failed to get video summary' });
    }
});
// Helper functions
async function getChannelId(channelUrl) {
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
    }
    catch (error) {
        console.error('Error getting channel ID:', error);
        return null;
    }
}
async function getLatestVideo(channelId) {
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
async function generateSummary(videoId) {
    try {
        const transcript = await youtube_transcript_1.YoutubeTranscript.fetchTranscript(videoId);
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
    }
    catch (error) {
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
