import { exec } from "child_process";
import util from "util";

const execAsync = util.promisify(exec);

export async function scrapeTweets(token: string): Promise<string[]> {
  try {
    const query = `"${token}" lang:en`
    const { stdout } = await execAsync(`python3 scraper/tweet_scraper.py "${query}" 20`);
    return JSON.parse(stdout);
  } catch (err) {
    console.error("Error scraping tweets:", err);
    return [];
  }
}
