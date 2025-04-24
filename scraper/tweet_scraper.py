# tweet_scraper.py
import sys
import json
import snscrape.modules.twitter as sntwitter # type: ignore

query = sys.argv[1]
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 50
tweets = []

for i, tweet in enumerate(sntwitter.TwitterSearchScraper(query).get_items()):
    if i >= limit:
        break
    tweets.append(tweet.content)

print(json.dumps(tweets))
