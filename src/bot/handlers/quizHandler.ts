import { Context, Markup } from "telegraf";
import * as admin from "firebase-admin";
import { DictionaryWord } from "../../services/googleSheetsService";

/** Helper to shuffle an array */
function shuffleArray<T>(array: T[]): T[] {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

export const startQuiz = async (ctx: Context) => {
    if (!ctx.from) return;
    
    const tgId = ctx.from.id.toString();
    const db = admin.firestore();

    const userRef = db.collection("users").doc(tgId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    const topic = userData.current_topic;
    const batchSize = userData.quiz_batch_size || 10;
    
    if (!topic) {
        await ctx.reply("Сначала выберите тему для тренировки с помощью команды /topic 📚");
        return;
    }

    // 1. Fetch available words for this topic
    const wordsSnapshot = await db.collection("words").where("topic", "==", topic).get();
    if (wordsSnapshot.empty) {
        await ctx.reply(`В теме "${topic}" пока нет слов.`);
        return;
    }
    const allWords = wordsSnapshot.docs.map(d => d.data() as DictionaryWord);

    // 2. Fetch user progress
    const userWordsSnapshot = await db.collection("user_words")
        .where("user_id", "==", tgId)
        .where("topic", "==", topic)
        .get();

    const now = admin.firestore.Timestamp.now();
    let dueWordsIds: string[] = [];
    let newWordsIds: string[] = [];

    const progressMap: Record<string, any> = {};

    userWordsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        progressMap[data.word_id] = data;
        if (data.next_review_date && data.next_review_date.toMillis() <= now.toMillis()) {
            dueWordsIds.push(data.word_id);
        }
    });

    // Find words that the user has never seen (no progress mapping)
    allWords.forEach(w => {
        if (!progressMap[w.id]) {
            newWordsIds.push(w.id);
        }
    });

    // Combine due words and new words for the quiz queue
    shuffleArray(dueWordsIds);
    shuffleArray(newWordsIds);
    
    let queueObj = [...dueWordsIds, ...newWordsIds].slice(0, batchSize);

    if (queueObj.length === 0) {
        // If they did everything perfectly and there are no due or new words
        // just give them random words from the topic
        const allIds = allWords.map(w => w.id);
        queueObj = shuffleArray(allIds).slice(0, batchSize);
    }

    // Initialize Quiz session in DB
    await userRef.set({
        current_state: "QUIZ",
        quiz_queue: queueObj,
        quiz_stats: { correct: 0, wrong: 0, total: queueObj.length }
    }, { merge: true });

    await ctx.reply(`🚀 Начинаем квиз!\nТема: ${topic}\nСлов в подходе: ${queueObj.length}`);
    await sendNextQuizQuestion(ctx);
};

