import { Telegraf, Markup } from "telegraf";
import * as dotenv from "dotenv";
import { authMiddleware } from "./middleware/authMiddleware";
import { startHandler } from "./handlers/startHandler";

import { applySettingAction, batchSizeSettingsAction, directionSettingsAction, settingsHandler } from "./handlers/settingsHandler";
import { applyTopicAction, topicHandler } from "./handlers/topicHandler";

dotenv.config();

const token = process.env.TELEGRAM_BOT_TOKEN;

// Create dummy bot if token is not passed (e.g. during build parsing)
export const bot = new Telegraf(token || "DUMMY_TOKEN_FOR_BUILD");

// Middleware
bot.use(authMiddleware);

import { showFlashcardTranslationAction, startFlashcards, stopFlashcardsAction } from "./handlers/flashcardsHandler";
import { handleQuizAnswer, startQuiz } from "./handlers/quizHandler";

// Commands
bot.start(startHandler);
bot.command("settings", settingsHandler);
bot.command("topic", topicHandler);
bot.command("flashcards", startFlashcards);
bot.command("quiz", startQuiz);

bot.hears("📇 Карточки", startFlashcards);
bot.hears("❓ Квиз", startQuiz);
bot.hears("📚 Тема", topicHandler);
bot.hears("⚙ Настройки", settingsHandler);

// Actions
bot.action("setting_direction", directionSettingsAction);
bot.action("setting_batch_size", batchSizeSettingsAction);
bot.action("back_to_settings", async (ctx) => {
    await ctx.editMessageText(
        "⚙️ **Настройки бота**\n\nВыбери, что хочешь изменить:",
        Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Направление перевода", "setting_direction")],
            [Markup.button.callback("🔢 Объем квиза", "setting_batch_size")],
        ])
    );
});

bot.action(/^set_dir_/, applySettingAction);
bot.action(/^set_batch_/, applySettingAction);
bot.action(/^set_topic_/, applyTopicAction);

import { handleFlashcardRememberAction } from "./handlers/flashcardsHandler";

bot.action("flashcard_show_translation", showFlashcardTranslationAction);
bot.action("flashcard_stop", stopFlashcardsAction);
bot.action(/^flashcard_rem_/, handleFlashcardRememberAction);

bot.action(/^q_ans_/, handleQuizAnswer);
bot.action("quiz_stop", handleQuizAnswer);
