#!/usr/bin/env node

/**
 * Antigravity Chat Timeline Uninstaller
 * Removes the injected timeline from Antigravity's preload.js
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
  console.log('🧹 Antigravity Chat Timeline Uninstaller\n');

  const preloadPath = findPreloadPath();
  if (!preloadPath) {
    console.error('❌ Error: Could not find Antigravity preload.js.');
    process.exit(1);
  }

  const backupPath = preloadPath + '.bak';
  if (fs.existsSync(backupPath)) {
    console.log(`💾 Restoring from backup: ${backupPath}`);
    fs.copyFileSync(backupPath, preloadPath);
    console.log('✅ Successfully restored original preload.js!');
  } else {
    console.log('ℹ️ No backup file found. Stripping injection block from preload.js...');
    let content = fs.readFileSync(preloadPath, 'utf8');

    const START_TAG = '// === ANTIGRAVITY TIMELINE INJECTION START ===';
    const END_TAG = '// === ANTIGRAVITY TIMELINE INJECTION END ===';

    if (content.includes(START_TAG) && content.includes(END_TAG)) {
      const regex = new RegExp(`\\n*${START_TAG}[\\s\\S]*?${END_TAG}\\n*`, 'g');
      content = content.replace(regex, '\n');
    } else {
      const regex = /\/\/ =*\s*\/\/ Antigravity 会话轮次时间轴[\s\S]*?\}\)\(\);\s*/g;
      content = content.replace(regex, '\n');
    }

    fs.writeFileSync(preloadPath, content, 'utf8');
  }

  try {
    execSync(`node --check "${preloadPath}"`, { stdio: 'pipe' });
    console.log('✅ Syntax validation passed.');
  } catch (err) {
    console.error('⚠️ Warning: Syntax check failed on modified preload.js.');
  }

  console.log('\n🎉 Successfully uninstalled Antigravity Chat Timeline.');
  console.log('🔄 Please restart Antigravity to apply changes.\n');
}

main();
