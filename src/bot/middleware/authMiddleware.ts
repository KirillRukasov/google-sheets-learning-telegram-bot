import { Context } from "telegraf";
import * as admin from "firebase-admin";

export const authMiddleware = async (ctx: Context, next: () => Promise<void>) => {
  if (!ctx.from) {
    return;
  }

  const tgId = ctx.from.id.toString();
  const db = admin.firestore();

  try {
    const userDoc = await db.collection("allowed_users").doc(tgId).get();
    
    if (!userDoc.exists) {
      console.log(`Unauthorized access attempt from tgId: ${tgId}`);
      // "Если пользователя нет в списке, то бот игнорирует сообщения пользователя"
      return; 
    }

    // User is authorized
    await next();
  } catch (error) {
    console.error("Auth Middleware Error:", error);
  }
};
