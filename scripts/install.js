#!/usr/bin/env node

/**
 * Antigravity Chat Timeline Installer
 * Injects the Codex-style session timeline into Antigravity's preload.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function findPreloadPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const candidates = [
    path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app', 'dist', 'preload.js'),
    path.join('C:', 'Users', process.env.USERNAME || '', 'AppData', 'Local', 'Programs', 'Antigravity', 'resources', 'app', 'dist', 'preload.js')
  ];

  if (process.argv[2]) {
    candidates.unshift(path.resolve(process.argv[2]));
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }
  return null;
}

function main() {
  console.log('🚀 Antigravity Chat Timeline Installer\n');

  const preloadPath = findPreloadPath();
  if (!preloadPath) {
    console.error('❌ Error: Could not find Antigravity preload.js automatically.');
    console.error('Please pass the path to preload.js as an argument:');
    console.error('  node scripts/install.js "C:\\path\\to\\preload.js"\n');
    process.exit(1);
  }

  console.log(`📁 Found target: ${preloadPath}`);

  // Create backup if not already present
  const backupPath = preloadPath + '.bak';
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(preloadPath, backupPath);
    console.log(`💾 Created backup: ${backupPath}`);
  } else {
    console.log(`ℹ️ Existing backup found: ${backupPath}`);
  }

  const timelineSrcPath = path.join(__dirname, '..', 'src', 'timeline.js');
  if (!fs.existsSync(timelineSrcPath)) {
    console.error(`❌ Error: Could not find timeline source at ${timelineSrcPath}`);
    process.exit(1);
  }

  const timelineCode = fs.readFileSync(timelineSrcPath, 'utf8');
  let preloadContent = fs.readFileSync(preloadPath, 'utf8');

  const START_TAG = '// === ANTIGRAVITY TIMELINE INJECTION START ===';
  const END_TAG = '// === ANTIGRAVITY TIMELINE INJECTION END ===';

  const injectionBlock = `\n${START_TAG}\n${timelineCode}\n${END_TAG}\n`;

  if (preloadContent.includes('initAntigravityTimeline')) {
    console.log('🔄 Updating existing timeline installation...');
    // If tagged block exists, replace it
    if (preloadContent.includes(START_TAG) && preloadContent.includes(END_TAG)) {
      const regex = new RegExp(`${START_TAG}[\\s\\S]*?${END_TAG}`, 'g');
      preloadContent = preloadContent.replace(regex, `${START_TAG}\n${timelineCode}\n${END_TAG}`);
    } else {
      // Replace untagged initAntigravityTimeline block
      const regex = /\/\/ =*\s*\/\/ Antigravity 会话轮次时间轴[\s\S]*?\}\)\(\);\s*/g;
      if (regex.test(preloadContent)) {
        preloadContent = preloadContent.replace(regex, injectionBlock);
      } else {
        preloadContent += injectionBlock;
      }
    }
  } else {
    console.log('➕ Injecting timeline into preload.js...');
    preloadContent += injectionBlock;
  }

  fs.writeFileSync(preloadPath, preloadContent, 'utf8');

  // Validate syntax
  try {
    execSync(`node --check "${preloadPath}"`, { stdio: 'pipe' });
    console.log('✅ Syntax validation passed.');
  } catch (err) {
    console.error('❌ Syntax error detected! Restoring from backup...');
    fs.copyFileSync(backupPath, preloadPath);
    console.error('Reverted to original preload.js.');
    process.exit(1);
  }

  console.log('\n🎉 Successfully installed Antigravity Chat Timeline!');
  console.log('🔄 Please restart Antigravity to see the timeline in action.\n');
}

main();
