const { Bot, GrammyError, HttpError } = require('grammy');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

require('events').EventEmitter.defaultMaxListeners = 120;

// Bot token
const token = '7914077254:AAHJxtLRqSM-QZPwcQfIYKSDdgXoQNtg-Jg';
const OWNER_ID = '6444305696';

// Initialize bot with increased timeout
const bot = new Bot(token, {
  client: {
    timeoutSeconds: 120,  // Increase timeout to 60 seconds
  },
});

// Logging function
function logError(error, context = '') {
  const logMessage = `${new Date().toISOString()} - ${context}: ${error.message}\n${error.stack}\n`;
  fs.appendFileSync('error.log', logMessage);
  console.error(logMessage);
}

// SQLite database initialization
const dbPath = path.resolve(__dirname, 'jadwal.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logError(err, 'Database initialization');
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Create table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS jadwal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hari TEXT NOT NULL,
    waktu TEXT NOT NULL
  )
`);

// Database functions with proper error handling
function getJadwalFromDB(day) {
  return new Promise((resolve, reject) => {
    const query = 'SELECT waktu FROM jadwal WHERE hari = ?';
    db.all(query, [day], (err, rows) => {
      if (err) {
        logError(err, 'getJadwalFromDB');
        reject(err);
      } else {
        resolve(rows.map(row => row.waktu));
      }
    });
  });
}

function updateJadwalInDB(day, schedule) {
  return new Promise((resolve, reject) => {
    const query = 'UPDATE jadwal SET waktu = ? WHERE hari = ?';
    db.run(query, [schedule, day], function(err) {
      if (err) {
        logError(err, 'updateJadwalInDB');
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function saveJadwalToDB(day, schedule) {
  return new Promise((resolve, reject) => {
    const query = 'INSERT INTO jadwal (hari, waktu) VALUES (?, ?)';
    db.run(query, [day, schedule], function(err) {
      if (err) {
        logError(err, 'saveJadwalToDB');
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

// Variables for tracking command usage
const lastCommandTime = {};
let groupChatId = null;

// Helper functions
function getCurrentDay() {
  const options = { timeZone: 'Asia/Jakarta', weekday: 'long' };
  return new Intl.DateTimeFormat('id-ID', options).format(new Date());
}

function getTimeDifferenceInMinutes(lastTime) {
  return Math.floor((Date.now() - lastTime) / (1000 * 60));
}

function formatJadwalMessage(day, scheduleItems) {
  const header = `<b>Donghua Schedule Today : </b>\n\n`;
  const body = Array.isArray(scheduleItems) ? scheduleItems.join('\n') : scheduleItems;
  const footer = `\n\n<b>schedule info : </b>\n<blockquote>The schedule can change at any time depending on the admin's mood!</blockquote>#botschedule`;
  return `${header}${body}${footer}`.replace(/<br\s*\/?>/gi, '\n');
}

// Command handlers
bot.command('start', async (ctx) => {
  if (ctx.chat.type !== 'private') {
    groupChatId = ctx.chat.id;
    await ctx.deleteMessage().catch(err => logError(err, 'Delete message in /start'));
    await ctx.reply("Bot has been activated. Ready to take orders!", { parse_mode: 'HTML' })
      .catch(err => logError(err, 'Reply in /start'));
  } else {
    // For private chats, just acknowledge without setting groupChatId
    await ctx.reply("Bot telah diaktifkan untuk penggunaan pribadi.", { parse_mode: 'HTML' })
      .catch(err => logError(err, 'Reply in private /start'));
  }
});

