import { Context, Markup } from "telegraf";
import * as admin from "firebase-admin";

export const topicHandler = async (ctx: Context) => {
    const db = admin.firestore();
    const configDoc = await db.collection("global").doc("config").get();
    
    if (!configDoc.exists) {
        await ctx.reply("Темы еще не загружены. Подождите первой синхронизации из таблиц.");
        return;
    }

    const topics: string[] = configDoc.data()?.topics || [];
    
    if (topics.length === 0) {
        await ctx.reply("Открытых тем пока нет.");
        return;
    }

    // Build buttons
    // Since telegraf markup limits row size, we slice into rows of 2
    const buttons = topics.map(t => Markup.button.callback(t, `set_topic_${t}`));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) {
        rows.push(buttons.slice(i, i + 2));
    }

    await ctx.reply("📚 **Выбери тему для тренировки:**", Markup.inlineKeyboard(rows));
};

export const applyTopicAction = async (ctx: Context) => {
    if (!ctx.from || !('data' in ctx.callbackQuery!)) return;
    
    const db = admin.firestore();
    const tgId = ctx.from.id.toString();
    const dataString = (ctx.callbackQuery as any).data;
    
    const chosenTopic = dataString.replace("set_topic_", "");
    
    await db.collection("users").doc(tgId).set({ current_topic: chosenTopic }, { merge: true });
    
    await ctx.answerCbQuery(`Тема выбрана: ${chosenTopic}`);
    await ctx.editMessageText(`✅ Вы выбрали тему: **${chosenTopic}**.\nТеперь можно начать тренировку!`);
};
