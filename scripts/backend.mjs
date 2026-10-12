// Rebuilds backend/Code.gs from backend/src and the page modules it needs. Run: npm run backend
import { buildBackend } from '../src/build.mjs';

try {
  await buildBackend();
  console.log('backend/Code.gs is up to date; paste it into the Apps Script editor and deploy a new version.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