// Rest of the command handlers remain the same...
bot.command('addjadwal', async (ctx) => {
  // Check if user is the owner
  if (ctx.from.id.toString() !== OWNER_ID) {
    return await ctx.reply('Sorry, only bot owners can use this command.')
      .catch(err => logError(err, 'Reply in owner check /addjadwal'));
  }
  // Get day from command arguments
  const dayInput = ctx.match ? ctx.match.toLowerCase() : '';
  const validDays = ['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'];
  
  if (!dayInput || !validDays.includes(dayInput)) {
    return await ctx.reply('Invalid format. Please enter a valid day. (senin, selasa, rabu, kamis, jumat, sabtu, minggu)')
      .catch(err => logError(err, 'Reply in /addjadwal'));
  }
  const replyToMessage = ctx.message.reply_to_message;
  if (replyToMessage && replyToMessage.text) {
    const chosenDay = dayInput.charAt(0).toUpperCase() + dayInput.slice(1);
    try {
      const jadwalExisting = await getJadwalFromDB(chosenDay);
      if (jadwalExisting.length > 0) {
        await updateJadwalInDB(chosenDay, replyToMessage.text);
        await ctx.reply(`Schedule for the day ${chosenDay} successfully updated!`);
      } else {
        await saveJadwalToDB(chosenDay, replyToMessage.text);
        await ctx.reply(`Schedule for the day ${chosenDay} successfully added!`);
      }
    } catch (err) {
      logError(err, '/addjadwal database operation');
      await ctx.reply('Terjadi kesalahan saat memproses jadwal. Silakan coba lagi nanti.')
        .catch(err => logError(err, 'Reply in /addjadwal error'));
    }
  } else {
    await ctx.reply('Mohon balas pesan yang berisi jadwal untuk menambahkannya.')
      .catch(err => logError(err, 'Reply in /addjadwal'));
  }
});


bot.command('jadwal', async (ctx) => {
  const userId = ctx.from.id;
  const currentDay = getCurrentDay();
  const currentTime = Date.now();
  const waitTime = 50;

  if (!lastCommandTime[userId] || getTimeDifferenceInMinutes(lastCommandTime[userId]) >= waitTime) {
    lastCommandTime[userId] = currentTime;

    try {
      const jadwalItems = await getJadwalFromDB(currentDay);
      if (jadwalItems && jadwalItems.length > 0) {
        const messageText = formatJadwalMessage(currentDay, jadwalItems);
        await ctx.reply(messageText, { parse_mode: 'HTML' });
      } else {
        await ctx.reply("Jadwal tidak tersedia untuk hari ini.");
      }
    } catch (err) {
      logError(err, '/jadwal command');
      await ctx.reply('Failed to get schedule. Please try again later.');
    }
  } else {
    const timeRemaining = waitTime - getTimeDifferenceInMinutes(lastCommandTime[userId]);
    await ctx.reply(
      `<b>Anti Spam!</b>\nThe Schedule command can be accessed in ${timeRemaining} minutes. The schedule has been sent 50 minutes ago, press the hashtag \n#botschedule`,
      { parse_mode: 'HTML' }
    ).catch(err => logError(err, 'Anti-spam reply in /jadwal'));
  }

  setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id)
    .catch(err => logError(err, 'Delete message in /jadwal')), 1000);
});

bot.command('rules', async (ctx) => {
  const userId = ctx.from.id;
  const currentTime = Date.now();
  const waitTime = 50;

  if (!lastCommandTime[userId] || getTimeDifferenceInMinutes(lastCommandTime[userId]) >= waitTime) {
    lastCommandTime[userId] = currentTime;
    const rules = `
<b> Animexin group rules :</b>
<blockquote>
Please do not promote or share other websites here. 
If you wish to provide a spoiler, please use a spoiler tag.
</blockquote>
#botrules
    `;
    try {
      const sentMessage = await ctx.reply(rules, { parse_mode: 'HTML' });
      setTimeout(() => {
        ctx.api.deleteMessage(ctx.chat.id, sentMessage.message_id)
          .catch(err => logError(err, 'Delete rules message'));
      }, 5 * 60 * 1000);
    } catch (err) {
      logError(err, 'Send rules message');
    }
  } else {
    const timeRemaining = waitTime - getTimeDifferenceInMinutes(lastCommandTime[ctx.from.id]);
    await ctx.reply(
      `<b>Anti Spam!</b>\nThe Schedule command can be accessed in ${timeRemaining} minutes. The schedule has been sent 50 minutes ago, press the hashtag \n#botrules`,
      { parse_mode: 'HTML' }
    ).catch(err => logError(err, 'Anti-spam reply in /rules'));
  }

  setTimeout(() => ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id)
    .catch(err => logError(err, 'Delete message in /rules')), 1000);
});

