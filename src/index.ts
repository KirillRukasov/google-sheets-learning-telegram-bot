import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GoogleSheetsService } from "./services/googleSheetsService";
import { FirestoreService } from "./services/firestoreService";

admin.initializeApp();

// Export the telegram bot webhook handler
export const botWebhook = functions.https.onRequest(async (request, response) => {
  // We will pass the request to the Telegraf bot instance later
  response.status(200).send("Bot Webhook is running");
});

// Export the scheduled function for daily sync from Google Sheets
export const syncWordsDaily = functions.pubsub
  .schedule("every 24 hours")
  .onRun(async (context) => {
    try {
      console.log("Starting daily synchronization from Google Sheets...");
      const sheetsService = new GoogleSheetsService();
      const firestoreService = new FirestoreService();

      const words = await sheetsService.fetchAllWords();
      await firestoreService.syncWords(words);
      console.log("Daily sync completed!");
    } catch (error: any) {
      console.error("Failed daily sync form Google Sheets:", error.message);
    }
    return null;
  });
