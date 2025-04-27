# scraper/summarize_transcript.py

import os
import sys
from dotenv import load_dotenv
from openai import OpenAI
from youtube_transcript_api import YouTubeTranscriptApi
from googleapiclient.discovery import build
from urllib.parse import urlparse, parse_qs

# Load .env
load_dotenv()
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
youtube = build('youtube', 'v3', developerKey=os.getenv("YOUTUBE_API_KEY"))

def get_latest_video_id(channel_url: str):
    try:
        # Extract channel ID from URL
        parsed_url = urlparse(channel_url)
        channel_id = None
        
        # Handle different URL formats
        if 'channel' in parsed_url.path:
            channel_id = parsed_url.path.split('/')[-1]
        elif 'c/' in parsed_url.path:
            # For custom URLs
            channel_name = parsed_url.path.split('/')[-1]
            request = youtube.search().list(
                part="snippet",
                q=channel_name,
                type="channel",
                maxResults=1
            )
            response = request.execute()
            if response['items']:
                channel_id = response['items'][0]['id']['channelId']
        elif '@' in parsed_url.path:
            # Handle @username format
            username = parsed_url.path.split('/')[-1]
            # Get channel ID using the handle
            request = youtube.channels().list(
                part="id",
                forHandle=username.replace('@', '')
            )
            response = request.execute()
            if response['items']:
                channel_id = response['items'][0]['id']
        
        if not channel_id:
            raise ValueError("Could not extract channel ID from URL")

        # Get the latest video from the channel
        request = youtube.search().list(
            part="snippet",  # Changed to include snippet for more info
            channelId=channel_id,
            order="date",
            maxResults=1,
            type="video"
        )
        response = request.execute()
        
        if not response['items']:
            raise ValueError("No videos found in channel")
        
        # Print video details for debugging
        video = response['items'][0]
        print(f"\nLatest video found:")
        print(f"Title: {video['snippet']['title']}")
        print(f"Published: {video['snippet']['publishedAt']}")
            
        return video['id']['videoId']
    except Exception as e:
        return f"Error fetching videos from channel: {e}"


def get_transcript(video_id: str):
    try:
        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        full_text = ' '.join([entry['text'] for entry in transcript])
        return full_text
    except Exception as e:
        return f"Error retrieving transcript: {e}"

def summarize_text(text: str, model: str = "gpt-4.1-mini"):
    prompt = (
        "Summarize the following YouTube transcript into 5 bullet points:\n\n"
        f"{text}"
    )

    try:
        response = client.chat.completions.create(model=model,
        messages=[
            {"role": "system", "content": "You are a helpful assistant that summarizes YouTube videos."},
            {"role": "user", "content": prompt}
        ],
        temperature=0.5,
        max_tokens=400)
        return response.choices[0].message.content.strip()
    except Exception as e:
        return f"Error calling OpenAI API: {e}"

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage:\n  python scraper/summarize_transcript.py <video_id | channel_url>")
        sys.exit(1)

    input_value = sys.argv[1]

    if "youtube.com" in input_value:
        print(f"\n🔎 Fetching latest video from channel: {input_value}")
        video_id = get_latest_video_id(input_value)
    else:
        video_id = input_value

    if "Error" in video_id:
        print(video_id)
        sys.exit(1)

    print(f"\n📼 Fetching transcript for video ID: {video_id}")
    transcript = get_transcript(video_id)

    if "Error" in transcript:
        print(transcript)
    else:
        print("\n🧠 Generating summary...\n")
        summary = summarize_text(transcript)
        print(summary)
