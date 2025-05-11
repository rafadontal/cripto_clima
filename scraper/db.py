from pymongo import MongoClient
from dotenv import load_dotenv
import os
from datetime import datetime, timedelta

# Load environment variables
load_dotenv()

# Get MongoDB connection string from environment variables
MONGODB_URI = os.getenv("MONGODB_URI")

# Create MongoDB client
client = MongoClient(MONGODB_URI)
db = client['youtube_summaries']
collection = db['video_summaries']

def get_video_summary(video_id: str):
    """Get video summary from database if it exists"""
    return collection.find_one({"video_id": video_id})

def get_recent_channel_video(channel_url: str, hours: int = 24):
    """Get the most recent video from a channel within the specified hours"""
    # Calculate the time threshold
    time_threshold = datetime.utcnow() - timedelta(hours=hours)
    
    # Find the most recent video from this channel
    recent_video = collection.find_one(
        {
            "channel_url": channel_url,
            "created_at": {"$gte": time_threshold}
        },
        sort=[("created_at", -1)]  # Sort by created_at in descending order
    )
    
    return recent_video

def save_video_summary(video_data: dict):
    """Save video summary to database"""
    # Check if video already exists
    existing = collection.find_one({"video_id": video_data["video_id"]})
    if existing:
        return existing
    
    # Insert new video data
    result = collection.insert_one(video_data)
    return collection.find_one({"_id": result.inserted_id}) 