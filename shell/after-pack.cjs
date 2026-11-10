const fs = require('node:fs/promises');
const path = require('node:path');

// A reused Electron distribution can contain a developer's portable profile.
module.exports = async context => {
  const output = path.resolve(context.appOutDir);
  const profile = path.resolve(output, 'bigfish-chat-profile');
  if (path.dirname(profile) !== output) throw new Error('Invalid profile cleanup path');
  await fs.rm(profile, { recursive: true, force: true });
};