// Helper function to safely delete messages

async function safeDeleteMessage(ctx, messageId = null, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      // If no messageId provided, use the current command message ID
      const targetMessageId = messageId || ctx.message.message_id;
      await ctx.api.deleteMessage(ctx.chat.id, targetMessageId);
      return true;
    } catch (error) {
      if (error.error_code === 400 && error.description.includes('message to delete not found')) {
        console.log(`Message ${targetMessageId} already deleted or not found`);
        return false;
      }
      // Log other types of errors
      console.error('Error deleting message:', error);
      if (i < retries - 1) {
        console.log(`Retrying delete message in ${i + 1} seconds...`);
        await new Promise(resolve => setTimeout(resolve, (i + 1) * 1000));
      }
    }
  }
  console.error(`Failed to delete message after ${retries} attempts`);
  return false;
}

// Updated setgroup command
bot.command('setgroup', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) {
    const reply = await ctx.reply('Sorry, only bot owners can use this command.')
      .catch(err => logError(err, 'Reply in owner check /setgroup'));
    
    // Delete both command and response after delay
    setTimeout(async () => {
      await safeDeleteMessage(ctx); // Delete command
      if (reply) await safeDeleteMessage(ctx, reply.message_id); // Delete response
    }, 5000);
    
    return;
  }

  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') {
    const reply = await ctx.reply('Perintah ini hanya dapat digunakan dalam grup.')
      .catch(err => logError(err, 'Reply in /setgroup - not in group'));
    
    // Delete both command and response after delay
    setTimeout(async () => {
      await safeDeleteMessage(ctx);
      if (reply) await safeDeleteMessage(ctx, reply.message_id);
    }, 5000);
    
    return;
  }

  try {
    groupChatId = ctx.chat.id;
    const reply = await ctx.reply(`Group successfully set as broadcast destination! ID : ${groupChatId}`)
      .catch(err => logError(err, 'Confirmation in /setgroup'));
    
    // Delete both command and response after delay
    setTimeout(async () => {
      await safeDeleteMessage(ctx);
      if (reply) await safeDeleteMessage(ctx, reply.message_id);
    }, 5000);
    
  } catch (err) {
    logError(err, '/setgroup command');
    const errorReply = await ctx.reply('Gagal mengatur grup. Silakan coba lagi nanti.')
      .catch(err => logError(err, 'Error reply in /setgroup'));
    
    // Delete both command and error message after delay
    setTimeout(async () => {
      await safeDeleteMessage(ctx);
      if (errorReply) await safeDeleteMessage(ctx, errorReply.message_id);
    }, 5000);
  }
});

