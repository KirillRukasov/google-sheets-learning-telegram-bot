import { Context, Markup } from "telegraf";
import * as admin from "firebase-admin";

export const startHandler = async (ctx: Context) => {
    if (!ctx.from) return;

    const tgId = ctx.from.id.toString();
    const db = admin.firestore();
    
    // Create or update basic user profile on start
    const userRef = db.collection("users").doc(tgId);
    await userRef.set({
        telegram_id: tgId,
        first_name: ctx.from.first_name,
        direction: "ES_RU", // Default
        quiz_batch_size: 10,  // Default
        current_state: "IDLE"
    }, { merge: true });

    const keyboard = Markup.keyboard([
        ["📇 Карточки", "❓ Квиз"],
        ["📚 Тема", "⚙ Настройки"]
    ]).resize();

    await ctx.reply(
        `Привет, ${ctx.from.first_name}! 👋\n\n` +
        `Я твой Serverless бот-тренажер для изучения лексики.\n\n` +
        `📌 **Доступные команды:**\n` +
        `📇 **Карточки** (/flashcards) — бесконечный режим повторения. Показывает новые и забытые слова.\n` +
        `❓ **Квиз** (/quiz) — тест с 4 вариантами ответа. Умный алгоритм запоминает ваши успехи и увеличивает интервал повторения (SRS).\n` +
        `📚 **Тема** (/topic) — переключение активного словаря (вкладки из таблицы).\n` +
        `⚙ **Настройки** (/settings) — выбор направления перевода и настройка количества слов в раунде Квиза.\n\n` +
        `Используй удобные кнопки внизу экрана для быстрого доступа ко всем режимам!`,
        keyboard
    );
};
