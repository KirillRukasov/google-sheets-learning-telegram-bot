import * as admin from "firebase-admin";
import { DictionaryWord } from "./googleSheetsService";

export class FirestoreService {
  private db = admin.firestore();

  /**
   * Clears old words and imports new ones, grouped by topic.
   */
  async syncWords(words: DictionaryWord[]) {
    // We can use a batch write to store all words efficiently
    const wordsRef = this.db.collection("words");
    
    // In a production app with thousands of words, you might want to delete the old collection first
    // or run a smart diff. For now, wiping and writing is fine, or just overwriting based on ID.
    // The ID is `<topicName>_<row_index>`.
    
    // Firestore batches allow max 500 operations. We split if necessary.
    const batches = [];
    let currentBatch = this.db.batch();
    let opCount = 0;

    for (const word of words) {
        const docRef = wordsRef.doc(word.id);
        currentBatch.set(docRef, word);
        opCount++;

        if (opCount === 490) { // stay under 500
            batches.push(currentBatch);
            currentBatch = this.db.batch();
            opCount = 0;
        }
    }

    if (opCount > 0) {
        batches.push(currentBatch);
    }

    // Execute all batches
    for (const batch of batches) {
        await batch.commit();
    }
    
    // Save unique topics to global config
    const uniqueTopics = Array.from(new Set(words.map(w => w.topic)));
    await this.db.collection("global").doc("config").set({
        topics: uniqueTopics,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`Successfully synced ${words.length} words to Firestore.`);
  }

}