// Enhanced broadcast command with HTML formatting support
bot.command('broadcast', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) {
    return await ctx.reply('Sorry, only bot owners can use this command.')
      .catch(err => logError(err, 'Reply in owner check /broadcast'));
  }

  if (!groupChatId) {
    return await ctx.reply('The broadcast destination group is not set. Use the /setgroup command inside the destination group..')
      .catch(err => logError(err, 'Reply in /broadcast - no group set'));
  }

  const replyToMessage = ctx.message.reply_to_message;
  if (!replyToMessage) {
    return await ctx.reply('Mohon balas pesan yang ingin di-broadcast.')
      .catch(err => logError(err, 'Reply in /broadcast'));
  }

  try {
    let messageText = replyToMessage.text || replyToMessage.caption || '';
    let entities = replyToMessage.entities || replyToMessage.caption_entities || [];

    // Parse button configuration
    let buttons = [];
    const buttonConfig = messageText.match(/\[button:(.*?)\|(.*?)\]/g);
    if (buttonConfig) {
      buttons = buttonConfig.map(btn => {
        const [text, url] = btn.slice(8, -1).split('|');
        return { text, url };
      });
      messageText = messageText.replace(/\[button:.*?\]/g, '').trim();
    }

    const inlineKeyboard = buttons.length > 0 ? {
      inline_keyboard: [buttons.map(btn => ({ text: btn.text, url: btn.url }))]
    } : undefined;

    // Enhanced message options with HTML support
    const messageOptions = {
      caption: messageText,
      parse_mode: 'HTML',
      reply_markup: inlineKeyboard
    };

    if (replyToMessage.photo) {
      await bot.api.sendPhoto(groupChatId, replyToMessage.photo[replyToMessage.photo.length - 1].file_id, messageOptions);
    } else if (replyToMessage.video) {
      await bot.api.sendVideo(groupChatId, replyToMessage.video.file_id, messageOptions);
    } else if (replyToMessage.animation) {
      await bot.api.sendAnimation(groupChatId, replyToMessage.animation.file_id, messageOptions);
    } else if (replyToMessage.document) {
      await bot.api.sendDocument(groupChatId, replyToMessage.document.file_id, messageOptions);
    } else if (replyToMessage.audio) {
      await bot.api.sendAudio(groupChatId, replyToMessage.audio.file_id, messageOptions);
    } else if (replyToMessage.voice) {
      await bot.api.sendVoice(groupChatId, replyToMessage.voice.file_id, messageOptions);
    } else if (replyToMessage.sticker) {
      await bot.api.sendSticker(groupChatId, replyToMessage.sticker.file_id);
    } else if (messageText) {
      await bot.api.sendMessage(groupChatId, messageText, {
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: inlineKeyboard
      });
    } else {
      return await ctx.reply('Jenis pesan ini belum didukung untuk broadcast.')
        .catch(err => logError(err, 'Unsupported message type in /broadcast'));
    }
    
    await ctx.reply('Pesan broadcast berhasil dikirim!')
      .catch(err => logError(err, 'Confirmation in /broadcast'));
    
    setTimeout(() => ctx.deleteMessage()
      .catch(err => logError(err, 'Delete command in /broadcast')), 1000);
      
  } catch (err) {
    logError(err, '/broadcast command');
    await ctx.reply('Gagal mengirim pesan broadcast. Silakan coba lagi nanti.')
      .catch(err => logError(err, 'Error reply in /broadcast'));
  }
});

