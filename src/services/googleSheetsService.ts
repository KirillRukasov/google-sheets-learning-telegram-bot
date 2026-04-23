import { google } from "googleapis";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

export interface DictionaryWord {
  id: string;
  topic: string; // The tab name
  es: string;
  ru: string;
  context: string;
}

export class GoogleSheetsService {
  private sheets = google.sheets("v4");
  private auth: any;

  constructor() {
    let authOptions: any = {
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    };
    
    // If running in local emulator or directly, attempt to use local credentials file
    const isLocal = process.env.FUNCTIONS_EMULATOR === "true" || !process.env.GCLOUD_PROJECT;
    if (isLocal) {
        // Adjust path depending on how it's executed (lib vs src)
        try {
            authOptions.keyFile = path.resolve(process.cwd(), "google-credentials.json");
        } catch (e) {
            console.warn("No google-credentials.json found locally. Please ensure it exists for local dev.");
        }
    }

    this.auth = new google.auth.GoogleAuth(authOptions);
  }

  /**
   * Fetches all words from all tabs in the spreadsheet
   */
  async fetchAllWords(): Promise<DictionaryWord[]> {
    const defaultSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
    if (!defaultSpreadsheetId) {
      throw new Error("GOOGLE_SPREADSHEET_ID is missing from environment variables");
    }

    const authClient = await this.auth.getClient();
    
    // Get metadata to discover all tabs
    const metadata = await this.sheets.spreadsheets.get({
        auth: authClient,
        spreadsheetId: defaultSpreadsheetId,
    });

    const sheetsList = metadata.data.sheets ?? [];
    let allWords: DictionaryWord[] = [];

    for (const sheet of sheetsList) {
        const topicName = sheet.properties?.title;
        if (!topicName) continue;

        // Fetch values (A: Spanish, B: Russian, C: Context). A2:C implies row 1 is header.
        try {
            const tableData = await this.sheets.spreadsheets.values.get({
                auth: authClient,
                spreadsheetId: defaultSpreadsheetId,
                range: `${topicName}!A2:C`,
            });
            
            const rows = tableData.data.values;
            if (rows && rows.length > 0) {
                const wordsFromTab = rows.map((row, index) => {
                    return {
                        id: `${topicName}_${index + 2}`, // e.g. Business_2
                        topic: topicName,
                        es: (row[0] || "").trim(),
                        ru: (row[1] || "").trim(),
                        context: (row[2] || "").trim()
                    } as DictionaryWord;
                }).filter(w => w.es && w.ru); // Skip empty rows

                allWords = allWords.concat(wordsFromTab);
            }
        } catch (err: any) {
             console.error(`Error fetching tab ${topicName}:`, err.message);
        }
    }

    return allWords;
  }
}
