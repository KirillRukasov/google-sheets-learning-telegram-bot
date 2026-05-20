import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GoogleSheetsService } from "./services/googleSheetsService";
import { FirestoreService } from "./services/firestoreService";
import { bot } from "./bot/bot";

admin.initializeApp();

// Export the telegram bot webhook handler
export const botWebhook = functions.https.onRequest(async (request, response) => {
  try {
     // Telegraf needs to handle the HTTP requests
     await bot.handleUpdate(request.body, response);
  } catch (e: any) {
     console.error("Webhook processing error:", e);
     if (!response.headersSent) {
        response.status(500).send("Server Error");
     }
  }
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