export const sendNextQuizQuestion = async (ctx: Context) => {
    if (!ctx.from) return;
    const tgId = ctx.from.id.toString();
    const db = admin.firestore();

    const userRef = db.collection("users").doc(tgId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    
    const queue = userData.quiz_queue || [];
    const stats = userData.quiz_stats || { correct: 0, wrong: 0, total: 0 };
    const direction = userData.direction || "ES_RU";
    const topic = userData.current_topic;

    if (queue.length === 0) {
        // Quiz is over
        await userRef.set({ current_state: "IDLE", quiz_queue: null }, { merge: true });
        await ctx.reply(
            `🏁 **Квиз завершен!**\n\n` +
            `📊 Статистика:\n` +
            `✅ Правильно: ${stats.correct}\n` +
            `❌ Ошибок: ${stats.wrong}\n\n` +
            `Отличная работа! Можешь запустить /quiz снова или выбрать другую /topic.`
        );
        return;
    }

    // Next word up
    const targetWordId = queue[0];
    const wordDoc = await db.collection("words").doc(targetWordId).get();
    const targetWord = wordDoc.data() as DictionaryWord;

    // Fetch 3 random options
    const allTopicWordsSnap = await db.collection("words").where("topic", "==", topic).get();
    let otherWords = allTopicWordsSnap.docs
        .map(d => d.data() as DictionaryWord)
        .filter(w => w.id !== targetWordId);

    otherWords = shuffleArray(otherWords).slice(0, 3);
    const options = [targetWord, ...otherWords];
    const shuffledOptions = shuffleArray(options);

    // Build question
    const qWord = direction === "ES_RU" ? targetWord.es : targetWord.ru;
    const qFlag = direction === "ES_RU" ? "🇪🇸" : "🇷🇺";

    const text = `❓ **Вопрос** (${stats.total - queue.length + 1}/${stats.total})\n\n${qFlag} Слово: **${qWord}**\n\nВыберите верный перевод:`;

    // Limit callback data characters. Using format: q_ans_<0|1>
    // We will store the current correct answer ID in the user session temporarily to avoid long callback_data
    await userRef.set({ current_quiz_word_id: targetWordId }, { merge: true });

    const buttons = shuffledOptions.map(opt => {
        const aWord = direction === "ES_RU" ? opt.ru : opt.es;
        const isCorrect = opt.id === targetWordId ? "1" : "0";
        // callback_data: q_ans_1_wordid (max 64 chars)
        // word.id can be long, so we just use q_ans_0 / q_ans_1 since we know the target from session
        return [Markup.button.callback(aWord, `q_ans_${isCorrect}_${opt.id}`)];
    });

    buttons.push([Markup.button.callback("❌ Прервать квиз", "quiz_stop")]);

    await ctx.reply(text, Markup.inlineKeyboard(buttons));
};

export const handleQuizAnswer = async (ctx: Context) => {
    if (!ctx.from || !('data' in ctx.callbackQuery!)) return;
    
    // Quick acknowledge to prevent button loading state timeout
    try { await ctx.answerCbQuery(); } catch(e){}

    const tgId = ctx.from.id.toString();
    const db = admin.firestore();
    const dataString = (ctx.callbackQuery as any).data; // e.g. q_ans_1_topic1_123

    if (dataString === "quiz_stop") {
        await db.collection("users").doc(tgId).set({ current_state: "IDLE", quiz_queue: null }, { merge: true });
        await ctx.editMessageText("Квиз прерван. 🛑");
        return;
    }

    const parts = dataString.split("_"); // ["q", "ans", "1", "wordId..."]
    const isCorrect = parts[2] === "1";
    // const selectedOptionId = parts.slice(3).join("_"); // Recombine word ID

    const userRef = db.collection("users").doc(tgId);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    
    let queue: string[] = userData.quiz_queue || [];
    const stats = userData.quiz_stats || { correct: 0, wrong: 0, total: queue.length };
    const targetWordId = userData.current_quiz_word_id;
    const topic = userData.current_topic;
    // const direction = userData.direction || "ES_RU";

    if (!targetWordId || queue.length === 0 || queue[0] !== targetWordId) {
        await ctx.editMessageText("Этот вопрос уже не актуален.");
        return;
    }

    // Fetch target word info to show right answer
    const wordDoc = await db.collection("words").doc(targetWordId).get();
    const targetWordData = wordDoc.data() as DictionaryWord;
    // const correctTranslation = direction === "ES_RU" ? targetWordData.ru : targetWordData.es;

    // Remove the word from the frontline of queue
    queue.shift();

    // SRS Logic
    const userWordRef = db.collection("user_words").doc(`${tgId}_${targetWordId}`);
    const uwDoc = await userWordRef.get();
    let uwData = uwDoc.data();

    if (!uwData) {
        uwData = { user_id: tgId, word_id: targetWordId, topic: topic, times_seen: 0, streak: 0, interval: 0 };
    }

    let nextIntervalDays = 0;
    let newStreak = uwData.streak || 0;

    let responseText = "";

    if (isCorrect) {
        stats.correct += 1;
        newStreak += 1;
        // Interval calculation (Simplified SRS)
        if (newStreak === 1) nextIntervalDays = 1;
        else if (newStreak === 2) nextIntervalDays = 3;
        else if (newStreak === 3) nextIntervalDays = 7;
        else nextIntervalDays = (uwData.interval || 7) * 2; // double

        responseText = `✅ **Правильно!**\n\n*${targetWordData.es}* — *${targetWordData.ru}*`;
    } else {
        stats.wrong += 1;
        newStreak = 0;
        nextIntervalDays = 0; // Due immediately
        
        // Push the word back into the queue so they have to answer it again in THIS session
        queue.push(targetWordId);
        
        responseText = `❌ **Ошибка!**\nПравильный ответ:\n*${targetWordData.es}* — *${targetWordData.ru}*`;
    }

    if (targetWordData.context) {
         responseText += `\n📝 ${targetWordData.context}`;
    }

    // Save SRS updates
    const nextDateTimestamp = new Date(Date.now() + nextIntervalDays * 24 * 60 * 60 * 1000);
    
    await userWordRef.set({
        ...uwData,
        streak: newStreak,
        interval: nextIntervalDays,
        next_review_date: admin.firestore.Timestamp.fromDate(nextDateTimestamp)
    }, { merge: true });

    // Update user session
    await userRef.set({
        quiz_queue: queue,
        quiz_stats: stats
    }, { merge: true });

    // Edit current message to show the outcome
    await ctx.editMessageText(responseText, { parse_mode: "Markdown" });
    
    // Immediately send next question
    await sendNextQuizQuestion(ctx);
};
