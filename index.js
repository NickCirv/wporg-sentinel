#!/usr/bin/env node
// wporg-sentinel — Stop refreshing WP.org. Get notified the moment your plugin gets approved.

import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ANSI color codes — no external deps
const C = {
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  reset:  '\x1b[0m',
};

const c = (color, text) => `${C[color]}${text}${C.reset}`;
const bold = (text) => `${C.bold}${text}${C.reset}`;

// ─── CLI ARGS ───────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { slug: null, telegram: null, interval: 15 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--slug' && args[i + 1]) {
      opts.slug = args[++i].trim().toLowerCase();
    } else if (args[i] === '--telegram' && args[i + 1]) {
      const [token, chatId] = args[++i].split(':');
      if (token && chatId) opts.telegram = { token, chatId };
    } else if (args[i] === '--interval' && args[i + 1]) {
      const parsed = parseInt(args[++i], 10);
      if (!isNaN(parsed) && parsed > 0) opts.interval = parsed;
    } else if (args[i] === '--help' || args[i] === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return opts;
}

function printHelp() {
  console.log(`
${bold('wporg-sentinel')} — Stop refreshing WP.org like a maniac.

${bold('USAGE')}
  node index.js --slug <plugin-slug> [options]
  npx wporg-sentinel --slug <plugin-slug> [options]

${bold('OPTIONS')}
  --slug <slug>              Plugin slug to watch ${c('red', '(required)')}
  --interval <minutes>       Initial poll interval in minutes (default: 15)
  --telegram <token:chatId>  Telegram bot token and chat ID for notifications
  --help, -h                 Show this help

${bold('EXAMPLES')}
  node index.js --slug my-awesome-plugin
  node index.js --slug my-awesome-plugin --interval 10
  node index.js --slug my-awesome-plugin --telegram 123456:BOT_TOKEN:987654321
`);
}

// ─── BANNER ─────────────────────────────────────────────────────────────────

function printBanner(slug) {
  console.log(`
${c('cyan', '┌─────────────────────────────────────────────────────────┐')}
${c('cyan', '│')}  ${bold(c('green', 'wporg-sentinel'))} ${c('dim', '— WP.org Plugin Approval Monitor')}        ${c('cyan', '│')}
${c('cyan', '└─────────────────────────────────────────────────────────┘')}

  ${c('dim', 'Plugin:')} ${bold(c('yellow', slug))}
  ${c('dim', 'API:')}    ${c('dim', 'https://api.wordpress.org/plugins/info/1.2/')}

${c('dim', '─────────────────────────────────────────────────────────')}
`);
}

// ─── WP.ORG API ─────────────────────────────────────────────────────────────

async function checkPlugin(slug) {
  const url = `https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${encodeURIComponent(slug)}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return { approved: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();

    if (data && data.slug) {
      return {
        approved: true,
        name: data.name || slug,
        version: data.version || '1.0.0',
        slug: data.slug,
        author: data.author ? data.author.replace(/<[^>]+>/g, '') : 'unknown',
        activeInstalls: data.active_installs || 0,
        lastUpdated: data.last_updated || 'just now',
      };
    }

    if (data && data.error) {
      return { approved: false, pending: true, message: data.error };
    }

    return { approved: false, error: 'Unexpected API response' };
  } catch (err) {
    clearTimeout(timeout);
    if (err.name === 'AbortError') {
      return { approved: false, error: 'Request timed out (15s)' };
    }
    return { approved: false, error: err.message };
  }
}

// ─── NOTIFICATIONS ──────────────────────────────────────────────────────────

async function notifyDesktop(slug, pluginName) {
  const title = 'wporg-sentinel';
  const message = `${pluginName || slug} is LIVE on WP.org! 🎉`;

  // macOS
  try {
    await execAsync(`osascript -e 'display notification "${message}" with title "${title}" sound name "Glass"'`);
    return 'macOS notification sent';
  } catch (_) {}

  // Linux
  try {
    await execAsync(`notify-send "${title}" "${message}"`);
    return 'Linux notification sent';
  } catch (_) {}

  return 'Desktop notification unavailable on this platform';
}

async function notifyTelegram(telegram, slug, pluginName) {
  const { token, chatId } = telegram;
  const text = `🛡️ *wporg-sentinel*\n\n✅ *${pluginName || slug}* is now LIVE on WordPress.org!\n\nhttps://wordpress.org/plugins/${slug}/`;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
    });
    const data = await res.json();
    if (data.ok) return 'Telegram notification sent';
    return `Telegram error: ${data.description}`;
  } catch (err) {
    return `Telegram failed: ${err.message}`;
  }
}

// ─── CELEBRATION ────────────────────────────────────────────────────────────

