import { emitKeypressEvents } from 'node:readline';

import { hashPassword } from '../auth/password.js';

async function readHiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('An interactive TTY is required; passwords are not accepted as arguments.');
  }
  process.stderr.write('Console admin password: ');
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let password = '';
    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('keypress', onKeypress);
      process.stderr.write('\n');
    };
    const onKeypress = (value: string, key: { name?: string; ctrl?: boolean }) => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        reject(new Error('Cancelled'));
      } else if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        resolve(password);
      } else if (key.name === 'backspace') {
        password = password.slice(0, -1);
      } else if (!key.ctrl && value) {
        password += value;
      }
    };
    process.stdin.on('keypress', onKeypress);
  });
}

try {
  const password = await readHiddenPassword();
  const encoded = await hashPassword(password);
  process.stdout.write(`${encoded}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'Password hashing failed'}\n`);
  process.exitCode = 1;
}
