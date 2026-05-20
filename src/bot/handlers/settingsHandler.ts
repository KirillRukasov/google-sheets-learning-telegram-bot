import { Context, Markup } from "telegraf";
import * as admin from "firebase-admin";

export const settingsHandler = async (ctx: Context) => {
    // Basic settings menu
    await ctx.reply(
        "⚙️ **Настройки бота**\n\nВыбери, что хочешь изменить:",
        Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Направление перевода", "setting_direction")],
            [Markup.button.callback("🔢 Объем квиза", "setting_batch_size")],
        ])
    );
};

export const directionSettingsAction = async (ctx: Context) => {
    await ctx.editMessageText("Выбери направление перевода:", Markup.inlineKeyboard([
        [Markup.button.callback("🇪🇸 ES ➔ 🇷🇺 RU", "set_dir_ES_RU")],
        [Markup.button.callback("🇷🇺 RU ➔ 🇪🇸 ES", "set_dir_RU_ES")],
        [Markup.button.callback("🔙 Назад", "back_to_settings")]
    ]));
};

export const batchSizeSettingsAction = async (ctx: Context) => {
    await ctx.editMessageText("Сколько слов учим за один подход Quiz?", Markup.inlineKeyboard([
        [
            Markup.button.callback("10", "set_batch_10"),
            Markup.button.callback("20", "set_batch_20"),
            Markup.button.callback("50", "set_batch_50")
        ],
        [Markup.button.callback("🔙 Назад", "back_to_settings")]
    ]));
};

export const applySettingAction = async (ctx: Context) => {
    if (!ctx.from || !('data' in ctx.callbackQuery!)) return;
    
    const db = admin.firestore();
    const tgId = ctx.from.id.toString();
    const action = (ctx.callbackQuery as any).data;

    let update = {};
    if (action === "set_dir_ES_RU") update = { direction: "ES_RU" };
    else if (action === "set_dir_RU_ES") update = { direction: "RU_ES" };
    else if (action === "set_batch_10") update = { quiz_batch_size: 10 };
    else if (action === "set_batch_20") update = { quiz_batch_size: 20 };
    else if (action === "set_batch_50") update = { quiz_batch_size: 50 };

    await db.collection("users").doc(tgId).set(update, { merge: true });
    await ctx.answerCbQuery("✅ Настройки сохранены!");
    
    // Go back to top settings
    await directionSettingsAction(ctx); // trick to just edit instead of sending new msg, let's just do a proper back:
    await ctx.editMessageText(
        "⚙️ **Настройки бота**\n\nНастройки обновлены! Выбери, что хочешь изменить:",
        Markup.inlineKeyboard([
            [Markup.button.callback("🔄 Направление перевода", "setting_direction")],
            [Markup.button.callback("🔢 Объем квиза", "setting_batch_size")],
        ])
    );
};
