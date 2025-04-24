#source venv/bin/activate

import os
import json # Added import for json handling in main block
import logging
import time
from typing import List, Optional, Dict

from dotenv import load_dotenv
from youtubesearchpython import VideosSearch
from youtube_transcript_api import YouTubeTranscriptApi
from openai import OpenAI

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Load environment variables and initialize OpenAI client
load_dotenv()
try:
    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    if not os.getenv("OPENAI_API_KEY"):
        logger.warning("OPENAI_API_KEY environment variable not set.")
except Exception as e:
    logger.error(f"Failed to initialize OpenAI client: {e}")
    # Depending on your application's needs, you might want to exit or handle this differently.
    client = None # Ensure client is None if initialization fails

def get_video_ids(keyword: str, max_results: int = 3) -> List[str]:
    """Search YouTube and return video IDs with error handling"""
    video_ids = []
    try:
        # Removed custom session creation - library handles this
        videos_search = VideosSearch(
            keyword,
            limit=max_results,
            language='en',
            region='US'
            # Removed the 'session' argument
        )
        results = videos_search.result()

        # Add checks for results and 'result' key existence
        if results and 'result' in results and results['result']:
            video_ids = [video['id'] for video in results['result'] if video.get('id')]
            logger.info(f"Found {len(video_ids)} video IDs for keyword '{keyword}'.")
        else:
            logger.warning(f"No search results found for keyword '{keyword}'.")

    except Exception as e:
        logger.error(f"Youtube failed for keyword '{keyword}': {e}", exc_info=True) # Added exc_info for detailed traceback
    return video_ids

def get_transcript(video_id: str) -> Optional[str]:
    """Fetch transcript with enhanced error handling"""
    try:
        # Fetch available transcripts first to check for English
        available_transcripts = YouTubeTranscriptApi.list_transcripts(video_id)
        transcript_en = available_transcripts.find_generated_transcript(['en'])

        # Fetch the actual transcript data
        transcript_list = transcript_en.fetch()

        # Combine transcript text
        full_transcript = ' '.join([entry['text'] for entry in transcript_list])
        logger.info(f"Successfully fetched transcript for video ID: {video_id}")
        return full_transcript

    except Exception as e:
        logger.warning(f"Could not retrieve transcript for video ID {video_id}: {e}")
        return None

def analyze_sentiment(transcript: str) -> Optional[Dict[str, str]]:
    """Analyze sentiment with structured output and error handling"""
    if not client:
        logger.error("OpenAI client not initialized. Cannot analyze sentiment.")
        return None
    if not transcript:
        logger.warning("Transcript is empty. Cannot analyze sentiment.")
        return None

    # Ensure transcript isn't excessively long (check OpenAI model limits if needed)
    max_length = 15000 # Adjust as needed based on model context window
    truncated_transcript = transcript[:max_length]

    prompt = f"""
    Analyze the sentiment and content of the following YouTube video transcript, which is about cryptocurrency:

    Transcript excerpt:
    "{truncated_transcript}..."

    Please return your analysis as a JSON object with the following keys:
    - "summary": A concise 2-3 sentence summary of the main points discussed in the transcript excerpt.
    - "sentiment": Classify the overall sentiment towards the main crypto topic (e.g., Bitcoin ETF) as "positive", "neutral", or "negative".
    - "confidence": Your confidence level in the sentiment classification, as a float between 0.0 (low confidence) and 1.0 (high confidence).
    - "key_topics": A list of the 3-5 most important keywords or topics mentioned.

    Ensure the output is valid JSON.
    """

    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo-1106",
            response_format={ "type": "json_object" },
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            # Consider adding max_tokens if needed, though response_format helps
        )
        analysis_content = response.choices[0].message.content
        logger.debug(f"Raw OpenAI response content: {analysis_content}") # Debug log

        # Add error handling for JSON parsing
        try:
            analysis_json = json.loads(analysis_content)
            logger.info("Successfully analyzed transcript sentiment.")
            return analysis_json
        except json.JSONDecodeError as json_e:
            logger.error(f"Failed to parse JSON response from OpenAI: {json_e}. Response was: {analysis_content}")
            return {"error": "Failed to parse OpenAI JSON response", "raw_response": analysis_content}

    except Exception as e:
        logger.error(f"OpenAI API call failed during sentiment analysis: {e}", exc_info=True)
        return {"error": f"OpenAI API error: {str(e)}"}


def process_videos(keyword: str, max_results: int = 3):
    """Main processing pipeline"""
    video_ids = get_video_ids(keyword, max_results)
    if not video_ids:
        logger.error(f"No video IDs found for keyword '{keyword}'. Stopping processing.")
        return # Stop if no videos are found

    processed_count = 0
    for video_id in video_ids:
        # Use standard YouTube URL format for logging clarity
        logger.info(f"Processing video: https://www.youtube.com/watch?v={video_id}")

        transcript = get_transcript(video_id)
        if transcript:
            analysis = analyze_sentiment(transcript)
            if analysis: # Only yield if analysis was successful
                 processed_count += 1
                 yield {
                    "video_id": video_id,
                    "video_url": f"https://www.youtube.com/watch?v={video_id}", # Added URL for convenience
                    # Keep transcript excerpt short for overview
                    "transcript_excerpt": transcript[:200] + ("..." if len(transcript) > 200 else ""),
                    "analysis": analysis
                 }
            else:
                 logger.warning(f"Skipping video {video_id} due to analysis failure.")
        else:
            logger.warning(f"Skipping video {video_id} due to missing transcript.")

        # Optional: Add a small delay to be polite to APIs, even if not strictly rate limited
        time.sleep(0.5) # Reduced sleep time slightly

    logger.info(f"Finished processing. Successfully analyzed {processed_count} out of {len(video_ids)} videos found.")


if __name__ == "__main__":
    search_keyword = "bitcoin ETF review" # Example keyword
    num_results = 2 # Number of videos to process

    logger.info(f"Starting video processing for keyword: '{search_keyword}' (max {num_results} results)...")
    results = list(process_videos(search_keyword, num_results))

    if results:
        print("\n--- Analysis Results ---")
        print(json.dumps(results, indent=2))
        print("----------------------")
    else:
        print("\nNo videos could be processed successfully.")

    logger.info("Script finished.")