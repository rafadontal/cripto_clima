"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initializeCollections = initializeCollections;
exports.startBackgroundJobs = startBackgroundJobs;
const server_1 = require("./server");
const server_2 = require("./server");
const server_3 = require("./server");
// Initialize MongoDB collections
let channelsCollection;
let videosCollection;
async function initializeCollections(client) {
    const db = client.db('youtube_summaries');
    channelsCollection = db.collection('channels');
    videosCollection = db.collection('videos');
}
// Rate limiting configuration
const RATE_LIMIT = {
    requestsPerBatch: 10,
    batchInterval: 15 * 60 * 1000 // 15 minutes
};
async function processChannelBatch(channels) {
    for (const channel of channels) {
        await checkChannelForNewVideos(channel);
        // Update lastUpdated timestamp
        await channelsCollection.updateOne({ _id: channel._id }, { $set: { lastUpdated: new Date() } });
    }
}
async function checkChannelForNewVideos(channel) {
    try {
        // Get channel ID
        const channelId = channel.channelId || await (0, server_2.getChannelId)(channel.channelUrl);
        if (!channelId) {
            console.error(`Could not get channel ID for: ${channel.channelUrl}`);
            return;
        }
        // Get latest video
        const response = await server_1.youtube.search.list({
            part: ['snippet'],
            channelId: channelId,
            order: 'date',
            maxResults: 1,
            type: ['video']
        });
        const video = response.data.items?.[0];
        if (!video?.id?.videoId || !video.snippet?.title || !video.snippet.publishedAt) {
            return;
        }
        // Check if we already have this video
        const existingVideo = await videosCollection.findOne({
            channelUrl: channel.channelUrl,
            videoId: video.id.videoId
        });
        if (existingVideo) {
            return;
        }
        // Generate summary for new video
        const result = await (0, server_3.generateSummary)(video.id.videoId);
        if (!result) {
            return;
        }
        // Save new video
        const videoInfo = {
            channelUrl: channel.channelUrl,
            videoId: video.id.videoId,
            title: video.snippet.title,
            publishedAt: video.snippet.publishedAt,
            summary: result.summary,
            transcript: result.transcript,
            createdAt: new Date()
        };
        await videosCollection.insertOne(videoInfo);
        console.log(`New video found and processed for channel: ${channel.channelUrl}`);
    }
    catch (error) {
        console.error(`Error checking channel ${channel.channelUrl}:`, error);
    }
}
async function startBackgroundJobs() {
    console.log('Starting background jobs...');
    // Run the job every 15 minutes
    setInterval(async () => {
        try {
            // Get channels that haven't been updated in the last 24 hours
            const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
            const channels = await channelsCollection.find({
                $or: [
                    { lastUpdated: { $lt: oneDayAgo } },
                    { lastUpdated: { $exists: false } }
                ]
            }).limit(RATE_LIMIT.requestsPerBatch).toArray();
            if (channels.length > 0) {
                console.log(`Processing batch of ${channels.length} channels`);
                await processChannelBatch(channels);
            }
        }
        catch (error) {
            console.error('Error in background job:', error);
        }
    }, RATE_LIMIT.batchInterval);
}