// Updated format command with complete HTML formatting guide including blockquote
bot.command('format', async (ctx) => {
  if (ctx.from.id.toString() !== OWNER_ID) {
    return await ctx.reply('Sorry, only bot owners can use this command.')
      .catch(err => logError(err, 'Reply in owner check /format'));
  }

  const helpText = `
<b>Panduan Format Teks HTML Telegram:</b>

1. Format Dasar:
• &lt;b&gt;teks&lt;/b&gt; = <b>Teks tebal</b>
• &lt;strong&gt;teks&lt;/strong&gt; = <strong>Teks tebal</strong>
• &lt;i&gt;teks&lt;/i&gt; = <i>Teks miring</i>
• &lt;em&gt;teks&lt;/em&gt; = <em>Teks miring</em>
• &lt;u&gt;teks&lt;/u&gt; = <u>Garis bawah</u>
• &lt;s&gt;teks&lt;/s&gt; = <s>Teks dicoret</s>
• &lt;del&gt;teks&lt;/del&gt; = <del>Teks dicoret</del>
• &lt;tg-spoiler&gt;teks&lt;/tg-spoiler&gt; = Spoiler
• &lt;blockquote&gt;teks&lt;/blockquote&gt; = <blockquote>Teks kutipan</blockquote>
• &lt;code&gt;teks&lt;/code&gt; = <code>Kode inline</code>
• &lt;pre&gt;teks&lt;/pre&gt; = Teks pre-formatted

2. Format Khusus:
• &lt;pre&gt;&lt;code class="language-python"&gt;kode&lt;/code&gt;&lt;/pre&gt; = Kode dengan syntax highlighting
• &lt;a href="URL"&gt;teks&lt;/a&gt; = <a href="https://example.com">Link dengan teks</a>

3. Kombinasi Format:
• <b><i>Teks tebal dan miring</i></b>
• <b><u>Teks tebal dan garis bawah</u></b>
• <i><u>Teks miring dan garis bawah</u></i>
• <b><i><u>Kombinasi semua</u></i></b>
• <blockquote><b>Kutipan tebal</b></blockquote>
• <blockquote><i>Kutipan miring</i></blockquote>

4. Contoh Penggunaan Blockquote:
<blockquote>Ini adalah teks kutipan biasa</blockquote>
<blockquote><b>Ini kutipan dengan teks tebal</b></blockquote>
<blockquote><i>Ini kutipan dengan teks miring</i></blockquote>
<blockquote><b><i>Ini kutipan dengan teks tebal dan miring</i></b></blockquote>

5. Tombol Inline:
Untuk menambahkan tombol, gunakan format:
<code>
Pesan dengan tombol
[button:Teks Tombol|https://link.com]
[button:Tombol 2|https://link2.com]
</code>

Tips Penggunaan:
1. Format HTML lebih mudah dari Markdown
2. Pastikan setiap tag dibuka dan ditutup dengan benar
3. Untuk mention user gunakan @username biasa
4. Untuk hashtag gunakan #hashtag biasa
5. Blockquote bisa dikombinasikan dengan format lain

Cara Pakai:
1. Ketik/salin pesan dengan format di atas
2. Reply pesan tersebut dengan /broadcast
3. Atau gunakan menu format bawaan Telegram

<i>Note: Format akan otomatis diproses saat broadcast</i>`;

  await ctx.reply(helpText, { 
    parse_mode: 'HTML',
    disable_web_page_preview: true 
  }).catch(err => logError(err, 'Reply in /format'));
});

// Helper function to log errors
function logError(error, context) {
  console.error(`Error in ${context}:`, error);
}

// Function to send messages with retry
async function sendMessageWithRetry(chatId, messageText, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await bot.api.sendMessage(chatId, messageText, { parse_mode: 'HTML' });
      console.log('Pesan otomatis telah dikirim ke grup');
      return;
    } catch (error) {
      logError(error, `Attempt ${i + 1} to send automatic message`);
      if (i < retries - 1) {
        console.log('Mencoba ulang pengiriman...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  console.error(`Gagal mengirim pesan setelah ${retries} percobaan`);
}

// Modified function to send automatic messages
async function sendAutomaticMessage() {
  if (!groupChatId) {
    console.log('groupChatId belum diatur. Menunggu bot diaktifkan di grup...');
    return;
  }

  // Verify this is actually a group chat ID
  try {
    const chat = await bot.api.getChat(groupChatId);
    if (chat.type === 'private') {
      console.log('Menghindari pengiriman ke chat pribadi');
      return;
    }
  } catch (err) {
    logError(err, 'Verifying chat type');
    return;
  }

  const currentDay = getCurrentDay();
  try {
    const jadwalItems = await getJadwalFromDB(currentDay);
    if (jadwalItems && jadwalItems.length > 0) {
      const messageText = formatJadwalMessage(currentDay, jadwalItems);
      await sendMessageWithRetry(groupChatId, messageText);
      console.log(`Pesan terkirim ke grup pada: ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
    }
  } catch (err) {
    logError(err, 'sendAutomaticMessage');
  }
}

// Schedule automatic messages
function startAutomaticMessages() {
  sendAutomaticMessage();
  setInterval(sendAutomaticMessage, 6 * 60 * 60 * 1000);
}

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    console.error("Error in request:", e.description);
  } else if (e instanceof HttpError) {
    console.error("Could not contact Telegram:", e);
  } else {
    console.error("Unknown error:", e);
  }
  logError(err, 'Uncaught bot error');
});

// Start the bot
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot ${botInfo.username} berjalan...`);
    startAutomaticMessages();
  },
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  logError(reason, 'Unhandled Rejection');
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  logError(error, 'Uncaught Exception');
  process.exit(1);
});
