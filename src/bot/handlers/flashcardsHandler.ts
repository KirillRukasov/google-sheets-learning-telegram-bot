import { Context, Markup } from "telegraf";
import * as admin from "firebase-admin";
import { DictionaryWord } from "../../services/googleSheetsService";

/**
 * Main entry for Flashcards mode.
 */
export const startFlashcards = async (ctx: Context) => {
    await sendNextFlashcard(ctx);
};

export const sendNextFlashcard = async (ctx: Context, editMessage = false) => {
    if (!ctx.from) return;
    
    const tgId = ctx.from.id.toString();
    const db = admin.firestore();

    // 1. Get user profile
    const userDoc = await db.collection("users").doc(tgId).get();
    const userData = userDoc.data() || {};
    const topic = userData.current_topic;
    const direction = userData.direction || "ES_RU"; // ES_RU or RU_ES

    if (!topic) {
        const msg = "Сначала выберите тему для тренировки с помощью команды /topic 📚";
        if (editMessage) await ctx.editMessageText(msg);
        else await ctx.reply(msg);
        return;
    }

    // 2. Fetch all words in topic
    const wordsSnapshot = await db.collection("words").where("topic", "==", topic).get();
    if (wordsSnapshot.empty) {
         const msg = `В теме "${topic}" пока нет слов.`;
         if (editMessage) await ctx.editMessageText(msg);
         else await ctx.reply(msg);
         return;
    }

    const words: DictionaryWord[] = wordsSnapshot.docs.map(d => d.data() as DictionaryWord);

    // 3. Fetch user's word progress for this topic
    const userWordsSnapshot = await db.collection("user_words")
        .where("user_id", "==", tgId)
        .where("topic", "==", topic)
        .get();

    const statsMap: Record<string, number> = {};
    userWordsSnapshot.docs.forEach(doc => {
        const d = doc.data();
        statsMap[d.word_id] = d.times_seen || 0;
    });

    // 4. Sort words by `times_seen` asc, so we prioritize the least seen words
    words.sort((a, b) => {
        const seenA = statsMap[a.id] || 0;
        const seenB = statsMap[b.id] || 0;
        // if same, shuffle randomly
        if (seenA === seenB) return Math.random() - 0.5;
        return seenA - Math.random() - (seenB - Math.random()); // Add variance
    });

    // Select the best word
    const targetWord = words[0];

    // 5. Update state in user config to remember current flashcard word
    await db.collection("users").doc(tgId).set({
        current_state: "FLASHCARDS",
        current_flashcard_id: targetWord.id
    }, { merge: true });

    // 6. Present the card
    // Depends on direction
    const sourceWord = direction === "ES_RU" ? targetWord.es : targetWord.ru;
    const langFlag = direction === "ES_RU" ? "🇪🇸" : "🇷🇺";

    const text = `📇 **Карточка**\nТема: ${topic}\n\n${langFlag} **${sourceWord}**`;
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("👀 Показать перевод", "flashcard_show_translation")],
        [Markup.button.callback("🛑 Закончить", "flashcard_stop")]
    ]);

    if (editMessage) {
        await ctx.editMessageText(text, keyboard).catch(() => {});
    } else {
        await ctx.reply(text, keyboard);
    }
};

export const showFlashcardTranslationAction = async (ctx: Context) => {
    if (!ctx.from) return;
    
    // Immediate acknowledgement and double-click prevention
    try { await ctx.answerCbQuery(); } catch(e){}
    try { await ctx.editMessageReplyMarkup(undefined); } catch(e){}
    
    const tgId = ctx.from.id.toString();
    const db = admin.firestore();
    
    // Get current word
    const userDoc = await db.collection("users").doc(tgId).get();
    const userData = userDoc.data() || {};
    const wordId = userData.current_flashcard_id;
    const direction = userData.direction || "ES_RU";
    const topic = userData.current_topic;

    if (!wordId) {
        await ctx.answerCbQuery("Карточка устарела. Начните заново!");
        return;
    }

    const wordDoc = await db.collection("words").doc(wordId).get();
    if (!wordDoc.exists) {
        await ctx.answerCbQuery("Слово не найдено.");
        return;
    }

    const word = wordDoc.data() as DictionaryWord;
    const sourceWord = direction === "ES_RU" ? word.es : word.ru;
    const transWord = direction === "ES_RU" ? word.ru : word.es;
    const srcFlag = direction === "ES_RU" ? "🇪🇸" : "🇷🇺";
    const trFlag = direction === "ES_RU" ? "🇷🇺" : "🇪🇸";

    // Build revealed text
    let text = `📇 **Карточка**\nТема: ${topic}\n\n`;
    text += `${srcFlag} **${sourceWord}**\n`;
    text += `${trFlag} Перевод: *${transWord}*\n`;
    
    if (word.context) {
        text += `\n📝 Контекст: _${word.context}_`;
    }

    await ctx.editMessageText(text, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [
                Markup.button.callback("✅ Помню", "flashcard_rem_yes"),
                Markup.button.callback("❌ Не помню", "flashcard_rem_no")
            ],
            [Markup.button.callback("🛑 Закончить", "flashcard_stop")]
        ])
    });

};

export const handleFlashcardRememberAction = async (ctx: Context) => {
    if (!ctx.from || !('data' in ctx.callbackQuery!)) return;
    
    // Quick acknowledge to prevent button loading state timeout
    try { await ctx.answerCbQuery(); } catch(e){}

    // Immediately remove the inline keyboard to prevent double clicks while processing
    try { await ctx.editMessageReplyMarkup(undefined); } catch(e){}

    const tgId = ctx.from.id.toString();
    const db = admin.firestore();
    const dataString = (ctx.callbackQuery as any).data;
    
    const remembered = dataString === "flashcard_rem_yes";

    // Get current word
    const userDoc = await db.collection("users").doc(tgId).get();
    const userData = userDoc.data() || {};
    const wordId = userData.current_flashcard_id;
    const topic = userData.current_topic;

    if (!wordId) {
        await ctx.editMessageText("Карточка устарела. Начните заново!");
        return;
    }

    if (remembered) {
        // Increment times_seen in user_words only if remembered
        const userWordRef = db.collection("user_words").doc(`${tgId}_${wordId}`);
        
        await db.runTransaction(async (t) => {
            const doc = await t.get(userWordRef);
            if (doc.exists) {
                const currentSeen = doc.data()?.times_seen || 0;
                t.update(userWordRef, { times_seen: currentSeen + 1 });
            } else {
                t.set(userWordRef, {
                    user_id: tgId,
                    word_id: wordId,
                    topic: topic,
                    times_seen: 1,
                    interval: 0,
                    streak: 0,
                    next_review_date: admin.firestore.FieldValue.serverTimestamp()
                });
            }
        });
    }

    // Immediately fetch and show next card
    await sendNextFlashcard(ctx, true);
};

export const stopFlashcardsAction = async (ctx: Context) => {
    if (!ctx.from) return;

    try { await ctx.answerCbQuery(); } catch(e){}
    try { await ctx.editMessageReplyMarkup(undefined); } catch(e){}

    const db = admin.firestore();
    const tgId = ctx.from.id.toString();

    await db.collection("users").doc(tgId).set({
        current_state: "IDLE",
        current_flashcard_id: null
    }, { merge: true });

    await ctx.editMessageText("Тренировка по карточкам завершена! Вы отлично справились. 🎉");
};