function printCelebration(result) {
  console.log(`
${c('green', '╔══════════════════════════════════════════════════════════╗')}
${c('green', '║')}  ${bold(c('yellow', '🎉  PLUGIN APPROVED!  🎉'))}                                ${c('green', '║')}
${c('green', '╚══════════════════════════════════════════════════════════╝')}

  ${bold('Plugin:')}   ${c('green', result.name)}
  ${bold('Slug:')}     ${c('cyan', result.slug)}
  ${bold('Version:')}  ${c('yellow', result.version)}
  ${bold('Author:')}   ${result.author}
  ${bold('URL:')}      ${c('cyan', `https://wordpress.org/plugins/${result.slug}/`)}

${c('green', '┌──────────────────────────────────────────────────────────┐')}
${c('green', '│')}  ${bold('What to do next:')}                                        ${c('green', '│')}
${c('green', '│')}  1. Announce on social media                             ${c('green', '│')}
${c('green', '│')}  2. Add the .org badge to your website                   ${c('green', '│')}
${c('green', '│')}  3. Ship the Freemius premium version                    ${c('green', '│')}
${c('green', '│')}  4. Sleep (you earned it)                                ${c('green', '│')}
${c('green', '└──────────────────────────────────────────────────────────┘')}
`);
}

// ─── POLLING TABLE ──────────────────────────────────────────────────────────

function printTableHeader() {
  console.log(
    c('dim', '  #    Time              Status           Next check in')
  );
  console.log(c('dim', '  ─────────────────────────────────────────────────────'));
}

function printTableRow(attempt, time, status, nextIn) {
  const num   = String(attempt).padStart(3, ' ');
  const ts    = time.padEnd(17, ' ');
  const st    = status.padEnd(16, ' ');
  const icon  = status.includes('pending') ? c('yellow', '○') :
                status.includes('error')   ? c('red', '✗') :
                c('green', '✓');
  console.log(`  ${c('dim', num)}  ${c('dim', ts)}  ${icon} ${st} ${c('dim', nextIn)}`);
}

// ─── COUNTDOWN ──────────────────────────────────────────────────────────────

function startCountdown(seconds, onTick) {
  return new Promise((resolve) => {
    let remaining = seconds;

    const tick = () => {
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const timeStr = mins > 0
        ? `${mins}m ${String(secs).padStart(2, '0')}s`
        : `${secs}s`;

      process.stdout.write(`\r  ${c('dim', '⏱  Next poll in:')} ${c('yellow', timeStr.padEnd(10, ' '))} ${c('dim', '(Ctrl+C to exit)')}  `);

      if (remaining <= 0) {
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
        resolve();
        return;
      }

      remaining--;
      setTimeout(tick, 1000);
    };

    tick();
  });
}

// ─── SUMMARY ────────────────────────────────────────────────────────────────

function printSummary(slug, history, startTime) {
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  console.log(`\n\n${c('cyan', '── Session Summary ──────────────────────────────────────')}`);
  console.log(`  Plugin:    ${bold(slug)}`);
  console.log(`  Runtime:   ${mins > 0 ? mins + 'm ' : ''}${secs}s`);
  console.log(`  Attempts:  ${history.length}`);
  if (history.length > 0) {
    const last = history[history.length - 1];
    console.log(`  Last check: ${last.time} — ${last.status}`);
  }
  console.log(c('cyan', '─────────────────────────────────────────────────────────'));
  console.log(`\n  Plugin is ${c('yellow', 'NOT YET APPROVED')}. Run again to resume monitoring.\n`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  if (!opts.slug) {
    console.error(`\n${c('red', 'Error:')} --slug is required.\n`);
    printHelp();
    process.exit(1);
  }

  const { slug, telegram, interval } = opts;
  const history = [];
  const startTime = Date.now();
  let attempt = 0;
  let currentInterval = interval * 60; // convert to seconds
  const maxInterval = 60 * 60; // 60 minutes cap

  printBanner(slug);

  if (telegram) {
    console.log(`  ${c('green', '✓')} Telegram notifications enabled (chat: ${telegram.chatId})`);
  }
  console.log(`  ${c('green', '✓')} Initial poll interval: ${c('yellow', interval + ' minutes')}`);
  console.log(`  ${c('dim', 'Exponential backoff up to 60 minutes')}\n`);
  printTableHeader();

  // SIGINT handler
  process.on('SIGINT', () => {
    printSummary(slug, history, startTime);
    process.exit(0);
  });

  // Main polling loop
  while (true) {
    attempt++;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    const result = await checkPlugin(slug);

    if (result.approved) {
      // SUCCESS
      printTableRow(attempt, timeStr, 'APPROVED ✓', '—');
      printCelebration(result);

      // Notifications
      const desktopStatus = await notifyDesktop(slug, result.name);
      console.log(`  ${c('dim', desktopStatus)}`);

      if (telegram) {
        const tgStatus = await notifyTelegram(telegram, slug, result.name);
        console.log(`  ${c('dim', tgStatus)}`);
      }

      process.exit(0);
    } else {
      // Not live yet
      const statusLabel = result.pending ? 'pending...' : `error: ${result.error || 'unknown'}`;
      const nextIntervalMins = Math.round(currentInterval / 60);
      const nextLabel = `~${nextIntervalMins}m`;

      printTableRow(attempt, timeStr, statusLabel, nextLabel);

      history.push({ attempt, time: timeStr, status: statusLabel });

      // Countdown to next poll
      await startCountdown(currentInterval);

      // Exponential backoff: double interval, cap at maxInterval
      currentInterval = Math.min(currentInterval * 2, maxInterval);
    }
  }
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal error:${C.reset}`, err.message);
  process.exit(1);
});
